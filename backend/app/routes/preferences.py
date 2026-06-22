from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import uuid

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.preferences import DriverPreferences
from app.models.user import User, Role
from app.schemas.preferences import PreferencesCreate, PreferencesOut

router = APIRouter(prefix="/preferences", tags=["preferences"])


@router.post("", response_model=PreferencesOut, status_code=status.HTTP_201_CREATED)
async def create_preferences(
    payload:      PreferencesCreate,
    db:           AsyncSession = Depends(get_db),
    current_user: User         = Depends(get_current_user),
):
    if current_user.role != Role.DRIVER:
        raise HTTPException(status_code=403, detail="Only drivers can set preferences.")

    result = await db.execute(
        select(DriverPreferences).where(DriverPreferences.driver_id == current_user.id)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Preferences already exist. Use PUT to update.")

    prefs = DriverPreferences(id=str(uuid.uuid4()), driver_id=current_user.id, **payload.model_dump())
    db.add(prefs)
    await db.commit()
    return prefs


@router.put("", response_model=PreferencesOut)
async def update_preferences(
    payload:      PreferencesCreate,
    db:           AsyncSession = Depends(get_db),
    current_user: User         = Depends(get_current_user),
):
    if current_user.role != Role.DRIVER:
        raise HTTPException(status_code=403, detail="Only drivers can update preferences.")

    result = await db.execute(
        select(DriverPreferences).where(DriverPreferences.driver_id == current_user.id)
    )
    prefs = result.scalar_one_or_none()
    if not prefs:
        raise HTTPException(status_code=404, detail="No preferences found. Use POST to create them first.")

    for field, value in payload.model_dump().items():
        setattr(prefs, field, value)

    await db.commit()
    return prefs


@router.get("/driver/{driver_id}", response_model=PreferencesOut)
async def get_driver_preferences_public(
    driver_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Public endpoint — returns a driver's preferences without auth."""
    result = await db.execute(
        select(DriverPreferences).where(DriverPreferences.driver_id == driver_id)
    )
    prefs = result.scalar_one_or_none()
    if not prefs:
        raise HTTPException(status_code=404, detail="Aucune préférence définie.")
    return prefs


@router.get("", response_model=PreferencesOut)
async def get_preferences(
    db:           AsyncSession = Depends(get_db),
    current_user: User         = Depends(get_current_user),
):
    result = await db.execute(
        select(DriverPreferences).where(DriverPreferences.driver_id == current_user.id)
    )
    prefs = result.scalar_one_or_none()
    if not prefs:
        raise HTTPException(status_code=404, detail="No preferences set yet.")
    return prefs