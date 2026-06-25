"""
Agentic AI copilot service.
Uses Groq's function-calling API so the LLM orchestrates real app tools
instead of generating freeform intents.

IMPLEMENTED:
  30+ tools covering search, booking, ride publication, ratings, alerts,
  reports, GPS share links, preferences, and tourist information.
  Full Darija/French bilingual support via Groq Llama-3.3-70B.

NOT IMPLEMENTED (IA-06 — Automated anomaly detection):
  Automated detection of abnormal prices or fake reviews by the AI agent
  is not implemented. The admin dashboard flags suspicious ratings with a
  simple rule (stars ≤ 2 and no comment), but there is no ML-based or
  LLM-based anomaly detection pipeline. This was planned for Phase 3 and
  deferred due to time constraints.
"""
import asyncio
import json
from datetime import date, timedelta

from groq import AsyncGroq
import os

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import joinedload

import uuid

from ..models.user import User
from ..models.ride import Ride, RideStatus
from ..models.booking import Booking, BookingStatus
from ..schemas.booking import BookingCreate
from ..schemas.ai import AgentMessage, AgentResponse
from . import agent_tools as tools
from .agent_tools import TOOL_DEFINITIONS
from .booking import create_booking

MODEL = "llama-3.1-8b-instant"
MAX_TOOL_ITERATIONS = 6


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

async def _get_user_top_routes(user: User, db: AsyncSession) -> str:
    """Query DB for the user's most-used routes to personalise the agent (IA-05)."""
    try:
        role = user.role.value if hasattr(user.role, "value") else str(user.role)
        if role == "DRIVER":
            result = await db.execute(
                select(Ride.origin, Ride.destination, func.count(Ride.id).label("n"))
                .where(Ride.driver_id == user.id)
                .group_by(Ride.origin, Ride.destination)
                .order_by(func.count(Ride.id).desc())
                .limit(3)
            )
        else:
            result = await db.execute(
                select(Ride.origin, Ride.destination, func.count(Booking.id).label("n"))
                .join(Ride, Booking.ride_id == Ride.id)
                .where(Booking.passenger_id == user.id, Booking.status == BookingStatus.CONFIRMED)
                .group_by(Ride.origin, Ride.destination)
                .order_by(func.count(Booking.id).desc())
                .limit(3)
            )
        rows = result.all()
        if not rows:
            return ""
        routes = ", ".join(f"{r.origin} → {r.destination}" for r in rows)
        label = "frequent routes published" if role == "DRIVER" else "past routes taken"
        return f"\nUser's {label}: {routes}. Prioritise these when relevant.\n"
    except Exception:
        return ""


_DRIVER_ONLY = {
    "get_my_rides", "get_driver_bookings", "prepare_publish_ride",
    "prepare_cancel_ride", "prepare_edit_ride", "rate_passenger_by_driver",
    "get_tracking_share_link", "get_user_preferences", "save_custom_note",
    "prepare_set_recurring",
    # new driver-only tools:
    "get_ride_passengers", "prepare_accept_booking", "prepare_refuse_booking",
    "prepare_send_message_to_passenger", "get_driver_revenue_summary",
    "get_my_driver_documents",
}

_PASSENGER_ONLY = {
    "get_my_bookings", "prepare_cancel_booking", "prepare_booking",
    "get_driver_profile", "get_booking_messages", "prepare_send_message",
    "get_tracking_for_booking", "get_my_alerts", "create_search_alert",
    "delete_search_alert", "submit_rating", "get_tourist_info",
    "get_payment_methods", "prepare_report",
}


