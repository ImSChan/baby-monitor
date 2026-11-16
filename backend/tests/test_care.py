import json
from copy import deepcopy
from datetime import datetime, timedelta
from uuid import uuid4
import pytest
from sqlmodel import Session, select
from app.models import CareRecord, EmotionEvent, NotificationPreference, NotificationEvent, PushDevice
from app.services.care_context_service import build_care_snapshot, apply_care_context, stamp
from app.utils.time import kst_now


def meal(at=None, **extra):
    return {'id':str(uuid4()), 'kind':'feeding', 'meal_type':'meal',
            'started_at':stamp(at or kst_now()-timedelta(minutes=10)), 'ended_at':None, **extra}


def sleep(start=None, end=None, **extra):
    now = kst_now()
    return {'id':str(uuid4()), 'kind':'sleep', 'meal_type':None,
            'started_at':stamp(start or now-timedelta(hours=10)),
            'ended_at':stamp(end or now-timedelta(hours=2)), **extra}


def model():
    return {'emotion':'배고픔','need':'feeding','confidence':.5,'message':'model feeding',
        'normalOverride':False,'topPredictions':[
            {'emotion':'배고픔','need':'feeding','confidence':.5,'message':'model feeding'},
            {'emotion':'잠와요','need':'sleep','confidence':.48,'message':'model sleep'}]}


def test_record_crud_auth_idempotency_revision_and_delete(client, auth):
    item = meal()
    assert client.post('/api/care/records',json=item).status_code == 403
    first = client.post('/api/care/records',headers=auth(1),json=item)
    assert first.status_code == 201, first.text
    assert client.post('/api/care/records',headers=auth(1),json=item).json() == first.json()
    assert client.get('/api/care/records',headers=auth(2)).json()['items'] == []
    update = {**item,'meal_type':'milk','expected_revision':1}
    assert client.post(f"/api/care/records/{item['id']}",headers=auth(2),json=update).status_code == 404
    response = client.post(f"/api/care/records/{item['id']}",headers=auth(1),json=update)
    assert response.json()['revision'] == 2
    assert client.post(f"/api/care/records/{item['id']}",headers=auth(1),json=update).status_code == 409
    url=f"/api/care/records/{item['id']}/delete?expected_revision="
    assert client.post(url+'1',headers=auth(1)).status_code == 409
    assert client.post(url+'2',headers=auth(2)).status_code == 404
    assert client.post(url+'2',headers=auth(1)).status_code == 204
    assert client.post(url+'2',headers=auth(1)).status_code == 204
    assert client.get('/api/care/records',headers=auth(1)).json()['items'] == []


@pytest.mark.parametrize('payload',[
    meal(started_at='2026-01-01T12:00:00'),
    meal(started_at=stamp(kst_now()+timedelta(days=1))),
    meal(meal_type=None), meal(ended_at=stamp(kst_now())),
    sleep(ended_at=None), sleep(meal_type='milk'),
    sleep(start=kst_now()-timedelta(hours=30),end=kst_now()-timedelta(hours=1)),
    sleep(start=kst_now()-timedelta(hours=1),end=kst_now()-timedelta(hours=2)),
])
def test_invalid_times_and_shapes_rejected(client, auth, payload):
    assert client.post('/api/care/records',headers=auth(1),json=payload).status_code == 422


def test_overnight_sleep_overlap_and_query_boundary(client, auth):
    first=sleep()
    assert client.post('/api/care/records',headers=auth(1),json=first).status_code == 201
    assert client.post('/api/care/records',headers=auth(1),json=sleep()).status_code == 409
    # Touching boundaries are allowed; overlap is not.
    end=datetime.fromisoformat(first['started_at'])
    adjacent=sleep(start=(end-timedelta(hours=1)).replace(tzinfo=None),end=end.replace(tzinfo=None))
    assert client.post('/api/care/records',headers=auth(1),json=adjacent).status_code == 201
    assert client.get('/api/care/records',headers=auth(1),params={'start':stamp(kst_now()-timedelta(hours=3))}).json()['items'][0]['id']==first['id']
    assert client.get('/api/care/records?start=2026-01-01T00:00:00',headers=auth(1)).status_code==422


