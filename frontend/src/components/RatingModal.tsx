"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";

interface Props {
    rideId: string;
    driverId: string;
    driverName: string;
    origin: string;
    destination: string;
    onClose: () => void;
    onSuccess: () => void;
}

export default function RatingModal({ rideId, driverId, driverName, origin, destination, onClose, onSuccess }: Props) {
    const [stars, setStars] = useState(0);
    const [hovered, setHovered] = useState(0);
    const [comment, setComment] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    async function submit() {
        if (stars === 0) { setError("Choisissez une note de 1 à 5 étoiles."); return; }
        setSaving(true);
        setError("");
        try {
            const res = await apiFetch("/ratings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ride_id: rideId, driver_id: driverId, stars, comment: comment || null }),
            });
            if (res.ok) {
                onSuccess();
            } else {
                const data = await res.json();
                setError(data.detail || "Erreur lors de l'envoi.");
            }
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
                <button className="modal-close" onClick={onClose}>✕</button>

                <h2 className="modal-title">Évaluer le trajet</h2>
                <p className="modal-subtitle">
                    {origin} → {destination} · <strong>{driverName}</strong>
                </p>

                {/* Star picker */}
                <div className="star-picker">
                    {[1, 2, 3, 4, 5].map((n) => (
                        <button
                            key={n}
                            className={`star-btn ${n <= (hovered || stars) ? "active" : ""}`}
                            onMouseEnter={() => setHovered(n)}
                            onMouseLeave={() => setHovered(0)}
                            onClick={() => setStars(n)}
                            type="button"
                        >
                            ★
                        </button>
                    ))}
                </div>
                <p className="star-label">
                    {stars === 0 ? "Cliquez pour noter" : ["", "Très mauvais", "Mauvais", "Correct", "Bien", "Excellent"][stars]}
                </p>

                <textarea
                    className="rating-comment"
                    placeholder="Commentaire (optionnel)..."
                    rows={3}
                    maxLength={400}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                />

                {error && <p className="alert-error" style={{ marginTop: 8 }}>{error}</p>}

                <button
                    className="btn btn-primary btn-full"
                    style={{ marginTop: 16 }}
                    onClick={submit}
                    disabled={saving || stars === 0}
                >
                    {saving ? "Envoi..." : "Envoyer l'évaluation"}
                </button>
            </div>
        </div>
    );
}
