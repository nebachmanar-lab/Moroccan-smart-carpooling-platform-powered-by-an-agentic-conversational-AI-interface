"""Public report endpoint — any logged-in user can flag a ride or user (ADM-01)."""
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.models.report import Report

router = APIRouter(prefix="/reports", tags=["reports"])


class ReportCreate(BaseModel):
    target_type: str   # "ride" | "user"
    target_id: str
    reason: str


@router.post("", status_code=201)
async def create_report(
    data: ReportCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if data.target_type not in ("ride", "user"):
        raise HTTPException(status_code=400, detail="target_type doit être 'ride' ou 'user'")
    if not data.reason.strip():
        raise HTTPException(status_code=400, detail="La raison est obligatoire")

    # Prevent duplicate pending reports from the same user for the same target
    dup = await db.execute(
        select(Report).where(
            Report.reporter_id == current_user.id,
            Report.target_id == data.target_id,
            Report.status == "PENDING",
        )
    )
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Vous avez déjà signalé cet élément")

    report = Report(
        id=str(uuid.uuid4()),
        reporter_id=current_user.id,
        target_type=data.target_type,
        target_id=data.target_id,
        reason=data.reason.strip(),
        status="PENDING",
        created_at=datetime.utcnow(),
    )
    db.add(report)
    await db.commit()
    return {"id": report.id, "status": "PENDING"}
