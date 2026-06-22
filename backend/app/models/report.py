import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base


class Report(Base):
    __tablename__ = "reports"

    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    reporter_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    target_type = Column(String(20), nullable=False)  # "ride" | "user"
    target_id   = Column(String, nullable=False)
    reason      = Column(Text, nullable=False)
    status      = Column(String(20), nullable=False, default="PENDING")
    admin_note  = Column(Text, nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

    reporter = relationship("User", foreign_keys=[reporter_id])
