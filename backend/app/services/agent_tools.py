"""
Tool implementations for the AI copilot.
The LLM calls these via Groq function-calling; they read from the DB
and return structured dicts.  No DB writes happen here except
save_user_preference — which is non-sensitive.
Booking creation happens in agent_service after explicit user confirmation.
"""
import os
import secrets as _secrets
from datetime import datetime, timedelta
from math import radians, sin, cos, sqrt, atan2

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from ..models.ride import Ride, RideStatus
from ..models.booking import Booking, BookingStatus
from ..models.preferences import DriverPreferences
from ..models.rating import Rating
from ..models.passenger_rating import PassengerRating
from ..models.alert import RideAlert
from ..models.report import Report
from ..models.user import User, Role
from ..models.document import DriverDocument
from ..data.moroccan_cities import MOROCCAN_CITIES


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return round(2 * R * atan2(sqrt(a), sqrt(1 - a)), 1)


def _fmt_duration(km: float) -> str:
    h = km / 90.0
    hours = int(h)
    mins = int((h - hours) * 60)
    return f"{hours}h{mins:02d}"


def _city_coords(name: str) -> dict | None:
    key = next(
        (k for k in MOROCCAN_CITIES if name.lower() in k.lower() or k.lower() in name.lower()),
        None,
    )
    return MOROCCAN_CITIES.get(key) if key else None


def _ride_to_dict(r: Ride, dist_km: float | None = None, est_h: float | None = None) -> dict:
    driver_name = "N/A"
    driver_prefs = None
    if r.driver:
        driver_name = f"{r.driver.first_name} {r.driver.last_name}"
        if r.driver.preferences:
            p = r.driver.preferences
            driver_prefs = {
                "smoking": p.smoking_allowed,
                "pets": p.pets_allowed,
                "music": p.music_allowed,
                "ac": p.air_conditioning,
                "talk": p.talking_preference,
                "luggage": p.luggage_size,
            }
    return {
        "id": r.id,
        "origin": r.origin,
        "destination": r.destination,
        "departure_time": r.departure_time.isoformat(),
        "available_seats": r.available_seats,
        "price_per_seat": r.price_per_seat,
        "pickup_location": r.pickup_location,
        "dropoff_location": r.dropoff_location,
        "origin_lat": r.origin_lat,
        "origin_lng": r.origin_lng,
        "destination_lat": r.destination_lat,
        "destination_lng": r.destination_lng,
        "driver_name": driver_name,
        "driver_rating": None,
        "distance_km": dist_km,
        "est_duration": _fmt_duration(dist_km) if dist_km else None,
        "driver_preferences": driver_prefs,
    }


# ---------------------------------------------------------------------------
# Tool: search_rides
# ---------------------------------------------------------------------------

async def search_rides(
    db: AsyncSession,
    from_city: str,
    to_city: str,
    date: str | None = None,
    seats: int | str = 1,
    max_price: float | str | None = None,
    time_of_day: str | None = None,
) -> dict:
    try:
        seats = int(seats)
        if max_price is not None:
            max_price = float(max_price)
    except (ValueError, TypeError):
        seats = 1
    filters = [
        Ride.origin.ilike(f"%{from_city}%"),
        Ride.destination.ilike(f"%{to_city}%"),
        Ride.status == RideStatus.ACTIVE,
        Ride.available_seats >= seats,
    ]
    if max_price:
        filters.append(Ride.price_per_seat <= max_price)
    if date:
        try:
            day = datetime.fromisoformat(date)
            filters += [Ride.departure_time >= day, Ride.departure_time < day + timedelta(days=1)]
        except ValueError:
            pass

    stmt = (
        select(Ride)
        .options(joinedload(Ride.driver).joinedload(User.preferences))
        .filter(*filters)
        .order_by(Ride.departure_time)
        .limit(20)
    )
    result = await db.execute(stmt)
    rides = result.scalars().unique().all()

    if time_of_day:
        ranges = {"morning": (5, 12), "afternoon": (12, 17), "evening": (17, 23)}
        lo, hi = ranges.get(time_of_day.lower(), (0, 24))
        rides = [r for r in rides if lo <= r.departure_time.hour < hi]

    # Distance / duration between cities
    o_coords = _city_coords(from_city)
    d_coords = _city_coords(to_city)
    dist_km = None
    est_h = None
    if o_coords and d_coords:
        dist_km = _haversine_km(o_coords["lat"], o_coords["lng"], d_coords["lat"], d_coords["lng"])
        est_h = round(dist_km / 90, 1)

    # Score rides: price cheapest, earliest, seat availability
    ride_dicts = [_ride_to_dict(r, dist_km, est_h) for r in rides]

    # Lightweight composite score for ranking in the tool result
    def _score(rd: dict) -> float:
        s = 0.0
        if max_price and rd["price_per_seat"] <= max_price:
            s += 20
        if rd["available_seats"] >= seats:
            s += 10
        # cheaper is better (normalise to 0-20 range)
        s += max(0, 20 - rd["price_per_seat"] / 10)
        return s

    ride_dicts.sort(key=_score, reverse=True)
    top = ride_dicts[:6]

    return {
        "rides": top,
        "count": len(top),
        "total_found": len(ride_dicts),
        "distance_km": dist_km,
        "est_duration": _fmt_duration(dist_km) if dist_km else None,
    }


# ---------------------------------------------------------------------------
# Tool: get_ride_details
# ---------------------------------------------------------------------------

async def get_ride_details(db: AsyncSession, ride_id: str) -> dict:
    stmt = (
        select(Ride)
        .options(joinedload(Ride.driver).joinedload(User.preferences))
        .where(Ride.id == ride_id)
    )
    result = await db.execute(stmt)
    r = result.scalar_one_or_none()
    if not r:
        return {"error": "Trajet introuvable"}

    dist_km = None
    if r.origin_lat and r.destination_lat:
        dist_km = _haversine_km(r.origin_lat, r.origin_lng, r.destination_lat, r.destination_lng)

    return _ride_to_dict(r, dist_km)


# ---------------------------------------------------------------------------
# Tool: estimate_distance_duration
# ---------------------------------------------------------------------------

def estimate_distance_duration(from_city: str, to_city: str) -> dict:
    o = _city_coords(from_city)
    d = _city_coords(to_city)
    if not o:
        return {"error": f"Ville inconnue: {from_city}"}
    if not d:
        return {"error": f"Ville inconnue: {to_city}"}
    dist = _haversine_km(o["lat"], o["lng"], d["lat"], d["lng"])
    return {
        "from_city": from_city,
        "to_city": to_city,
        "distance_km": dist,
        "est_duration": _fmt_duration(dist),
        "est_hours": round(dist / 90, 1),
    }


# ---------------------------------------------------------------------------
# Tool: check_seat_availability
# ---------------------------------------------------------------------------

async def check_seat_availability(db: AsyncSession, ride_id: str, seats_needed: int = 1) -> dict:
    result = await db.execute(select(Ride).where(Ride.id == ride_id))
    r = result.scalar_one_or_none()
    if not r:
        return {"available": False, "reason": "Trajet introuvable"}
    if r.status != RideStatus.ACTIVE:
        return {"available": False, "reason": "Trajet non disponible"}
    if r.available_seats < seats_needed:
        return {"available": False, "seats_left": r.available_seats,
                "reason": f"Seulement {r.available_seats} place(s) disponible(s)"}
    return {"available": True, "seats_left": r.available_seats, "price_per_seat": r.price_per_seat}


