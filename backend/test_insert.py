import asyncio
from app.database import AsyncSessionLocal
from sqlalchemy import select
from app.models.user import User
from app.models.ride import Ride, RideStatus
from datetime import datetime

async def test():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(User))
        user = res.scalars().first()
        if not user:
            print("No users found!")
            return
        print("Using user:", user.id, user.email)
        
        ride = Ride(
            driver_id=user.id,
            origin="Casablanca",
            destination="Rabat",
            departure_time=datetime.utcnow(),
            available_seats=3,
            price_per_seat=50.0,
            status=RideStatus.active
        )
        db.add(ride)
        try:
            await db.commit()
            print("Successfully inserted ride!")
            await db.delete(ride)
            await db.commit()
            print("Successfully deleted ride!")
        except Exception as e:
            print("Error:", e)
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test())
