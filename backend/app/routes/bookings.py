from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import joinedload
from app.database import get_db
from app.schemas.booking import BookingCreate, BookingResponse, BookingCancelResponse, MyBookingItem, DriverBookingItem
from app.services.booking import create_booking, cancel_booking
from app.services.email import (
    send_booking_confirmation,
    send_driver_booking_notification,
    send_booking_accepted_email,
    send_booking_refused_email,
    send_receipt_email,
    send_passenger_cancelled_email,
)
import uuid as _uuid
from app.services.sms import send_booking_confirmation_sms, send_booking_cancellation_sms
from app.middleware.auth import get_current_user
from app.models.user import User
from app.models.booking import Booking
from app.models.ride import Ride

router = APIRouter(prefix="/bookings", tags=["bookings"])


@router.get("/me", response_model=list[MyBookingItem])
async def my_bookings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    stmt = (
        select(Booking)
        .options(joinedload(Booking.ride).joinedload(Ride.driver))
        .where(Booking.passenger_id == current_user.id)
        .order_by(Booking.created_at.desc())
        .limit(50)
    )
    result = await db.execute(stmt)
    bookings = result.scalars().unique().all()
    return [
        MyBookingItem(
            id=b.id,
            ride_id=b.ride_id,
            status=b.status.value if hasattr(b.status, "value") else str(b.status),
            seats_booked=b.seats_booked,
            total_price=b.total_price,
            created_at=b.created_at,
            origin=b.ride.origin if b.ride else "?",
            destination=b.ride.destination if b.ride else "?",
            departure_time=b.ride.departure_time if b.ride else b.created_at,
            driver_name=(
                f"{b.ride.driver.first_name} {b.ride.driver.last_name}"
                if b.ride and b.ride.driver else "N/A"
            ),
            driver_id=b.ride.driver_id if b.ride else "",
            ride_status=b.ride.status.value if b.ride and b.ride.status else "?",
        )
        for b in bookings
    ]


@router.get("/driver", response_model=list[DriverBookingItem])
async def driver_received_bookings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """All bookings received across the driver's rides — single JOIN query."""
    stmt = (
        select(Booking)
        .join(Ride, Booking.ride_id == Ride.id)
        .options(joinedload(Booking.ride), joinedload(Booking.passenger))
        .where(Ride.driver_id == current_user.id)
        .order_by(Booking.created_at.desc())
        .limit(200)
    )
    res = await db.execute(stmt)
    bookings = res.scalars().unique().all()
    return [
        DriverBookingItem(
            booking_id=b.id,
            ride_id=b.ride_id,
            origin=b.ride.origin if b.ride else "?",
            destination=b.ride.destination if b.ride else "?",
            departure_time=b.ride.departure_time if b.ride else b.created_at,
            passenger_id=b.passenger_id,
            passenger_name=(
                f"{b.passenger.first_name} {b.passenger.last_name}".strip()
                if b.passenger else "Inconnu"
            ),
            passenger_email=b.passenger.email if b.passenger else "",
            passenger_phone=b.passenger.phone if b.passenger else None,
            seats_booked=b.seats_booked,
            total_price=b.total_price,
            status=b.status.value if hasattr(b.status, "value") else str(b.status),
            ride_status=b.ride.status.value if b.ride and b.ride.status else "UNKNOWN",
            booked_at=b.created_at,
        )
        for b in bookings
    ]