# ---------------------------------------------------------------------------
# Tool: prepare_booking  (safe — no DB write; triggers confirmation UI)
# ---------------------------------------------------------------------------

async def prepare_booking(db: AsyncSession, ride_id: str, seats: int, user: User) -> dict:
    stmt = select(Ride).options(joinedload(Ride.driver)).where(Ride.id == ride_id)
    result = await db.execute(stmt)
    r = result.scalar_one_or_none()
    if not r:
        return {"error": "Trajet introuvable", "confirm_required": False}
    if r.driver_id == user.id:
        return {"error": "Vous ne pouvez pas réserver votre propre trajet", "confirm_required": False}
    if r.available_seats < seats:
        return {"error": f"Seulement {r.available_seats} place(s) disponible(s)", "confirm_required": False}

    return {
        "confirm_required": True,
        "summary": {
            "ride_id": ride_id,
            "seats": seats,
            "origin": r.origin,
            "destination": r.destination,
            "departure_time": r.departure_time.isoformat(),
            "price_per_seat": r.price_per_seat,
            "total_price": round(r.price_per_seat * seats, 2),
            "driver_name": f"{r.driver.first_name} {r.driver.last_name}" if r.driver else "N/A",
            "origin_lat": r.origin_lat,
            "origin_lng": r.origin_lng,
            "destination_lat": r.destination_lat,
            "destination_lng": r.destination_lng,
        },
    }


# ---------------------------------------------------------------------------
# Tool: get_user_preferences
# ---------------------------------------------------------------------------

async def get_user_preferences(db: AsyncSession, user: User) -> dict:
    result = await db.execute(
        select(DriverPreferences).where(DriverPreferences.driver_id == user.id)
    )
    prefs = result.scalar_one_or_none()
    if not prefs:
        return {"found": False, "message": "Aucune préférence enregistrée pour ce compte."}
    return {
        "found": True,
        "smoking": prefs.smoking_allowed,
        "pets": prefs.pets_allowed,
        "music": prefs.music_allowed,
        "ac": prefs.air_conditioning,
        "talk": prefs.talking_preference,
        "luggage": prefs.luggage_size,
        "note": prefs.custom_note,
    }


# ---------------------------------------------------------------------------
# Tool: get_my_bookings  (passenger's bookings)
# ---------------------------------------------------------------------------

async def get_my_bookings(db: AsyncSession, user: User) -> dict:
    stmt = (
        select(Booking)
        .options(joinedload(Booking.ride))
        .where(Booking.passenger_id == user.id)
        .order_by(Booking.created_at.desc())
        .limit(20)
    )
    result = await db.execute(stmt)
    bookings = result.scalars().unique().all()
    return {
        "bookings": [
            {
                "id": b.id,
                "ride_id": b.ride_id,
                "status": b.status.value if hasattr(b.status, "value") else str(b.status),
                "seats_booked": b.seats_booked,
                "total_price": b.total_price,
                "created_at": b.created_at.isoformat(),
                "ride": {
                    "origin": b.ride.origin,
                    "destination": b.ride.destination,
                    "departure_time": b.ride.departure_time.isoformat(),
                    "price_per_seat": b.ride.price_per_seat,
                    "status": b.ride.status.value if b.ride else None,
                } if b.ride else None,
            }
            for b in bookings
        ],
        "count": len(bookings),
    }


# ---------------------------------------------------------------------------
# Tool: get_driver_bookings  (bookings received on the driver's rides)
# ---------------------------------------------------------------------------

async def get_driver_bookings(db: AsyncSession, user: User, ride_id: str | None = None) -> dict:
    stmt = (
        select(Booking)
        .join(Ride, Booking.ride_id == Ride.id)
        .options(joinedload(Booking.ride), joinedload(Booking.passenger))
        .where(Ride.driver_id == user.id)
    )
    if ride_id:
        stmt = stmt.where(Booking.ride_id == ride_id)
    stmt = stmt.order_by(Booking.created_at.desc()).limit(50)
    result = await db.execute(stmt)
    bookings = result.scalars().unique().all()
    return {
        "bookings": [
            {
                "id": b.id,
                "ride_id": b.ride_id,
                "status": b.status.value if hasattr(b.status, "value") else str(b.status),
                "seats_booked": b.seats_booked,
                "total_price": b.total_price,
                "passenger_name": f"{b.passenger.first_name} {b.passenger.last_name}" if b.passenger else "N/A",
                "created_at": b.created_at.isoformat(),
                "ride": {
                    "origin": b.ride.origin,
                    "destination": b.ride.destination,
                    "departure_time": b.ride.departure_time.isoformat(),
                } if b.ride else None,
            }
            for b in bookings
        ],
        "count": len(bookings),
    }


# ---------------------------------------------------------------------------
# Tool: prepare_cancel_booking  (safe — no DB write; triggers confirmation)
# ---------------------------------------------------------------------------

async def prepare_cancel_booking(db: AsyncSession, booking_id: str, user: User) -> dict:
    stmt = select(Booking).options(joinedload(Booking.ride)).where(
        Booking.id == booking_id,
        Booking.passenger_id == user.id,
    )
    result = await db.execute(stmt)
    booking = result.scalar_one_or_none()
    if not booking:
        return {"confirm_required": False, "error": "Réservation introuvable ou n'appartient pas à ce compte."}
    if booking.status == BookingStatus.CANCELLED:
        return {"confirm_required": False, "error": "Cette réservation est déjà annulée."}
    return {
        "confirm_required": True,
        "action": "cancel_booking",
        "summary": {
            "booking_id": booking_id,
            "origin": booking.ride.origin if booking.ride else "?",
            "destination": booking.ride.destination if booking.ride else "?",
            "departure_time": booking.ride.departure_time.isoformat() if booking.ride else "?",
            "seats_booked": booking.seats_booked,
            "total_price": booking.total_price,
        },
    }


# ---------------------------------------------------------------------------
# Tool: prepare_cancel_ride  (safe — no DB write; triggers confirmation)
# ---------------------------------------------------------------------------

async def prepare_cancel_ride(db: AsyncSession, ride_id: str, user: User) -> dict:
    result = await db.execute(
        select(Ride).where(Ride.id == ride_id, Ride.driver_id == user.id)
    )
    ride = result.scalar_one_or_none()
    if not ride:
        return {"confirm_required": False, "error": "Trajet introuvable ou n'appartient pas à ce compte."}
    if ride.status == RideStatus.CANCELLED:
        return {"confirm_required": False, "error": "Ce trajet est déjà annulé."}
    if ride.status == RideStatus.COMPLETED:
        return {"confirm_required": False, "error": "Un trajet terminé ne peut pas être annulé."}
    return {
        "confirm_required": True,
        "action": "cancel_ride",
        "summary": {
            "ride_id": ride_id,
            "origin": ride.origin,
            "destination": ride.destination,
            "departure_time": ride.departure_time.isoformat(),
            "available_seats": ride.available_seats,
        },
    }


# ---------------------------------------------------------------------------
# Tool: update_preferences  (direct write — non-destructive, no confirmation)
# ---------------------------------------------------------------------------