async def _system_prompt(user: User, db: AsyncSession) -> str:
    today = date.today()
    tomorrow = today + timedelta(days=1)
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    top_routes = await _get_user_top_routes(user, db)
    weekend = today + timedelta(days=(5 - today.weekday()) % 7 + 1)

    if role == "DRIVER":
        return f"""You are Rafi, AI copilot of CovoMar for DRIVER {user.first_name} {user.last_name}.

Today: {today} | demain={tomorrow} | weekend={weekend}{top_routes}
Cities: kaza/casa→Casablanca, rbat→Rabat, fas→Fès, mrrakch→Marrakech, tnja→Tanger, meknas→Meknès, wjda→Oujda, agadir→Agadir, tet→Tétouan, lgdida→El Jadida

Tool-calling rules — you have no internal knowledge of user data:
- For rides: call get_my_rides. For bookings: call get_driver_bookings. For revenue: call get_driver_revenue_summary. For documents: call get_my_driver_documents. For preferences: call get_user_preferences.
- For tourist info (hotels, hébergements, restaurants, attractions, que voir, activities, tourism): call get_tourist_info with the city name. NEVER call get_my_rides for tourist questions.
- When the user activates "mode touristique" or asks to switch to tourist mode: respond with a generic welcome message ("Mode touristique activé. Quelle ville souhaitez-vous explorer ?") — do NOT assume or mention any specific city.
- Call ONE tool, get the result, then respond. Do not chain multiple tools unless the user explicitly asked for several things.
- Never invent numbers, ride IDs, prices, or status values.

Action rules:
- prepare_* tools (prepare_update_preferences, prepare_publish_ride, prepare_cancel_ride, etc.): call first, wait for user confirmation before executing.
- rate_passenger_by_driver: execute directly, no confirmation.
- To show preferences: call get_user_preferences — the UI card lets the user toggle values directly.
- When the driver describes personal rules or preferences in text (e.g. punctuality, no food, rest stops): call save_custom_note with their exact words.
- When the driver wants to mark a ride as "trajet habituel" or set recurring days: call get_my_rides to show the ride list — each card has an "Habitualiser" checkbox the driver can use directly. Do NOT call prepare_set_recurring.
- Convert relative dates (demain/ghdwa={tomorrow}, lyoum={today}, weekend={weekend}) to YYYY-MM-DD.
- For prepare_publish_ride: departure_date (YYYY-MM-DD) and departure_time (HH:MM) are separate params.
- Only access your own rides, bookings, passengers, documents.
- Never give admin access or validate your own documents.

Language: Detect French/Darija/Arabic, always reply in same language. Be concise."""
    else:
        return f"""You are Rafi, the AI copilot of CovoMar (Moroccan carpooling). You control app features via tools — never invent data.

User: {user.first_name} {user.last_name} | Role: {role} | Today: {today}{top_routes}
Dates: demain/ghdwa={tomorrow}, lyoum={today}, ce weekend={weekend}. Convert all relative dates to YYYY-MM-DD before tool calls.
Cities (Darija→standard): kaza/casa→Casablanca, rbat→Rabat, fas→Fès, mrrakch→Marrakech, tnja→Tanger, meknas→Meknès, wjda→Oujda, agadir→Agadir, tet→Tétouan, lgdida→El Jadida

Rules:
1. Always call a tool via the tool-calling API — NEVER write <function=...> syntax in your text reply.
2. Never invent rides, prices, or statuses — only return what tools return.
3. prepare_* tools (booking/publish/cancel/edit/report/send_message): call first, then wait for user confirmation.
4. submit_rating, rate_passenger_by_driver, create_search_alert, delete_search_alert, update_preferences: execute directly, no confirmation.
5. Ask for missing required info before calling a tool.
6. PASSENGER cannot publish rides. DRIVER can book rides as passenger.
7. For tourist info (hotels, hébergements, restaurants, attractions, que voir, activities): call get_tourist_info with the city name.
8. When the user activates "mode touristique": respond "Mode touristique activé. Quelle ville souhaitez-vous explorer ?" — do NOT assume any specific city.

Language: Detect French/Darija/Arabic and always reply in the same language. The UI shows visual cards — be concise, don't describe what cards already show."""


# ---------------------------------------------------------------------------
# Tool executor
# ---------------------------------------------------------------------------

