from datetime import datetime


def score_rides(rides: list[dict], entities: dict) -> list[dict]:
    from_city = entities.get("from_city") or entities.get("origin")
    to_city = entities.get("to_city") or entities.get("destination")
    date_str = entities.get("date")
    max_price = entities.get("max_price")
    seats = entities.get("seats")

    scored = []
    for ride in rides:
        score = 0.0

        if from_city and ride.get("origin", "").lower() == from_city.lower():
            score += 40
        if to_city and ride.get("destination", "").lower() == to_city.lower():
            score += 40

        if date_str and ride.get("departure_time"):
            try:
                ride_date = datetime.fromisoformat(ride["departure_time"]).date()
                target_date = datetime.fromisoformat(date_str).date()
                diff = abs((ride_date - target_date).days)
                score += max(0, 10 - diff * 2)
            except ValueError:
                pass

        if max_price and ride.get("price_per_seat") is not None:
            if ride["price_per_seat"] <= float(max_price):
                score += 5
            else:
                score -= 10

        if seats and ride.get("available_seats", 0) >= int(seats):
            score += 5

        ride["score"] = round(score, 1)
        scored.append(ride)

    return sorted(scored, key=lambda r: r["score"], reverse=True)
