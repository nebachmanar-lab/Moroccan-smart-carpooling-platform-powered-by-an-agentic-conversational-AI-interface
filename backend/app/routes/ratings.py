from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import joinedload

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User, Role
from app.models.ride import Ride, RideStatus
from app.models.booking import Booking, BookingStatus
from app.models.rating import Rating
from app.schemas.rating import (
    RatingCreate, RatingResponse, DriverRatingsSummary,
    PassengerRatingCreate, PassengerRatingResponse, PassengerRatingsSummary,
)
from app.models.passenger_rating import PassengerRating

router = APIRouter(prefix="/ratings", tags=["ratings"])


@router.post("", response_model=RatingResponse, status_code=201)
async def create_rating(
    data: RatingCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Verify ride exists and is COMPLETED
    ride_result = await db.execute(select(Ride).where(Ride.id == data.ride_id))
    ride = ride_result.scalar_one_or_none()
    if not ride:
        raise HTTPException(status_code=404, detail="Trajet introuvable")
    if ride.status != RideStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Le trajet doit être terminé pour laisser une note")

    # Verify passenger had a confirmed booking on this ride
    booking_result = await db.execute(
        select(Booking).where(
            Booking.ride_id == data.ride_id,
            Booking.passenger_id == current_user.id,
            Booking.status == BookingStatus.CONFIRMED,
        )
    )
    if not booking_result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Vous n'avez pas participé à ce trajet")

    # Prevent duplicate ratings
    existing = await db.execute(
        select(Rating).where(
            Rating.ride_id == data.ride_id,
            Rating.passenger_id == current_user.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Vous avez déjà évalué ce trajet")

    rating = Rating(
        ride_id      = data.ride_id,
        passenger_id = current_user.id,
        driver_id    = data.driver_id,
        stars        = data.stars,
        comment      = data.comment,
    )
    db.add(rating)
    await db.commit()
    return rating


@router.get("/driver/{driver_id}", response_model=DriverRatingsSummary)
async def get_driver_ratings(driver_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Rating).where(Rating.driver_id == driver_id).order_by(Rating.created_at.desc())
    )
    ratings = result.scalars().all()
    avg = round(sum(r.stars for r in ratings) / len(ratings), 1) if ratings else 0.0
    return DriverRatingsSummary(
        avg_stars=avg,
        total_reviews=len(ratings),
        reviews=[RatingResponse.model_validate(r) for r in ratings],
    )


@router.get("/admin/all", response_model=list[RatingResponse])
async def admin_list_ratings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required")
    result = await db.execute(select(Rating).order_by(Rating.created_at.desc()))
    return result.scalars().all()


@router.get("/my-ride/{ride_id}", response_model=RatingResponse | None)
async def my_rating_for_ride(
    ride_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns current user's rating for a ride, or null."""
    result = await db.execute(
        select(Rating).where(
            Rating.ride_id == ride_id,
            Rating.passenger_id == current_user.id,
        )
    )
    return result.scalar_one_or_none()


# ── Driver rates passenger ────────────────────────────────────────────────────

@router.post("/passenger", response_model=PassengerRatingResponse, status_code=201)
async def rate_passenger(
    data: PassengerRatingCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != Role.DRIVER:
        raise HTTPException(status_code=403, detail="Seuls les conducteurs peuvent évaluer les passagers")

    ride_result = await db.execute(select(Ride).where(Ride.id == data.ride_id))
    ride = ride_result.scalar_one_or_none()
    if not ride:
        raise HTTPException(status_code=404, detail="Trajet introuvable")
    if ride.status != RideStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Le trajet doit être terminé pour laisser une note")
    if ride.driver_id != current_user.id:
        raise HTTPException(status_code=403, detail="Vous n'êtes pas le conducteur de ce trajet")

    booking_result = await db.execute(
        select(Booking).where(
            Booking.ride_id == data.ride_id,
            Booking.passenger_id == data.passenger_id,
            Booking.status == BookingStatus.CONFIRMED,
        )
    )
    if not booking_result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Ce passager n'a pas participé à ce trajet")

    existing = await db.execute(
        select(PassengerRating).where(
            PassengerRating.ride_id == data.ride_id,
            PassengerRating.driver_id == current_user.id,
            PassengerRating.passenger_id == data.passenger_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Vous avez déjà évalué ce passager")

    rating = PassengerRating(
        ride_id=data.ride_id,
        driver_id=current_user.id,
        passenger_id=data.passenger_id,
        stars=data.stars,
        comment=data.comment,
    )
    db.add(rating)
    await db.commit()
    return rating


@router.get("/passenger/{passenger_id}", response_model=PassengerRatingsSummary)
async def get_passenger_ratings(passenger_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PassengerRating)
        .where(PassengerRating.passenger_id == passenger_id)
        .order_by(PassengerRating.created_at.desc())
    )
    ratings = result.scalars().all()
    avg = round(sum(r.stars for r in ratings) / len(ratings), 1) if ratings else 0.0
    return PassengerRatingsSummary(
        avg_stars=avg,
        total_reviews=len(ratings),
        reviews=[PassengerRatingResponse.model_validate(r) for r in ratings],
    )


@router.get("/my-passenger-rating/{ride_id}/{passenger_id}", response_model=PassengerRatingResponse | None)
async def my_passenger_rating(
    ride_id: str,
    passenger_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(PassengerRating).where(
            PassengerRating.ride_id == ride_id,
            PassengerRating.driver_id == current_user.id,
            PassengerRating.passenger_id == passenger_id,
        )
    )
    return result.scalar_one_or_none()
