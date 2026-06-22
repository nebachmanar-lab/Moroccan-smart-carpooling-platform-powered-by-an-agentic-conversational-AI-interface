from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.orm import joinedload
from pydantic import BaseModel
from datetime import datetime

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.models.booking import Booking, BookingStatus
from app.models.message import DirectMessage
from app.services.email import send_new_message_email
from app.core.config import settings

router = APIRouter(prefix="/messages", tags=["messages"])


class SendMessage(BaseModel):
    content: str


@router.get("/{booking_id}")
async def get_messages(
    booking_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Verify user is participant (passenger or driver)
    booking_res = await db.execute(
        select(Booking).options(joinedload(Booking.ride)).where(Booking.id == booking_id)
    )
    booking = booking_res.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Réservation introuvable")

    is_passenger = booking.passenger_id == current_user.id
    is_driver    = booking.ride and booking.ride.driver_id == current_user.id
    if not (is_passenger or is_driver):
        raise HTTPException(status_code=403, detail="Accès refusé")

    # Mark messages from the other party as read
    other_id = booking.ride.driver_id if is_passenger else booking.passenger_id
    await db.execute(
        update(DirectMessage)
        .where(
            DirectMessage.booking_id == booking_id,
            DirectMessage.sender_id  == other_id,
            DirectMessage.read       == False,
        )
        .values(read=True)
    )
    await db.commit()

    result = await db.execute(
        select(DirectMessage)
        .options(joinedload(DirectMessage.sender))
        .where(DirectMessage.booking_id == booking_id)
        .order_by(DirectMessage.created_at)
    )
    msgs = result.unique().scalars().all()
    return [_serialize(m, current_user.id) for m in msgs]


@router.post("/{booking_id}", status_code=201)
async def send_message(
    booking_id: str,
    body: SendMessage,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="Message vide")

    booking_res = await db.execute(
        select(Booking).options(joinedload(Booking.ride)).where(Booking.id == booking_id)
    )
    booking = booking_res.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Réservation introuvable")

    is_passenger = booking.passenger_id == current_user.id
    is_driver    = booking.ride and booking.ride.driver_id == current_user.id
    if not (is_passenger or is_driver):
        raise HTTPException(status_code=403, detail="Accès refusé")

    if booking.status == BookingStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="Réservation annulée")

    msg = DirectMessage(
        booking_id=booking_id,
        sender_id=current_user.id,
        content=body.content.strip(),
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    sender_res = await db.execute(select(User).where(User.id == current_user.id))
    msg.sender = sender_res.scalar_one()

    # Notify the other party by email (fire-and-forget)
    other_id = booking.ride.driver_id if booking.passenger_id == current_user.id else booking.passenger_id
    other_res = await db.execute(select(User).where(User.id == other_id))
    other = other_res.scalar_one_or_none()
    if other:
        sender_name = f"{current_user.first_name} {current_user.last_name}".strip()
        background_tasks.add_task(
            send_new_message_email,
            to_email=other.email,
            recipient_name=other.first_name,
            sender_name=sender_name,
            preview=body.content.strip(),
            booking_id=booking_id,
            frontend_url=settings.FRONTEND_URL,
        )

    return _serialize(msg, current_user.id)


@router.get("/unread/count")
async def unread_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Count unread messages across all user's bookings — single query."""
    from app.models.ride import Ride
    from sqlalchemy import func

    passenger_booking_ids = select(Booking.id).where(
        Booking.passenger_id == current_user.id
    )
    driver_booking_ids = (
        select(Booking.id)
        .join(Ride, Booking.ride_id == Ride.id)
        .where(Ride.driver_id == current_user.id)
    )
    all_booking_ids = passenger_booking_ids.union(driver_booking_ids)

    result = await db.execute(
        select(func.count(DirectMessage.id)).where(
            DirectMessage.booking_id.in_(all_booking_ids),
            DirectMessage.sender_id != current_user.id,
            DirectMessage.read == False,
        )
    )
    return {"unread": result.scalar() or 0}


def _serialize(m: DirectMessage, current_user_id: str) -> dict:
    return {
        "id": m.id,
        "booking_id": m.booking_id,
        "sender_id": m.sender_id,
        "sender_name": f"{m.sender.first_name} {m.sender.last_name}".strip() if m.sender else "?",
        "content": m.content,
        "read": m.read,
        "is_mine": m.sender_id == current_user_id,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }
