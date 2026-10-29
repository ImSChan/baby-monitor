from fastapi import Depends

from app.models import AppUser
from app.routers.auth import get_current_user


def get_current_user_id(
    current_user: AppUser = Depends(get_current_user),
) -> int:
    return current_user.id