def test_snapshot_scoping_clipping_and_disabled_summary(db, client, auth):
    now=kst_now()
    client.post('/api/care/records',headers=auth(1),json=meal(now-timedelta(minutes=5)))
    client.post('/api/care/records',headers=auth(2),json=meal(now-timedelta(minutes=1)))
    client.post('/api/care/records',headers=auth(1),json=sleep(now-timedelta(hours=30),now-timedelta(hours=20)))
    with Session(db) as session:
        snapshot=build_care_snapshot(session,1,now)
        assert snapshot['minutesSinceMeal']==5
        assert snapshot['recordedSleepMinutes24h']==240
        assert snapshot['sleepCoverage']=='not_confirmed'
    client.post('/api/care/preferences',headers=auth(1),json={'context_enabled':False})
    with Session(db) as session:
        assert build_care_snapshot(session,1,now)['reason']=='parent_disabled'
    summary=client.get('/api/care/summary',headers=auth(1)).json()
    assert summary['contextEnabled'] is False and summary['context']['minutesSinceMeal']==5


def test_recent_meal_changes_only_close_model_tie_and_keeps_original():
    raw=model(); original=deepcopy(raw)
    snapshot={'enabled':True,'policyVersion':'care-10m-v1','minutesSinceMeal':10}
    adjusted=apply_care_context(raw,snapshot)
    assert raw==original
    assert adjusted['need']=='sleep'
    assert adjusted['careContext']['winnerChanged']
    assert adjusted['careContext']['modelPrediction']['need']=='feeding'
    assert adjusted['topPredictions'][1]['modelConfidence']==.5
    raw['confidence']=.9;raw['topPredictions'][0]['confidence']=.9
    assert apply_care_context(raw,snapshot)['need']=='feeding'


def test_no_records_quiet_stable_and_missing_model_evidence_never_create_a_label():
    raw=model()
    for snapshot in [None,{'enabled':False,'reason':'no_records'}]:
        assert apply_care_context(raw,snapshot)['topPredictions']==raw['topPredictions']
    snapshot={'enabled':True,'policyVersion':'care-10m-v1','minutesSinceMeal':10}
    raw.update(need='stable',normalOverride=True)
    assert not apply_care_context(raw,snapshot)['careContext']['applied']
    raw=model();raw['topPredictions']=[raw['topPredictions'][1]]
    assert not apply_care_context(raw,snapshot)['careContext']['applied']


def test_long_gap_is_not_a_medical_threshold_and_unknown_sleep_is_not_deficiency(db):
    now=kst_now()
    with Session(db) as session:
        session.add(CareRecord(id=str(uuid4()),user_id=1,kind='feeding',meal_type='meal',started_at=now-timedelta(hours=5)))
        session.commit()
        sparse=build_care_snapshot(session,1,now)
    assert sparse['typicalMealGapMinutes'] is None
    assert not apply_care_context(model(),sparse)['careContext']['applied']


def test_personal_meal_pattern_can_raise_supported_candidate(db):
    now=kst_now(); day=now.replace(hour=0,minute=0,second=0,microsecond=0)-timedelta(days=1)
    with Session(db) as session:
        for hour in (1,4,7,10,13,16):
            session.add(CareRecord(id=str(uuid4()),user_id=1,kind='feeding',meal_type='meal',started_at=day+timedelta(hours=hour)))
        reference=day+timedelta(hours=20)
        session.commit();snapshot=build_care_snapshot(session,1,reference)
    assert snapshot['typicalMealGapMinutes']==180
    out=apply_care_context(model(),snapshot)
    assert out['confidence']==.56 and out['careContext']['adjustments'][0]['delta']==.06


def test_personal_sleep_pattern_and_recent_wake_remain_small_adjustments(db):
    now=kst_now();day=now.replace(hour=0,minute=0,second=0,microsecond=0)-timedelta(days=1)
    with Session(db) as session:
        for hour in (0,4,8,12,16):
            session.add(CareRecord(id=str(uuid4()),user_id=1,kind='sleep',
                started_at=day+timedelta(hours=hour),ended_at=day+timedelta(hours=hour+1)))
        session.commit();snapshot=build_care_snapshot(session,1,day+timedelta(hours=21))
    assert snapshot['typicalAwakeGapMinutes']==180
    out=apply_care_context(model(),snapshot)
    assert out['need']=='sleep' and out['confidence']==.54
    recent={**snapshot,'minutesSinceWake':10,'lastSleepDurationMinutes':60}
    out=apply_care_context(model(),recent)
    assert out['need']=='feeding'
    assert out['careContext']['adjustments'][0]['delta']==-.04


def test_snapshot_never_uses_records_after_capture_time(db,client,auth):
    now=kst_now()
    client.post('/api/care/records',headers=auth(1),json=meal(now-timedelta(minutes=5)))
    with Session(db) as session:
        snapshot=build_care_snapshot(session,1,now-timedelta(minutes=10))
    assert snapshot['reason']=='no_records'
    assert not apply_care_context(model(),snapshot)['careContext']['applied']


