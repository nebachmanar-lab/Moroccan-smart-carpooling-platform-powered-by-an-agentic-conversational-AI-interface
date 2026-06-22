import smtplib
import logging
import asyncio
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime
from app.core.config import settings

logger = logging.getLogger(__name__)


def _build_booking_confirmation_html(
    passenger_name: str,
    booking_id: int,
    origin: str,
    destination: str,
    departure: datetime,
    seats: int,
    total_price: float,
    driver_name: str,
    pickup_point: str | None,
) -> str:
    departure_str = departure.strftime("%A %d %B %Y à %H:%M")
    pickup_str = pickup_point or "À confirmer avec le conducteur"

    return f"""
    <html><body style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;color:#333;">
      <div style="background:#1A56DB;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;">🚗 Réservation confirmée</h1>
      </div>
      <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;">
        <p>Bonjour <strong>{passenger_name}</strong>,</p>
        <p>Votre réservation <strong>#{booking_id}</strong> est bien enregistrée.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr style="background:#EBF3FF;">
            <td style="padding:10px 14px;font-weight:bold;">Trajet</td>
            <td style="padding:10px 14px;">{origin} → {destination}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:bold;">Date &amp; heure</td>
            <td style="padding:10px 14px;">{departure_str}</td>
          </tr>
          <tr style="background:#EBF3FF;">
            <td style="padding:10px 14px;font-weight:bold;">Point de rencontre</td>
            <td style="padding:10px 14px;">{pickup_str}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:bold;">Conducteur</td>
            <td style="padding:10px 14px;">{driver_name}</td>
          </tr>
          <tr style="background:#EBF3FF;">
            <td style="padding:10px 14px;font-weight:bold;">Places réservées</td>
            <td style="padding:10px 14px;">{seats}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:bold;">Total</td>
            <td style="padding:10px 14px;color:#1A56DB;font-size:18px;"><strong>{total_price:.0f} MAD</strong></td>
          </tr>
        </table>
        <p style="font-size:13px;color:#666;">
          Bon voyage ! Si vous devez annuler, faites-le depuis votre espace personnel
          au moins 2 heures avant le départ.
        </p>
      </div>
    </body></html>
    """


def _build_driver_new_booking_html(
    driver_name: str,
    passenger_name: str,
    booking_id: str,
    origin: str,
    destination: str,
    departure: datetime,
    seats: int,
    total_price: float,
) -> str:
    departure_str = departure.strftime("%A %d %B %Y à %H:%M")
    return f"""
    <html><body style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;color:#333;">
      <div style="background:#16a34a;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;">🎉 Nouvelle réservation !</h1>
      </div>
      <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;">
        <p>Bonjour <strong>{driver_name}</strong>,</p>
        <p><strong>{passenger_name}</strong> vient de réserver une place sur votre trajet.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr style="background:#ECFDF5;">
            <td style="padding:10px 14px;font-weight:bold;">Réservation</td>
            <td style="padding:10px 14px;">#{booking_id[:8]}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:bold;">Trajet</td>
            <td style="padding:10px 14px;">{origin} → {destination}</td>
          </tr>
          <tr style="background:#ECFDF5;">
            <td style="padding:10px 14px;font-weight:bold;">Date &amp; heure</td>
            <td style="padding:10px 14px;">{departure_str}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:bold;">Passager</td>
            <td style="padding:10px 14px;">{passenger_name}</td>
          </tr>
          <tr style="background:#ECFDF5;">
            <td style="padding:10px 14px;font-weight:bold;">Places réservées</td>
            <td style="padding:10px 14px;">{seats}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:bold;">Montant</td>
            <td style="padding:10px 14px;color:#16a34a;font-size:18px;"><strong>{total_price:.0f} MAD</strong></td>
          </tr>
        </table>
        <p style="font-size:13px;color:#666;">
          Rendez-vous au point de départ à l'heure convenue. Bon trajet !
        </p>
      </div>
    </body></html>
    """


def _send_smtp(to_email: str, msg: MIMEMultipart) -> None:
    """Blocking SMTP send — runs in a thread pool via run_in_executor."""
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
        server.ehlo()
        if settings.SMTP_TLS:
            server.starttls()
        if settings.SMTP_PASSWORD:
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(settings.SMTP_USER, to_email, msg.as_string())


