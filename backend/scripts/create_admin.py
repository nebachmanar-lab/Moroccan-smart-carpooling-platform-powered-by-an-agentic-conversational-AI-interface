"""
Script to create or promote an admin account.

Usage:
    python -m scripts.create_admin

Reads from environment variables (or .env file):
    ADMIN_EMAIL    — email of the account to create/promote
    ADMIN_PASSWORD — password (only used when creating a new account)

Run from the backend/ directory:
    cd backend
    python -m scripts.create_admin
"""
import asyncio
import os
import sys
import uuid

from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import select

from app.core.config import settings
from app.core.security import hash_password
from app.models.user import User, Role


async def main() -> None:
    email    = os.getenv("ADMIN_EMAIL", "").strip()
    password = os.getenv("ADMIN_PASSWORD", "").strip()

    if not email:
        print("ERROR: ADMIN_EMAIL environment variable is not set.")
        sys.exit(1)

    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as db:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()

        if user:
            user.role        = Role.ADMIN
            user.is_verified = True
            await db.commit()
            print(f"✓ User '{email}' promoted to ADMIN and marked as verified.")
        else:
            if not password:
                print("ERROR: User not found. Set ADMIN_PASSWORD to create a new account.")
                sys.exit(1)
            new_user = User(
                id            = str(uuid.uuid4()),
                email         = email,
                password_hash = hash_password(password),
                first_name    = "Admin",
                last_name     = "CovoMar",
                role          = Role.ADMIN,
                is_verified   = True,
            )
            db.add(new_user)
            await db.commit()
            print(f"✓ Admin account created for '{email}'.")

    await engine.dispose()
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