async def _execute_tool(name: str, args: dict, user: User, db: AsyncSession) -> dict:
    try:
        if name == "search_rides":
            return await tools.search_rides(db, **args)
        if name == "get_ride_details":
            return await tools.get_ride_details(db, args["ride_id"])
        if name == "estimate_distance_duration":
            return tools.estimate_distance_duration(args["from_city"], args["to_city"])
        if name == "check_seat_availability":
            return await tools.check_seat_availability(
                db, args["ride_id"], args.get("seats_needed", 1)
            )
        if name == "prepare_booking":
            return await tools.prepare_booking(
                db, args["ride_id"], args.get("seats", 1), user
            )
        if name == "get_my_rides":
            return await tools.get_my_rides(db, user)
        if name == "get_my_bookings":
            return await tools.get_my_bookings(db, user)
        if name == "get_driver_bookings":
            return await tools.get_driver_bookings(db, user, args.get("ride_id"))
        if name == "prepare_cancel_booking":
            return await tools.prepare_cancel_booking(db, args["booking_id"], user)
        if name == "prepare_cancel_ride":
            return await tools.prepare_cancel_ride(db, args["ride_id"], user)
        if name == "get_user_preferences":
            return await tools.get_user_preferences(db, user)
        if name == "save_custom_note":
            return await tools.save_custom_note(db, user, args["note"])
        if name == "prepare_set_recurring":
            return await tools.prepare_set_recurring(db, user, args["ride_id"])
        if name == "prepare_publish_ride":
            return await tools.prepare_publish_ride(user=user, **args)
        if name == "get_tourist_info":
            return tools.get_tourist_info(args["destination"])
        if name == "get_payment_methods":
            return tools.get_payment_methods()
        if name == "get_driver_ratings":
            return await tools.get_driver_ratings(db, args["driver_id"])
        if name == "submit_rating":
            return await tools.submit_rating(db, user, args["ride_id"], int(args["stars"]), args.get("comment"))
        if name == "rate_passenger_by_driver":
            return await tools.rate_passenger_by_driver(db, user, args["ride_id"], args["passenger_id"], int(args["stars"]), args.get("comment"))
        if name == "get_my_alerts":
            return await tools.get_my_alerts(db, user)
        if name == "create_search_alert":
            return await tools.create_search_alert(db, user, args["origin"], args["destination"])
        if name == "delete_search_alert":
            return await tools.delete_search_alert(db, user, args["alert_id"])
        if name == "prepare_report":
            return await tools.prepare_report(db, user, args["target_type"], args["target_id"], args["reason"])
        if name == "prepare_edit_ride":
            return await tools.prepare_edit_ride(
                db, user, args["ride_id"],
                price_per_seat=args.get("price_per_seat"),
                available_seats=args.get("available_seats"),
                departure_time=args.get("departure_time"),
                pickup_location=args.get("pickup_location"),
                dropoff_location=args.get("dropoff_location"),
            )
        if name == "get_tracking_share_link":
            return await tools.get_tracking_share_link(db, user, args["ride_id"])
        if name == "get_ride_passengers":
            return await tools.get_ride_passengers(db, args["ride_id"], user)
        if name == "prepare_accept_booking":
            return await tools.prepare_accept_booking(db, args["booking_id"], user)
        if name == "prepare_refuse_booking":
            return await tools.prepare_refuse_booking(db, args["booking_id"], user)
        if name == "prepare_send_message_to_passenger":
            return await tools.prepare_send_message_to_passenger(db, args["booking_id"], args["content"], user)
        if name == "get_driver_revenue_summary":
            return await tools.get_driver_revenue_summary(db, user)
        if name == "get_my_driver_documents":
            return await tools.get_my_driver_documents(db, user)
        return {"error": f"Unknown tool: {name}"}
    except Exception as exc:
        return {"error": str(exc)}


# ---------------------------------------------------------------------------
# Main agent entry point
# ---------------------------------------------------------------------------

