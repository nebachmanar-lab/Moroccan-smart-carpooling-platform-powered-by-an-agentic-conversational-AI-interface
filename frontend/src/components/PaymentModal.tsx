"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";

interface Ride {
  id: string;
  origin: string;
  destination: string;
  price_per_seat: number;
  available_seats: number;
  departure_time: string;
}

interface Props {
  ride: Ride;
  onClose: () => void;
  onSuccess: () => void;
}

type PayMethod = "cash" | "card";
type Step = "choose" | "card_form" | "processing" | "done";

export default function PaymentModal({ ride, onClose, onSuccess }: Props) {
  const [method, setMethod] = useState<PayMethod>("cash");
  const [step, setStep] = useState<Step>("choose");
  const [error, setError] = useState("");
  const [seats, setSeats] = useState(1);

  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");

  const total = ride.price_per_seat * seats;
  const maxSeats = Math.max(1, ride.available_seats);

  function handleContinue() {
    if (method === "card") {
      setStep("card_form");
    } else {
      confirmBooking();
    }
  }

  function handleCardSubmit() {
    if (cardNumber.replace(/\s/g, "").length < 16) {
      setError("Numero de carte invalide.");
      return;
    }
    if (!expiry.match(/^\d{2}\/\d{2}$/)) {
      setError("Format expiration : MM/AA");
      return;
    }
    if (cvv.length < 3) {
      setError("CVV invalide.");
      return;
    }
    setError("");
    confirmBooking();
  }

  async function confirmBooking() {
    setStep("processing");

    try {
      const res = await apiFetch("/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ride_id: ride.id, seats_booked: seats }),
      });

      if (!res.ok) {
        const data = await res.json();
        const detail = data.detail;
        const msg = Array.isArray(detail)
          ? detail.map((e: { msg?: string }) => e.msg || JSON.stringify(e)).join(", ")
          : typeof detail === "string"
          ? detail
          : "Erreur lors de la reservation.";
        throw new Error(msg);
      }

      setStep("done");
      setTimeout(onSuccess, 1800);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erreur inconnue.";
      setError(msg);
      setStep(method === "card" ? "card_form" : "choose");
    }
  }

  function formatCard(val: string) {
    return val.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
  }

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <button className="modal-close" onClick={onClose}>x</button>

        <div className="simulation-badge">
          SIMULATION — Aucun paiement reel effectue
        </div>

        {/* Choose method */}
        {step === "choose" && (
          <>
            <h2 className="modal-title">Confirmer la reservation</h2>
            <p className="modal-subtitle">
              {ride.origin} &rarr; {ride.destination}
            </p>

            {/* Seat selector */}
            <div style={{ marginBottom: "16px" }}>
              <p style={{ color: "var(--text-soft)", fontSize: "13px", fontWeight: 800, marginBottom: "8px" }}>
                Nombre de places
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setSeats((s) => Math.max(1, s - 1))}
                  disabled={seats <= 1}
                  style={{ width: "32px", padding: "0" }}
                >
                  −
                </button>
                <span style={{ fontSize: "18px", fontWeight: 700, minWidth: "24px", textAlign: "center" }}>
                  {seats}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setSeats((s) => Math.min(maxSeats, s + 1))}
                  disabled={seats >= maxSeats}
                  style={{ width: "32px", padding: "0" }}
                >
                  +
                </button>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  (max {maxSeats} disponible{maxSeats > 1 ? "s" : ""})
                </span>
              </div>
            </div>

            <p style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>
              Total : <span style={{ color: "white" }}>{total} MAD</span>
              {seats > 1 && (
                <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 400, marginLeft: 6 }}>
                  ({ride.price_per_seat} × {seats})
                </span>
              )}
            </p>

            <p style={{ color: "var(--text-soft)", fontSize: "13px", fontWeight: 800, marginBottom: "12px" }}>
              Mode de paiement
            </p>

            <label className={`pay-option${method === "cash" ? " selected" : ""}`}>
              <input
                type="radio"
                name="method"
                value="cash"
                checked={method === "cash"}
                onChange={() => setMethod("cash")}
              />
              <div>
                <p className="pay-option-name">Paiement en especes</p>
                <p className="pay-option-desc">
                  Vous payez directement le conducteur a bord
                </p>
              </div>
            </label>

            <label className={`pay-option${method === "card" ? " selected" : ""}`}>
              <input
                type="radio"
                name="method"
                value="card"
                checked={method === "card"}
                onChange={() => setMethod("card")}
              />
              <div>
                <p className="pay-option-name">Carte bancaire (CMI)</p>
                <p className="pay-option-desc">
                  Carte Visa / Mastercard — simulation
                </p>
              </div>
            </label>

            {error && (
              <p className="alert-error" style={{ marginTop: "12px" }}>{error}</p>
            )}

            <button
              onClick={handleContinue}
              className="btn btn-primary btn-full"
              style={{ marginTop: "16px" }}
            >
              Continuer — {total} MAD
            </button>
          </>
        )}

        {/* Card form */}
        {step === "card_form" && (
          <>
            <h2 className="modal-title">Paiement par carte</h2>
            <p className="modal-subtitle">
              Montant : <strong style={{ color: "white" }}>{total} MAD</strong>
              {seats > 1 && <span style={{ color: "var(--text-muted)", fontSize: "12px" }}> ({seats} places)</span>}
            </p>

            <div className="inner-field">
              <label>Numero de carte</label>
              <input
                type="text"
                placeholder="1234 5678 9012 3456"
                value={cardNumber}
                onChange={(e) => setCardNumber(formatCard(e.target.value))}
                style={{ letterSpacing: "0.1em" }}
              />
            </div>

            <div className="two-col">
              <div className="inner-field">
                <label>Expiration</label>
                <input
                  type="text"
                  placeholder="MM/AA"
                  maxLength={5}
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                />
              </div>
              <div className="inner-field">
                <label>CVV</label>
                <input
                  type="password"
                  placeholder="..."
                  maxLength={4}
                  value={cvv}
                  onChange={(e) => setCvv(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <p className="alert-error" style={{ marginBottom: "12px" }}>{error}</p>
            )}

            <div className="modal-row">
              <button
                onClick={() => { setStep("choose"); setError(""); }}
                className="btn btn-secondary"
                style={{ flex: 1 }}
              >
                Retour
              </button>
              <button
                onClick={handleCardSubmit}
                className="btn btn-primary"
                style={{ flex: 1 }}
              >
                Payer {total} MAD
              </button>
            </div>
          </>
        )}

        {/* Processing */}
        {step === "processing" && (
          <div className="modal-center">
            <div className="modal-icon" style={{ fontSize: "40px" }}>. . .</div>
            <p className="modal-state-title">Traitement en cours...</p>
            <p className="modal-state-sub">Veuillez patienter</p>
          </div>
        )}

        {/* Done */}
        {step === "done" && (
          <div className="modal-center">
            <div className="modal-icon" style={{ color: "var(--green)", fontSize: "40px" }}>OK</div>
            <p className="modal-state-title">Reservation confirmee !</p>
            <p className="modal-state-sub">
              {ride.origin} &rarr; {ride.destination} &middot; {seats} place(s) &middot; {total} MAD
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "12px" }}>
              Un email de confirmation a ete envoye a votre adresse.
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "4px" }}>
              Bon voyage !
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
