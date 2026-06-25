from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime


class ConversationMessageOut(BaseModel):
    id: str
    role: str
    content: str
    ui_action: Optional[str] = "none"
    data: Optional[dict] = None
    needs_confirmation: Optional[bool] = False
    pending_action: Optional[dict] = None
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("ui_action", mode="before")
    @classmethod
    def default_ui_action(cls, v: object) -> str:
        return "none" if v is None else str(v)

    @field_validator("needs_confirmation", mode="before")
    @classmethod
    def default_needs_confirmation(cls, v: object) -> bool:
        return False if v is None else bool(v)


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
