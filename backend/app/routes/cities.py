# app/routes/cities.py
#
# This file creates one simple API endpoint: GET /cities
#
# The frontend calls this endpoint once (when the page loads) to get
# the full list of Moroccan cities + their coordinates.
# It then shows them in a dropdown, and uses the lat/lng to draw the map.
#
# No external API. No API key. Pure Python dictionary.

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from app.data.moroccan_cities import MOROCCAN_CITIES

router = APIRouter(prefix="/cities", tags=["cities"])

_cities_payload = None


@router.get("/")
def list_cities():
    global _cities_payload
    if _cities_payload is None:
        _cities_payload = [
            {"name": city, "lat": coords["lat"], "lng": coords["lng"]}
            for city, coords in MOROCCAN_CITIES.items()
        ]
    return JSONResponse(
        content=_cities_payload,
        headers={"Cache-Control": "public, max-age=86400"},
    )