# app/models/ride.py
#
# This file defines the "rides" table in the database.
# SQLAlchemy maps each class attribute to a column.
#
# Changes from the previous version:
#   - Added 4 new columns: origin_lat, origin_lng, destination_lat, destination_lng
#   - All Float (decimal numbers like 33.5731)
#   - nullable=True so old rides without coordinates still work
#
# After adding these columns, you need to create a new Alembic migration:
#   alembic revision --autogenerate -m "add_lat_lng_to_rides"
#   alembic upgrade head

import uuid
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Enum
from sqlalchemy.orm import relationship
from app.database import Base
import enum


class RideStatus(str, enum.Enum):
    ACTIVE    = "ACTIVE"
    FULL      = "FULL"
    CANCELLED = "CANCELLED"
    COMPLETED = "COMPLETED"


class Ride(Base):
    __tablename__ = "rides"

    id                  = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    driver_id           = Column(String, ForeignKey("users.id"), nullable=False)

    # City names (human-readable, shown in the UI)
    origin              = Column(String, nullable=False)
    destination         = Column(String, nullable=False)

    # Coordinates (used to draw the map — stored so we don't recalculate)
    origin_lat          = Column(Float, nullable=True)
    origin_lng          = Column(Float, nullable=True)
    destination_lat     = Column(Float, nullable=True)
    destination_lng     = Column(Float, nullable=True)

    departure_time      = Column(DateTime, nullable=False)
    available_seats     = Column(Integer, nullable=False)
    price_per_seat      = Column(Float, nullable=False)
    pickup_location     = Column(String, nullable=True)
    dropoff_location    = Column(String, nullable=True)
    status = Column(Enum(RideStatus), default=RideStatus.ACTIVE)    # Relationships
    driver              = relationship("User", back_populates="rides")
    bookings            = relationship("Booking", back_populates="ride")