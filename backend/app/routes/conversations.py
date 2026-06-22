"""
Conversation persistence layer — ChatGPT-style memory for the AI copilot.

Endpoints:
  POST   /ai/conversations                   create a new conversation
  GET    /ai/conversations                   list user's conversations (newest first)
  GET    /ai/conversations/{id}              load conversation with all messages
  DELETE /ai/conversations/{id}              delete conversation
  POST   /ai/conversations/{id}/chat         send a message, get AI response, both saved
  PATCH  /ai/conversations/{id}/title        rename a conversation
"""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.user import User
from ..models.conversation import Conversation, ConversationMessage
from ..schemas.conversation import (
    ConversationListItem, ConversationDetail,
    ConversationMessageOut, ChatRequest,
)
from ..schemas.ai import AgentMessage, AgentResponse
from ..services.agent_service import agent_chat

router = APIRouter(prefix="/ai/conversations", tags=["Conversations"])


def _auto_title(message: str) -> str:
    t = message.strip()
    return (t[:57] + "...") if len(t) > 60 else t


# ---------------------------------------------------------------------------
# Create conversation
# ---------------------------------------------------------------------------
@router.post("", status_code=status.HTTP_201_CREATED, response_model=ConversationListItem)
async def create_conversation(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conv = Conversation(id=str(uuid.uuid4()), user_id=user.id)
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return conv


# ---------------------------------------------------------------------------
# List conversations
# ---------------------------------------------------------------------------
@router.get("", response_model=list[ConversationListItem])
async def list_conversations(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Conversation)
        .where(Conversation.user_id == user.id)
        .order_by(Conversation.updated_at.desc())
        .limit(100)
    )
    return result.scalars().all()


# ---------------------------------------------------------------------------
# Get conversation detail
# ---------------------------------------------------------------------------
@router.get("/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Conversation)
        .options(selectinload(Conversation.messages))
        .where(Conversation.id == conversation_id, Conversation.user_id == user.id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation introuvable")
    return conv


# ---------------------------------------------------------------------------
# Delete conversation
# ---------------------------------------------------------------------------
@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id, Conversation.user_id == user.id
        )
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation introuvable")
    await db.delete(conv)
    await db.commit()


# ---------------------------------------------------------------------------
# Rename conversation
# ---------------------------------------------------------------------------
@router.patch("/{conversation_id}/title", response_model=ConversationListItem)
async def rename_conversation(
    conversation_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id, Conversation.user_id == user.id
        )
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation introuvable")
    conv.title = str(body.get("title", ""))[:200]
    conv.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(conv)
    return conv


# ---------------------------------------------------------------------------
# Chat — the main endpoint
# ---------------------------------------------------------------------------
@router.post("/{conversation_id}/chat", response_model=AgentResponse)
async def chat(
    conversation_id: str,
    req: ChatRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Load conversation + existing messages
    result = await db.execute(
        select(Conversation)
        .options(selectinload(Conversation.messages))
        .where(Conversation.id == conversation_id, Conversation.user_id == user.id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation introuvable")

    # Build history for the agent (confirmed path bypasses LLM, so skip history)
    history: list[AgentMessage] = [
        AgentMessage(role=m.role, content=m.content)
        for m in conv.messages
    ]

    if not req.confirmed:
        # Append the new user message to history
        history.append(AgentMessage(role="user", content=req.message))

    # Call the agentic copilot
    response: AgentResponse = await agent_chat(
        messages=history,
        user=user,
        db=db,
        confirmed=req.confirmed,
        pending_action=req.pending_action,
    )

    # Persist user message (not for confirmation path — the "Confirm" press is implicit)
    if not req.confirmed:
        user_msg = ConversationMessage(
            id=str(uuid.uuid4()),
            conversation_id=conversation_id,
            role="user",
            content=req.message,
        )
        db.add(user_msg)

        # Auto-title from first user message
        if not conv.title:
            conv.title = _auto_title(req.message)

    # Persist assistant response
    assistant_msg = ConversationMessage(
        id=str(uuid.uuid4()),
        conversation_id=conversation_id,
        role="assistant",
        content=response.reply,
        ui_action=response.ui_action,
        data=response.data,
        needs_confirmation=response.needs_confirmation,
        pending_action=response.pending_action,
    )
    db.add(assistant_msg)

    conv.updated_at = datetime.utcnow()
    await db.commit()

    return response
