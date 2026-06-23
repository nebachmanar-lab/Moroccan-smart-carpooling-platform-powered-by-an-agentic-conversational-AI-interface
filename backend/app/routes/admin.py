from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import joinedload
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User, Role
from app.models.ride import Ride, RideStatus
from app.models.booking import Booking, BookingStatus
from app.models.rating import Rating
from app.models.document import DriverDocument, DocStatus
from app.models.report import Report

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


# ── Schemas ──────────────────────────────────────────────────────────────────

class AdminUserItem(BaseModel):
    id: str
    first_name: str
    last_name: str
    email: str
    phone: Optional[str]
    role: str
    is_verified: bool
    created_at: datetime
    rides_count: int
    bookings_count: int
    model_config = {"from_attributes": True}


class AdminRideItem(BaseModel):
    id: str
    origin: str
    destination: str
    departure_time: datetime
    available_seats: int
    price_per_seat: float
    status: str
    driver_name: str
    bookings_count: int
    model_config = {"from_attributes": True}


class RoleUpdateRequest(BaseModel):
    role: str


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats")
async def get_stats(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    total_users        = (await db.execute(select(func.count(User.id)))).scalar()
    total_drivers      = (await db.execute(select(func.count(User.id)).where(User.role == Role.DRIVER))).scalar()
    total_passengers   = (await db.execute(select(func.count(User.id)).where(User.role == Role.PASSENGER))).scalar()
    total_rides        = (await db.execute(select(func.count(Ride.id)))).scalar()
    active_rides       = (await db.execute(select(func.count(Ride.id)).where(Ride.status == RideStatus.ACTIVE))).scalar()
    completed_rides    = (await db.execute(select(func.count(Ride.id)).where(Ride.status == RideStatus.COMPLETED))).scalar()
    total_bookings     = (await db.execute(select(func.count(Booking.id)))).scalar()
    confirmed_bookings = (await db.execute(select(func.count(Booking.id)).where(Booking.status == BookingStatus.CONFIRMED))).scalar()
    pending_docs       = (await db.execute(select(func.count(DriverDocument.id)).where(DriverDocument.status == DocStatus.PENDING))).scalar()
    total_ratings      = (await db.execute(select(func.count(Rating.id)))).scalar()

    revenue_res = await db.execute(select(func.sum(Booking.total_price)).where(Booking.status == BookingStatus.CONFIRMED))
    total_revenue = float(revenue_res.scalar() or 0)

    return {
        "users": {"total": total_users, "drivers": total_drivers, "passengers": total_passengers},
        "rides": {"total": total_rides, "active": active_rides, "completed": completed_rides},
        "bookings": {"total": total_bookings, "confirmed": confirmed_bookings},
        "documents": {"pending": pending_docs},
        "ratings": {"total": total_ratings},
        "revenue": {"total_confirmed_mad": round(total_revenue, 2)},
    }


# ── Users ─────────────────────────────────────────────────────────────────────

@router.get("/users", response_model=list[AdminUserItem])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    result = await db.execute(
        select(User)
        .options(joinedload(User.rides), joinedload(User.bookings))
        .order_by(User.created_at.desc())
    )
    users = result.unique().scalars().all()
    return [
        AdminUserItem(
            id=u.id,
            first_name=u.first_name,
            last_name=u.last_name,
            email=u.email,
            phone=u.phone,
            role=u.role.value if hasattr(u.role, "value") else str(u.role),
            is_verified=u.is_verified,
            created_at=u.created_at,
            rides_count=len(u.rides),
            bookings_count=len(u.bookings),
        )
        for u in users
    ]


@router.patch("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    body: RoleUpdateRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    try:
        user.role = Role(body.role)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}")
    await db.commit()
    return {"id": user_id, "role": user.role.value}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await db.delete(user)
    await db.commit()
    return {"deleted": user_id}


# ── Rides ─────────────────────────────────────────────────────────────────────

@router.get("/rides", response_model=list[AdminRideItem])
async def list_rides(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    result = await db.execute(
        select(Ride)
        .options(joinedload(Ride.driver), joinedload(Ride.bookings))
        .order_by(Ride.departure_time.desc())
    )
    rides = result.unique().scalars().all()
    return [
        AdminRideItem(
            id=r.id,
            origin=r.origin,
            destination=r.destination,
            departure_time=r.departure_time,
            available_seats=r.available_seats,
            price_per_seat=r.price_per_seat,
            status=r.status.value if hasattr(r.status, "value") else str(r.status),
            driver_name=f"{r.driver.first_name} {r.driver.last_name}" if r.driver else "N/A",
            bookings_count=len([b for b in r.bookings if b.status == BookingStatus.CONFIRMED]),
        )
        for r in rides
    ]


@router.delete("/rides/{ride_id}")
async def cancel_ride(
    ride_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    result = await db.execute(select(Ride).where(Ride.id == ride_id))
    ride = result.scalar_one_or_none()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    ride.status = RideStatus.CANCELLED
    await db.commit()
    return {"cancelled": ride_id}


# ── Reports / Moderation (ADM-01) ─────────────────────────────────────────────

class ReportItem(BaseModel):
    id: str
    reporter_id: Optional[str]
    reporter_name: str
    target_type: str
    target_id: str
    reason: str
    status: str
    admin_note: Optional[str]
    created_at: datetime
    model_config = {"from_attributes": True}


class ResolveReportRequest(BaseModel):
    status: str   # "RESOLVED" | "DISMISSED"
    admin_note: Optional[str] = None


@router.get("/reports", response_model=list[ReportItem])
async def list_reports(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    query = select(Report).options(joinedload(Report.reporter)).order_by(Report.created_at.desc())
    if status:
        query = query.where(Report.status == status.upper())
    result = await db.execute(query)
    reports = result.unique().scalars().all()
    return [
        ReportItem(
            id=r.id,
            reporter_id=r.reporter_id,
            reporter_name=f"{r.reporter.first_name} {r.reporter.last_name}".strip() if r.reporter else "Système (auto)",
            target_type=r.target_type,
            target_id=r.target_id,
            reason=r.reason,
            status=r.status,
            admin_note=r.admin_note,
            created_at=r.created_at,
        )
        for r in reports
    ]


@router.delete("/ratings/{rating_id}", status_code=204)
async def delete_rating(
    rating_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    """ADM-04: admin removes a suspicious/fake review."""
    result = await db.execute(select(Rating).where(Rating.id == rating_id))
    rating = result.scalar_one_or_none()
    if not rating:
        raise HTTPException(status_code=404, detail="Avis introuvable")
    await db.delete(rating)
    await db.commit()


@router.patch("/reports/{report_id}")
async def resolve_report(
    report_id: str,
    body: ResolveReportRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if body.status.upper() not in ("RESOLVED", "DISMISSED"):
        raise HTTPException(status_code=400, detail="status must be RESOLVED or DISMISSED")
    report.status = body.status.upper()
    report.admin_note = body.admin_note
    report.resolved_at = datetime.utcnow()
    await db.commit()
    return {"id": report_id, "status": report.status}
