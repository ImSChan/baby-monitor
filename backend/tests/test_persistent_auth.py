import math
from datetime import datetime,timedelta,timezone
import jwt
import pytest
from sqlmodel import Session
from app.models import AppUser
from app.routers.auth import create_access_token,get_secret_key,authenticate_access_token


def headers(token):return {'Authorization':'Bearer '+token}


def test_new_login_token_has_no_deadline_and_remains_valid_years_later(db,client,monkeypatch):
    token=create_access_token(1)
    payload=jwt.decode(token,get_secret_key(),algorithms=['HS256'])
    assert payload['persistent'] is True and 'exp' not in payload and 'iat' in payload
    with Session(db) as session:
        user,deadline=authenticate_access_token(token,session)
        assert user.id==1 and math.isinf(deadline)
    class FutureDateTime(datetime):
        @classmethod
        def now(cls,tz=None):return datetime(2099,1,1,tzinfo=timezone.utc)
    monkeypatch.setattr(jwt.api_jwt,'datetime',FutureDateTime)
    assert client.get('/api/auth/me',headers=headers(token)).status_code==200


@pytest.mark.parametrize('payload',[
    {'sub':'1'}, {'sub':'1','iat':1}, {'sub':'1','iat':1,'persistent':False},
    {'sub':'1','iat':1,'persistent':'true'}, {'sub':'1','persistent':True},
    {'sub':'1','iat':1,'persistent':True,'exp':1},
    {'sub':'1','iat':1,'exp':float('inf')},
])
def test_missing_policy_and_expired_or_invalid_legacy_tokens_are_not_revived(client,payload):
    token=jwt.encode(payload,get_secret_key(),algorithm='HS256')
    assert client.get('/api/auth/me',headers=headers(token)).status_code==401


def test_signed_unexpired_legacy_token_still_works_but_keeps_its_expiry(db,client):
    expiry=datetime.now(timezone.utc)+timedelta(minutes=10)
    token=jwt.encode({'sub':'1','exp':expiry},get_secret_key(),algorithm='HS256')
    assert client.get('/api/auth/me',headers=headers(token)).status_code==200
    with Session(db) as session:
        assert math.isfinite(authenticate_access_token(token,session)[1])


def test_persistent_token_still_checks_signature_and_active_account(db,client):
    token=create_access_token(1)
    forged=jwt.encode({'sub':'1','iat':1,'persistent':True},'wrong-secret-for-test-123456789012345',algorithm='HS256')
    assert client.get('/api/auth/me',headers=headers(forged)).status_code==401
    with Session(db) as session:
        user=session.get(AppUser,1);user.is_active=False;session.add(user);session.commit()
    assert client.get('/api/auth/me',headers=headers(token)).status_code==401