def test_recording_is_not_feedback_or_a_training_label(db,client,auth):
    from app.models import InferenceFeedback, TrainingJob
    client.post('/api/care/records',headers=auth(1),json=meal())
    client.post('/api/care/records',headers=auth(1),json=sleep())
    with Session(db) as session:
        assert session.exec(select(InferenceFeedback)).all()==[]
        assert session.exec(select(TrainingJob)).all()==[]


def test_inference_api_snapshots_server_owned_logs_and_requires_real_capture_time(db, client, auth, tmp_path, monkeypatch):
    from app.routers import inference
    client.app.include_router(inference.router,prefix='/api/inference')
    monkeypatch.setattr(inference,'UPLOAD_ROOT',tmp_path)
    jobs=[];monkeypatch.setattr(inference,'enqueue_inference_job',jobs.append)
    record=meal();client.post('/api/care/records',headers=auth(1),json=record)
    def upload(data):
        return client.post('/api/inference/multimodal',headers=auth(1),data=data,
            files=[('frame_files',('frame.jpg',b'isolated mock frame','image/jpeg'))])
    assert upload({'care_context_allowed':'true'}).status_code==422
    assert upload({'care_context_allowed':'true','captured_at':stamp(kst_now()+timedelta(days=1))}).status_code==422
    response=upload({'care_context_allowed':'true','captured_at':stamp(kst_now())})
    assert response.status_code==200,response.text
    path=tmp_path/response.json()['requestId']/'metadata.json'
    metadata=json.loads(path.read_text(encoding='utf-8'))
    assert metadata['care_context']['minutesSinceMeal']==10
    snapshot=metadata['care_context']
    client.post(f"/api/care/records/{record['id']}/delete?expected_revision=1",headers=auth(1))
    assert json.loads(path.read_text(encoding='utf-8'))['care_context']==snapshot
    unknown=upload({})
    unknown_meta=json.loads((tmp_path/unknown.json()['requestId']/'metadata.json').read_text(encoding='utf-8'))
    assert unknown_meta['care_context']['reason']=='capture_time_unknown'


def test_worker_persists_adjusted_state_and_alerts_after_three(db, client, auth, tmp_path, monkeypatch, push_enabled):
    from app.routers import inference
    from app.workers import analysis_worker, notification_worker
    client.app.include_router(inference.router,prefix='/api/inference')
    monkeypatch.setattr(inference,'UPLOAD_ROOT',tmp_path)
    jobs=[];monkeypatch.setattr(inference,'enqueue_inference_job',jobs.append)
    monkeypatch.setattr(analysis_worker,'engine',db)
    monkeypatch.setattr(analysis_worker,'run_multimodal_inference',lambda **_:model())
    monkeypatch.setattr(analysis_worker,'set_job_status',lambda *args,**kwargs:None)
    monkeypatch.setattr(analysis_worker,'set_job_result',lambda *args,**kwargs:None)
    client.post('/api/care/records',headers=auth(1),json=meal())
    with Session(db) as session:
        session.add(NotificationPreference(user_id=1,enabled=True))
        session.add(PushDevice(user_id=1,token='isolated-mock-device-token',installation_id=str(uuid4())))
        session.commit()
    for _ in range(3):
        response=client.post('/api/inference/multimodal',headers=auth(1),
            data={'care_context_allowed':'true','quiet_audio':'false','captured_at':stamp(kst_now())},
            files=[('frame_files',('frame.jpg',b'isolated mock frame','image/jpeg'))])
        assert response.status_code==200,response.text
        job=jobs[-1];path=tmp_path/job['request_id']/'metadata.json'
        metadata=json.loads(path.read_text(encoding='utf-8'));metadata['synthetic']=True
        path.write_text(json.dumps(metadata),encoding='utf-8')
        analysis_worker.process_job(job)
        final=json.loads(path.read_text(encoding='utf-8'))
        assert final['status']=='completed', final.get('failed_at')
        assert final['result']['careContext']['winnerChanged']
    with Session(db) as session:
        events=session.exec(select(EmotionEvent)).all()
        assert len(events)==3 and all(e.need=='sleep' for e in events)
        alert=session.exec(select(NotificationEvent)).one()
        assert alert.result['need']=='sleep' and alert.result['careContext']['applied']
    sent=[]
    history=client.get('/api/inference/history',headers=auth(1)).json()
    assert history['items'][0]['careContext']['applied']
    for _ in range(3):notification_worker.dispatch_once(lambda token,event:sent.append(event.id) or 'mock-sent',db)
    assert len(sent)==1
    assert analysis_worker.parse_captured_at('2026-11-16T01:00:00Z')==datetime(2026,11,16,10)