async def prepare_update_preferences(
    db: AsyncSession,
    user: User,
    smoking_allowed: bool | None = None,
    pets_allowed: bool | None = None,
    music_allowed: bool | None = None,
    air_conditioning: bool | None = None,
    talking_preference: str | None = None,
    luggage_size: str | None = None,
) -> dict:
    """Build a confirmation summary. The actual DB write happens after user confirms."""
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role.upper() != "DRIVER":
        return {"error": "Seuls les conducteurs peuvent définir des préférences."}

    updates: dict = {}
    if smoking_allowed is not None:    updates["smoking_allowed"]    = smoking_allowed
    if pets_allowed is not None:       updates["pets_allowed"]       = pets_allowed
    if music_allowed is not None:      updates["music_allowed"]      = music_allowed
    if air_conditioning is not None:   updates["air_conditioning"]   = air_conditioning
    if talking_preference is not None: updates["talking_preference"] = talking_preference
    if luggage_size is not None:       updates["luggage_size"]       = luggage_size

    if not updates:
        return {"error": "Aucune préférence fournie à mettre à jour."}

    return {
        "confirm_required": True,
        "action": "update_preferences",
        "summary": updates,
    }


async def execute_update_preferences(
    db: AsyncSession,
    user: User,
    updates: dict,
) -> dict:
    """Actually write preferences to DB. Called only from the confirmed path."""
    result = await db.execute(
        select(DriverPreferences).where(DriverPreferences.driver_id == user.id)
    )
    prefs = result.scalar_one_or_none()

    if prefs:
        for k, v in updates.items():
            setattr(prefs, k, v)
    else:
        import uuid as _uuid
        prefs = DriverPreferences(id=str(_uuid.uuid4()), driver_id=user.id, **updates)
        db.add(prefs)

    await db.commit()
    await db.refresh(prefs)
    return {
        "smoking": prefs.smoking_allowed,
        "pets": prefs.pets_allowed,
        "music": prefs.music_allowed,
        "ac": prefs.air_conditioning,
        "talk": prefs.talking_preference,
        "luggage": prefs.luggage_size,
        "note": prefs.custom_note,
    }


# ---------------------------------------------------------------------------
# Tool: save_custom_note  (driver personal preferences note)
# ---------------------------------------------------------------------------

async def save_custom_note(db: AsyncSession, user: User, note: str) -> dict:
    result = await db.execute(
        select(DriverPreferences).where(DriverPreferences.driver_id == user.id)
    )
    prefs = result.scalar_one_or_none()
    if prefs:
        prefs.custom_note = note
    else:
        import uuid as _uuid
        prefs = DriverPreferences(
            id=str(_uuid.uuid4()),
            driver_id=user.id,
            custom_note=note,
        )
        db.add(prefs)
    await db.commit()
    await db.refresh(prefs)
    return {
        "found": True,
        "smoking": prefs.smoking_allowed,
        "pets": prefs.pets_allowed,
        "music": prefs.music_allowed,
        "ac": prefs.air_conditioning,
        "talk": prefs.talking_preference,
        "luggage": prefs.luggage_size,
        "note": prefs.custom_note,
    }


# ---------------------------------------------------------------------------
# Tool: get_my_rides  (driver's own published rides)
# ---------------------------------------------------------------------------

async def get_my_rides(db: AsyncSession, user: User) -> dict:
    stmt = (
        select(Ride)
        .where(Ride.driver_id == user.id)
        .order_by(Ride.departure_time.desc())
        .limit(20)
    )
    result = await db.execute(stmt)
    rides = result.scalars().all()
    day_names = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]
    return {
        "rides": [
            {
                "id": r.id,
                "origin": r.origin,
                "destination": r.destination,
                "departure_time": r.departure_time.isoformat(),
                "available_seats": r.available_seats,
                "price_per_seat": r.price_per_seat,
                "status": r.status.value if hasattr(r.status, "value") else str(r.status),
                "is_recurring": r.is_recurring,
                "recurrence_days": (
                    [day_names[d] for d in r.recurrence_days if 0 <= d <= 6]
                    if r.recurrence_days else []
                ),
                "recurrence_end_date": r.recurrence_end_date.isoformat() if r.recurrence_end_date else None,
            }
            for r in rides
        ],
        "count": len(rides),
    }


# ---------------------------------------------------------------------------
# Tool: prepare_set_recurring  (safe — no DB write; triggers day-picker UI)
# ---------------------------------------------------------------------------

async def prepare_set_recurring(db: AsyncSession, user: User, ride_id: str) -> dict:
    """Return ride info so the frontend shows a day-of-week picker card."""
    result = await db.execute(select(Ride).where(Ride.id == ride_id, Ride.driver_id == user.id))
    ride = result.scalar_one_or_none()
    if not ride:
        return {"error": "Trajet introuvable ou vous n'êtes pas le conducteur."}
    day_names = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]
    return {
        "ride_id": ride.id,
        "origin": ride.origin,
        "destination": ride.destination,
        "departure_time": ride.departure_time.isoformat(),
        "is_recurring": ride.is_recurring,
        "recurrence_days": (
            [day_names[d] for d in ride.recurrence_days if 0 <= d <= 6]
            if ride.recurrence_days else []
        ),
        "recurrence_end_date": ride.recurrence_end_date.isoformat() if ride.recurrence_end_date else None,
    }


# ---------------------------------------------------------------------------
# Tool: prepare_publish_ride  (safe — no DB write; triggers confirmation UI)
# ---------------------------------------------------------------------------

async def prepare_publish_ride(
    origin: str,
    destination: str,
    departure_date: str,
    departure_time: str,
    seats: int | str,
    price_per_seat: float | str,
    user: User,
    pickup_location: str | None = None,
    dropoff_location: str | None = None,
) -> dict:
    # LLMs sometimes stringify numbers; coerce defensively
    try:
        seats = int(seats)
        price_per_seat = float(price_per_seat)
    except (ValueError, TypeError) as e:
        return {"confirm_required": False, "error": f"Valeur invalide : {e}"}
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role.upper() != "DRIVER":
        return {
            "confirm_required": False,
            "error": "Seuls les conducteurs peuvent publier des trajets. Votre compte est enregistré en tant que passager.",
        }
    try:
        dt = datetime.fromisoformat(f"{departure_date}T{departure_time}")
    except ValueError:
        return {"confirm_required": False, "error": f"Date/heure invalide : {departure_date} {departure_time}"}

    if dt <= datetime.now():
        return {"confirm_required": False, "error": "La date de départ doit être dans le futur."}
    if seats < 1 or seats > 8:
        return {"confirm_required": False, "error": "Le nombre de places doit être entre 1 et 8."}
    if price_per_seat <= 0:
        return {"confirm_required": False, "error": "Le prix par place doit être supérieur à 0 MAD."}

    # Enrich with coordinates
    o_coords = _city_coords(origin)
    d_coords = _city_coords(destination)
    dist_km = None
    if o_coords and d_coords:
        dist_km = _haversine_km(o_coords["lat"], o_coords["lng"], d_coords["lat"], d_coords["lng"])

    return {
        "confirm_required": True,
        "action": "create_ride",
        "summary": {
            "origin": origin,
            "destination": destination,
            "departure_time": dt.isoformat(),
            "available_seats": seats,
            "price_per_seat": price_per_seat,
            "pickup_location": pickup_location,
            "dropoff_location": dropoff_location,
            "origin_lat": o_coords["lat"] if o_coords else None,
            "origin_lng": o_coords["lng"] if o_coords else None,
            "destination_lat": d_coords["lat"] if d_coords else None,
            "destination_lng": d_coords["lng"] if d_coords else None,
            "distance_km": dist_km,
            "est_duration": _fmt_duration(dist_km) if dist_km else None,
            "total_earnings": round(price_per_seat * seats, 2),
        },
    }


