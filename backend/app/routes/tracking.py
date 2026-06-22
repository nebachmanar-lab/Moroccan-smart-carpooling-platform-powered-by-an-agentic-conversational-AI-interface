"""
Real-time GPS tracking via WebSocket.

Flow:
  Driver  → connects as role=driver  → sends {lat, lng, speed?, heading?}
  Watcher → connects as role=watcher → receives driver location broadcasts
            Can auth with JWT token OR a share_token (no account required) — C-09
"""
import json
import logging
import secrets
from typing import Any, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi import Depends

from ..database import get_db
from ..models.ride import Ride, RideStatus
from ..middleware.auth import get_current_user_ws

# In-memory share tokens: { token: ride_id }
_share_tokens: dict[str, str] = {}

logger = logging.getLogger(__name__)
router = APIRouter(tags=["tracking"])

# { ride_id: { "driver": WebSocket|None, "watchers": list[WebSocket], "last": dict|None } }
_rooms: dict[str, dict[str, Any]] = {}


def _room(ride_id: str) -> dict:
    if ride_id not in _rooms:
        _rooms[ride_id] = {"driver": None, "watchers": [], "last": None}
    return _rooms[ride_id]


async def _broadcast(ride_id: str, payload: dict) -> None:
    room = _rooms.get(ride_id, {})
    dead = []
    for ws in room.get("watchers", []):
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        room["watchers"].remove(ws)


@router.get("/rides/{ride_id}/tracking/share-link")
async def get_tracking_share_link(
    ride_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Return a share token that allows anyone to watch tracking without logging in (C-09)."""
    result = await db.execute(select(Ride).where(Ride.id == ride_id))
    ride = result.scalar_one_or_none()
    if not ride:
        raise HTTPException(status_code=404, detail="Trajet introuvable")
    # Reuse existing token for this ride if one exists, else create new
    existing = next((t for t, rid in _share_tokens.items() if rid == ride_id), None)
    token = existing or secrets.token_urlsafe(16)
    _share_tokens[token] = ride_id
    return {"ride_id": ride_id, "share_token": token}


@router.websocket("/ws/tracking/{ride_id}")
async def tracking_ws(
    websocket: WebSocket,
    ride_id: str,
    role: str = Query("watcher", description="'driver' or 'watcher'"),
    token: Optional[str] = Query(None, description="JWT access token"),
    share_token: Optional[str] = Query(None, description="Public share token (no login required)"),
    db: AsyncSession = Depends(get_db),
):
    # Authenticate: JWT required for drivers, share_token allows public watchers (C-09)
    user = None
    if token:
        user = await get_current_user_ws(token, db)
    elif share_token and role == "watcher":
        if _share_tokens.get(share_token) != ride_id:
            await websocket.close(code=4001, reason="Invalid share token")
            return
        user = True  # sentinel — public watcher authenticated via share token

    if not user:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    # Verify ride exists and is active
    result = await db.execute(select(Ride).where(Ride.id == ride_id))
    ride = result.scalar_one_or_none()
    if not ride:
        await websocket.close(code=4004, reason="Ride not found")
        return

    await websocket.accept()
    room = _room(ride_id)

    if role == "driver":
        if user is True or ride.driver_id != user.id:
            await websocket.close(code=4003, reason="Not the driver of this ride")
            return
        room["driver"] = websocket
        logger.info(f"Driver {user.id} started tracking ride {ride_id}")
        await websocket.send_json({"type": "connected", "role": "driver", "ride_id": ride_id})

        try:
            while True:
                data = await websocket.receive_json()
                lat = data.get("lat")
                lng = data.get("lng")
                if lat is None or lng is None:
                    continue
                location = {
                    "type": "location",
                    "lat": lat,
                    "lng": lng,
                    "speed": data.get("speed"),
                    "heading": data.get("heading"),
                    "ride_id": ride_id,
                }
                room["last"] = location
                await _broadcast(ride_id, location)
        except WebSocketDisconnect:
            room["driver"] = None
            room["last"] = None
            await _broadcast(ride_id, {"type": "driver_disconnected", "ride_id": ride_id})
            logger.info(f"Driver disconnected from ride {ride_id}")

    else:  # watcher (passenger or public via share token)
        room["watchers"].append(websocket)
        watcher_id = "public" if user is True else getattr(user, "id", "unknown")
        logger.info(f"Watcher {watcher_id} joined ride {ride_id} ({len(room['watchers'])} total)")

        # Send last known position immediately so they don't wait
        if room["last"]:
            await websocket.send_json(room["last"])
        else:
            await websocket.send_json({"type": "waiting", "message": "En attente du conducteur..."})

        try:
            while True:
                # Watchers only receive; ignore any data they send
                await websocket.receive_text()
        except WebSocketDisconnect:
            if websocket in room["watchers"]:
                room["watchers"].remove(websocket)
            watcher_id = "public" if user is True else getattr(user, "id", "unknown")
            logger.info(f"Watcher {watcher_id} left ride {ride_id}")


@router.get("/rides/{ride_id}/tracking/status")
async def tracking_status(ride_id: str):
    """Check if a driver is currently sharing their location for this ride."""
    room = _rooms.get(ride_id)
    if not room or not room["driver"]:
        return {"active": False, "watchers": 0}
    return {
        "active": True,
        "watchers": len(room.get("watchers", [])),
        "last_location": room.get("last"),
    }