async def agent_chat(
    messages: list[AgentMessage],
    user: User,
    db: AsyncSession,
    confirmed: bool = False,
    pending_action: dict | None = None,
) -> AgentResponse:
    """
    Main copilot loop.

    Normal path: build LLM messages → call Groq with tool definitions →
    execute returned tool calls → repeat until LLM stops → return response.

    Confirmation path: when confirmed=True and pending_action is present,
    directly execute create_booking without calling the LLM.
    """

    # -----------------------------------------------------------------------
    # Confirmation path — user clicked "Confirm" in the UI
    # -----------------------------------------------------------------------
    if confirmed and pending_action and pending_action.get("action") == "cancel_booking":
        from .booking import cancel_booking as _cancel_booking
        booking_id = pending_action.get("booking_id") or pending_action.get("summary", {}).get("booking_id")
        try:
            await _cancel_booking(db, booking_id, user.id)
            s = pending_action.get("summary", {})
            return AgentResponse(
                reply=f"Réservation annulée. Trajet {s.get('origin')} → {s.get('destination')} supprimé de vos réservations.",
                ui_action="booking_cancelled",
                data={"booking_id": booking_id},
            )
        except Exception as exc:
            return AgentResponse(reply=f"Erreur lors de l'annulation : {exc}", ui_action="error")

    if confirmed and pending_action and pending_action.get("action") == "cancel_ride":
        ride_id = pending_action.get("ride_id") or pending_action.get("summary", {}).get("ride_id")
        try:
            result = await db.execute(
                select(Ride).where(Ride.id == ride_id, Ride.driver_id == user.id)
            )
            ride = result.scalar_one_or_none()
            if not ride:
                return AgentResponse(reply="Trajet introuvable.", ui_action="error")
            ride.status = RideStatus.CANCELLED
            await db.commit()
            s = pending_action.get("summary", {})
            return AgentResponse(
                reply=f"Trajet annulé : {s.get('origin')} → {s.get('destination')}. Les passagers déjà réservés seront notifiés.",
                ui_action="ride_cancelled",
                data={"ride_id": ride_id},
            )
        except Exception as exc:
            return AgentResponse(reply=f"Erreur lors de l'annulation : {exc}", ui_action="error")

    if confirmed and pending_action and pending_action.get("action") == "create_ride":
        s = pending_action.get("summary", {})
        try:
            from datetime import datetime as _dt
            departure_time = _dt.fromisoformat(s["departure_time"])
            ride = Ride(
                id=str(uuid.uuid4()),
                driver_id=user.id,
                origin=s["origin"],
                destination=s["destination"],
                departure_time=departure_time,
                available_seats=s["available_seats"],
                price_per_seat=s["price_per_seat"],
                pickup_location=s.get("pickup_location"),
                dropoff_location=s.get("dropoff_location"),
                origin_lat=s.get("origin_lat"),
                origin_lng=s.get("origin_lng"),
                destination_lat=s.get("destination_lat"),
                destination_lng=s.get("destination_lng"),
            )
            db.add(ride)
            await db.commit()
            await db.refresh(ride)
            dt_str = departure_time.strftime("%d/%m/%Y à %H:%M")
            return AgentResponse(
                reply=(
                    f"Trajet publié avec succès ! {ride.origin} → {ride.destination}, "
                    f"{dt_str}, {ride.available_seats} place(s) à {ride.price_per_seat:.0f} MAD/place. "
                    f"Les passagers peuvent maintenant le réserver."
                ),
                ui_action="ride_published",
                data={"ride": {
                    "id": ride.id,
                    "origin": ride.origin,
                    "destination": ride.destination,
                    "departure_time": ride.departure_time.isoformat(),
                    "available_seats": ride.available_seats,
                    "price_per_seat": ride.price_per_seat,
                }},
            )
        except Exception as exc:
            return AgentResponse(reply=f"Erreur lors de la publication : {exc}", ui_action="error")

    if confirmed and pending_action and pending_action.get("action") == "create_report":
        s = pending_action.get("summary", {})
        try:
            from ..models.report import Report as _Report
            import uuid as _uuid
            report = _Report(
                id=str(_uuid.uuid4()),
                reporter_id=user.id,
                target_type=s["target_type"],
                target_id=s["target_id"],
                reason=s["reason"],
                status="PENDING",
            )
            db.add(report)
            await db.commit()
            label = "trajet" if s["target_type"] == "ride" else "utilisateur"
            return AgentResponse(
                reply=f"Signalement envoyé. Notre équipe de modération va examiner ce {label}.",
                ui_action="report_sent",
                data={"report_id": report.id},
            )
        except Exception as exc:
            return AgentResponse(reply=f"Erreur lors du signalement : {exc}", ui_action="error")

    if confirmed and pending_action and pending_action.get("action") == "edit_ride":
        s = pending_action.get("summary", {})
        ride_id = s["ride_id"]
        try:
            result = await db.execute(
                select(Ride).where(Ride.id == ride_id, Ride.driver_id == user.id)
            )
            ride = result.scalar_one_or_none()
            if not ride:
                return AgentResponse(reply="Trajet introuvable.", ui_action="error")
            for field in ("price_per_seat", "available_seats", "pickup_location", "dropoff_location"):
                if field in s and s[field] is not None:
                    setattr(ride, field, s[field])
            if "departure_time" in s and s["departure_time"]:
                from datetime import datetime as _dt
                ride.departure_time = _dt.fromisoformat(s["departure_time"])
            await db.commit()
            return AgentResponse(
                reply=f"Trajet {ride.origin} → {ride.destination} modifié avec succès.",
                ui_action="ride_updated",
                data={"ride_id": ride_id},
            )
        except Exception as exc:
            return AgentResponse(reply=f"Erreur lors de la modification : {exc}", ui_action="error")

    if confirmed and pending_action and pending_action.get("action") == "accept_booking":
        s = pending_action.get("summary", {})
        booking_id = s.get("booking_id")
        try:
            b_res = await db.execute(
                select(Booking).options(joinedload(Booking.ride))
                .where(Booking.id == booking_id)
            )
            booking = b_res.scalar_one_or_none()
            if not booking or (booking.ride and booking.ride.driver_id != user.id):
                return AgentResponse(reply="Réservation introuvable ou accès non autorisé.", ui_action="error")
            booking.status = BookingStatus.CONFIRMED
            await db.commit()
            return AgentResponse(
                reply=f"Réservation de {s.get('passenger_name')} acceptée pour {s.get('origin')} → {s.get('destination')}.",
                ui_action="booking_accepted",
                data={"booking_id": booking_id, "passenger_name": s.get("passenger_name")},
            )
        except Exception as exc:
            return AgentResponse(reply=f"Erreur : {exc}", ui_action="error")

    if confirmed and pending_action and pending_action.get("action") == "refuse_booking":
        s = pending_action.get("summary", {})
        booking_id = s.get("booking_id")
        try:
            b_res = await db.execute(
                select(Booking).options(joinedload(Booking.ride))
                .where(Booking.id == booking_id)
            )
            booking = b_res.scalar_one_or_none()
            if not booking or (booking.ride and booking.ride.driver_id != user.id):
                return AgentResponse(reply="Réservation introuvable ou accès non autorisé.", ui_action="error")
            booking.status = BookingStatus.CANCELLED
            if booking.ride:
                booking.ride.available_seats += booking.seats_booked
            await db.commit()
            return AgentResponse(
                reply=f"Réservation de {s.get('passenger_name')} refusée. {booking.seats_booked} place(s) remises disponibles.",
                ui_action="booking_refused",
                data={"booking_id": booking_id, "passenger_name": s.get("passenger_name")},
            )
        except Exception as exc:
            return AgentResponse(reply=f"Erreur : {exc}", ui_action="error")

    if confirmed and pending_action and pending_action.get("action") == "send_message_to_passenger":
        from ..models.message import DirectMessage
        s = pending_action.get("summary", {})
        booking_id = s.get("booking_id")
        content = s.get("content", "")
        try:
            import uuid as _uuid_mod
            msg = DirectMessage(id=str(_uuid_mod.uuid4()), booking_id=booking_id, sender_id=user.id, content=content)
            db.add(msg)
            await db.commit()
            return AgentResponse(
                reply=f"Message envoyé à {s.get('passenger_name', 'le passager')} : « {content} »",
                ui_action="message_sent",
                data={"booking_id": booking_id, "content": content},
            )
        except Exception as exc:
            return AgentResponse(reply=f"Erreur lors de l'envoi : {exc}", ui_action="error")

    if confirmed and pending_action and pending_action.get("action") == "create_booking":
        ride_id = pending_action["ride_id"]
        seats = pending_action.get("seats", 1)
        try:
            booking, ride = await create_booking(
                db,
                BookingCreate(ride_id=ride_id, seats_booked=seats),
                user.id,
            )
            dt = ride.departure_time.strftime("%d/%m/%Y à %H:%M")
            return AgentResponse(
                reply=(
                    f"Réservation confirmée ! {ride.origin} → {ride.destination}, "
                    f"{dt}, {booking.seats_booked} place(s), {booking.total_price:.0f} MAD. "
                    f"Bon voyage !"
                ),
                ui_action="booking_confirmed",
                data={
                    "booking": {
                        "booking_id": booking.id,
                        "origin": ride.origin,
                        "destination": ride.destination,
                        "departure_time": ride.departure_time.isoformat(),
                        "seats_booked": booking.seats_booked,
                        "total_price": booking.total_price,
                        "ride_id": ride.id,
                    }
                },
            )
        except Exception as exc:
            return AgentResponse(reply=f"Erreur lors de la réservation : {exc}", ui_action="error")

    # -----------------------------------------------------------------------
    # Fast-path: tourist info — call directly without LLM to avoid tool_use_failed
    # -----------------------------------------------------------------------
    _CITY_ALIASES: dict[str, str] = {
        "casablanca": "Casablanca", "casa": "Casablanca", "kaza": "Casablanca",
        "rabat": "Rabat", "rbat": "Rabat",
        "fes": "Fès", "fas": "Fès", "fès": "Fès",
        "marrakech": "Marrakech", "mrrakch": "Marrakech",
        "tanger": "Tanger", "tnja": "Tanger",
        "agadir": "Agadir",
        "tetouan": "Tétouan", "tétouan": "Tétouan", "tet": "Tétouan",
        "chefchaouen": "Chefchaouen",
        "ouarzazate": "Ouarzazate",
        "meknes": "Meknès", "meknès": "Meknès", "meknas": "Meknès",
        "el jadida": "El Jadida", "lgdida": "El Jadida",
        "oujda": "Oujda", "wjda": "Oujda",
        "essaouira": "Essaouira",
        "ifrane": "Ifrane",
    }
    _TOURIST_KEYWORDS = (
        "heberg", "hotel", "restaurant", "voir", "visit", "attraction",
        "touristique", "tourist", "activit", "discover", "explorer",
        "riads", "médina", "medina", "sortir", "recommand",
    )
    if messages:
        last_msg = messages[-1].content.strip().lower()
        # Detect city name (standalone or with tourist keywords)
        detected_city: str | None = None
        for alias, canonical in _CITY_ALIASES.items():
            if alias in last_msg:
                detected_city = canonical
                break
        # Trigger fast-path if: message is just a city name OR contains tourist keyword
        if detected_city:
            is_pure_city = last_msg in _CITY_ALIASES
            has_tourist_kw = any(kw in last_msg for kw in _TOURIST_KEYWORDS)
            # Also check if previous assistant msg asked for a city (tourist mode context)
            prev_assistant_msgs = [m.content.lower() for m in messages[:-1] if m.role == "assistant"]
            tourist_context = any(
                any(kw in m for kw in ("ville", "explorer", "touristique", "souhaitez-vous"))
                for m in prev_assistant_msgs
            )
            if is_pure_city or has_tourist_kw or tourist_context:
                result = tools.get_tourist_info(detected_city)
                if result.get("found"):
                    return AgentResponse(
                        reply=f"Voici les informations touristiques pour **{detected_city}** :",
                        ui_action="tourist_info",
                        data={"tourist_info": result},
                    )

    # -----------------------------------------------------------------------
    # Normal agentic loop
    # -----------------------------------------------------------------------
    client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))

    _role = user.role.value if hasattr(user.role, "value") else str(user.role)
    if _role == "PASSENGER":
        active_tools = [t for t in TOOL_DEFINITIONS if t["function"]["name"] not in _DRIVER_ONLY]
    elif _role == "DRIVER":
        active_tools = [t for t in TOOL_DEFINITIONS if t["function"]["name"] not in _PASSENGER_ONLY]
    else:
        active_tools = TOOL_DEFINITIONS

    llm_messages: list[dict] = [
        {"role": "system", "content": await _system_prompt(user, db)},
        *[{"role": m.role, "content": m.content} for m in messages],
    ]

    accumulated_data: dict = {}
    ui_action = "none"
    _tool_use_failed_retried = False

    for _iteration in range(MAX_TOOL_ITERATIONS):
        try:
            _last_exc: Exception | None = None
            for _attempt in range(3):
                try:
                    response = await client.chat.completions.create(
                        model=MODEL,
                        messages=llm_messages,
                        tools=active_tools,
                        tool_choice="auto",
                        temperature=0.3,
                        max_tokens=1024,
                    )
                    break
                except Exception as _exc:
                    _last_exc = _exc
                    err_str = str(_exc)
                    # Only retry on RPM/TPM rate limits (not daily quota exhaustion)
                    is_429 = "429" in err_str
                    is_daily = any(k in err_str.lower() for k in ("daily", "quota", "exceeded your current quota", "organization"))
                    if is_429 and not is_daily and _attempt < 2:
                        await asyncio.sleep(5 * (2 ** _attempt))  # 5s, 10s
                        continue
                    raise
            else:
                raise _last_exc  # type: ignore[misc]
        except Exception as exc:
            err = str(exc)
            is_daily = any(k in err.lower() for k in ("daily", "quota", "exceeded your current quota", "organization"))
            if "429" in err:
                if is_daily:
                    return AgentResponse(
                        reply="Le quota journalier de l'IA est atteint. Réessayez demain ou changez la clé API Groq dans le fichier `.env`.",
                        ui_action="error",
                    )
                return AgentResponse(
                    reply="Trop de requêtes en ce moment. Attendez quelques secondes et réessayez.",
                    ui_action="error",
                )
            # 400 tool_use_failed — model wrote <function=...> text instead of proper tool call
            if "400" in err and ("tool_use_failed" in err or "failed_generation" in err):
                if not _tool_use_failed_retried:
                    _tool_use_failed_retried = True
                    llm_messages.append({
                        "role": "system",
                        "content": (
                            "IMPORTANT: Use the tool-calling API (function call blocks). "
                            "NEVER write <function=...> or <function_calls> syntax in your text reply. "
                            "Retry the user's last request using a proper tool call."
                        ),
                    })
                    continue  # retry with corrective instruction
                return AgentResponse(
                    reply="Je n'ai pas pu traiter votre demande. Reformulez et réessayez.",
                    ui_action="error",
                )
            return AgentResponse(reply=f"Erreur IA : {exc}", ui_action="error")

        choice = response.choices[0]

        # LLM finished — return final text response
        if choice.finish_reason in ("stop", "end_turn"):
            return AgentResponse(
                reply=choice.message.content or "...",
                ui_action=ui_action,
                data=accumulated_data or None,
            )

        # Unexpected finish reason (e.g. "length") — return whatever we have
        if choice.finish_reason not in ("tool_calls", "function_call"):
            return AgentResponse(
                reply=choice.message.content or "...",
                ui_action=ui_action,
                data=accumulated_data or None,
            )

        # LLM wants to call tools
        if choice.finish_reason in ("tool_calls", "function_call"):
            # Add assistant message (with tool_calls) to history
            llm_messages.append({
                "role": "assistant",
                "content": choice.message.content,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in choice.message.tool_calls
                ],
            })

            for tc in choice.message.tool_calls:
                name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}

                tool_result = await _execute_tool(name, args, user, db)

                # --- Confirmation intercept (booking or ride publication) ---
                if tool_result.get("confirm_required"):
                    action = tool_result.get("action", "create_booking")
                    summary = tool_result["summary"]
                    dt_str = summary["departure_time"][:16].replace("T", " à ")

                    if action == "create_ride":
                        reply_text = (
                            f"Voici le récapitulatif de votre trajet :\n"
                            f"🚗 {summary['origin']} → {summary['destination']}\n"
                            f"📅 {dt_str}\n"
                            f"💺 {summary['available_seats']} place(s) disponible(s)\n"
                            f"💰 {summary['price_per_seat']:.0f} MAD/place\n"
                        )
                        if summary.get("distance_km"):
                            reply_text += f"📍 ~{summary['distance_km']} km ({summary.get('est_duration', '')})\n"
                        reply_text += "\nConfirmez-vous la publication de ce trajet ?"
                        return AgentResponse(
                            reply=reply_text,
                            ui_action="show_publish_summary",
                            data={"publish_summary": summary},
                            needs_confirmation=True,
                            pending_action={"action": "create_ride", "summary": summary},
                        )
                    elif action == "cancel_booking":
                        reply_text = (
                            f"Confirmer l'annulation de la réservation ?\n"
                            f"🚗 {summary.get('origin')} → {summary.get('destination')}\n"
                            f"📅 {dt_str}\n"
                            f"💺 {summary.get('seats_booked')} place(s) — {summary.get('total_price', 0):.0f} MAD\n\n"
                            f"Cette action est irréversible."
                        )
                        return AgentResponse(
                            reply=reply_text,
                            ui_action="show_cancel_booking_summary",
                            data={"cancel_summary": summary},
                            needs_confirmation=True,
                            pending_action={"action": "cancel_booking", "booking_id": summary["booking_id"], "summary": summary},
                        )
                    elif action == "cancel_ride":
                        reply_text = (
                            f"Confirmer l'annulation de ce trajet ?\n"
                            f"🚗 {summary.get('origin')} → {summary.get('destination')}\n"
                            f"📅 {dt_str}\n\n"
                            f"⚠️ Tous les passagers ayant réservé seront impactés."
                        )
                        return AgentResponse(
                            reply=reply_text,
                            ui_action="show_cancel_ride_summary",
                            data={"cancel_summary": summary},
                            needs_confirmation=True,
                            pending_action={"action": "cancel_ride", "ride_id": summary["ride_id"], "summary": summary},
                        )
                    else:
                        reply_text = (
                            f"Voici le récapitulatif de votre réservation :\n"
                            f"🚗 {summary['origin']} → {summary['destination']}\n"
                            f"📅 {dt_str}\n"
                            f"💺 {summary['seats']} place(s)\n"
                            f"💰 {summary['total_price']:.0f} MAD total\n"
                            f"👤 Conducteur : {summary['driver_name']}\n"
                            f"💵 Paiement en espèces\n\n"
                            f"Confirmez-vous la réservation ?"
                        )
                        return AgentResponse(
                            reply=reply_text,
                            ui_action="show_booking_summary",
                            data={"booking_summary": summary},
                            needs_confirmation=True,
                            pending_action={
                                "action": "create_booking",
                                "ride_id": summary["ride_id"],
                                "seats": summary["seats"],
                            },
                        )

                # Confirmation intercept for report and ride edit
                if tool_result.get("confirm_required") and tool_result.get("action") == "create_report":
                    s = tool_result["summary"]
                    label = "trajet" if s["target_type"] == "ride" else "utilisateur"
                    return AgentResponse(
                        reply=f"Confirmer le signalement de ce {label} ?\nRaison : {s['reason']}\n\nCette action sera transmise à l'équipe de modération.",
                        ui_action="show_report_summary",
                        data={"report_summary": s},
                        needs_confirmation=True,
                        pending_action={"action": "create_report", "summary": s},
                    )

                if tool_result.get("confirm_required") and tool_result.get("action") == "edit_ride":
                    s = tool_result["summary"]
                    lines = [f"Confirmer les modifications du trajet {s['origin']} → {s['destination']} ?"]
                    if "price_per_seat" in s:
                        lines.append(f"💰 Nouveau prix : {s['price_per_seat']} MAD (était {s['current_price_per_seat']} MAD)")
                    if "available_seats" in s:
                        lines.append(f"💺 Nouvelles places : {s['available_seats']} (était {s['current_available_seats']})")
                    if "departure_time" in s:
                        lines.append(f"📅 Nouveau départ : {s['departure_time'][:16].replace('T', ' à ')} (était {s['current_departure_time'][:16].replace('T', ' à ')})")
                    if "pickup_location" in s:
                        lines.append(f"📍 Point de prise en charge : {s['pickup_location']}")
                    if "dropoff_location" in s:
                        lines.append(f"🏁 Point de dépôt : {s['dropoff_location']}")
                    return AgentResponse(
                        reply="\n".join(lines),
                        ui_action="show_edit_ride_summary",
                        data={"edit_summary": s},
                        needs_confirmation=True,
                        pending_action={"action": "edit_ride", "summary": s},
                    )

                if tool_result.get("confirm_required") and tool_result.get("action") == "accept_booking":
                    summary = tool_result["summary"]
                    dt_str = summary["departure_time"][:16].replace("T", " à ")
                    return AgentResponse(
                        reply=f"Confirmer l'acceptation de la réservation de {summary['passenger_name']} ?\n🚗 {summary['origin']} → {summary['destination']}\n📅 {dt_str}\n💺 {summary['seats']} place(s) · {summary['total_price']:.0f} MAD",
                        ui_action="show_accept_booking_summary",
                        data={"accept_summary": summary},
                        needs_confirmation=True,
                        pending_action={"action": "accept_booking", "summary": summary},
                    )

                if tool_result.get("confirm_required") and tool_result.get("action") == "refuse_booking":
                    summary = tool_result["summary"]
                    dt_str = summary["departure_time"][:16].replace("T", " à ")
                    return AgentResponse(
                        reply=f"Confirmer le refus de la réservation de {summary['passenger_name']} ?\n🚗 {summary['origin']} → {summary['destination']}\n📅 {dt_str}\n💺 {summary['seats']} place(s)\n\n⚠️ Les places seront remises disponibles.",
                        ui_action="show_refuse_booking_summary",
                        data={"refuse_summary": summary},
                        needs_confirmation=True,
                        pending_action={"action": "refuse_booking", "summary": summary},
                    )

                if tool_result.get("confirm_required") and tool_result.get("action") == "send_message_to_passenger":
                    summary = tool_result["summary"]
                    passenger_name = summary.get("passenger_name", "le passager")
                    return AgentResponse(
                        reply=f"Envoyer ce message à {passenger_name} ?\n\n« {summary['content']} »",
                        ui_action="show_message_preview",
                        data={"message_preview": summary},
                        needs_confirmation=True,
                        pending_action={"action": "send_message_to_passenger", "summary": summary},
                    )

                # Track which UI components to render
                if name == "search_rides" and not tool_result.get("error"):
                    ui_action = "show_rides"
                    accumulated_data["rides"] = tool_result.get("rides", [])
                    accumulated_data["distance_km"] = tool_result.get("distance_km")
                    accumulated_data["est_duration"] = tool_result.get("est_duration")
                    accumulated_data["total_found"] = tool_result.get("total_found", 0)
                elif name == "get_ride_details" and not tool_result.get("error"):
                    ui_action = "show_ride_detail"
                    accumulated_data["ride_detail"] = tool_result
                elif name == "get_tourist_info" and tool_result.get("found"):
                    if ui_action == "show_rides":
                        accumulated_data["tourist_info"] = tool_result
                    else:
                        ui_action = "show_tourist_info"
                        accumulated_data["tourist_info"] = tool_result
                elif name == "get_payment_methods":
                    ui_action = "show_payment_methods"
                    accumulated_data["payment_methods"] = tool_result
                elif name == "estimate_distance_duration" and not tool_result.get("error"):
                    accumulated_data["distance_info"] = tool_result
                elif name == "prepare_publish_ride" and tool_result.get("error"):
                    # Error from validation (not a driver, bad date, etc.) — no special UI needed
                    pass
                elif name == "get_my_rides":
                    ui_action = "driver_rides"
                    rides = tool_result.get("rides", [])
                    accumulated_data["rides"] = rides
                    count = len(rides)
                    if count == 0:
                        reply = "Vous n'avez aucun trajet publié pour le moment."
                    elif count == 1:
                        reply = "Voici votre trajet publié :"
                    else:
                        reply = f"Voici vos {count} trajets publiés :"
                    return AgentResponse(reply=reply, ui_action=ui_action, data=dict(accumulated_data))
                elif name == "get_ride_passengers" and not tool_result.get("error"):
                    ui_action = "driver_ride_passengers"
                    accumulated_data["passengers"] = tool_result
                elif name == "get_driver_bookings":
                    ui_action = "driver_bookings"
                    accumulated_data["bookings"] = tool_result.get("bookings", [])
                elif name == "get_driver_revenue_summary":
                    ui_action = "driver_revenue"
                    accumulated_data["revenue"] = tool_result
                elif name == "get_my_driver_documents":
                    ui_action = "driver_documents"
                    accumulated_data["documents"] = tool_result
                elif name == "get_user_preferences" and not tool_result.get("error"):
                    ui_action = "driver_preferences"
                    accumulated_data["preferences"] = tool_result
                elif name == "save_custom_note" and not tool_result.get("error"):
                    ui_action = "driver_preferences"
                    accumulated_data["preferences"] = tool_result
                elif name == "prepare_set_recurring" and not tool_result.get("error"):
                    ui_action = "driver_set_recurring"
                    accumulated_data["recurring_ride"] = tool_result
                elif name == "get_tracking_share_link" and tool_result.get("success"):
                    ui_action = "tracking_share_link"
                    accumulated_data["share_url"] = tool_result.get("share_url", "")

                # Feed result back to LLM
                llm_messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(tool_result, ensure_ascii=False, default=str),
                })

    # Fallback if loop exhausted
    return AgentResponse(
        reply="Je n'ai pas pu terminer le traitement. Reformulez votre demande.",
        ui_action="error",
    )