# ---------------------------------------------------------------------------
# Tool: get_tourist_info  (static curated data)
# ---------------------------------------------------------------------------

_TOURIST_DB: dict[str, dict] = {
    "Chefchaouen": {
        "description": "La ville bleue du Rif, connue pour ses ruelles peintes en bleu et blanc.",
        "highlights": ["Médina bleue", "Place Uta el-Hammam", "Cascades Ras el-Ma", "Randonnée Jebel el-Kelaa"],
        "food": ["Restaurant Bab Ssour", "Tisseura", "Tajine local au marché"],
        "accommodation": ["Casa Perleta", "Hostel Ras el-Ma", "Dar Zitoun"],
        "tip": "Meilleure période : avril-juin et sept-oct. Évitez août (chaleur et foule).",
        "tags": ["montagne", "médina", "nature", "photographique"],
    },
    "Marrakech": {
        "description": "La ville rouge, capitale touristique avec Médina classée UNESCO.",
        "highlights": ["Jemaa el-Fna", "Jardins Majorelle", "Palais Bahia", "Souks"],
        "food": ["Café de France (terrasse)", "Restaurant Nomad", "Café Arabe"],
        "accommodation": ["Riads de la Médina", "La Mamounia (luxe)", "Riad Yasmine"],
        "tip": "Négociez dans les souks. Guide recommandé pour la Médina.",
        "tags": ["culture", "shopping", "gastronomie", "animation"],
    },
    "Fès": {
        "description": "Ville impériale avec la plus grande médina piétonne du monde (UNESCO).",
        "highlights": ["Médina Fès el-Bali", "Tanneries Chouara", "Université Al Quaraouiyine", "Bou Inania Medersa"],
        "food": ["Dar Tajine", "Café Clock", "Restaurant Ruined Garden"],
        "accommodation": ["Riad Fès", "Riad Laaroussa", "Dar Seffarine"],
        "tip": "Labyrinthe de ruelles — guide local indispensable. Visite tanneries le matin.",
        "tags": ["histoire", "artisanat", "religion", "UNESCO"],
    },
    "Essaouira": {
        "description": "Port atlantique authentique, médina UNESCO, paradis des artistes.",
        "highlights": ["Remparts et bastions", "Port de pêche", "Festival Gnaoua (juin)", "Plage de sable fin"],
        "food": ["Poisson grillé au port", "Restaurant Elizir", "Chez Driss"],
        "accommodation": ["Hôtel Riad al-Medina", "Villa Maroc", "Riad Mimouna"],
        "tip": "Vent fort (alizan) — idéal pour kitesurf et windsurf.",
        "tags": ["plage", "arts", "vent", "musique"],
    },
    "Agadir": {
        "description": "Station balnéaire moderne, plage de sable doré, soleil 300 jours/an.",
        "highlights": ["Plage d'Agadir 7 km", "Souk El Had", "Vallée du Paradis", "Tiznit (excursion 90 km)"],
        "food": ["Restaurants de la Marina", "La Scala", "Grillades de poisson"],
        "accommodation": ["Hôtels de la Marina", "Royal Atlas", "Sofitel Agadir"],
        "tip": "Eau propre et surveillance de plage. Parfait pour familles.",
        "tags": ["plage", "famille", "soleil", "balnéaire"],
    },
    "Ouarzazate": {
        "description": "Porte du désert, capitale du cinéma marocain, paysages époustouflants.",
        "highlights": ["Aït-Ben-Haddou (UNESCO)", "Atlas Film Studios", "Vallée du Draa", "Lac Mansour Eddahbi"],
        "food": ["Chez Dimitri", "Restaurant Douyria", "Tajine berbère"],
        "accommodation": ["Dar Ahlam", "Berbère Palace", "Auberges du désert"],
        "tip": "Base idéale pour dunes d'Erg Chebbi (4h). Froid la nuit en hiver.",
        "tags": ["désert", "cinéma", "UNESCO", "aventure"],
    },
    "Tanger": {
        "description": "Ville cosmopolite à l'entrée du Détroit de Gibraltar, entre deux mers.",
        "highlights": ["Médina", "Cap Spartel", "Grottes d'Hercule", "Café Hafa"],
        "food": ["El Korsan", "Le Saveur du Poisson", "Café Hafa"],
        "accommodation": ["La Tangerina", "El Minzah", "Riad Tanja"],
        "tip": "Ville très vivante la nuit. Ferry vers l'Espagne disponible.",
        "tags": ["cosmopolite", "histoire", "détroit", "internationale"],
    },
}


def get_tourist_info(destination: str) -> dict:
    key = next(
        (k for k in _TOURIST_DB if destination.lower() in k.lower() or k.lower() in destination.lower()),
        None,
    )
    if not key:
        return {"found": False, "destination": destination,
                "message": f"Pas d'informations touristiques disponibles pour {destination}."}
    return {"found": True, "destination": key, **_TOURIST_DB[key]}


# ---------------------------------------------------------------------------
# Tool: get_payment_methods
# ---------------------------------------------------------------------------

def get_payment_methods() -> dict:
    return {
        "methods": [
            {"id": "cash", "name": "Espèces", "icon": "💵",
             "description": "Paiement direct au conducteur à l'arrivée.", "available": True},
            {"id": "cmi", "name": "Carte bancaire (CMI)", "icon": "💳",
             "description": "Visa / Mastercard via CMI Maroc.", "available": False, "note": "Bientôt"},
            {"id": "cashplus", "name": "CashPlus", "icon": "📱",
             "description": "Paiement mobile CashPlus.", "available": False, "note": "Bientôt"},
            {"id": "inwi", "name": "Inwi Money", "icon": "📱",
             "description": "Portefeuille mobile Inwi.", "available": False, "note": "Bientôt"},
        ],
        "current_default": "cash",
        "note": "Actuellement seul le paiement en espèces est disponible.",
    }


# ---------------------------------------------------------------------------
# Tool: get_driver_ratings
# ---------------------------------------------------------------------------

async def get_driver_ratings(db: AsyncSession, driver_id: str) -> dict:
    result = await db.execute(
        select(Rating).where(Rating.driver_id == driver_id).order_by(Rating.created_at.desc()).limit(10)
    )
    ratings = result.scalars().all()
    avg = round(sum(r.stars for r in ratings) / len(ratings), 1) if ratings else 0.0
    return {
        "driver_id": driver_id,
        "avg_stars": avg,
        "total_reviews": len(ratings),
        "reviews": [
            {"stars": r.stars, "comment": r.comment, "created_at": r.created_at.isoformat()}
            for r in ratings
        ],
    }


# ---------------------------------------------------------------------------
# Tool: submit_rating  (passenger rates driver — direct write)
# ---------------------------------------------------------------------------

