import time
from fastapi import Depends, HTTPException, status, Cookie
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from jose import JWTError
from app.core.security import decode_access_token
from app.models.user import User
from app.database import get_db

from fastapi.security import HTTPBearer

bearer = HTTPBearer(auto_error=True)

# Simple per-process user cache — avoids a DB lookup on every authenticated request.
# TTL of 60 s is fine: user profile changes are rare and non-critical to propagate instantly.
_user_cache: dict[str, tuple[User, float]] = {}
_USER_CACHE_TTL = 60.0


def invalidate_user_cache(user_id: str) -> None:
    _user_cache.pop(user_id, None)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db)
) -> User:
    token = credentials.credentials
    try:
        payload = decode_access_token(token)
        user_id: str = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Token expired or invalid")

    cached = _user_cache.get(user_id)
    if cached and time.monotonic() - cached[1] < _USER_CACHE_TTL:
        return cached[0]

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    _user_cache[user_id] = (user, time.monotonic())
    return user

async def get_current_user_ws(token: str, db: AsyncSession) -> User | None:
    """WebSocket-compatible auth: takes raw token string, returns User or None."""
    try:
        payload = decode_access_token(token)
        user_id: str = payload.get("sub")
        if not user_id:
            return None
    except JWTError:
        return None
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


def require_role(*roles: str):
    async def checker(current_user: User = Depends(get_current_user)):
        if current_user.role not in roles:
            raise HTTPException(status_code=403, detail="Forbidden")
        return current_user
    return checker