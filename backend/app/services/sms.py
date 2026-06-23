"""
SMS notifications via Twilio.
All functions are fire-and-forget background tasks.
If Twilio credentials are not configured, calls are silently skipped.
"""
import logging
from datetime import datetime

from app.core.config import settings

logger = logging.getLogger(__name__)


def _client():
    if not (settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN):
        return None
    from twilio.rest import Client
    return Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)


def _send(to_phone: str, body: str) -> bool:
    client = _client()
    if not client:
        logger.warning("Twilio not configured — skipping SMS")
        return False
    if not to_phone:
        return False
    try:
        # Normalize Moroccan number: 06xxxxxxxx → +2126xxxxxxxx
        phone = to_phone.strip()
        if phone.startswith("0") and not phone.startswith("+"):
            phone = "+212" + phone[1:]
        elif not phone.startswith("+"):
            phone = "+212" + phone

        msg = client.messages.create(
            body=body,
            from_=settings.TWILIO_PHONE_NUMBER,
            to=phone,
        )
        logger.info(f"SMS sent to {phone} — SID {msg.sid}")
        return True
    except Exception as e:
        logger.error(f"SMS failed to {to_phone}: {e}")
        return False


def send_booking_confirmation_sms(
    to_phone: str,
    passenger_name: str,
    origin: str,
    destination: str,
    departure: datetime,
    seats: int,
    total_price: float,
    driver_name: str,
) -> bool:
    dt = departure.strftime("%d/%m à %Hh%M")
    body = (
        f"CovoitMaroc ✅ Réservation confirmée !\n"
        f"{origin} → {destination}, {dt}\n"
        f"{seats} place(s) — {total_price:.0f} MAD\n"
        f"Conducteur : {driver_name}"
    )
    return _send(to_phone, body)


def send_booking_cancellation_sms(
    to_phone: str,
    origin: str,
    destination: str,
    departure: datetime,
    by_driver: bool = False,
) -> bool:
    dt = departure.strftime("%d/%m à %Hh%M")
    who = "le conducteur" if by_driver else "le passager"
    body = (
        f"CovoitMaroc ❌ Trajet annulé par {who}.\n"
        f"{origin} → {destination}, {dt}\n"
        f"Votre place a été libérée."
    )
    return _send(to_phone, body)


def send_phone_otp_sms(to_phone: str, otp: str, first_name: str) -> bool:
    body = (
        f"CovoitMaroc — Bonjour {first_name} !\n"
        f"Votre code de vérification : {otp}\n"
        f"Ce code expire dans 10 minutes. Ne le partagez pas."
    )
    return _send(to_phone, body)


def send_ride_published_sms(
    to_phone: str,
    origin: str,
    destination: str,
    departure: datetime,
    seats: int,
    price: float,
) -> bool:
    dt = departure.strftime("%d/%m à %Hh%M")
    body = (
        f"CovoitMaroc 🚗 Trajet publié !\n"
        f"{origin} → {destination}, {dt}\n"
        f"{seats} place(s) à {price:.0f} MAD/place"
    )
    return _send(to_phone, body)
