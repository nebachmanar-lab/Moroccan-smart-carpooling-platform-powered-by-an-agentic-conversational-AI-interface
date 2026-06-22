from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime


def _validate_stars(v: int) -> int:
    if not 1 <= v <= 5:
        raise ValueError("stars must be between 1 and 5")
    return v


class RatingCreate(BaseModel):
    ride_id: str
    driver_id: str
    stars: int
    comment: Optional[str] = None

    @field_validator("stars")
    @classmethod
    def validate_stars(cls, v: int) -> int:
        return _validate_stars(v)


class RatingResponse(BaseModel):
    id: str
    ride_id: str
    passenger_id: str
    driver_id: str
    stars: int
    comment: Optional[str]
    created_at: datetime
    model_config = {"from_attributes": True}


class DriverRatingsSummary(BaseModel):
    avg_stars: float
    total_reviews: int
    reviews: list[RatingResponse]


# ── Passenger ratings (driver → passenger) ────────────────────────────────────

class PassengerRatingCreate(BaseModel):
    ride_id: str
    passenger_id: str
    stars: int
    comment: Optional[str] = None

    @field_validator("stars")
    @classmethod
    def validate_stars(cls, v: int) -> int:
        return _validate_stars(v)


class PassengerRatingResponse(BaseModel):
    id: str
    ride_id: str
    driver_id: str
    passenger_id: str
    stars: int
    comment: Optional[str]
    created_at: datetime
    model_config = {"from_attributes": True}


class PassengerRatingsSummary(BaseModel):
    avg_stars: float
    total_reviews: int
    reviews: list[PassengerRatingResponse]
