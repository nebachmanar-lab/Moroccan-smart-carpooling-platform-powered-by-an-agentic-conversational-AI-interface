import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.orm import mapped_column, relationship
from app.database import Base


class DirectMessage(Base):
    __tablename__ = "direct_messages"

    id         = mapped_column(String,  primary_key=True, default=lambda: str(uuid.uuid4()))
    booking_id = mapped_column(String,  ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False)
    sender_id  = mapped_column(String,  ForeignKey("users.id",    ondelete="CASCADE"), nullable=False)
    content    = mapped_column(Text,    nullable=False)
    read       = mapped_column(Boolean, default=False)
    created_at = mapped_column(DateTime, default=datetime.utcnow)

    sender  = relationship("User",    foreign_keys=[sender_id])
    booking = relationship("Booking", foreign_keys=[booking_id])
