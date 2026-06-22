# app/main.py
#
# Entry point of the FastAPI application.
# All routers are registered here with app.include_router().
#
# Change for Step 4: added the cities router.

from dotenv import load_dotenv
load_dotenv()

import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from app.routes import auth, rides, bookings, preferences, cities
from app.routes import ai
from app.routes import conversations
from app.routes import tracking
from app.routes import admin
from app.routes import ratings
from app.routes import documents
from app.routes import messages
from app.routes import tourist
from app.routes import alerts
from app.routes import reports
app = FastAPI(title="Covoiturage Maroc API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ai.router)

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """
    Catch all unhandled exceptions so they flow back through CORSMiddleware.
    Without this, Starlette's ServerErrorMiddleware returns 500 before CORS
    headers are added, causing the browser to report a CORS error instead of
    the real server error.
    """
    import traceback
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


# Register all route groups
app.include_router(auth.router)
app.include_router(rides.router)
app.include_router(bookings.router)
app.include_router(preferences.router)
app.include_router(cities.router)
app.include_router(conversations.router)
app.include_router(tracking.router)
app.include_router(admin.router)
app.include_router(ratings.router)
app.include_router(documents.router)
app.include_router(messages.router)
app.include_router(tourist.router)
app.include_router(alerts.router)
app.include_router(reports.router)

# Serve uploaded files
_uploads_dir = os.path.join(os.path.dirname(__file__), "..", "uploads")
os.makedirs(_uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_uploads_dir), name="uploads")


@app.get("/")
def root():
    return {"message": "Covoiturage Maroc API is running"}