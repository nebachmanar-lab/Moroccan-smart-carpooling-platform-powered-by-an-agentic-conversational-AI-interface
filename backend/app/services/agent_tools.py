"""
Tool implementations for the AI copilot.
The LLM calls these via Groq function-calling; they read from the DB
and return structured dicts.  No DB writes happen here except
save_user_preference — which is non-sensitive.
Booking creation happens in agent_service after explicit user confirmation.
"""
import json
from datetime import datetime, timedelta
from math import radians, sin, cos, sqrt, atan2

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from ..models.ride import Ride, RideStatus
from ..models.booking import Booking, BookingStatus
from ..models.preferences import DriverPreferences
from ..models.user import User, Role
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
        "smoking_allowed": prefs.smoking_allowed,
        "pets_allowed": prefs.pets_allowed,
        "music_allowed": prefs.music_allowed,
        "talking_preference": prefs.talking_preference,
        "luggage_size": prefs.luggage_size,
        "air_conditioning": prefs.air_conditioning,
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

async def update_preferences(
    db: AsyncSession,
    user: User,
    smoking_allowed: bool | None = None,
    pets_allowed: bool | None = None,
    music_allowed: bool | None = None,
    air_conditioning: bool | None = None,
    talking_preference: str | None = None,
    luggage_size: str | None = None,
) -> dict:
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role.upper() != "DRIVER":
        return {"success": False, "error": "Seuls les conducteurs peuvent définir des préférences."}

    result = await db.execute(
        select(DriverPreferences).where(DriverPreferences.driver_id == user.id)
    )
    prefs = result.scalar_one_or_none()

    updates: dict = {}
    if smoking_allowed is not None:   updates["smoking_allowed"]    = smoking_allowed
    if pets_allowed is not None:      updates["pets_allowed"]       = pets_allowed
    if music_allowed is not None:     updates["music_allowed"]      = music_allowed
    if air_conditioning is not None:  updates["air_conditioning"]   = air_conditioning
    if talking_preference is not None: updates["talking_preference"] = talking_preference
    if luggage_size is not None:      updates["luggage_size"]       = luggage_size

    if not updates:
        return {"success": False, "error": "Aucune préférence fournie à mettre à jour."}

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
        "success": True,
        "preferences": {
            "smoking_allowed": prefs.smoking_allowed,
            "pets_allowed": prefs.pets_allowed,
            "music_allowed": prefs.music_allowed,
            "air_conditioning": prefs.air_conditioning,
            "talking_preference": prefs.talking_preference,
            "luggage_size": prefs.luggage_size,
        },
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
            }
            for r in rides
        ],
        "count": len(rides),
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
            "name": "update_preferences",
            "description": "Update the DRIVER's ride preferences (smoking, pets, music, AC, talking style, luggage). Only provide the fields the user wants to change. Takes effect immediately without confirmation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "smoking_allowed":    {"type": "boolean", "description": "Whether smoking is allowed in the car"},
                    "pets_allowed":       {"type": "boolean", "description": "Whether pets are allowed"},
                    "music_allowed":      {"type": "boolean", "description": "Whether music is played"},
                    "air_conditioning":   {"type": "boolean", "description": "Whether AC is available"},
                    "talking_preference": {"type": "string",  "enum": ["silent", "no_preference", "talkative"], "description": "Preferred conversation level"},
                    "luggage_size":       {"type": "string",  "enum": ["small", "medium", "large"], "description": "Maximum luggage size accepted"},
                },
                "required": [],
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
            "description": "Get the current user's ride preferences (smoking, music, AC, etc.).",
            "parameters": {"type": "object", "properties": {}, "required": []},
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
]
