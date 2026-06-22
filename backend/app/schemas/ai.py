from pydantic import BaseModel
from typing import Optional


class ExtractedEntities(BaseModel):
    from_city: Optional[str] = None
    to_city: Optional[str] = None
    date: Optional[str] = None
    seats: Optional[int] = None
    max_price: Optional[float] = None
    is_tourist: bool = False
    language: str = "fr"


class ChatRequest(BaseModel):
    message: str


class AISearchResponse(BaseModel):
    entities: ExtractedEntities
    rides: list[dict]


# ---------------------------------------------------------------------------
# Agentic copilot schemas
# ---------------------------------------------------------------------------

class AgentMessage(BaseModel):
    role: str   # "user" | "assistant"
    content: str


class AgentRequest(BaseModel):
    messages: list[AgentMessage]
    confirmed: bool = False
    pending_action: Optional[dict] = None


class AgentResponse(BaseModel):
    reply: str
    ui_action: str = "none"
    # ui_action values:
    #   "none"                 - text reply only
    #   "show_rides"           - ride cards grid
    #   "show_ride_detail"     - detailed single ride card
    #   "show_booking_summary" - booking confirmation UI
    #   "booking_confirmed"    - success state
    #   "show_tourist_info"    - destination info cards
    #   "show_payment_methods" - payment options
    #   "error"                - error state
    data: Optional[dict] = None
    needs_confirmation: bool = False
    pending_action: Optional[dict] = None
