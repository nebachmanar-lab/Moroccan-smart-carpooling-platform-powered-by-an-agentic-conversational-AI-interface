import uuid
from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import mapped_column, relationship
from app.database import Base


class PassengerRating(Base):
    __tablename__ = "passenger_ratings"
    __table_args__ = (
        UniqueConstraint("ride_id", "driver_id", "passenger_id", name="uq_passenger_rating"),
    )

    id           = mapped_column(String,  primary_key=True, default=lambda: str(uuid.uuid4()))
    ride_id      = mapped_column(String,  ForeignKey("rides.id",  ondelete="CASCADE"), nullable=False)
    driver_id    = mapped_column(String,  ForeignKey("users.id",  ondelete="CASCADE"), nullable=False)
    passenger_id = mapped_column(String,  ForeignKey("users.id",  ondelete="CASCADE"), nullable=False)
    stars        = mapped_column(Integer, nullable=False)
    comment      = mapped_column(Text,    nullable=True)
    created_at   = mapped_column(DateTime, default=datetime.utcnow)

    driver    = relationship("User", foreign_keys=[driver_id])
    passenger = relationship("User", foreign_keys=[passenger_id])
