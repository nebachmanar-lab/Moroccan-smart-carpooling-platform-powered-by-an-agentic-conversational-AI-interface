# app/routes/auth.py
import uuid

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from jose import JWTError
from app.core.security import (
    create_access_token, create_refresh_token,
    decode_refresh_token, hash_password, verify_password,
    hash_password_async, verify_password_async,
    create_one_time_token, decode_one_time_token,
)
from app.core.config import settings
from app.database import get_db
from app.middleware.auth import get_current_user, invalidate_user_cache
from app.models.user import User
from app.schemas.auth import LoginRequest, TokenResponse, UserRegister, UserResponse, UserUpdate
from app.services.email import (
    send_verification_email,
    send_reset_password_email,
)


class RefreshRequest(BaseModel):
    refresh_token: str

class VerifyEmailRequest(BaseModel):
    token: str

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    password: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserResponse, status_code=201)
async def register(
    user_in: UserRegister,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == user_in.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email déjà utilisé.")

    user = User(
        id=str(uuid.uuid4()),
        first_name=user_in.first_name,
        last_name=user_in.last_name,
        email=user_in.email,
        password_hash=await hash_password_async(user_in.password),
        role=user_in.role,
        is_verified=False,
    )
    db.add(user)
    await db.commit()

    token = create_one_time_token(user.id, "verify_email", expire_hours=24)
    verify_url = f"{settings.FRONTEND_URL}/auth/verify-email?token={token}"
    background_tasks.add_task(
        send_verification_email,
        to_email=user.email,
        name=user.first_name,
        verify_url=verify_url,
    )

    return user


@router.post("/verify-email")
async def verify_email(
    body: VerifyEmailRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = decode_one_time_token(body.token, "verify_email")
    except JWTError:
        raise HTTPException(status_code=400, detail="Lien de vérification invalide ou expiré.")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    user.is_verified = True
    await db.commit()
    return {"message": "Email vérifié avec succès. Vous pouvez maintenant vous connecter."}


@router.post("/resend-verification")
async def resend_verification(
    body: ForgotPasswordRequest,  # reuses { email } shape
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    # Always return 200 to avoid email enumeration
    if user and not user.is_verified:
        token = create_one_time_token(user.id, "verify_email", expire_hours=24)
        verify_url = f"{settings.FRONTEND_URL}/auth/verify-email?token={token}"
        background_tasks.add_task(
            send_verification_email,
            to_email=user.email,
            name=user.first_name,
            verify_url=verify_url,
        )
    return {"message": "Si cet email existe et n'est pas encore vérifié, un nouveau lien a été envoyé."}


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or not await verify_password_async(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect.")

    if not user.is_verified:
        raise HTTPException(status_code=403, detail="email_not_verified")

    role_value = user.role.value if hasattr(user.role, "value") else str(user.role)
    token = create_access_token(user_id=str(user.id), role=role_value)
    refresh = create_refresh_token(user_id=str(user.id))

    return {"access_token": token, "refresh_token": refresh, "token_type": "bearer"}


@router.post("/forgot-password")
async def forgot_password(
    body: ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if user:
        token = create_one_time_token(user.id, "reset_password", expire_hours=1)
        reset_url = f"{settings.FRONTEND_URL}/auth/reset-password?token={token}"
        background_tasks.add_task(
            send_reset_password_email,
            to_email=user.email,
            name=user.first_name,
            reset_url=reset_url,
        )
    return {"message": "Si cet email est enregistré, un lien de réinitialisation a été envoyé."}


@router.post("/reset-password")
async def reset_password(
    body: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = decode_one_time_token(body.token, "reset_password")
    except JWTError:
        raise HTTPException(status_code=400, detail="Lien de réinitialisation invalide ou expiré.")

    if len(body.password) < 8:
        raise HTTPException(status_code=422, detail="Le mot de passe doit contenir au moins 8 caractères.")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    user.password_hash = await hash_password_async(body.password)
    await db.commit()
    return {"message": "Mot de passe réinitialisé avec succès."}


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserResponse)
async def update_me(
    data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(current_user, field, value)
    await db.commit()
    await db.refresh(current_user)
    invalidate_user_cache(current_user.id)
    return current_user


@router.post("/me/change-password")
async def change_password(
    body: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not await verify_password_async(body.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Mot de passe actuel incorrect.")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=422, detail="Le nouveau mot de passe doit contenir au moins 8 caractères.")
    current_user.password_hash = await hash_password_async(body.new_password)
    await db.commit()
    invalidate_user_cache(current_user.id)
    return {"message": "Mot de passe modifié avec succès."}


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        payload = decode_refresh_token(body.refresh_token)
        user_id: str = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid refresh token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Refresh token expired or invalid")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    role_value = user.role.value if hasattr(user.role, "value") else str(user.role)
    new_access = create_access_token(user_id=str(user.id), role=role_value)
    new_refresh = create_refresh_token(user_id=str(user.id))

    return {"access_token": new_access, "refresh_token": new_refresh, "token_type": "bearer"}
