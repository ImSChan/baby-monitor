
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field
from pwdlib import PasswordHash
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.database import get_session
from app.models import AppUser

router = APIRouter()
security = HTTPBearer()
password_hash = PasswordHash.recommended()

JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=100)


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
        "exp": now + timedelta(minutes=JWT_EXPIRE_MINUTES),
    }
    return jwt.encode(
        payload,
        get_secret_key(),
        algorithm=JWT_ALGORITHM,
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    session: Session = Depends(get_session),
) -> AppUser:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired authentication token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(
            credentials.credentials,
            get_secret_key(),
            algorithms=[JWT_ALGORITHM],
        )
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        raise unauthorized

    user = session.get(AppUser, user_id)
    if user is None or not user.is_active:
        raise unauthorized

    return user


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
