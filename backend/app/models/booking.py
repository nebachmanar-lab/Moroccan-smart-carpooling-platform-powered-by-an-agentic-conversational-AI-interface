import enum
import uuid
from datetime import datetime
from sqlalchemy import String, Integer, Float, DateTime, ForeignKey, Enum, Text
from sqlalchemy.orm import mapped_column, relationship
from app.database import Base


class BookingStatus(str, enum.Enum):
    PENDING   = "PENDING"
    CONFIRMED = "CONFIRMED"
    CANCELLED = "CANCELLED"


class Booking(Base):
    __tablename__ = "bookings"

    id           = mapped_column(String,  primary_key=True, default=lambda: str(uuid.uuid4()))
    ride_id      = mapped_column(String,  ForeignKey("rides.id", ondelete="CASCADE"), nullable=False)
    passenger_id = mapped_column(String,  ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    seats_booked = mapped_column(Integer, nullable=False, default=1)
    total_price  = mapped_column(Float,   nullable=False, default=0.0)
    status       = mapped_column(Enum(BookingStatus), default=BookingStatus.CONFIRMED, nullable=False)
    message      = mapped_column(Text,    nullable=True)
    cancelled_at = mapped_column(DateTime, nullable=True)
    created_at   = mapped_column(DateTime, default=datetime.utcnow)
    updated_at   = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    ride      = relationship("Ride", back_populates="bookings")
    passenger = relationship("User", back_populates="bookings")