async def send_booking_confirmation(
    to_email: str,
    passenger_name: str,
    booking_id: int,
    origin: str,
    destination: str,
    departure: datetime,
    seats: int,
    total_price: float,
    driver_name: str,
    pickup_point: str | None = None,
) -> bool:
    if not settings.SMTP_HOST or not settings.SMTP_USER:
        logger.warning("SMTP not configured — skipping confirmation email")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Confirmation de réservation #{booking_id} — {origin} → {destination}"
        msg["From"] = f"CovoitMaroc <{settings.SMTP_USER}>"
        msg["To"] = to_email

        html_content = _build_booking_confirmation_html(
            passenger_name, booking_id, origin, destination,
            departure, seats, total_price, driver_name, pickup_point
        )
        msg.attach(MIMEText(html_content, "html", "utf-8"))

        # Run blocking smtplib in a thread so we don't block the async event loop
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _send_smtp, to_email, msg)

        logger.info(f"Confirmation email sent to {to_email} for booking #{booking_id}")
        return True

    except Exception as e:
        logger.error(f"Failed to send confirmation email: {e}")
        return False


async def send_driver_booking_notification(
    to_email: str,
    driver_name: str,
    passenger_name: str,
    booking_id: str,
    origin: str,
    destination: str,
    departure: datetime,
    seats: int,
    total_price: float,
) -> bool:
    if not settings.SMTP_HOST or not settings.SMTP_USER:
        logger.warning("SMTP not configured — skipping driver notification email")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Nouvelle réservation — {passenger_name} · {origin} → {destination}"
        msg["From"] = f"CovoitMaroc <{settings.SMTP_USER}>"
        msg["To"] = to_email

        html_content = _build_driver_new_booking_html(
            driver_name, passenger_name, booking_id,
            origin, destination, departure, seats, total_price,
        )
        msg.attach(MIMEText(html_content, "html", "utf-8"))

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _send_smtp, to_email, msg)

        logger.info(f"Driver notification email sent to {to_email} for booking #{booking_id}")
        return True

    except Exception as e:
        logger.error(f"Failed to send driver notification email: {e}")
        return False


# ── Email verification ────────────────────────────────────────────────────────

def _build_verification_html(name: str, verify_url: str) -> str:
    return f"""
    <html><body style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;color:#333;">
      <div style="background:#1A56DB;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;">Verifiez votre adresse email</h1>
      </div>
      <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;">
        <p>Bonjour <strong>{name}</strong>,</p>
        <p>Merci de vous etre inscrit sur Covoit Maroc. Cliquez ci-dessous pour activer votre compte.</p>
        <div style="text-align:center;margin:28px 0;">
          <a href="{verify_url}" style="background:#1A56DB;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:bold;">
            Verifier mon email
          </a>
        </div>
        <p style="font-size:13px;color:#666;">Ce lien expire dans 24 heures.</p>
        <p style="font-size:12px;color:#aaa;word-break:break-all;">{verify_url}</p>
      </div>
    </body></html>"""


async def send_verification_email(to_email: str, name: str, verify_url: str) -> bool:
    if not settings.SMTP_HOST or not settings.SMTP_USER:
        logger.warning("SMTP not configured — skipping verification email")
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = "Verifiez votre adresse email — Covoit Maroc"
        msg["From"] = f"CovoitMaroc <{settings.SMTP_USER}>"
        msg["To"] = to_email
        msg.attach(MIMEText(_build_verification_html(name, verify_url), "html", "utf-8"))
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _send_smtp, to_email, msg)
        return True
    except Exception as e:
        logger.error(f"Failed to send verification email: {e}")
        return False


# ── Password reset ────────────────────────────────────────────────────────────

def _build_reset_html(name: str, reset_url: str) -> str:
    return f"""
    <html><body style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;color:#333;">
      <div style="background:#dc2626;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;">Reinitialisation du mot de passe</h1>
      </div>
      <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;">
        <p>Bonjour <strong>{name}</strong>,</p>
        <p>Vous avez demande a reinitialiser votre mot de passe. Cliquez ci-dessous :</p>
        <div style="text-align:center;margin:28px 0;">
          <a href="{reset_url}" style="background:#dc2626;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:bold;">
            Reinitialiser mon mot de passe
          </a>
        </div>
        <p style="font-size:13px;color:#666;">Ce lien expire dans 1 heure. Si vous ne l avez pas demande, ignorez cet email.</p>
      </div>
    </body></html>"""


async def send_reset_password_email(to_email: str, name: str, reset_url: str) -> bool:
    if not settings.SMTP_HOST or not settings.SMTP_USER:
        logger.warning("SMTP not configured — skipping reset email")
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = "Reinitialisation de mot de passe — Covoit Maroc"
        msg["From"] = f"CovoitMaroc <{settings.SMTP_USER}>"
        msg["To"] = to_email
        msg.attach(MIMEText(_build_reset_html(name, reset_url), "html", "utf-8"))
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _send_smtp, to_email, msg)
        return True
    except Exception as e:
        logger.error(f"Failed to send reset email: {e}")
        return False


