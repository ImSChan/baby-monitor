from datetime import datetime, date, timedelta
import pytest
from sqlmodel import Session, select
from app.models import AppUser, CareProfile, CareRecord
from app.services.child_profile_service import age_months, age_policy
from app.services.care_context_service import build_care_snapshot, apply_care_context
from app.routers.auth import password_hash
from app.utils.time import kst_now
from uuid import uuid4


def signup(**extra):
    return {'email':'signup@example.com','password':'test-password-123','child_name':'별이','child_age_months':10,**extra}


def test_register_disabled_and_validation(client, monkeypatch):
    monkeypatch.setenv('ALLOW_REGISTRATION','false')
    assert client.post('/api/auth/register',json=signup()).status_code==403
    monkeypatch.setenv('ALLOW_REGISTRATION','true')
    for extra in [{'password':'short'},{'child_name':'  '},{'child_age_months':-1},{'child_age_months':72},
                  {'child_age_months':1.5},{'child_age_months':True},{'email':'not-email'}]:
        assert client.post('/api/auth/register',json=signup(**extra)).status_code==422
    payload=signup();del payload['child_age_months']
    assert client.post('/api/auth/register',json=payload).status_code==422


def test_signup_stores_atomic_profile_and_hashed_password_then_login(client, db, monkeypatch):
    monkeypatch.setenv('ALLOW_REGISTRATION','true')
    response=client.post('/api/auth/register',json=signup(email='Signup@EXAMPLE.COM',child_name=' 별이 ',password=' test-password-123 '))
    assert response.status_code==201,response.text
    user=response.json();assert user['role']=='parent' and 'password_hash' not in user
    with Session(db) as session:
        row=session.get(AppUser,user['id']);assert row.email=='signup@example.com'
        assert row.password_hash!=' test-password-123 ' and password_hash.verify(' test-password-123 ',row.password_hash)
        profile=session.get(CareProfile,row.id)
        assert profile.child_name=='별이' and profile.child_age_months==10 and profile.age_recorded_on==kst_now().date()
    assert client.post('/api/auth/register',json=signup()).status_code==409
    with Session(db) as session:
        assert len(session.exec(select(CareProfile)).all())==1
    login=client.post('/api/auth/login',json={'email':'SIGNUP@example.com','password':' test-password-123 '})
    assert login.status_code==200
    headers={'Authorization':'Bearer '+login.json()['access_token']}
    assert client.get('/api/auth/me',headers=headers).json()['id']==user['id']
    summary=client.get('/api/care/summary',headers=headers).json()
    assert summary['ageMonths']==10 and summary['childName']=='별이'
    assert summary['agePolicy']['mealsPerDay']==[3,4]


def test_profile_is_owned_preserves_preferences_and_requires_auth(client,auth):
    assert client.post('/api/care/profile',json={'child_name':'A','child_age_months':6}).status_code==403
    assert client.get('/api/care/profile',headers=auth(1)).json()['ageMonths'] is None
    client.post('/api/care/preferences',headers=auth(1),json={'context_enabled':False})
    saved=client.post('/api/care/profile',headers=auth(1),json={'child_name':'A','child_age_months':6})
    assert saved.status_code==200 and saved.json()['ageMonths']==6
    assert client.get('/api/care/summary',headers=auth(1)).json()['contextEnabled'] is False
    assert client.get('/api/care/profile',headers=auth(2)).json()['childName'] is None


def test_completed_months_handles_month_end_and_history():
    row=CareProfile(user_id=1,child_age_months=5,age_recorded_on=date(2026,1,31))
    assert age_months(row,datetime(2026,2,27))==5
    assert age_months(row,datetime(2026,2,28))==6
    assert age_months(row,datetime(2026,3,30))==6
    assert age_months(row,datetime(2026,3,31))==7
    assert age_months(row,datetime(2026,1,30))==4


@pytest.mark.parametrize('months,stage,sleep,meals,eligible',[
    (0,'0-3',[14,17],None,False),(4,'4-5',[12,16],None,True),
    (6,'6-8',[12,16],[2,3],True),(9,'9-11',[12,16],[3,4],True),
    (12,'12-23',[11,14],[3,4],True),(24,'24-35',[11,14],None,True),
    (36,'36+',[10,13],None,False),(72,'unknown',None,None,False)])
def test_age_policy(months,stage,sleep,meals,eligible):
    assert age_policy(months)=={'stage':stage,'sleepHours':sleep,'mealsPerDay':meals,'timingEligible':eligible}


def test_age_really_changes_eligible_meals_and_missing_age_never_adjusts(db):
    now=kst_now()
    with Session(db) as session:
        session.add(CareRecord(id=str(uuid4()),user_id=1,kind='feeding',meal_type='meal',started_at=now-timedelta(minutes=10)))
        session.commit()
        assert build_care_snapshot(session,1,now)['reason']=='child_age_missing'
        profile=CareProfile(user_id=1,child_age_months=5,age_recorded_on=now.date())
        session.add(profile);session.commit()
        assert build_care_snapshot(session,1,now)['minutesSinceMeal'] is None
        profile.child_age_months=10;session.add(profile);session.commit()
        assert build_care_snapshot(session,1,now)['minutesSinceMeal']==10
        profile.child_age_months=2;session.add(profile);session.commit()
        assert not build_care_snapshot(session,1,now)['enabled']


def test_personal_baselines_do_not_mix_stages_or_meal_types(db):
    now=kst_now().replace(hour=23,minute=0,second=0,microsecond=0)-timedelta(days=1)
    with Session(db) as session:
        session.add(CareProfile(user_id=1,child_age_months=6,age_recorded_on=now.date()))
        for hour in (1,4,7,10,13,16):
            session.add(CareRecord(id=str(uuid4()),user_id=1,kind='feeding',meal_type='milk',started_at=now.replace(hour=hour)))
        session.add(CareRecord(id=str(uuid4()),user_id=1,kind='feeding',meal_type='meal',started_at=now.replace(hour=19)))
        session.commit()
        assert build_care_snapshot(session,1,now)['typicalMealGapMinutes'] is None
        profile=session.get(CareProfile,1);profile.age_recorded_on=(now+timedelta(days=1)).date();session.add(profile);session.commit()
        # Previous day's 5-month records cannot form the current 6-month baseline.
        assert build_care_snapshot(session,1,now+timedelta(days=1),now=now+timedelta(days=1))['typicalMealGapMinutes'] is None
