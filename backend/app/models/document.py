import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Enum
from sqlalchemy.orm import mapped_column, relationship
from app.database import Base
import enum


class DocType(str, enum.Enum):
    CIN    = "CIN"
    PERMIS = "PERMIS"


class DocStatus(str, enum.Enum):
    PENDING  = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class DriverDocument(Base):
    __tablename__ = "driver_documents"

    id            = mapped_column(String,  primary_key=True, default=lambda: str(uuid.uuid4()))
    driver_id     = mapped_column(String,  ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    doc_type      = mapped_column(Enum(DocType),   nullable=False)
    file_path     = mapped_column(String,  nullable=False)
    original_name = mapped_column(String,  nullable=False)
    status        = mapped_column(Enum(DocStatus), default=DocStatus.PENDING, nullable=False)
    admin_note    = mapped_column(String,  nullable=True)
    created_at    = mapped_column(DateTime, default=datetime.utcnow)

    driver = relationship("User", foreign_keys=[driver_id])
