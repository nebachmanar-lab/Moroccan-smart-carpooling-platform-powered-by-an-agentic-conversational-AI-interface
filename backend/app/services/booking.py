from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import joinedload
from fastapi import HTTPException
from datetime import datetime, timezone
from app.models.ride import Ride, RideStatus
from app.models.booking import Booking, BookingStatus
from app.schemas.booking import BookingCreate
import logging

logger = logging.getLogger(__name__)


async def create_booking(db: AsyncSession, data: BookingCreate, passenger_id: str) -> tuple["Booking", object]:
    # SELECT FOR UPDATE locks the ride row so two passengers
    # can't grab the last seat simultaneously
    result = await db.execute(
        select(Ride)
        .options(joinedload(Ride.driver))
        .where(Ride.id == data.ride_id)
        .with_for_update(of=Ride)
    )
    ride = result.scalar_one_or_none()

    if not ride:
        raise HTTPException(status_code=404, detail="Trajet introuvable")
    if ride.status != RideStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Ce trajet n'est plus disponible")
    if ride.driver_id == passenger_id:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas réserver votre propre trajet")
    if ride.available_seats < data.seats_booked:
        raise HTTPException(
            status_code=400,
            detail=f"Seulement {ride.available_seats} place(s) disponible(s)"
        )

    # Prevent duplicate booking (PENDING or CONFIRMED)
    dup_result = await db.execute(
        select(Booking).where(
            Booking.ride_id      == data.ride_id,
            Booking.passenger_id == passenger_id,
            Booking.status.in_([BookingStatus.CONFIRMED, BookingStatus.PENDING]),
        )
    )
    if dup_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Vous avez déjà une réservation en cours pour ce trajet")

    booking = Booking(
        ride_id      = ride.id,
        passenger_id = passenger_id,
        seats_booked = data.seats_booked,
        total_price  = ride.price_per_seat * data.seats_booked,
        status       = BookingStatus.PENDING,
        message      = data.message,
    )
    db.add(booking)
    ride.available_seats -= data.seats_booked
    await db.commit()
    logger.info(f"Booking #{booking.id} — passenger {passenger_id}, ride {ride.id}")
    return booking, ride


async def cancel_booking(db: AsyncSession, booking_id: str, passenger_id: str) -> Booking:
    result = await db.execute(
        select(Booking).where(
            Booking.id           == booking_id,
            Booking.passenger_id == passenger_id,
        )
    )
    booking = result.scalar_one_or_none()

    if not booking:
        raise HTTPException(status_code=404, detail="Réservation introuvable")
    if booking.status == BookingStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="Déjà annulée")

    ride_result = await db.execute(
        select(Ride).where(Ride.id == booking.ride_id).with_for_update()
    )
    ride = ride_result.scalar_one()

    booking.status       = BookingStatus.CANCELLED
    booking.cancelled_at = datetime.utcnow()

    if ride.status == RideStatus.ACTIVE:
        ride.available_seats += booking.seats_booked

    await db.commit()
    return booking