async def submit_rating(db: AsyncSession, user: User, ride_id: str, stars: int, comment: str | None = None) -> dict:
    result = await db.execute(select(Ride).where(Ride.id == ride_id))
    ride = result.scalar_one_or_none()
    if not ride:
        return {"success": False, "error": "Trajet introuvable."}
    if ride.status != RideStatus.COMPLETED:
        return {"success": False, "error": "Le trajet doit être terminé pour laisser une note."}
    booking_result = await db.execute(
        select(Booking).where(
            Booking.ride_id == ride_id,
            Booking.passenger_id == user.id,
            Booking.status == BookingStatus.CONFIRMED,
        )
    )
    if not booking_result.scalar_one_or_none():
        return {"success": False, "error": "Vous n'avez pas participé à ce trajet."}
    existing = await db.execute(
        select(Rating).where(Rating.ride_id == ride_id, Rating.passenger_id == user.id)
    )
    if existing.scalar_one_or_none():
        return {"success": False, "error": "Vous avez déjà évalué ce trajet."}
    if not (1 <= stars <= 5):
        return {"success": False, "error": "La note doit être entre 1 et 5 étoiles."}
    import uuid as _uuid
    rating = Rating(
        id=str(_uuid.uuid4()),
        ride_id=ride_id,
        passenger_id=user.id,
        driver_id=ride.driver_id,
        stars=stars,
        comment=comment,
    )
    db.add(rating)
    await db.commit()
    return {"success": True, "message": f"Avis enregistré : {stars}/5 étoiles.", "stars": stars}


# ---------------------------------------------------------------------------
# Tool: rate_passenger_by_driver  (driver rates passenger — direct write)
# ---------------------------------------------------------------------------

async def rate_passenger_by_driver(
    db: AsyncSession, user: User, ride_id: str, passenger_id: str, stars: int, comment: str | None = None
) -> dict:
    result = await db.execute(
        select(Ride).where(Ride.id == ride_id, Ride.driver_id == user.id)
    )
    ride = result.scalar_one_or_none()
    if not ride:
        return {"success": False, "error": "Trajet introuvable ou vous n'en êtes pas le conducteur."}
    if ride.status != RideStatus.COMPLETED:
        return {"success": False, "error": "Le trajet doit être terminé pour évaluer un passager."}
    booking_result = await db.execute(
        select(Booking).where(
            Booking.ride_id == ride_id,
            Booking.passenger_id == passenger_id,
            Booking.status == BookingStatus.CONFIRMED,
        )
    )
    if not booking_result.scalar_one_or_none():
        return {"success": False, "error": "Ce passager n'a pas participé à ce trajet."}
    existing = await db.execute(
        select(PassengerRating).where(
            PassengerRating.ride_id == ride_id,
            PassengerRating.driver_id == user.id,
            PassengerRating.passenger_id == passenger_id,
        )
    )
    if existing.scalar_one_or_none():
        return {"success": False, "error": "Vous avez déjà évalué ce passager."}
    if not (1 <= stars <= 5):
        return {"success": False, "error": "La note doit être entre 1 et 5 étoiles."}
    import uuid as _uuid
    rating = PassengerRating(
        id=str(_uuid.uuid4()),
        ride_id=ride_id,
        driver_id=user.id,
        passenger_id=passenger_id,
        stars=stars,
        comment=comment,
    )
    db.add(rating)
    await db.commit()
    return {"success": True, "message": f"Passager évalué : {stars}/5 étoiles.", "stars": stars}


# ---------------------------------------------------------------------------
# Tool: get_my_alerts
# ---------------------------------------------------------------------------

async def get_my_alerts(db: AsyncSession, user: User) -> dict:
    result = await db.execute(
        select(RideAlert)
        .where(RideAlert.user_id == user.id, RideAlert.is_active == True)
        .order_by(RideAlert.created_at.desc())
    )
    alerts = result.scalars().all()
    return {
        "alerts": [
            {"id": a.id, "origin": a.origin, "destination": a.destination, "created_at": a.created_at.isoformat()}
            for a in alerts
        ],
        "count": len(alerts),
    }


# ---------------------------------------------------------------------------
# Tool: create_search_alert
# ---------------------------------------------------------------------------

async def create_search_alert(db: AsyncSession, user: User, origin: str, destination: str) -> dict:
    existing = await db.execute(
        select(RideAlert).where(
            RideAlert.user_id == user.id,
            RideAlert.origin.ilike(origin.strip()),
            RideAlert.destination.ilike(destination.strip()),
            RideAlert.is_active == True,
        )
    )
    if existing.scalar_one_or_none():
        return {"success": False, "error": "Vous avez déjà une alerte active pour ce trajet."}
    import uuid as _uuid
    alert = RideAlert(id=str(_uuid.uuid4()), user_id=user.id, origin=origin.strip(), destination=destination.strip())
    db.add(alert)
    await db.commit()
    return {
        "success": True,
        "message": f"Alerte créée pour {origin} → {destination}. Vous serez notifié par email dès qu'un trajet est publié.",
        "origin": origin,
        "destination": destination,
    }


# ---------------------------------------------------------------------------
# Tool: delete_search_alert
# ---------------------------------------------------------------------------

async def delete_search_alert(db: AsyncSession, user: User, alert_id: str) -> dict:
    result = await db.execute(
        select(RideAlert).where(RideAlert.id == alert_id, RideAlert.user_id == user.id)
    )
    alert = result.scalar_one_or_none()
    if not alert:
        return {"success": False, "error": "Alerte introuvable ou n'appartient pas à ce compte."}
    alert.is_active = False
    await db.commit()
    return {"success": True, "message": f"Alerte {alert.origin} → {alert.destination} supprimée."}


# ---------------------------------------------------------------------------
# Tool: prepare_report  (triggers confirmation before writing)
# ---------------------------------------------------------------------------

async def prepare_report(db: AsyncSession, user: User, target_type: str, target_id: str, reason: str) -> dict:
    if target_type not in ("ride", "user"):
        return {"confirm_required": False, "error": "Type invalide. Utilisez 'ride' ou 'user'."}
    if not reason.strip():
        return {"confirm_required": False, "error": "La raison du signalement est requise."}
    existing = await db.execute(
        select(Report).where(
            Report.reporter_id == user.id,
            Report.target_type == target_type,
            Report.target_id == target_id,
            Report.status == "PENDING",
        )
    )
    if existing.scalar_one_or_none():
        return {"confirm_required": False, "error": "Vous avez déjà un signalement en attente pour cet élément."}
    return {
        "confirm_required": True,
        "action": "create_report",
        "summary": {
            "target_type": target_type,
            "target_id": target_id,
            "reason": reason.strip(),
        },
    }


# ---------------------------------------------------------------------------
# Tool: prepare_edit_ride  (triggers confirmation before writing)
# ---------------------------------------------------------------------------

