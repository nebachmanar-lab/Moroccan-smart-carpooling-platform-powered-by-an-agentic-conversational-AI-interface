from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class BookingCreate(BaseModel):
    ride_id:      str
    seats_booked: int = Field(default=1, ge=1, le=8)
    message:      Optional[str] = None


class BookingResponse(BaseModel):
    id:                 str
    ride_id:            str
    passenger_id:       str
    seats_booked:       int
    total_price:        float
    status:             str
    created_at:         datetime
    origin_city:        str
    destination_city:   str
    departure_datetime: datetime
    driver_name:        str

    model_config = {"from_attributes": True}


class BookingCancelResponse(BaseModel):
    booking_id: str
    status:     str
    message:    str

    model_config = {"from_attributes": True}


class BookingOut(BaseModel):
    id:           str
    ride_id:      str
    passenger_id: str
    status:       str
    message:      Optional[str]
    created_at:   datetime

    model_config = {"from_attributes": True}


class MyBookingItem(BaseModel):
    id:             str
    ride_id:        str
    status:         str
    seats_booked:   int
    total_price:    float
    created_at:     datetime
    origin:         str
    destination:    str
    departure_time: datetime
    driver_name:    str
    driver_id:      str
    ride_status:    str

    model_config = {"from_attributes": True}


class DriverBookingItem(BaseModel):
    booking_id:      str
    ride_id:         str
    origin:          str
    destination:     str
    departure_time:  datetime
    passenger_id:    str
    passenger_name:  str
    passenger_email: str
    passenger_phone: Optional[str]
    seats_booked:    int
    total_price:     float
    status:          str
    ride_status:     str
    booked_at:       datetime

    model_config = {"from_attributes": True}