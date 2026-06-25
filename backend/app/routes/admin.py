from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import joinedload, selectinload
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


# ── Schemas ───────────────────────────────────────────────────────────────────

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
    reports_received_count: int
    model_config = {"from_attributes": True}


class RoleUpdateRequest(BaseModel):
    role: str


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
    status: str
    admin_note: Optional[str] = None


# ── Stats (ADM-02) ────────────────────────────────────────────────────────────

@router.get("/stats")
async def get_stats(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    total_users        = (await db.execute(select(func.count(User.id)))).scalar() or 0
    total_admins       = (await db.execute(select(func.count(User.id)).where(User.role == Role.ADMIN))).scalar() or 0
    total_drivers      = (await db.execute(select(func.count(User.id)).where(User.role == Role.DRIVER))).scalar() or 0
    total_passengers   = (await db.execute(select(func.count(User.id)).where(User.role == Role.PASSENGER))).scalar() or 0
    verified_users     = (await db.execute(select(func.count(User.id)).where(User.is_verified == True))).scalar() or 0
    total_rides        = (await db.execute(select(func.count(Ride.id)))).scalar() or 0
    active_rides       = (await db.execute(select(func.count(Ride.id)).where(Ride.status == RideStatus.ACTIVE))).scalar() or 0
    completed_rides    = (await db.execute(select(func.count(Ride.id)).where(Ride.status == RideStatus.COMPLETED))).scalar() or 0
    cancelled_rides    = (await db.execute(select(func.count(Ride.id)).where(Ride.status == RideStatus.CANCELLED))).scalar() or 0
    total_bookings     = (await db.execute(select(func.count(Booking.id)))).scalar() or 0
    confirmed_bookings = (await db.execute(select(func.count(Booking.id)).where(Booking.status == BookingStatus.CONFIRMED))).scalar() or 0
    pending_bookings   = (await db.execute(select(func.count(Booking.id)).where(Booking.status == BookingStatus.PENDING))).scalar() or 0
    pending_docs       = (await db.execute(select(func.count(DriverDocument.id)).where(DriverDocument.status == DocStatus.PENDING))).scalar() or 0
    total_ratings      = (await db.execute(select(func.count(Rating.id)))).scalar() or 0
    total_reports      = (await db.execute(select(func.count(Report.id)))).scalar() or 0
    pending_reports    = (await db.execute(select(func.count(Report.id)).where(Report.status == "PENDING"))).scalar() or 0

    revenue_res   = await db.execute(select(func.sum(Booking.total_price)).where(Booking.status == BookingStatus.CONFIRMED))
    total_revenue = float(revenue_res.scalar() or 0)

    # Top 5 origins by ride count
    top_origins_res = await db.execute(
        select(Ride.origin, func.count(Ride.id).label("cnt"))
        .group_by(Ride.origin).order_by(func.count(Ride.id).desc()).limit(5)
    )
    top_origins = [{"city": r.origin, "count": r.cnt} for r in top_origins_res.all()]

    # Top 5 destinations
    top_dest_res = await db.execute(
        select(Ride.destination, func.count(Ride.id).label("cnt"))
        .group_by(Ride.destination).order_by(func.count(Ride.id).desc()).limit(5)
    )
    top_destinations = [{"city": r.destination, "count": r.cnt} for r in top_dest_res.all()]

    # Top 5 drivers by rides
    top_drv_res = await db.execute(
        select(Ride.driver_id, func.count(Ride.id).label("cnt"))
        .where(Ride.driver_id.isnot(None))
        .group_by(Ride.driver_id).order_by(func.count(Ride.id).desc()).limit(5)
    )
    top_drivers = []
    for row in top_drv_res.all():
        d = (await db.execute(select(User).where(User.id == row.driver_id))).scalar_one_or_none()
        if d:
            top_drivers.append({"id": d.id, "name": f"{d.first_name} {d.last_name}", "count": row.cnt})

    # Suspicious counts for overview badge
    avg_price_res = await db.execute(select(func.avg(Ride.price_per_seat)))
    avg_price     = float(avg_price_res.scalar() or 100)
    ride_susp     = (await db.execute(
        select(func.count(Ride.id)).where(
            Ride.status == RideStatus.ACTIVE,
            (Ride.price_per_seat > avg_price * 2.5) | (Ride.price_per_seat < 5),
        )
    )).scalar() or 0
    rat_susp = (await db.execute(
        select(func.count(Rating.id)).where(Rating.stars <= 2, Rating.comment.is_(None))
    )).scalar() or 0

    return {
        "users": {
            "total": total_users,
            "admins": total_admins,
            "drivers": total_drivers,
            "passengers": total_passengers,
            "verified": verified_users,
            "unverified": total_users - verified_users,
        },
        "rides": {
            "total": total_rides,
            "active": active_rides,
            "completed": completed_rides,
            "cancelled": cancelled_rides,
        },
        "bookings": {
            "total": total_bookings,
            "confirmed": confirmed_bookings,
            "pending": pending_bookings,
        },
        "documents": {"pending": pending_docs},
        "ratings": {"total": total_ratings},
        "reports": {"total": total_reports, "pending": pending_reports},
        "revenue": {"total_confirmed_mad": round(total_revenue, 2)},
        "top_origins": top_origins,
        "top_destinations": top_destinations,
        "top_drivers": top_drivers,
        "suspicious_count": ride_susp + rat_susp,
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

    rep_res = await db.execute(
        select(Report.target_id, func.count(Report.id).label("cnt"))
        .where(Report.target_type == "user")
        .group_by(Report.target_id)
    )
    report_counts = {row.target_id: row.cnt for row in rep_res.all()}

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
            reports_received_count=report_counts.get(u.id, 0),
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


@router.patch("/users/{user_id}/verify")
async def toggle_verify_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_verified = not user.is_verified
    await db.commit()
    return {"id": user_id, "is_verified": user.is_verified}


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

@router.get("/rides")
async def list_rides(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    avg_res   = await db.execute(select(func.avg(Ride.price_per_seat)))
    avg_price = float(avg_res.scalar() or 100)

    result = await db.execute(
        select(Ride)
        .options(joinedload(Ride.driver), selectinload(Ride.bookings))
        .order_by(Ride.departure_time.desc())
    )
    rides = result.unique().scalars().all()

    rep_res = await db.execute(
        select(Report.target_id, func.count(Report.id).label("cnt"))
        .where(Report.target_type == "ride", Report.status == "PENDING")
        .group_by(Report.target_id)
    )
    rep_counts = {row.target_id: row.cnt for row in rep_res.all()}

    return [
        {
            "id": r.id,
            "origin": r.origin,
            "destination": r.destination,
            "departure_time": r.departure_time.isoformat(),
            "available_seats": r.available_seats,
            "price_per_seat": r.price_per_seat,
            "status": r.status.value if hasattr(r.status, "value") else str(r.status),
            "driver_name": f"{r.driver.first_name} {r.driver.last_name}" if r.driver else "N/A",
            "driver_id": r.driver_id,
            "bookings_count": len([b for b in r.bookings if b.status == BookingStatus.CONFIRMED]),
            "reports_count": rep_counts.get(r.id, 0),
            "suspect": r.price_per_seat > avg_price * 2.5 or r.price_per_seat < 5,
        }
        for r in rides
    ]


@router.get("/rides/{ride_id}")
async def get_ride_detail(
    ride_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    result = await db.execute(
        select(Ride)
        .options(joinedload(Ride.driver), selectinload(Ride.bookings).joinedload(Booking.passenger))
        .where(Ride.id == ride_id)
    )
    ride = result.unique().scalar_one_or_none()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")

    reports_res = await db.execute(
        select(Report).options(joinedload(Report.reporter))
        .where(Report.target_type == "ride", Report.target_id == ride_id)
    )
    reports = reports_res.unique().scalars().all()

    return {
        "id": ride.id,
        "origin": ride.origin,
        "destination": ride.destination,
        "departure_time": ride.departure_time.isoformat(),
        "available_seats": ride.available_seats,
        "price_per_seat": ride.price_per_seat,
        "status": ride.status.value,
        "pickup_location": ride.pickup_location,
        "dropoff_location": ride.dropoff_location,
        "driver": {
            "id": ride.driver.id,
            "name": f"{ride.driver.first_name} {ride.driver.last_name}",
            "email": ride.driver.email,
        } if ride.driver else None,
        "bookings": [
            {
                "id": b.id,
                "passenger_name": f"{b.passenger.first_name} {b.passenger.last_name}" if b.passenger else "?",
                "passenger_email": b.passenger.email if b.passenger else "?",
                "seats": b.seats_booked,
                "status": b.status.value,
                "total_price": b.total_price,
            }
            for b in ride.bookings
        ],
        "reports": [
            {
                "id": r.id,
                "reason": r.reason,
                "status": r.status,
                "reporter": f"{r.reporter.first_name} {r.reporter.last_name}" if r.reporter else "Anonyme",
                "created_at": r.created_at.isoformat(),
            }
            for r in reports
        ],
    }


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


# ── Ratings ───────────────────────────────────────────────────────────────────

@router.get("/ratings")
async def list_ratings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    result = await db.execute(
        select(Rating).options(joinedload(Rating.passenger)).order_by(Rating.created_at.desc())
    )
    ratings = result.unique().scalars().all()
    out = []
    for r in ratings:
        driver = (await db.execute(select(User).where(User.id == r.driver_id))).scalar_one_or_none()
        out.append({
            "id": r.id,
            "ride_id": r.ride_id,
            "passenger_id": r.passenger_id,
            "driver_id": r.driver_id,
            "stars": r.stars,
            "comment": r.comment,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "passenger_name": f"{r.passenger.first_name} {r.passenger.last_name}" if r.passenger else "?",
            "driver_name": f"{driver.first_name} {driver.last_name}" if driver else "?",
        })
    return out


@router.delete("/ratings/{rating_id}", status_code=204)
async def delete_rating(
    rating_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    result = await db.execute(select(Rating).where(Rating.id == rating_id))
    rating = result.scalar_one_or_none()
    if not rating:
        raise HTTPException(status_code=404, detail="Avis introuvable")
    await db.delete(rating)
    await db.commit()


# ── Reports (ADM-01) ──────────────────────────────────────────────────────────

@router.get("/reports", response_model=list[ReportItem])
async def list_reports(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    result = await db.execute(
        select(Report).options(joinedload(Report.reporter)).order_by(Report.created_at.desc())
    )
    reports = result.unique().scalars().all()
    return [
        ReportItem(
            id=r.id,
            reporter_id=r.reporter_id,
            reporter_name=f"{r.reporter.first_name} {r.reporter.last_name}".strip() if r.reporter else "Anonyme",
            target_type=r.target_type,
            target_id=r.target_id,
            reason=r.reason,
            status=r.status,
            admin_note=r.admin_note,
            created_at=r.created_at,
        )
        for r in reports
    ]


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
    report.status     = body.status.upper()
    report.admin_note = body.admin_note
    report.resolved_at = datetime.utcnow()
    await db.commit()
    return {"id": report_id, "status": report.status, "admin_note": report.admin_note}


# ── Suspicious (ADM-04) ───────────────────────────────────────────────────────

@router.get("/suspicious")
async def get_suspicious(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(_require_admin),
):
    # 1. Low ratings without comment
    rat_res = await db.execute(
        select(Rating).options(joinedload(Rating.passenger))
        .where(Rating.stars <= 2).order_by(Rating.created_at.desc()).limit(100)
    )
    suspicious_ratings = []
    for r in rat_res.unique().scalars().all():
        if not r.comment or len(r.comment.strip()) < 10:
            driver = (await db.execute(select(User).where(User.id == r.driver_id))).scalar_one_or_none()
            suspicious_ratings.append({
                "id": r.id, "stars": r.stars, "comment": r.comment,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "passenger_name": f"{r.passenger.first_name} {r.passenger.last_name}" if r.passenger else "?",
                "driver_name": f"{driver.first_name} {driver.last_name}" if driver else "?",
                "reason": "Note faible sans commentaire",
                "level": "medium",
            })

    # 2. Price outlier rides
    avg_price = float((await db.execute(select(func.avg(Ride.price_per_seat)))).scalar() or 100)
    rides_res = await db.execute(
        select(Ride).options(joinedload(Ride.driver)).where(Ride.status == RideStatus.ACTIVE)
    )
    suspicious_rides = []
    for r in rides_res.unique().scalars().all():
        if r.price_per_seat > avg_price * 3:
            reason, level = f"Prix très élevé : {r.price_per_seat} MAD (moy. {round(avg_price)} MAD)", "high"
        elif r.price_per_seat > avg_price * 2.5:
            reason, level = f"Prix élevé : {r.price_per_seat} MAD (moy. {round(avg_price)} MAD)", "medium"
        elif r.price_per_seat < 5:
            reason, level = f"Prix anormalement bas : {r.price_per_seat} MAD", "medium"
        else:
            continue
        suspicious_rides.append({
            "id": r.id, "origin": r.origin, "destination": r.destination,
            "price_per_seat": r.price_per_seat, "avg_price": round(avg_price, 2),
            "driver_name": f"{r.driver.first_name} {r.driver.last_name}" if r.driver else "?",
            "driver_id": r.driver_id,
            "departure_time": r.departure_time.isoformat(),
            "status": r.status.value, "reason": reason, "level": level,
        })

    # 3. Users with >= 2 pending reports
    rep_agg = await db.execute(
        select(Report.target_id, func.count(Report.id).label("cnt"))
        .where(Report.target_type == "user", Report.status == "PENDING")
        .group_by(Report.target_id).having(func.count(Report.id) >= 2)
    )
    suspicious_users: list = []
    seen: set = set()
    for row in rep_agg.all():
        u = (await db.execute(select(User).where(User.id == row.target_id))).scalar_one_or_none()
        if u:
            seen.add(u.id)
            suspicious_users.append({
                "id": u.id, "name": f"{u.first_name} {u.last_name}",
                "email": u.email, "role": u.role.value if hasattr(u.role, "value") else str(u.role),
                "reports_count": row.cnt,
                "reason": f"{row.cnt} signalements en attente reçus",
                "level": "high" if row.cnt >= 3 else "medium",
            })

    # 4. Drivers with >= 50% cancellation rate
    cancel_agg = await db.execute(
        select(Ride.driver_id, func.count(Ride.id).label("cancelled"))
        .where(Ride.status == RideStatus.CANCELLED)
        .group_by(Ride.driver_id).having(func.count(Ride.id) >= 3)
    )
    for row in cancel_agg.all():
        if row.driver_id in seen:
            continue
        total_n = (await db.execute(select(func.count(Ride.id)).where(Ride.driver_id == row.driver_id))).scalar() or 1
        if row.cancelled / total_n >= 0.5:
            d = (await db.execute(select(User).where(User.id == row.driver_id))).scalar_one_or_none()
            if d:
                seen.add(d.id)
                suspicious_users.append({
                    "id": d.id, "name": f"{d.first_name} {d.last_name}",
                    "email": d.email, "role": d.role.value if hasattr(d.role, "value") else str(d.role),
                    "reports_count": 0,
                    "reason": f"Taux annulation : {row.cancelled}/{total_n} trajets",
                    "level": "medium",
                })

    return {"ratings": suspicious_ratings, "rides": suspicious_rides, "users": suspicious_users}
