from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class ConversationMessageOut(BaseModel):
    id: str
    role: str
    content: str
    ui_action: str = "none"
    data: Optional[dict] = None
    needs_confirmation: bool = False
    pending_action: Optional[dict] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ConversationListItem(BaseModel):
    id: str
    title: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ConversationDetail(BaseModel):
    id: str
    title: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    messages: list[ConversationMessageOut] = []

    model_config = {"from_attributes": True}


class ChatRequest(BaseModel):
    message: str
    confirmed: bool = False
    pending_action: Optional[dict] = None
