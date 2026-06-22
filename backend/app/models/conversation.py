import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Boolean, ForeignKey, Text
from sqlalchemy import JSON
from sqlalchemy.orm import relationship
from app.database import Base


class Conversation(Base):
    __tablename__ = "conversations"

    id         = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id    = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title      = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    messages = relationship(
        "ConversationMessage",
        back_populates="conversation",
        order_by="ConversationMessage.created_at",
        cascade="all, delete-orphan",
    )


class ConversationMessage(Base):
    __tablename__ = "conversation_messages"

    id                  = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id     = Column(String, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    role                = Column(String(20), nullable=False)   # "user" | "assistant"
    content             = Column(Text, nullable=False)
    ui_action           = Column(String(50), nullable=True)
    data                = Column(JSON, nullable=True)           # rides, tourist info, booking data…
    needs_confirmation  = Column(Boolean, default=False)
    pending_action      = Column(JSON, nullable=True)
    created_at          = Column(DateTime, default=datetime.utcnow)

    conversation = relationship("Conversation", back_populates="messages")
