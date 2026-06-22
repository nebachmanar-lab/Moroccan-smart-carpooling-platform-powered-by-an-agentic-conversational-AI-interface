import asyncio
import json
import os
import re

import httpx
from fastapi import APIRouter, HTTPException

from app.services.openrouter import call_llm

router = APIRouter(prefix="/tourist", tags=["tourist"])

# ── Foursquare config ──────────────────────────────────────────────────────────
# Free tier: basic fields only (no rating, price, photos — those are premium).
# Auth header: "Authorization: Bearer <key>"  +  "X-Places-Api-Version: 2025-06-17"

FSQ_KEY    = os.getenv("FOURSQUARE_API_KEY", "")
FSQ_BASE   = "https://places-api.foursquare.com/places/search"
FSQ_HDRS   = lambda: {
    "Authorization": f"Bearer {FSQ_KEY}",
    "X-Places-Api-Version": "2025-06-17",
    "Accept": "application/json",
}

# Text queries that reliably surface each type even on Moroccan city data
FSQ_QUERIES = {
    "poi":           "museum monument mosque medina palace kasbah",
    "restaurant":    "restaurant cafe",
    "accommodation": "hotel riad hostel",
}

# ── Hardcoded coords (skip Nominatim for known cities) ─────────────────────────

CITY_COORDS: dict[str, tuple[float, float]] = {
    "casablanca": (33.5731, -7.5898),
    "marrakech":  (31.6295, -7.9811),
    "fès":  (34.0181, -5.0078), "fes":  (34.0181, -5.0078),
    "rabat": (34.0209, -6.8416),
    "tanger": (35.7595, -5.8340), "tangier": (35.7595, -5.8340),
    "agadir": (30.4278, -9.5981),
    "meknès": (33.8935, -5.5547), "meknes": (33.8935, -5.5547),
    "oujda": (34.6814, -1.9086),
    "tétouan": (35.5785, -5.3684), "tetouan": (35.5785, -5.3684),
    "safi": (32.2994, -9.2372),
    "essaouira": (31.5085, -9.7595),
    "chefchaouen": (35.1688, -5.2636),
    "ouarzazate":  (30.9189, -6.8934),
    "merzouga":    (31.0979, -4.0126),
    "ifrane":      (33.5228, -5.1116),
    "asilah":      (35.4653, -6.0343),
    "dakhla":      (23.7151, -15.9357),
    "el jadida":   (33.2316, -8.5007),
    "kenitra":  (34.2610, -6.5802), "kénitra": (34.2610, -6.5802),
    "nador":    (35.1740, -2.9287),
    "beni mellal": (32.3373, -6.3498), "béni mellal": (32.3373, -6.3498),
    "laayoune": (27.1536, -13.2033), "laâyoune": (27.1536, -13.2033),
    "settat":     (33.0016, -7.6199),
    "berrechid":  (33.2658, -7.5883),
    "khemisset":  (33.8241, -6.0658),
    "tiznit":     (29.6974, -9.7316),
    "taroudant":  (30.4702, -8.8774),
    "ouezzane":   (34.7987, -5.5778),
    "azrou":      (33.4344, -5.2222),
}

# ── AI guide prompt ────────────────────────────────────────────────────────────

GUIDE_PROMPT = """Tu es un guide touristique expert du Maroc. Pour la ville ou région de {city}, génère un guide complet en JSON :
{{
  "city": "{city}",
  "description": "2-3 phrases vivantes de présentation",
  "highlights": ["incontournable 1", "incontournable 2", "incontournable 3", "incontournable 4", "incontournable 5"],
  "food": ["spécialité ou adresse 1", "spécialité 2", "spécialité 3", "spécialité 4"],
  "accommodation": ["Riads en médina (300-700 MAD/nuit)", "Hôtels centre-ville (200-500 MAD/nuit)", "Auberges (80-180 MAD/nuit)"],
  "tips": ["conseil pratique 1", "conseil 2", "conseil 3", "conseil 4"],
  "best_time": "période idéale pour visiter",
  "language": "langue(s) parlée(s)"
}}
Réponds UNIQUEMENT avec le JSON valide, sans balise markdown ni explication."""


# ── Geocoding ──────────────────────────────────────────────────────────────────