async def prepare_edit_ride(
    db: AsyncSession,
    user: User,
    ride_id: str,
    price_per_seat: float | None = None,
    available_seats: int | None = None,
    departure_time: str | None = None,
    pickup_location: str | None = None,
    dropoff_location: str | None = None,
) -> dict:
    result = await db.execute(
        select(Ride).where(Ride.id == ride_id, Ride.driver_id == user.id)
    )
    ride = result.scalar_one_or_none()
    if not ride:
        return {"confirm_required": False, "error": "Trajet introuvable ou vous n'en êtes pas le conducteur."}
    if ride.status in (RideStatus.CANCELLED, RideStatus.COMPLETED):
        return {"confirm_required": False, "error": "Ce trajet ne peut plus être modifié."}

    updates: dict = {}
    if price_per_seat is not None:
        p = float(price_per_seat)
        if p <= 0:
            return {"confirm_required": False, "error": "Le prix doit être supérieur à 0 MAD."}
        updates["price_per_seat"] = p
    if available_seats is not None:
        s = int(available_seats)
        if not (0 <= s <= 8):
            return {"confirm_required": False, "error": "Le nombre de places doit être entre 0 et 8."}
        updates["available_seats"] = s
    if departure_time is not None:
        try:
            dt = datetime.fromisoformat(departure_time)
            if dt <= datetime.now():
                return {"confirm_required": False, "error": "La date de départ doit être dans le futur."}
            updates["departure_time"] = dt.isoformat()
        except ValueError:
            return {"confirm_required": False, "error": f"Date invalide : {departure_time}. Utilisez le format ISO (YYYY-MM-DDTHH:MM)."}
    if pickup_location is not None:
        updates["pickup_location"] = pickup_location
    if dropoff_location is not None:
        updates["dropoff_location"] = dropoff_location

    if not updates:
        return {"confirm_required": False, "error": "Aucune modification fournie."}

    return {
        "confirm_required": True,
        "action": "edit_ride",
        "summary": {
            "ride_id": ride_id,
            "origin": ride.origin,
            "destination": ride.destination,
            "current_departure_time": ride.departure_time.isoformat(),
            "current_price_per_seat": ride.price_per_seat,
            "current_available_seats": ride.available_seats,
            **updates,
        },
    }


# ---------------------------------------------------------------------------
# Tool: get_tracking_share_link
# ---------------------------------------------------------------------------

async def get_tracking_share_link(db: AsyncSession, user: User, ride_id: str) -> dict:
    result = await db.execute(
        select(Ride).where(Ride.id == ride_id, Ride.driver_id == user.id)
    )
    ride = result.scalar_one_or_none()
    if not ride:
        return {"success": False, "error": "Trajet introuvable ou vous n'en êtes pas le conducteur."}

    from ..routes.tracking import _share_tokens
    existing = next((t for t, rid in _share_tokens.items() if rid == ride_id), None)
    token = existing or _secrets.token_urlsafe(16)
    _share_tokens[token] = ride_id

    frontend_url = os.getenv("NEXT_PUBLIC_APP_URL", "http://localhost:3000")
    share_url = f"{frontend_url}/track/{ride_id}?share_token={token}"
    return {
        "success": True,
        "share_url": share_url,
        "message": f"Lien de suivi GPS prêt. Partagez ce lien avec votre famille : {share_url}",
    }


# ---------------------------------------------------------------------------
# Tool: get_ride_passengers
# ---------------------------------------------------------------------------

async def get_ride_passengers(db: AsyncSession, ride_id: str, user: User) -> dict:
    """Returns passengers with confirmed/pending bookings for a driver's ride."""
    ride_res = await db.execute(select(Ride).where(Ride.id == ride_id, Ride.driver_id == user.id))
    ride = ride_res.scalar_one_or_none()
    if not ride:
        return {"error": "Trajet introuvable ou vous n'en êtes pas le conducteur."}
    stmt = (
        select(Booking)
        .options(joinedload(Booking.passenger))
        .where(Booking.ride_id == ride_id, Booking.status != BookingStatus.CANCELLED)
        .order_by(Booking.created_at)
    )
    result = await db.execute(stmt)
    bookings = result.scalars().unique().all()
    return {
        "ride_id": ride_id,
        "origin": ride.origin,
        "destination": ride.destination,
        "departure_time": ride.departure_time.isoformat(),
        "passengers": [
            {
                "booking_id": b.id,
                "passenger_id": b.passenger_id,
                "passenger_name": f"{b.passenger.first_name} {b.passenger.last_name}" if b.passenger else "N/A",
                "seats": b.seats_booked,
                "total_price": b.total_price,
                "status": b.status.value if hasattr(b.status, "value") else str(b.status),
            }
            for b in bookings
        ],
        "count": len(bookings),
    }


# ---------------------------------------------------------------------------
# Tool: prepare_accept_booking
# ---------------------------------------------------------------------------

async def prepare_accept_booking(db: AsyncSession, booking_id: str, user: User) -> dict:
    b_res = await db.execute(
        select(Booking).options(joinedload(Booking.ride), joinedload(Booking.passenger))
        .where(Booking.id == booking_id)
    )
    booking = b_res.scalar_one_or_none()
    if not booking:
        return {"confirm_required": False, "error": "Réservation introuvable."}
    if not booking.ride or booking.ride.driver_id != user.id:
        return {"confirm_required": False, "error": "Cette réservation n'appartient pas à un de vos trajets."}
    if booking.status != BookingStatus.PENDING:
        return {"confirm_required": False, "error": f"Réservation déjà en statut : {booking.status.value}."}
    passenger_name = f"{booking.passenger.first_name} {booking.passenger.last_name}" if booking.passenger else "N/A"
    return {
        "confirm_required": True,
        "action": "accept_booking",
        "summary": {
            "booking_id": booking_id,
            "passenger_name": passenger_name,
            "seats": booking.seats_booked,
            "total_price": booking.total_price,
            "origin": booking.ride.origin,
            "destination": booking.ride.destination,
            "departure_time": booking.ride.departure_time.isoformat(),
        },
    }


# ---------------------------------------------------------------------------
# Tool: prepare_refuse_booking
# ---------------------------------------------------------------------------

async def prepare_refuse_booking(db: AsyncSession, booking_id: str, user: User) -> dict:
    b_res = await db.execute(
        select(Booking).options(joinedload(Booking.ride), joinedload(Booking.passenger))
        .where(Booking.id == booking_id)
    )
    booking = b_res.scalar_one_or_none()
    if not booking:
        return {"confirm_required": False, "error": "Réservation introuvable."}
    if not booking.ride or booking.ride.driver_id != user.id:
        return {"confirm_required": False, "error": "Cette réservation n'appartient pas à un de vos trajets."}
    if booking.status == BookingStatus.CANCELLED:
        return {"confirm_required": False, "error": "Réservation déjà annulée."}
    passenger_name = f"{booking.passenger.first_name} {booking.passenger.last_name}" if booking.passenger else "N/A"
    return {
        "confirm_required": True,
        "action": "refuse_booking",
        "summary": {
            "booking_id": booking_id,
            "passenger_name": passenger_name,
            "seats": booking.seats_booked,
            "origin": booking.ride.origin,
            "destination": booking.ride.destination,
            "departure_time": booking.ride.departure_time.isoformat(),
        },
    }


# ---------------------------------------------------------------------------
# Tool: prepare_send_message_to_passenger
# ---------------------------------------------------------------------------