# ── Booking accept / refuse ───────────────────────────────────────────────────

async def send_booking_accepted_email(
    to_email: str,
    passenger_name: str,
    driver_name: str,
    origin: str,
    destination: str,
    departure: datetime,
    seats: int,
    total_price: float,
) -> bool:
    if not settings.SMTP_HOST or not settings.SMTP_USER:
        return False
    departure_str = departure.strftime("%A %d %B %Y a %H:%M")
    html = f"""
    <html><body style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;color:#333;">
      <div style="background:#16a34a;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;">Reservation acceptee !</h1>
      </div>
      <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;">
        <p>Bonjour <strong>{passenger_name}</strong>,</p>
        <p><strong>{driver_name}</strong> a accepte votre reservation.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr style="background:#ECFDF5;"><td style="padding:10px;font-weight:bold;">Trajet</td><td style="padding:10px;">{origin} → {destination}</td></tr>
          <tr><td style="padding:10px;font-weight:bold;">Date</td><td style="padding:10px;">{departure_str}</td></tr>
          <tr style="background:#ECFDF5;"><td style="padding:10px;font-weight:bold;">Places</td><td style="padding:10px;">{seats}</td></tr>
          <tr><td style="padding:10px;font-weight:bold;">Total</td><td style="padding:10px;color:#16a34a;font-size:18px;"><strong>{total_price:.0f} MAD</strong></td></tr>
        </table>
        <p style="font-size:13px;color:#666;">Bon voyage !</p>
      </div>
    </body></html>"""
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Reservation acceptee — {origin} → {destination}"
        msg["From"] = f"CovoitMaroc <{settings.SMTP_USER}>"
        msg["To"] = to_email
        msg.attach(MIMEText(html, "html", "utf-8"))
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _send_smtp, to_email, msg)
        return True
    except Exception as e:
        logger.error(f"Failed to send accepted email: {e}")
        return False


async def send_new_message_email(
    to_email: str,
    recipient_name: str,
    sender_name: str,
    preview: str,
    booking_id: str,
    frontend_url: str,
) -> bool:
    if not settings.SMTP_HOST or not settings.SMTP_USER:
        return False
    link = f"{frontend_url}/messages/{booking_id}"
    html = f"""
    <html><body style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;color:#333;">
      <div style="background:#5367ff;padding:20px;border-radius:8px 8px 0 0;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:20px;">Nouveau message</h1>
      </div>
      <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;">
        <p>Bonjour <strong>{recipient_name}</strong>,</p>
        <p><strong>{sender_name}</strong> vous a envoyé un message :</p>
        <blockquote style="border-left:4px solid #5367ff;margin:16px 0;padding:10px 16px;background:#f0f4ff;border-radius:4px;font-style:italic;color:#444;">
          {preview[:200]}{"..." if len(preview) > 200 else ""}
        </blockquote>
        <div style="text-align:center;margin:24px 0;">
          <a href="{link}" style="background:#5367ff;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:bold;">
            Répondre
          </a>
        </div>
        <p style="font-size:12px;color:#aaa;">Vous recevez cet email car vous avez une réservation active sur Covoit Maroc.</p>
      </div>
    </body></html>"""
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Message de {sender_name} — Covoit Maroc"
        msg["From"] = f"CovoitMaroc <{settings.SMTP_USER}>"
        msg["To"] = to_email
        msg.attach(MIMEText(html, "html", "utf-8"))
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _send_smtp, to_email, msg)
        return True
    except Exception as e:
        logger.error(f"Failed to send message notification email: {e}")
        return False


async def send_booking_refused_email(
    to_email: str,
    passenger_name: str,
    driver_name: str,
    origin: str,
    destination: str,
    departure: datetime,
) -> bool:
    if not settings.SMTP_HOST or not settings.SMTP_USER:
        return False
    departure_str = departure.strftime("%A %d %B %Y a %H:%M")
    html = f"""
    <html><body style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;color:#333;">
      <div style="background:#dc2626;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;">Reservation refusee</h1>
      </div>
      <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;">
        <p>Bonjour <strong>{passenger_name}</strong>,</p>
        <p><strong>{driver_name}</strong> n a pas pu accepter votre reservation pour le trajet <strong>{origin} → {destination}</strong> du {departure_str}.</p>
        <p>Vos places ont ete liberees. Nous vous invitons a rechercher un autre trajet.</p>
      </div>
    </body></html>"""
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Reservation refusee — {origin} → {destination}"
        msg["From"] = f"CovoitMaroc <{settings.SMTP_USER}>"
        msg["To"] = to_email
        msg.attach(MIMEText(html, "html", "utf-8"))
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _send_smtp, to_email, msg)
        return True
    except Exception as e:
        logger.error(f"Failed to send refused email: {e}")
        return False

