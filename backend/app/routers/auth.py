
import os
import math
from datetime import datetime, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field
from pwdlib import PasswordHash
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.database import get_session
from app.models import AppUser, CareProfile
from app.services.child_profile_service import ChildInput
from app.utils.time import kst_now

router = APIRouter()
security = HTTPBearer()
password_hash = PasswordHash.recommended()

JWT_ALGORITHM = "HS256"


class RegisterRequest(ChildInput):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(default="보호자", min_length=1, max_length=100)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    email: str
    name: str
    role: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


def get_secret_key() -> str:
    secret = os.getenv("JWT_SECRET_KEY", "")
    if len(secret) < 32:
        raise RuntimeError(
            "JWT_SECRET_KEY must be at least 32 characters"
        )
    return secret


def create_access_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "persistent": True,
    }
    return jwt.encode(
        payload,
        get_secret_key(),
        algorithm=JWT_ALGORITHM,
    )


def authenticate_access_token(token: str, session: Session) -> tuple[AppUser, float]:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired authentication token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(
            token,
            get_secret_key(),
            algorithms=[JWT_ALGORITHM],
            options={"require": ["sub"]},
        )
        user_id = int(payload["sub"])
        if 'exp' in payload:
            # Existing finite tokens keep their signed expiry; never revive them.
            expires_at = float(payload['exp'])
            if not math.isfinite(expires_at):
                raise ValueError('Invalid expiry')
        elif payload.get('persistent') is True and 'iat' in payload:
            # Internal deadline only, never serialized. Existing live connection
            # cleanup still uses heartbeat/account checks for persistent sessions.
            expires_at = float('inf')
        else:
            raise ValueError('Missing session lifetime policy')
    except (jwt.PyJWTError, KeyError, TypeError, ValueError, OverflowError):
        raise unauthorized

    user = session.get(AppUser, user_id)
    if user is None or not user.is_active:
        raise unauthorized

    return user, expires_at


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    session: Session = Depends(get_session),
) -> AppUser:
    return authenticate_access_token(credentials.credentials, session)[0]


@router.post("/register", response_model=UserResponse, status_code=201)
def register(
    data: RegisterRequest,
    session: Session = Depends(get_session),
):
    if os.getenv("ALLOW_REGISTRATION", "false").lower() != "true":
        raise HTTPException(
            status_code=403,
            detail="Registration is disabled",
        )

    email = str(data.email).strip().lower()

    existing = session.exec(
        select(AppUser).where(AppUser.email == email)
    ).first()

    if existing:
        raise HTTPException(
            status_code=409,
            detail="Email already registered",
        )

    user = AppUser(
        email=email,
        name=data.name,
        password_hash=password_hash.hash(data.password),
        role="parent",
        is_active=True,
    )

    session.add(user)
    try:
        session.flush()
        session.add(CareProfile(user_id=user.id, child_name=data.child_name,
            child_age_months=data.child_age_months, age_recorded_on=kst_now().date()))
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail="Email already registered",
        )

    session.refresh(user)
    return user


@router.post("/login", response_model=TokenResponse)
def login(
    data: LoginRequest,
    session: Session = Depends(get_session),
):
    email = str(data.email).strip().lower()

    user = session.exec(
        select(AppUser).where(AppUser.email == email)
    ).first()

    if (
        user is None
        or not user.is_active
        or not user.password_hash
        or not password_hash.verify(data.password, user.password_hash)
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password",
        )

    return TokenResponse(
        access_token=create_access_token(user.id),
        user=UserResponse.model_validate(user, from_attributes=True),
    )


@router.get("/me", response_model=UserResponse)
def me(user: AppUser = Depends(get_current_user)):
    return user