@router.get("/ride/{ride_id}")
async def my_booking_for_ride(
    ride_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns the current user's active booking for a specific ride, or null."""
    result = await db.execute(
        select(Booking)
        .where(
            Booking.ride_id == ride_id,
            Booking.passenger_id == current_user.id,
            Booking.status.in_(["PENDING", "CONFIRMED"]),
        )
        .order_by(Booking.created_at.desc())
        .limit(1)
    )
    booking = result.scalar_one_or_none()
    if not booking:
        return None
    return {
        "id": booking.id,
        "status": booking.status.value if hasattr(booking.status, "value") else str(booking.status),
        "seats_booked": booking.seats_booked,
        "total_price": booking.total_price,
    }


@router.post("", response_model=BookingResponse, status_code=201)
async def book_ride(
    data:             BookingCreate,
    background_tasks: BackgroundTasks,
    db:               AsyncSession = Depends(get_db),
    current_user:     User         = Depends(get_current_user),
):
    booking, ride = await create_booking(db, data, current_user.id)

    driver_name = f"{ride.driver.first_name} {ride.driver.last_name}".strip()
    passenger_name = f"{current_user.first_name} {current_user.last_name}".strip()

    # Confirmation email sent only when driver accepts — not here (PENDING state)
    if ride.driver and ride.driver.email:
        background_tasks.add_task(
            send_driver_booking_notification,
            to_email       = ride.driver.email,
            driver_name    = driver_name,
            passenger_name = passenger_name,
            booking_id     = str(booking.id),
            origin         = ride.origin,
            destination    = ride.destination,
            departure      = ride.departure_time,
            seats          = booking.seats_booked,
            total_price    = booking.total_price,
        )

    if current_user.phone:
        background_tasks.add_task(
            send_booking_confirmation_sms,
            to_phone       = current_user.phone,
            passenger_name = passenger_name,
            origin         = ride.origin,
            destination    = ride.destination,
            departure      = ride.departure_time,
            seats          = booking.seats_booked,
            total_price    = booking.total_price,
            driver_name    = driver_name,
        )

    return BookingResponse(
        id                 = booking.id,
        ride_id            = booking.ride_id,
        passenger_id       = booking.passenger_id,
        seats_booked       = booking.seats_booked,
        total_price        = booking.total_price,
        status             = booking.status,
        created_at         = booking.created_at,
        origin_city        = ride.origin,
        destination_city   = ride.destination,
        departure_datetime = ride.departure_time,
        driver_name        = driver_name,
    )


@router.post("/{booking_id}/accept")
async def accept_booking(
    booking_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Driver accepts a PENDING booking → CONFIRMED."""
    stmt = (
        select(Booking)
        .options(joinedload(Booking.ride).joinedload(Ride.driver), joinedload(Booking.passenger))
        .where(Booking.id == booking_id)
    )
    result = await db.execute(stmt)
    booking = result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Réservation introuvable")
    if not booking.ride or booking.ride.driver_id != current_user.id:
        raise HTTPException(status_code=403, detail="Pas votre trajet")
    if booking.status != "PENDING":
        raise HTTPException(status_code=400, detail="Seules les réservations en attente peuvent être acceptées")

    booking.status = "CONFIRMED"
    await db.commit()

    if booking.passenger:
        driver_name = f"{current_user.first_name} {current_user.last_name}".strip()
        passenger_name = f"{booking.passenger.first_name} {booking.passenger.last_name}".strip()
        receipt_number = str(_uuid.uuid4()).upper()[:8]
        background_tasks.add_task(
            send_booking_accepted_email,
            to_email=booking.passenger.email,
            passenger_name=passenger_name,
            driver_name=driver_name,
            origin=booking.ride.origin,
            destination=booking.ride.destination,
            departure=booking.ride.departure_time,
            seats=booking.seats_booked,
            total_price=booking.total_price,
        )
        background_tasks.add_task(
            send_receipt_email,
            to_email=booking.passenger.email,
            passenger_name=passenger_name,
            driver_name=driver_name,
            origin=booking.ride.origin,
            destination=booking.ride.destination,
            departure=booking.ride.departure_time,
            seats=booking.seats_booked,
            total_price=booking.total_price,
            receipt_number=receipt_number,
        )
    return {"booking_id": booking_id, "status": "CONFIRMED"}


@router.post("/{booking_id}/refuse")
async def refuse_booking(
    booking_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Driver refuses a PENDING booking → CANCELLED, seats restored."""
    stmt = (
        select(Booking)
        .options(joinedload(Booking.ride).joinedload(Ride.driver), joinedload(Booking.passenger))
        .where(Booking.id == booking_id)
    )
    result = await db.execute(stmt)
    booking = result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Réservation introuvable")
    if not booking.ride or booking.ride.driver_id != current_user.id:
        raise HTTPException(status_code=403, detail="Pas votre trajet")
    if booking.status not in ("PENDING", "CONFIRMED"):
        raise HTTPException(status_code=400, detail="Réservation déjà annulée")

    ride_result = await db.execute(
        select(Ride).where(Ride.id == booking.ride_id).with_for_update()
    )
    ride = ride_result.scalar_one()
    ride.available_seats += booking.seats_booked
    booking.status = "CANCELLED"
    await db.commit()

    if booking.passenger:
        driver_name = f"{current_user.first_name} {current_user.last_name}".strip()
        passenger_name = f"{booking.passenger.first_name} {booking.passenger.last_name}".strip()
        background_tasks.add_task(
            send_booking_refused_email,
            to_email=booking.passenger.email,
            passenger_name=passenger_name,
            driver_name=driver_name,
            origin=ride.origin,
            destination=ride.destination,
            departure=ride.departure_time,
        )
    return {"booking_id": booking_id, "status": "CANCELLED"}


@router.delete("/{booking_id}", response_model=BookingCancelResponse)
async def cancel(
    booking_id:       str,
    background_tasks: BackgroundTasks,
    db:               AsyncSession = Depends(get_db),
    current_user:     User         = Depends(get_current_user),
):
    # Load the booking with ride+driver before cancelling so we can notify the driver (C-07)
    pre_result = await db.execute(
        select(Booking)
        .options(joinedload(Booking.ride).joinedload(Ride.driver))
        .where(Booking.id == booking_id, Booking.passenger_id == current_user.id)
    )
    pre_booking = pre_result.scalar_one_or_none()

    booking = await cancel_booking(db, booking_id, current_user.id)

    if current_user.phone and booking.ride:
        background_tasks.add_task(
            send_booking_cancellation_sms,
            to_phone   = current_user.phone,
            origin     = booking.ride.origin,
            destination= booking.ride.destination,
            departure  = booking.ride.departure_time,
            by_driver  = False,
        )

    # Notify driver that a passenger cancelled (C-07)
    if pre_booking and pre_booking.ride and pre_booking.ride.driver:
        driver = pre_booking.ride.driver
        if driver.email:
            passenger_name = f"{current_user.first_name} {current_user.last_name}".strip()
            driver_name = f"{driver.first_name} {driver.last_name}".strip()
            background_tasks.add_task(
                send_passenger_cancelled_email,
                to_email=driver.email,
                driver_name=driver_name,
                passenger_name=passenger_name,
                origin=pre_booking.ride.origin,
                destination=pre_booking.ride.destination,
                departure=pre_booking.ride.departure_time,
                seats=pre_booking.seats_booked,
            )

    return BookingCancelResponse(
        booking_id = booking.id,
        status     = booking.status,
        message    = "Réservation annulée avec succès",
    )