import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import mapped_column, relationship
from app.database import Base


class RideAlert(Base):
    __tablename__ = "ride_alerts"

    id         = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id    = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    origin      = mapped_column(String, nullable=False)
    destination = mapped_column(String, nullable=False)
    is_active   = mapped_column(Boolean, default=True, nullable=False)
    created_at  = mapped_column(DateTime, default=datetime.utcnow)

    user = relationship("User")
