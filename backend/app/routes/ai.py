from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..schemas.ai import ChatRequest, AISearchResponse, AgentRequest, AgentResponse
from ..services.ai_service import ai_search
from ..services.agent_service import agent_chat
from ..middleware.auth import get_current_user
from ..models.ride import Ride, RideStatus
from ..models.user import User

router = APIRouter(prefix="/ai", tags=["AI"])


@router.post("/search", response_model=AISearchResponse)
async def ai_search_endpoint(req: ChatRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Ride).filter(Ride.status == RideStatus.ACTIVE))
    rides = result.scalars().all()
    rides_dicts = [
        {k: v for k, v in r.__dict__.items() if not k.startswith("_")}
        for r in rides
    ]
    return await ai_search(req.message, rides_dicts)


@router.post("/agent", response_model=AgentResponse)
async def agent_endpoint(
    req: AgentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await agent_chat(
        messages=req.messages,
        user=current_user,
        db=db,
        confirmed=req.confirmed,
        pending_action=req.pending_action,
    )
