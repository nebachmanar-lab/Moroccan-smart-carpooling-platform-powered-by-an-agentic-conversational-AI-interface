from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import joinedload
from datetime import datetime, timedelta
from typing import Optional

from app.database import get_db
from app.models.ride import Ride, RideStatus
from app.models.booking import Booking, BookingStatus
from app.models.rating import Rating
from app.models.user import User
from app.models.alert import RideAlert
from app.schemas.ride import RideCreate, RideUpdate, RideResponse, DriverPrefsPublic
from app.middleware.auth import get_current_user
from app.data.moroccan_cities import MOROCCAN_CITIES
from app.core.config import settings
from pydantic import BaseModel


class PassengerItem(BaseModel):
    booking_id: str
    passenger_id: str
    first_name: str
    last_name: str
    email: str
    phone: Optional[str]
    seats_booked: int
    total_price: float
    status: str
    booked_at: datetime
    model_config = {"from_attributes": True}


router = APIRouter(prefix="/rides", tags=["rides"])


def _fill_coordinates(city_name: str, lat_field: str, lng_field: str, data: dict):
    if data.get(lat_field) is None and city_name in MOROCCAN_CITIES:
        data[lat_field] = MOROCCAN_CITIES[city_name]["lat"]
        data[lng_field] = MOROCCAN_CITIES[city_name]["lng"]


def _build_ride_response(ride: Ride, avg_rating: float | None = None, rating_count: int = 0) -> RideResponse:
    resp = RideResponse.model_validate(ride)
    if ride.driver:
        resp.driver_name = f"{ride.driver.first_name} {ride.driver.last_name}".strip()
        if ride.driver.preferences:
            resp.driver_preferences = DriverPrefsPublic.model_validate(ride.driver.preferences)
    if avg_rating is not None:
        resp.driver_avg_rating = round(avg_rating, 1)
        resp.driver_rating_count = rating_count
    return resp


async def _fetch_driver_rating(db: AsyncSession, driver_id: str) -> tuple[float | None, int]:
    result = await db.execute(
        select(func.avg(Rating.stars), func.count(Rating.id))
        .where(Rating.driver_id == driver_id)
    )
    row = result.one()
    avg = float(row[0]) if row[0] is not None else None
    count = int(row[1])
    return avg, count


# ── Create ────────────────────────────────────────────────────────────────────

async def _notify_alert_users(ride_id: str, origin: str, destination: str,
                              departure: datetime, seats: int, price: float) -> None:
    """Find active alerts matching this ride and send email notifications."""
    from app.services.email import send_ride_alert_email
    from app.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(RideAlert)
            .options(joinedload(RideAlert.user))
            .where(
                RideAlert.is_active == True,
                RideAlert.origin.ilike(f"%{origin}%"),
                RideAlert.destination.ilike(f"%{destination}%"),
            )
        )
        alerts = result.unique().scalars().all()
        frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:3000")
        for alert in alerts:
            if alert.user and alert.user.email:
                user_name = f"{alert.user.first_name} {alert.user.last_name}".strip()
                await send_ride_alert_email(
                    to_email=alert.user.email,
                    user_name=user_name,
                    origin=origin,
                    destination=destination,
                    departure=departure,
                    seats=seats,
                    price=price,
                    ride_id=ride_id,
                    frontend_url=frontend_url,
                )


@router.post("/", response_model=RideResponse, status_code=status.HTTP_201_CREATED)
async def create_ride(
    ride_in: RideCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ride_data = ride_in.model_dump()
    _fill_coordinates(ride_in.origin,      "origin_lat",      "origin_lng",      ride_data)
    _fill_coordinates(ride_in.destination, "destination_lat", "destination_lng", ride_data)
    ride = Ride(**ride_data, driver_id=current_user.id)
    db.add(ride)
    await db.commit()
    background_tasks.add_task(
        _notify_alert_users,
        str(ride.id), ride.origin, ride.destination,
        ride.departure_time, ride.available_seats, ride.price_per_seat,
    )
    return ride


# ── Search ────────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[RideResponse])
async def search_rides(
    origin: str,
    destination: str,
    date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(Ride)
        .filter(
            Ride.origin.ilike(f"%{origin}%"),
            Ride.destination.ilike(f"%{destination}%"),
            Ride.status == RideStatus.ACTIVE,
        )
        .order_by(Ride.departure_time)
    )
    if date:
        try:
            from datetime import date as date_type
            d = date_type.fromisoformat(date)
            day_start = datetime(d.year, d.month, d.day, 0, 0, 0)
            day_end   = day_start + timedelta(days=1)
            query = query.filter(
                Ride.departure_time >= day_start,
                Ride.departure_time <  day_end,
            )
        except ValueError:
            pass
    result = await db.execute(
        query.options(joinedload(Ride.driver).joinedload(User.preferences))
    )
    rides = result.unique().scalars().all()

    # Batch-fetch ratings for all unique driver IDs
    driver_ids = list({r.driver_id for r in rides})
    rating_rows = await db.execute(
        select(Rating.driver_id, func.avg(Rating.stars), func.count(Rating.id))
        .where(Rating.driver_id.in_(driver_ids))
        .group_by(Rating.driver_id)
    )
    rating_map: dict[str, tuple[float, int]] = {
        row[0]: (float(row[1]), int(row[2])) for row in rating_rows
    }
    return [_build_ride_response(r, *rating_map.get(r.driver_id, (None, 0))) for r in rides]


# ── My rides ──────────────────────────────────────────────────────────────────

# /my MUST come before /{ride_id} — FastAPI matches top-to-bottom.
@router.get("/my", response_model=list[RideResponse])
async def get_my_rides(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Ride)
        .options(joinedload(Ride.driver).joinedload(User.preferences))
        .filter(Ride.driver_id == current_user.id)
        .order_by(Ride.departure_time.desc())
    )
    rides = result.unique().scalars().all()
    return [_build_ride_response(r) for r in rides]