async def _geocode(city: str) -> tuple[float, float]:
    key = city.strip().lower()
    if key in CITY_COORDS:
        return CITY_COORDS[key]
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": f"{city}, Maroc", "format": "json", "limit": 1},
                headers={"User-Agent": "CovoitMaroc/1.0"},
            )
            data = r.json()
            if data:
                return float(data[0]["lat"]), float(data[0]["lon"])
    except Exception:
        pass
    raise HTTPException(status_code=404, detail=f"Ville introuvable : {city}")


# ── Foursquare helpers ─────────────────────────────────────────────────────────

async def _fsq_search(lat: float, lng: float, query: str, radius: int = 5000, limit: int = 30) -> list[dict]:
    """Call Foursquare Places Search with free-tier fields only."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                FSQ_BASE,
                headers=FSQ_HDRS(),
                params={
                    "ll":     f"{lat},{lng}",
                    "radius": radius,
                    "query":  query,
                    "limit":  limit,
                    "sort":   "POPULARITY",
                },
            )
            if r.status_code != 200:
                return []
            return r.json().get("results", [])
    except Exception:
        return []


def _normalize_fsq(places: list[dict], category: str) -> list[dict]:
    """Convert Foursquare v3 (new API) response to our POI schema."""
    result = []
    for p in places:
        lat = p.get("latitude")
        lng = p.get("longitude")
        if lat is None or lng is None:
            continue

        name = p.get("name", "").strip()
        if not name:
            continue

        cats     = p.get("categories") or []
        cat_name = cats[0].get("name", "") if cats else ""

        result.append({
            "id":          p.get("fsq_place_id"),
            "name":        name,
            "lat":         lat,
            "lng":         lng,
            "category":    category,
            "cat_name":    cat_name,
            "website":     p.get("website") or None,
            "tel":         p.get("tel") or None,
            # premium fields are absent in free tier — set None so frontend skips them
            "rating":      None,
            "photo_url":   None,
            "open_now":    None,
            "hours_display": "",
            "budget":      None,
            "tags": {
                "cuisine":       cat_name.lower() if category == "restaurant" else "",
                "tourism":       cat_name.lower() if category != "restaurant" else "",
                "opening_hours": "",
            },
        })
    return result


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/explore/{city}")
async def explore_city(city: str):
    lat, lng = await _geocode(city)

    if not FSQ_KEY:
        # No API key — return coords only; POIs fetched client-side via Overpass
        return {"city": city, "lat": lat, "lng": lng, "source": "osm"}

    pois_raw, rest_raw, accom_raw = await asyncio.gather(
        _fsq_search(lat, lng, FSQ_QUERIES["poi"],           radius=5000, limit=30),
        _fsq_search(lat, lng, FSQ_QUERIES["restaurant"],    radius=3000, limit=30),
        _fsq_search(lat, lng, FSQ_QUERIES["accommodation"], radius=5000, limit=20),
    )

    return {
        "city":           city,
        "lat":            lat,
        "lng":            lng,
        "source":         "foursquare",
        "pois":           _normalize_fsq(pois_raw,   "poi"),
        "restaurants":    _normalize_fsq(rest_raw,   "restaurant"),
        "accommodations": _normalize_fsq(accom_raw,  "accommodation"),
    }


@router.get("/guide/{city}")
async def get_guide(city: str):
    """AI-generated destination guide via Groq LLM."""
    raw = await call_llm(
        [{"role": "user", "content": GUIDE_PROMPT.format(city=city.strip().title())}],
        system="",
    )
    try:
        data = json.loads(raw)
    except Exception:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        try:
            data = json.loads(m.group()) if m else _fallback_guide(city)
        except Exception:
            data = _fallback_guide(city)
    return data


def _fallback_guide(city: str) -> dict:
    return {
        "city": city,
        "description": f"{city} est une destination fascinante du Maroc, riche en histoire et en culture.",
        "highlights":    ["Médina historique", "Marché local", "Mosquée principale", "Musée de la ville", "Point de vue panoramique"],
        "food":          ["Tagine traditionnel", "Couscous du vendredi", "Pastilla feuilletée", "Harira et msemen"],
        "accommodation": ["Riads en médina (300-700 MAD/nuit)", "Hôtels centre-ville (200-500 MAD/nuit)", "Auberges de jeunesse (80-180 MAD/nuit)"],
        "tips":          ["Visitez tôt le matin pour éviter la foule", "Habillez-vous modestement dans les médinas", "Négociez toujours au souk", "Privilégiez les taxis agréés (compteur obligatoire)"],
        "best_time": "Printemps (mars – mai) et automne (sept – nov)",
        "language":  "Darija (arabe dialectal) · Français · Berbère",
    }
