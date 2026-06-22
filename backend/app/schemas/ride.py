from pydantic import BaseModel, field_validator
from datetime import datetime, timezone
from typing import Optional, List


class RideCreate(BaseModel):
    origin: str
    destination: str
    origin_lat: Optional[float] = None
    origin_lng: Optional[float] = None
    destination_lat: Optional[float] = None
    destination_lng: Optional[float] = None
    departure_time: datetime
    available_seats: int
    price_per_seat: float
    pickup_location: Optional[str] = None
    dropoff_location: Optional[str] = None
    # Recurring rides (C-08)
    is_recurring: bool = False
    recurrence_days: Optional[List[int]] = None
    recurrence_end_date: Optional[datetime] = None

    @field_validator("departure_time", "recurrence_end_date", mode="before")
    @classmethod
    def strip_timezone(cls, v) -> datetime:
        if v is None:
            return v
        if isinstance(v, str):
            v = datetime.fromisoformat(v)
        if isinstance(v, datetime) and v.tzinfo is not None:
            v = v.astimezone(timezone.utc).replace(tzinfo=None)
        return v


class RideUpdate(BaseModel):
    departure_time: Optional[datetime] = None
    available_seats: Optional[int] = None
    price_per_seat: Optional[float] = None
    pickup_location: Optional[str] = None
    dropoff_location: Optional[str] = None

    @field_validator("departure_time", mode="before")
    @classmethod
    def strip_tz(cls, v):
        if v is None:
            return v
        if isinstance(v, str):
            v = datetime.fromisoformat(v)
        if isinstance(v, datetime) and v.tzinfo is not None:
            v = v.astimezone(timezone.utc).replace(tzinfo=None)
        return v


class DriverPrefsPublic(BaseModel):
    smoking_allowed: bool
    pets_allowed: bool
    music_allowed: bool
    talking_preference: str
    luggage_size: str
    air_conditioning: bool
    custom_note: Optional[str]

    model_config = {"from_attributes": True}


class RideResponse(BaseModel):
    id: str
    driver_id: str
    origin: str
    destination: str
    origin_lat: Optional[float]
    origin_lng: Optional[float]
    destination_lat: Optional[float]
    destination_lng: Optional[float]
    departure_time: datetime
    available_seats: int
    price_per_seat: float
    pickup_location: Optional[str]
    dropoff_location: Optional[str]
    status: str
    is_recurring: bool = False
    recurrence_days: Optional[List[int]] = None
    driver_name: Optional[str] = None
    driver_avg_rating: Optional[float] = None
    driver_rating_count: Optional[int] = None
    driver_preferences: Optional[DriverPrefsPublic] = None

    model_config = {"from_attributes": True}
