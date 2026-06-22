from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import joinedload
from app.models.ride import Ride, RideStatus
from app.schemas.ride import RideSearchParams

SORT_OPTIONS = ("departure_time", "price", "seats")


async def search_rides(
    db: AsyncSession,
    params: RideSearchParams,
    sort_by: str = "departure_time",
) -> tuple[list[Ride], str]:
    """
    Filter: city pair (case-insensitive), date window, seats needed, optional max price.
    Sort:   departure_time | price | seats
    """
    if sort_by not in SORT_OPTIONS:
        sort_by = "departure_time"

    # Build a full-day window from the requested date
    day_start = datetime.strptime(params.date, "%Y-%m-%d")
    day_end   = day_start + timedelta(days=1)

    stmt = (
        select(Ride)
        .options(joinedload(Ride.driver))   # avoid N+1 when serializing driver info
        .where(
            Ride.status == RideStatus.ACTIVE,
            func.lower(Ride.origin_city)      == params.origin_city.lower(),
            func.lower(Ride.destination_city) == params.destination_city.lower(),
            Ride.departure_datetime >= day_start,
            Ride.departure_datetime <  day_end,
            Ride.available_seats    >= params.seats_needed,
        )
    )

    if params.max_price is not None:
        stmt = stmt.where(Ride.price_per_seat <= params.max_price)

    if sort_by == "departure_time":
        stmt = stmt.order_by(Ride.departure_datetime.asc())
    elif sort_by == "price":
        stmt = stmt.order_by(Ride.price_per_seat.asc())
    elif sort_by == "seats":
        stmt = stmt.order_by(Ride.available_seats.desc())

    result = await db.execute(stmt)
    rides = result.scalars().unique().all()
    return rides, sort_by