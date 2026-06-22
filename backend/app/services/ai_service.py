import json
from ..schemas.ai import AISearchResponse, ExtractedEntities
from .openrouter import call_llm

SYSTEM_PROMPT = """You are a travel assistant for a Moroccan carpooling app.
Extract the following fields from the user's message and return ONLY valid JSON:
{
  "from_city": "<city or null>",
  "to_city": "<city or null>",
  "date": "<YYYY-MM-DD or null>",
  "seats": <integer or null>,
  "max_price": <number or null>,
  "is_tourist": <true or false>,
  "language": "<fr|ar|en>"
}
Do not include any explanation, only the JSON object."""


async def ai_search(message: str, rides: list[dict]) -> AISearchResponse:
    raw = await call_llm([{"role": "user", "content": message}], system=SYSTEM_PROMPT)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        import re
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        data = json.loads(match.group()) if match else {}

    entities = ExtractedEntities(**{k: v for k, v in data.items() if k in ExtractedEntities.model_fields})

    filtered = rides
    if entities.from_city:
        filtered = [r for r in filtered if entities.from_city.lower() in (r.get("origin") or "").lower()]
    if entities.to_city:
        filtered = [r for r in filtered if entities.to_city.lower() in (r.get("destination") or "").lower()]
    if entities.max_price is not None:
        filtered = [r for r in filtered if (r.get("price_per_seat") or float("inf")) <= entities.max_price]
    if entities.seats is not None:
        filtered = [r for r in filtered if (r.get("available_seats") or 0) >= entities.seats]
    if entities.date:
        filtered = [r for r in filtered if r.get("departure_time") and str(r["departure_time"]).startswith(entities.date)]

    safe = []
    for r in filtered:
        d = {k: v for k, v in r.items() if not k.startswith("_")}
        if "departure_time" in d and d["departure_time"] is not None:
            d["departure_time"] = str(d["departure_time"])
        safe.append(d)

    return AISearchResponse(entities=entities, rides=safe)
