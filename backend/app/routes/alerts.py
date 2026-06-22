from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from datetime import datetime

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.models.alert import RideAlert

router = APIRouter(prefix="/alerts", tags=["alerts"])


class AlertCreate(BaseModel):
    origin: str
    destination: str


class AlertOut(BaseModel):
    id: str
    origin: str
    destination: str
    is_active: bool
    created_at: datetime
    model_config = {"from_attributes": True}


@router.post("", response_model=AlertOut, status_code=201)
async def create_alert(
    data: AlertCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Avoid duplicate active alerts for same route
    existing = await db.execute(
        select(RideAlert).where(
            RideAlert.user_id == current_user.id,
            RideAlert.origin.ilike(data.origin.strip()),
            RideAlert.destination.ilike(data.destination.strip()),
            RideAlert.is_active == True,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Vous avez déjà une alerte active pour ce trajet.")

    alert = RideAlert(
        user_id=current_user.id,
        origin=data.origin.strip(),
        destination=data.destination.strip(),
    )
    db.add(alert)
    await db.commit()
    return alert


@router.get("/me", response_model=list[AlertOut])
async def my_alerts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(RideAlert)
        .where(RideAlert.user_id == current_user.id, RideAlert.is_active == True)
        .order_by(RideAlert.created_at.desc())
    )
    return result.scalars().all()


@router.delete("/{alert_id}", status_code=204)
async def delete_alert(
    alert_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(RideAlert).where(RideAlert.id == alert_id, RideAlert.user_id == current_user.id)
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alerte introuvable.")
    alert.is_active = False
    await db.commit()