async def prepare_send_message_to_passenger(db: AsyncSession, booking_id: str, content: str, user: User) -> dict:
    """Driver sends message to a passenger via booking."""
    b_res = await db.execute(
        select(Booking).options(joinedload(Booking.ride), joinedload(Booking.passenger))
        .where(Booking.id == booking_id)
    )
    booking = b_res.scalar_one_or_none()
    if not booking:
        return {"confirm_required": False, "error": "Réservation introuvable."}
    if not booking.ride or booking.ride.driver_id != user.id:
        return {"confirm_required": False, "error": "Accès non autorisé."}
    passenger_name = f"{booking.passenger.first_name} {booking.passenger.last_name}" if booking.passenger else "le passager"
    return {
        "confirm_required": True,
        "action": "send_message_to_passenger",
        "summary": {
            "booking_id": booking_id,
            "content": content,
            "passenger_name": passenger_name,
            "origin": booking.ride.origin if booking.ride else None,
            "destination": booking.ride.destination if booking.ride else None,
        },
    }


# ---------------------------------------------------------------------------
# Tool: get_driver_revenue_summary
# ---------------------------------------------------------------------------

async def get_driver_revenue_summary(db: AsyncSession, user: User) -> dict:
    rides_res = await db.execute(
        select(Ride).where(Ride.driver_id == user.id)
    )
    rides = rides_res.scalars().all()
    total_rides = len(rides)
    active_rides = sum(1 for r in rides if (r.status.value if hasattr(r.status, "value") else str(r.status)) == "ACTIVE")
    completed_rides = sum(1 for r in rides if (r.status.value if hasattr(r.status, "value") else str(r.status)) == "COMPLETED")
    cancelled_rides = sum(1 for r in rides if (r.status.value if hasattr(r.status, "value") else str(r.status)) == "CANCELLED")

    ride_ids = [r.id for r in rides]
    confirmed_bookings = []
    if ride_ids:
        b_res = await db.execute(
            select(Booking).where(
                Booking.ride_id.in_(ride_ids),
                Booking.status == BookingStatus.CONFIRMED,
            )
        )
        confirmed_bookings = b_res.scalars().all()

    estimated_revenue = sum(b.total_price for b in confirmed_bookings)
    return {
        "total_rides": total_rides,
        "active_rides": active_rides,
        "completed_rides": completed_rides,
        "cancelled_rides": cancelled_rides,
        "confirmed_bookings": len(confirmed_bookings),
        "estimated_revenue_mad": round(estimated_revenue, 2),
        "note": "Revenus estimés basés sur les réservations confirmées. Le paiement se fait en espèces.",
    }


# ---------------------------------------------------------------------------
# Tool: get_my_driver_documents
# ---------------------------------------------------------------------------

async def get_my_driver_documents(db: AsyncSession, user: User) -> dict:
    from ..models.document import DriverDocument
    res = await db.execute(
        select(DriverDocument).where(DriverDocument.driver_id == user.id)
        .order_by(DriverDocument.created_at.desc())
    )
    docs = res.scalars().all()

    doc_list = [
        {
            "id": d.id,
            "type": d.doc_type.value if hasattr(d.doc_type, "value") else str(d.doc_type),
            "status": d.status.value if hasattr(d.status, "value") else str(d.status),
            "uploaded_at": d.created_at.isoformat() if d.created_at else None,
            "notes": d.admin_note,
        }
        for d in docs
    ]

    # A driver is truly verified only when at least one document is APPROVED by admin
    has_approved = any(d["status"] == "APPROVED" for d in doc_list)
    has_pending  = any(d["status"] == "PENDING"  for d in doc_list)

    if has_approved:
        message = "Documents validés par l'admin. Compte conducteur vérifié."
    elif has_pending:
        message = "Documents soumis, en attente de validation par l'admin."
    elif doc_list:
        message = "Vos documents ont été refusés. Veuillez les soumettre à nouveau."
    else:
        message = "Aucun document soumis. Uploadez votre CIN et votre permis de conduire pour faire valider votre profil conducteur."

    return {
        "verified": has_approved,
        "documents": doc_list,
        "count": len(doc_list),
        "message": message,
    }