# ── Passengers per ride ───────────────────────────────────────────────────────

@router.get("/{ride_id}/passengers", response_model=list[PassengerItem])
async def get_ride_passengers(
    ride_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Ride).where(Ride.id == ride_id))
    ride = result.scalar_one_or_none()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    if ride.driver_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your ride")

    res = await db.execute(
        select(Booking)
        .options(joinedload(Booking.passenger))
        .where(Booking.ride_id == ride_id)
        .order_by(Booking.created_at)
    )
    bookings = res.scalars().unique().all()
    return [
        PassengerItem(
            booking_id=b.id,
            passenger_id=b.passenger_id,
            first_name=b.passenger.first_name if b.passenger else "",
            last_name=b.passenger.last_name if b.passenger else "",
            email=b.passenger.email if b.passenger else "",
            phone=b.passenger.phone if b.passenger else None,
            seats_booked=b.seats_booked,
            total_price=b.total_price,
            status=b.status.value if hasattr(b.status, "value") else str(b.status),
            booked_at=b.created_at,
        )
        for b in bookings
    ]


# ── Get single ride (with driver info) ───────────────────────────────────────

@router.get("/{ride_id}", response_model=RideResponse)
async def get_ride(ride_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Ride)
        .options(joinedload(Ride.driver).joinedload(User.preferences))
        .filter(Ride.id == ride_id)
    )
    ride = result.unique().scalar_one_or_none()
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    avg, count = await _fetch_driver_rating(db, ride.driver_id)
    return _build_ride_response(ride, avg, count)


# ── Update ride (driver only) ─────────────────────────────────────────────────

@router.patch("/{ride_id}", response_model=RideResponse)
async def update_ride(
    ride_id: str,
    data: RideUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Ride).where(Ride.id == ride_id))
    ride = result.scalar_one_or_none()
    if not ride:
        raise HTTPException(status_code=404, detail="Trajet introuvable")
    if ride.driver_id != current_user.id:
        raise HTTPException(status_code=403, detail="Pas votre trajet")
    if ride.status == RideStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="Trajet déjà annulé")

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(ride, field, value)
    await db.commit()
    return ride


# ── Complete ride (driver only) ───────────────────────────────────────────────

@router.post("/{ride_id}/complete")
async def complete_ride(
    ride_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Ride).where(Ride.id == ride_id))
    ride = result.scalar_one_or_none()
    if not ride:
        raise HTTPException(status_code=404, detail="Trajet introuvable")
    if ride.driver_id != current_user.id:
        raise HTTPException(status_code=403, detail="Pas votre trajet")
    if ride.status == RideStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="Trajet annulé")
    if ride.status == RideStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Trajet déjà terminé")

    ride.status = RideStatus.COMPLETED
    await db.commit()
    return {"ride_id": ride_id, "status": "COMPLETED"}


# ── Driver revenue ─────────────────────────────────────────────────────────────

@router.get("/revenue/summary")
async def get_revenue_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy import select as sa_select, func
    from app.models.booking import Booking, BookingStatus

    # All driver rides with their confirmed bookings
    stmt = (
        select(Ride)
        .options(joinedload(Ride.bookings))
        .where(Ride.driver_id == current_user.id)
        .order_by(Ride.departure_time.desc())
    )
    result = await db.execute(stmt)
    rides = result.unique().scalars().all()

    total_earned = 0.0
    total_trips = 0
    total_passengers = 0
    breakdown = []

    for r in rides:
        confirmed = [b for b in r.bookings if b.status == BookingStatus.CONFIRMED]
        earned = sum(b.total_price for b in confirmed)
        total_earned += earned
        if confirmed:
            total_trips += 1
            total_passengers += sum(b.seats_booked for b in confirmed)
        breakdown.append({
            "ride_id": r.id,
            "origin": r.origin,
            "destination": r.destination,
            "departure_time": r.departure_time.isoformat(),
            "status": r.status.value if hasattr(r.status, "value") else str(r.status),
            "confirmed_bookings": len(confirmed),
            "passengers": sum(b.seats_booked for b in confirmed),
            "earned": earned,
        })

    return {
        "total_earned": round(total_earned, 2),
        "total_trips_with_passengers": total_trips,
        "total_passengers_transported": total_passengers,
        "breakdown": breakdown,
    }


# ── Cancel ride (driver only) ─────────────────────────────────────────────────

@router.delete("/{ride_id}")
async def cancel_my_ride(
    ride_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Ride).where(Ride.id == ride_id))
    ride = result.scalar_one_or_none()
    if not ride:
        raise HTTPException(status_code=404, detail="Trajet introuvable")
    if ride.driver_id != current_user.id:
        raise HTTPException(status_code=403, detail="Pas votre trajet")
    if ride.status == RideStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="Déjà annulé")

    ride.status = RideStatus.CANCELLED
    await db.commit()
    return {"cancelled": ride_id}
