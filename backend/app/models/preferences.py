from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import mapped_column, relationship
from app.database import Base

class DriverPreferences(Base):
    __tablename__ = "driver_preferences"

    id                 = mapped_column(String, primary_key=True)
    driver_id          = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    smoking_allowed    = mapped_column(Boolean, default=False, nullable=False)
    pets_allowed       = mapped_column(Boolean, default=False, nullable=False)
    music_allowed      = mapped_column(Boolean, default=True, nullable=False)
    talking_preference = mapped_column(String, default="no_preference", nullable=False)
    luggage_size       = mapped_column(String, default="medium", nullable=False)
    air_conditioning   = mapped_column(Boolean, default=True, nullable=False)
    custom_note        = mapped_column(String, nullable=True)
    created_at         = mapped_column(DateTime, default=datetime.utcnow)
    updated_at         = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    driver = relationship("User", back_populates="preferences")