from datetime import timedelta
from sqlmodel import Session,select
from app.models import EmotionEvent,Camera
from app.routers import dashboard
from app.services.confirmed_state_service import latest_confirmed_event
from app.utils.time import kst_now


def append(db,states,uid=1,camera=None):
    ids=[]
    with Session(db) as session:
        for state in states:
            row=EmotionEvent(user_id=uid,camera_id=camera,need=state,emotion=state,
                confidence=.87,top_predictions=[{'need':state,'emotion':state,'confidence':.87},
                {'need':'sleep','emotion':'졸림','confidence':.1},{'need':'feeding','emotion':'배고픔','confidence':.03}])
            session.add(row);session.flush();ids.append(row.id)
        session.commit()
    return ids


def confirmed(db,uid=1):
    with Session(db) as session:
        row=latest_confirmed_event(session,uid)
        return row.id if row else None


def test_requires_three_and_retains_confirmed_state_despite_newer_single_results(db):
    assert confirmed(db) is None
    append(db,['feeding','feeding']);assert confirmed(db) is None
    last=append(db,['feeding'])[-1];assert confirmed(db)==last
    append(db,['sleep','sleep']);assert confirmed(db)==last
    last=append(db,['sleep'])[-1];assert confirmed(db)==last
    # Fourth same result is the newest rolling window, with its own time/scores.
    last=append(db,['sleep'])[-1];assert confirmed(db)==last


def test_unknown_and_intervening_states_break_the_run_but_stable_can_confirm(db):
    append(db,['care','care','unknown','care','care']);assert confirmed(db) is None
    last=append(db,['care'])[-1];assert confirmed(db)==last
    append(db,['stable','stable']);assert confirmed(db)==last
    last=append(db,['stable'])[-1];assert confirmed(db)==last


def test_user_and_camera_isolation_and_alias_normalization(db):
    with Session(db) as session:
        session.add_all([Camera(id=1,user_id=1,name='one'),Camera(id=2,user_id=1,name='two')]);session.commit()
    append(db,['care','care'],camera=1)
    append(db,['care'],camera=2)
    append(db,['care']*3,uid=2)
    assert confirmed(db,1) is None
    last=append(db,['불편함'],camera=1)[-1];assert confirmed(db,1)==last
    assert confirmed(db,2)!=last


def test_api_looks_beyond_twenty_history_rows_and_needs_no_push_opt_in(db,client,auth):
    client.app.include_router(dashboard.router,prefix='/api/dashboard')
    last=append(db,['care']*3)[-1]
    append(db,['feeding','sleep']*30)
    assert client.get('/api/dashboard').status_code==403
    response=client.get('/api/dashboard',headers=auth(1));assert response.status_code==200,response.text
    data=response.json()
    assert data['currentEmotion']['id']!=last
    assert data['confirmedEmotion']['id']==last
    assert data['confirmedEmotion']['consecutiveCount']==3
    assert len(data['confirmedEmotion']['topPredictions'])==3
    assert data['confirmedEmotion']['created_at'] and data['confirmedEmotion']['captured_at']
    assert client.get('/api/dashboard',headers=auth(2)).json()['confirmedEmotion'] is None


def test_confirmation_uses_completion_order_not_a_late_uploaded_capture_date(db):
    ids=append(db,['feeding']*3)
    with Session(db) as session:
        row=session.get(EmotionEvent,ids[-1]);row.captured_at=kst_now()-timedelta(days=7);session.add(row);session.commit()
    assert confirmed(db)==ids[-1]


def test_averages_same_states_across_rank_swaps_not_just_latest_scores(db):
    from app.services.confirmed_state_service import latest_confirmed_summary
    vectors=[(.9,.02,.08),(.8,.35,.05),(.7,.1,.2)]
    ids=[]
    with Session(db) as session:
        for feeding,care,sleep in vectors:
            row=EmotionEvent(user_id=1,need='feeding',emotion='배고픔',confidence=feeding,
                top_predictions=[{'need':'feeding','confidence':feeding},{'need':'care','confidence':care},{'need':'sleep','confidence':sleep}])
            session.add(row);session.flush();ids.append(row.id)
        session.commit();result=latest_confirmed_summary(session,1)
        assert result['sampleIds']==ids and result['sampleCount']==3
        assert result['confidence']==.8
        assert [(item['need'],item['confidence']) for item in result['topPredictions']]==[
            ('feeding',.8),('care',.156667),('sleep',.11)]


def test_missing_candidate_score_is_not_filled_with_zero(db):
    from app.services.confirmed_state_service import latest_confirmed_summary
    ids=append(db,['feeding']*3)
    with Session(db) as session:
        row=session.get(EmotionEvent,ids[0]);row.top_predictions=[{'need':'sleep','confidence':.1}];session.add(row);session.commit()
        result=latest_confirmed_summary(session,1)
        assert result['confidence']==.87
        assert result['candidateCoverage']['care']==0
        assert [item['need'] for item in result['topPredictions']]==['feeding','sleep']


def test_representative_api_auth_scope_and_readonly_average(db,client,auth):
    from app.routers import emotions
    client.app.include_router(emotions.router,prefix='/api/emotions')
    ids=append(db,['care']*3)
    assert client.get('/api/emotions/representative').status_code==403
    result=client.get('/api/emotions/representative',headers=auth(1)).json()
    assert result['sampleIds']==ids and result['scoreBasis']=='three_consecutive_mean'
    assert client.get('/api/emotions/representative',headers=auth(2)).json() is None
    with Session(db) as session:
        assert session.get(EmotionEvent,ids[-1]).confidence==.87


def test_summary_uses_exact_latest_rolling_three_and_no_newer_single_state(db):
    from app.services.confirmed_state_service import latest_confirmed_summary
    ids=append(db,['care']*4)
    append(db,['feeding','feeding'])
    with Session(db) as session:
        result=latest_confirmed_summary(session,1)
        assert result['sampleIds']==ids[-3:] and result['need']=='care'


def test_stable_average_does_not_invent_alternatives(db):
    from app.services.confirmed_state_service import latest_confirmed_summary
    ids=append(db,['stable']*3)
    with Session(db) as session:
        for uid in ids:
            row=session.get(EmotionEvent,uid);row.confidence=1;row.top_predictions=[{'need':'stable','confidence':1}];session.add(row)
        session.commit();result=latest_confirmed_summary(session,1)
        assert result['confidence']==1 and len(result['topPredictions'])==1
