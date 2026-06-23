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

MODEL = "llama-3.3-70b-versatile"
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


async def _system_prompt(user: User, db: AsyncSession) -> str:
    today = date.today()
    tomorrow = today + timedelta(days=1)
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    top_routes = await _get_user_top_routes(user, db)

    return f"""You are Rafi, the AI copilot of CovoitMaroc — the Moroccan carpooling platform.
You are NOT a chatbot. You are an intelligent app controller that uses tools to orchestrate real features.

Current user: {user.first_name} {user.last_name} | Role: {role}
Today: {today}. Tomorrow: {tomorrow}.{top_routes}

## Available tools — use the right one for each action

### SEARCH & INFO (both roles)
- search_rides(from_city, to_city, date?, seats?, max_price?, time_of_day?) → find rides
- get_ride_details(ride_id) → full detail of ONE specific ride (use real UUID only)
- estimate_distance_duration(from_city, to_city) → distance & travel time
- check_seat_availability(ride_id, seats_needed?) → availability check
- get_tourist_info(destination) → tourist tips for a city
- get_payment_methods() → available payment options

### PASSENGER actions
- get_my_bookings() → list of MY reservations
- prepare_booking(ride_id, seats?) → show booking summary + ask confirmation (does NOT book yet)
  ⚠️ Cannot book your own ride (you are the driver of it)
- prepare_cancel_booking(booking_id) → show cancel summary + ask confirmation
- submit_rating(ride_id, stars, comment?) → rate a driver after a COMPLETED ride (1–5 stars)
- get_my_alerts() → list active search alerts
- create_search_alert(origin, destination) → get email when a matching ride is published
- delete_search_alert(alert_id) → remove a search alert

### DRIVER actions
- get_my_rides() → list of MY published rides
- get_driver_bookings(ride_id?) → see who booked my rides
- prepare_publish_ride(origin, destination, departure_date, departure_time, seats, price_per_seat, pickup_location?, dropoff_location?) → show publish summary + ask confirmation
- prepare_cancel_ride(ride_id) → show cancel summary + ask confirmation
- prepare_edit_ride(ride_id, price_per_seat?, available_seats?, departure_time?, pickup_location?, dropoff_location?) → modify a ride + ask confirmation
- get_user_preferences() → view my current preferences
- update_preferences(smoking_allowed?, pets_allowed?, music_allowed?, air_conditioning?, talking_preference?, luggage_size?) → update preferences immediately (no confirmation needed)
- rate_passenger_by_driver(ride_id, passenger_id, stars, comment?) → rate a passenger after a COMPLETED ride
- get_tracking_share_link(ride_id) → get a public GPS tracking URL to share with family

### BOTH ROLES
- get_driver_ratings(driver_id) → view ratings & reviews for any driver
- prepare_report(target_type, target_id, reason) → report a ride or user to moderators + ask confirmation

## Rules
1. ALWAYS call a tool — never invent data, prices, or statuses.
2. For booking/publishing/cancellation/editing/reporting: use the prepare_* tool first. Wait for user confirmation.
3. submit_rating, rate_passenger_by_driver, create_search_alert, delete_search_alert, update_preferences — execute directly without extra confirmation.
4. If required info is missing for a tool call, ask for it before calling.
5. A driver CAN also search and book rides as a passenger (they travel too).
6. A passenger CANNOT publish rides.

## Date handling
- "demain" / "ghdwa" / "غدا" = {tomorrow}
- "ce weekend" / "had weekend" = next Saturday = {today + timedelta(days=(5 - today.weekday()) % 7 + 1)}
- "lyoum" / "اليوم" = today = {today}
- "jemaa" / "ljoumoa" = Friday, "sebt" = Saturday, "had" = Sunday
- Always convert relative dates to YYYY-MM-DD before calling search_rides() or prepare_publish_ride().

## Language & Darija
You MUST understand Moroccan Darija (dialect). Detect the language and ALWAYS reply in the SAME language/dialect the user wrote in.

### Darija travel vocabulary
- bghit nmchi / bghit nsafar / bghit nroh = I want to travel
- fayn / fin / wfayn = where (destination)
- mn fayn / mn fin = from where (origin)
- chhal / bchhal = how much (price)
- chhal mn place / chhal mn mkan = how many seats
- wach kayn / wach fih = is there (availability)
- nhar / yom = day
- sa3a / lwa9t = time / hour
- had ssafra / had lkra = this trip
- l9itu / l9ina = I found / we found
- 7jz / 7ajz / 7ajzli = book / book for me
- nchri / nchouf = I'll buy / let me see
- b7al / bhal = like / approximately
- mzyane / zwine = good / nice
- ghalya / ghalia = expensive
- rkhisa / rkhis = cheap
- kayn / kayna = there is / available
- machi / mazal machi = going / not yet going
- daba = now / right now
- m3a = with
- bla = without
- ndir / dir = I will do / do
- 3tini / 3tini = give me
- shof / chouf = show / look

### Darija city names → standard names for tools
Use the STANDARD French name when calling tools:
- "kaza" / "casa" / "Dar Lbida" / "دار البيضاء" → "Casablanca"
- "rbat" / "Rbat" / "الرباط" → "Rabat"
- "fas" / "Fes" / "فاس" → "Fès"
- "mrrakch" / "Mrakch" / "مراكش" → "Marrakech"
- "tnja" / "Tanja" / "طنجة" → "Tanger"
- "3sbanya lmghrib" / "Tet" / "تطوان" → "Tétouan"
- "l3youne" / "العيون" → "Laâyoune"
- "wjda" / "Wujda" / "وجدة" → "Oujda"
- "meknas" / "Meknas" / "مكناس" → "Meknès"
- "lgdida" / "الجديدة" → "El Jadida"
- "safi" / "آسفي" → "Safi"
- "bni mlal" / "بني ملال" → "Béni Mellal"
- "khnifrа" / "خنيفرة" → "Khénifra"
- "agadir" / "أكادير" → "Agadir"
- "warzazat" / "ورزازات" → "Ouarzazate"
- "shfshawn" / "Chaouen" / "شفشاون" → "Chefchaouen"

### Darija number words
- wahed = 1, jouj/zouj = 2, tlata = 3, rb3a = 4, khmsa = 5, stta = 6, sb3a = 7, tmnya = 8
- 3shrin = 20, tlatin = 30, rb3in = 40, miya = 100

## Response style
- Be concise in text — the UI renders visual cards for rides/maps/bookings. Don't describe what the cards already show.
- After a search, briefly explain the best option and why (price, availability, timing).
- Ask targeted follow-up questions if key info is missing (date, destination).
- NEVER confirm a booking without calling prepare_booking() first.
- NEVER make up data — all information must come from tool results.
- When the user writes in Darija, reply in Darija. When in French, reply in French. When in Arabic (فصحى), reply in Arabic.

## Important rules
- PASSENGER cannot publish rides.
- DRIVER can search for rides as a passenger but mainly manages their own rides.
- Sensitive actions (booking, publishing) ALWAYS require explicit user confirmation through the UI.
"""


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
        if name == "update_preferences":
            return await tools.update_preferences(db, user, **args)
        if name == "get_user_preferences":
            return await tools.get_user_preferences(db, user)
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
    # Normal agentic loop
    # -----------------------------------------------------------------------
    client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))

    llm_messages: list[dict] = [
        {"role": "system", "content": await _system_prompt(user, db)},
        *[{"role": m.role, "content": m.content} for m in messages],
    ]

    accumulated_data: dict = {}
    ui_action = "none"

    for _iteration in range(MAX_TOOL_ITERATIONS):
        try:
            response = await client.chat.completions.create(
                model=MODEL,
                messages=llm_messages,
                tools=TOOL_DEFINITIONS,
                tool_choice="auto",
                temperature=0.3,
                max_tokens=1024,
            )
        except Exception as exc:
            err = str(exc)
            if "429" in err:
                return AgentResponse(
                    reply="Quota Groq dépassé. Attendez quelques secondes et réessayez.",
                    ui_action="error",
                )
            return AgentResponse(reply=f"Erreur IA : {exc}", ui_action="error")

        choice = response.choices[0]

        # LLM finished — return final text response
        if choice.finish_reason == "stop":
            return AgentResponse(
                reply=choice.message.content or "...",
                ui_action=ui_action,
                data=accumulated_data or None,
            )

        # LLM wants to call tools
        if choice.finish_reason == "tool_calls":
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