async def send_ride_alert_email(
    to_email: str,
    user_name: str,
    origin: str,
    destination: str,
    departure: datetime,
    seats: int,
    price: float,
    ride_id: str,
    frontend_url: str,
) -> bool:
    if not settings.SMTP_HOST or not settings.SMTP_USER:
        return False
    dep_str = departure.strftime("%A %d %B %Y à %H:%M")
    ride_url = f"{frontend_url}/rides/{ride_id}"
    html = f"""
    <html><body style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;color:#333;">
      <div style="background:#6366f1;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;">🔔 Nouveau trajet disponible !</h1>
      </div>
      <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;">
        <p>Bonjour <strong>{user_name}</strong>,</p>
        <p>Un nouveau trajet correspondant à votre alerte <strong>{origin} → {destination}</strong> vient d'être publié.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr style="background:#ede9fe;"><td style="padding:10px 14px;font-weight:bold;">Trajet</td><td style="padding:10px 14px;">{origin} → {destination}</td></tr>
          <tr><td style="padding:10px 14px;font-weight:bold;">Départ</td><td style="padding:10px 14px;">{dep_str}</td></tr>
          <tr style="background:#ede9fe;"><td style="padding:10px 14px;font-weight:bold;">Places</td><td style="padding:10px 14px;">{seats}</td></tr>
          <tr><td style="padding:10px 14px;font-weight:bold;">Prix / place</td><td style="padding:10px 14px;font-weight:bold;">{price:.0f} MAD</td></tr>
        </table>
        <div style="text-align:center;margin:24px 0;">
          <a href="{ride_url}" style="background:#6366f1;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;">
            Voir le trajet →
          </a>
        </div>
        <p style="font-size:12px;color:#888;">Covoit Maroc · Vous recevez cet email car vous avez créé une alerte pour ce trajet.</p>
      </div>
    </body></html>"""
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"🔔 Nouveau trajet {origin} → {destination}"
        msg["From"] = f"CovoitMaroc <{settings.SMTP_USER}>"
        msg["To"] = to_email
        msg.attach(MIMEText(html, "html", "utf-8"))
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _send_smtp, to_email, msg)
        return True
    except Exception as e:
        logger.error(f"Failed to send alert email: {e}")
        return False


async def send_receipt_email(
    to_email: str,
    passenger_name: str,
    driver_name: str,
    origin: str,
    destination: str,
    departure: datetime,
    seats: int,
    total_price: float,
    receipt_number: str,
) -> bool:
    if not settings.SMTP_HOST or not settings.SMTP_USER:
        return False
    departure_str = departure.strftime("%A %d %B %Y a %H:%M")
    html = f"""
    <html><body style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;color:#333;">
      <div style="background:#0f172a;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;">Recu de paiement — Covoit Maroc</h1>
      </div>
      <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;">
        <p>Bonjour <strong>{passenger_name}</strong>,</p>
        <p>Voici votre recu pour la reservation confirmee.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr style="background:#f1f5f9;"><td style="padding:10px 14px;font-weight:bold;">N Recu</td><td style="padding:10px 14px;font-family:monospace;">{receipt_number}</td></tr>
          <tr><td style="padding:10px 14px;font-weight:bold;">Trajet</td><td style="padding:10px 14px;">{origin} &rarr; {destination}</td></tr>
          <tr style="background:#f1f5f9;"><td style="padding:10px 14px;font-weight:bold;">Depart</td><td style="padding:10px 14px;">{departure_str}</td></tr>
          <tr><td style="padding:10px 14px;font-weight:bold;">Conducteur</td><td style="padding:10px 14px;">{driver_name}</td></tr>
          <tr style="background:#f1f5f9;"><td style="padding:10px 14px;font-weight:bold;">Places</td><td style="padding:10px 14px;">{seats}</td></tr>
          <tr style="background:#dcfce7;"><td style="padding:10px 14px;font-weight:bold;color:#166534;">Total paye</td><td style="padding:10px 14px;font-weight:bold;color:#166534;font-size:18px;">{total_price:.2f} MAD</td></tr>
        </table>
        <p style="font-size:12px;color:#888;">Merci d utiliser Covoit Maroc. Ce recu confirme votre paiement.</p>
      </div>
    </body></html>"""
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Recu #{receipt_number} — {origin} → {destination}"
        msg["From"] = f"CovoitMaroc <{settings.SMTP_USER}>"
        msg["To"] = to_email
        msg.attach(MIMEText(html, "html", "utf-8"))
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _send_smtp, to_email, msg)
        return True
    except Exception as e:
        logger.error(f"Failed to send receipt email: {e}")
        return False