# ---------------------------------------------------------------------------
# Tool schema definitions (OpenAI / Groq format)
# ---------------------------------------------------------------------------

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "search_rides",
            "description": (
                "Search available rides in the database matching the user's travel request. "
                "Returns real ride results ranked by relevance. "
                "Call this whenever the user wants to find a ride."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "from_city": {"type": "string", "description": "Departure city (French or Arabic name)"},
                    "to_city": {"type": "string", "description": "Arrival/destination city"},
                    "date": {"type": "string", "description": "Date in YYYY-MM-DD format. Convert relative dates (demain, vendredi...) to absolute dates."},
                    "seats": {"anyOf": [{"type": "integer"}, {"type": "string"}], "description": "Number of seats needed (default 1)"},
                    "max_price": {"anyOf": [{"type": "number"}, {"type": "string"}], "description": "Maximum acceptable price per seat in MAD"},
                    "time_of_day": {"type": "string", "enum": ["morning", "afternoon", "evening"],
                                    "description": "Preferred time of day"},
                },
                "required": ["from_city", "to_city"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_ride_details",
            "description": "Get full details of a specific ride including driver preferences, route coordinates, distance and duration.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ride_id": {"type": "string", "description": "The ride UUID"},
                },
                "required": ["ride_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "estimate_distance_duration",
            "description": "Estimate distance in km and travel duration between two Moroccan cities.",
            "parameters": {
                "type": "object",
                "properties": {
                    "from_city": {"type": "string"},
                    "to_city": {"type": "string"},
                },
                "required": ["from_city", "to_city"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_seat_availability",
            "description": "Check if a specific ride has enough available seats for the user.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ride_id": {"type": "string"},
                    "seats_needed": {"type": "integer", "description": "Number of seats to check (default 1)"},
                },
                "required": ["ride_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "prepare_booking",
            "description": (
                "Prepare a booking and show a confirmation summary to the user. "
                "ALWAYS call this before any booking — it does NOT create the reservation yet. "
                "The user must explicitly confirm before the booking is created."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "ride_id": {"type": "string", "description": "The ride UUID to book"},
                    "seats": {"type": "integer", "description": "Number of seats to reserve (default 1)"},
                },
                "required": ["ride_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_my_bookings",
            "description": "Get the list of rides the current PASSENGER has booked. Use when a passenger asks to see their reservations, trips, or booking history.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_driver_bookings",
            "description": "Get the list of bookings received on the current DRIVER's rides. Use when a driver asks who booked their rides.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ride_id": {"type": "string", "description": "Optional: filter bookings for a specific ride ID"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "prepare_cancel_booking",
            "description": "Prepare cancellation of a booking. Shows summary and asks for confirmation. Does NOT cancel immediately. Use when a passenger wants to cancel a reservation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "booking_id": {"type": "string", "description": "The booking UUID to cancel"},
                },
                "required": ["booking_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "prepare_cancel_ride",
            "description": "Prepare cancellation of a published ride. Shows summary and asks for confirmation. Does NOT cancel immediately. Use when a DRIVER wants to cancel one of their rides.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ride_id": {"type": "string", "description": "The ride UUID to cancel"},
                },
                "required": ["ride_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_my_rides",
            "description": (
                "Get the list of rides published by the current DRIVER. "
                "Use this when a driver asks to see their rides, trips, or publications. "
                "Never use get_ride_details with a fake ID to list rides — use this tool instead."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "prepare_publish_ride",
            "description": (
                "Prepare a ride publication and show a confirmation summary to the driver. "
                "ALWAYS call this when a DRIVER wants to publish/create a ride — it does NOT save to the DB yet. "
                "The driver must confirm before the ride is created. "
                "Collect all required details before calling: origin, destination, date, time, seats, price."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "origin": {"type": "string", "description": "Departure city (e.g. Casablanca)"},
                    "destination": {"type": "string", "description": "Arrival city (e.g. Marrakech)"},
                    "departure_date": {"type": "string", "description": "Date in YYYY-MM-DD format"},
                    "departure_time": {"type": "string", "description": "Time in HH:MM format (24h)"},
                    "seats": {"anyOf": [{"type": "integer"}, {"type": "string"}], "description": "Number of available seats (1-8)"},
                    "price_per_seat": {"anyOf": [{"type": "number"}, {"type": "string"}], "description": "Price per seat in MAD"},
                    "pickup_location": {"type": "string", "description": "Optional specific pickup point"},
                    "dropoff_location": {"type": "string", "description": "Optional specific dropoff point"},
                },
                "required": ["origin", "destination", "departure_date", "departure_time", "seats", "price_per_seat"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_user_preferences",
            "description": "Get the current DRIVER's ride preferences (smoking, music, AC, etc.) and display the interactive preferences card.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "save_custom_note",
            "description": (
                "Save the DRIVER's personal preferences text note. "
                "Use this when the driver describes personal rules or preferences in natural language, "
                "e.g. 'je préfère les passagers ponctuels', 'pas de nourriture dans la voiture', "
                "'je m'arrête pour pause si trajet > 2h'. Extract the full text and save it."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "note": {"type": "string", "description": "The personal preferences text to save, written in the driver's own words."},
                },
                "required": ["note"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "prepare_set_recurring",
            "description": (
                "Show a day-of-week picker so the driver can mark one of their rides as recurring (trajet habituel). "
                "Call this when the driver wants to set which days a ride repeats. "
                "Requires the ride_id of the specific ride. Get it from get_my_rides first if unknown."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "ride_id": {"type": "string", "description": "The ID of the ride to mark as recurring."},
                },
                "required": ["ride_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_tourist_info",
            "description": (
                "Get tourist information about a Moroccan destination: highlights, restaurants, "
                "accommodation tips. Use when the user mentions visiting a city as a tourist."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "destination": {"type": "string", "description": "Moroccan city or destination"},
                },
                "required": ["destination"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_payment_methods",
            "description": "Get the available payment methods for booking a ride.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_driver_ratings",
            "description": "Get ratings and reviews for a specific driver. Use when user asks about a driver's reputation or stars.",
            "parameters": {
                "type": "object",
                "properties": {
                    "driver_id": {"type": "string", "description": "The driver's user UUID"},
                },
                "required": ["driver_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "submit_rating",
            "description": "Submit a star rating and optional comment for a driver after a COMPLETED ride. The passenger must have had a confirmed booking on that ride.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ride_id": {"type": "string", "description": "The ride UUID to rate"},
                    "stars": {"type": "integer", "description": "Rating from 1 to 5 stars"},
                    "comment": {"type": "string", "description": "Optional written review"},
                },
                "required": ["ride_id", "stars"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "rate_passenger_by_driver",
            "description": "As a DRIVER, rate a passenger after a COMPLETED ride.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ride_id": {"type": "string", "description": "The ride UUID"},
                    "passenger_id": {"type": "string", "description": "The passenger's user UUID"},
                    "stars": {"type": "integer", "description": "Rating from 1 to 5 stars"},
                    "comment": {"type": "string", "description": "Optional written review"},
                },
                "required": ["ride_id", "passenger_id", "stars"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_my_alerts",
            "description": "Get the user's active search alerts. Use when user asks to see their alerts or notifications for routes.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_search_alert",
            "description": "Create an email alert so the user is notified when a ride matching their route is published. Use when user asks to be notified or set an alert for a route.",
            "parameters": {
                "type": "object",
                "properties": {
                    "origin": {"type": "string", "description": "Departure city"},
                    "destination": {"type": "string", "description": "Arrival city"},
                },
                "required": ["origin", "destination"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_search_alert",
            "description": "Delete / deactivate a search alert. Call get_my_alerts first if the user doesn't know the alert ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "alert_id": {"type": "string", "description": "The alert UUID to delete"},
                },
                "required": ["alert_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "prepare_report",
            "description": "Report a ride or user to moderators. Shows a confirmation before submitting. Use when user says 'signaler', 'report', 'abuse', etc.",
            "parameters": {
                "type": "object",
                "properties": {
                    "target_type": {"type": "string", "enum": ["ride", "user"], "description": "'ride' to report a ride, 'user' to report a user"},
                    "target_id": {"type": "string", "description": "UUID of the ride or user to report"},
                    "reason": {"type": "string", "description": "Reason for the report (detailed description of the problem)"},
                },
                "required": ["target_type", "target_id", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "prepare_edit_ride",
            "description": "Modify a published ride (price, seats, departure time, pickup/dropoff). Shows a confirmation summary before saving. DRIVER only.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ride_id": {"type": "string", "description": "UUID of the ride to edit"},
                    "price_per_seat": {"anyOf": [{"type": "number"}, {"type": "string"}], "description": "New price per seat in MAD"},
                    "available_seats": {"anyOf": [{"type": "integer"}, {"type": "string"}], "description": "New number of available seats"},
                    "departure_time": {"type": "string", "description": "New departure datetime in ISO format (YYYY-MM-DDTHH:MM)"},
                    "pickup_location": {"type": "string", "description": "New pickup point description"},
                    "dropoff_location": {"type": "string", "description": "New dropoff point description"},
                },
                "required": ["ride_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_tracking_share_link",
            "description": "Generate a public GPS tracking share link for a ride. Anyone with the link can watch the live position without logging in. DRIVER only.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ride_id": {"type": "string", "description": "UUID of the ride to share tracking for"},
                },
                "required": ["ride_id"],
            },
        },
    },
    # ── DRIVER-ONLY TOOLS ────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "get_ride_passengers",
            "description": "Get the list of passengers (confirmed and pending) for a specific ride owned by the driver.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ride_id": {"type": "string", "description": "The ride UUID"},
                },
                "required": ["ride_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "prepare_accept_booking",
            "description": "Prepare acceptance of a passenger booking. Shows confirmation before executing. Use when driver wants to accept a PENDING booking.",
            "parameters": {
                "type": "object",
                "properties": {
                    "booking_id": {"type": "string", "description": "The booking UUID to accept"},
                },
                "required": ["booking_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "prepare_refuse_booking",
            "description": "Prepare refusal of a passenger booking. Shows confirmation before executing. Use when driver wants to refuse/reject a booking.",
            "parameters": {
                "type": "object",
                "properties": {
                    "booking_id": {"type": "string", "description": "The booking UUID to refuse"},
                },
                "required": ["booking_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "prepare_send_message_to_passenger",
            "description": "Prepare a message from driver to a passenger linked to a booking. Requires confirmation before sending.",
            "parameters": {
                "type": "object",
                "properties": {
                    "booking_id": {"type": "string", "description": "Booking UUID linking driver and passenger"},
                    "content": {"type": "string", "description": "Message content"},
                },
                "required": ["booking_id", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_driver_revenue_summary",
            "description": "Get driver's revenue statistics: total rides, confirmed bookings, estimated revenue in MAD.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_my_driver_documents",
            "description": "Get driver's uploaded documents (CIN, permis) and verification status.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]
