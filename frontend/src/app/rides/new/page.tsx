"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { City, fetchCities } from "@/lib/cities";
import { apiFetch } from "@/lib/api";
import CitySelect from "@/components/CitySelect";
import Link from "next/link";

export default function NewRidePage() {
    const router = useRouter();
    const [cities, setCities] = useState<City[]>([]);
    const [origin, setOrigin] = useState<City | null>(null);
    const [destination, setDestination] = useState<City | null>(null);
    const [departureTime, setDepartureTime] = useState("");
    const [seats, setSeats] = useState(3);
    const [price, setPrice] = useState(50);
    const [pickupLocation, setPickupLocation] = useState("");
    const [dropoffLocation, setDropoffLocation] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    // Recurring ride state (C-08)
    const [isRecurring, setIsRecurring] = useState(false);
    const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
    const [recurrenceEndDate, setRecurrenceEndDate] = useState("");

    const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

    useEffect(() => {
        fetchCities()
            .then(setCities)
            .catch(() => setError("Erreur de chargement des villes."));
    }, []);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!origin || !destination) {
            setError("Veuillez choisir une ville de depart et d'arrivee.");
            return;
        }

        setLoading(true);
        setError("");

        const body: Record<string, unknown> = {
            origin: origin.name,
            destination: destination.name,
            origin_lat: origin.lat,
            origin_lng: origin.lng,
            destination_lat: destination.lat,
            destination_lng: destination.lng,
            departure_time: new Date(departureTime).toISOString(),
            available_seats: seats,
            price_per_seat: price,
            is_recurring: isRecurring,
        };
        if (pickupLocation.trim())  body.pickup_location  = pickupLocation.trim();
        if (dropoffLocation.trim()) body.dropoff_location = dropoffLocation.trim();
        if (isRecurring && recurrenceDays.length > 0) {
            body.recurrence_days = recurrenceDays;
            if (recurrenceEndDate) body.recurrence_end_date = new Date(recurrenceEndDate).toISOString();
        }

        try {
            const res = await apiFetch("/rides/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.detail || "Erreur lors de la publication.");
            }

            const ride = await res.json();
            router.push(`/rides/${ride.id}`);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Erreur inconnue.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="app-shell">
            <div className="page-layer">
                <nav className="navbar">
                    <Link href="/" className="brand">
                        <span className="brand-badge">CM</span>
                        <span>Covoit Maroc</span>
                    </Link>
                    <div className="nav-links">
                        <Link href="/dashboard">Dashboard</Link>
                    </div>
                </nav>

                <div className="inner-page">
                    <Link href="/dashboard" className="page-back">
                        &larr; Dashboard
                    </Link>

                    <h1 className="page-title">Publier un trajet</h1>

                    <form onSubmit={handleSubmit}>
                        <CitySelect
                            label="Ville de depart"
                            cities={cities}
                            value={origin?.name ?? ""}
                            onChange={setOrigin}
                        />

                        <CitySelect
                            label="Ville d'arrivee"
                            cities={cities}
                            value={destination?.name ?? ""}
                            onChange={setDestination}
                        />

                        <div className="inner-field">
                            <label htmlFor="departureTime">Date et heure de depart</label>
                            <input
                                id="departureTime"
                                type="datetime-local"
                                value={departureTime}
                                onChange={(e) => setDepartureTime(e.target.value)}
                                required
                            />
                        </div>

                        <div className="two-col">
                            <div className="inner-field">
                                <label htmlFor="seats">Places disponibles</label>
                                <input
                                    id="seats"
                                    type="number"
                                    min={1}
                                    max={8}
                                    value={seats}
                                    onChange={(e) => setSeats(Number(e.target.value))}
                                />
                            </div>
                            <div className="inner-field">
                                <label htmlFor="price">Prix par place (MAD)</label>
                                <input
                                    id="price"
                                    type="number"
                                    min={1}
                                    value={price}
                                    onChange={(e) => setPrice(Number(e.target.value))}
                                />
                            </div>
                        </div>

                        <div className="two-col">
                            <div className="inner-field">
                                <label htmlFor="pickup">Point de prise en charge (optionnel)</label>
                                <input
                                    id="pickup"
                                    type="text"
                                    placeholder="Ex: Café Central, Gare Routière..."
                                    value={pickupLocation}
                                    onChange={(e) => setPickupLocation(e.target.value)}
                                />
                            </div>
                            <div className="inner-field">
                                <label htmlFor="dropoff">Point de dépose (optionnel)</label>
                                <input
                                    id="dropoff"
                                    type="text"
                                    placeholder="Ex: Centre-ville, Université..."
                                    value={dropoffLocation}
                                    onChange={(e) => setDropoffLocation(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Recurring ride (C-08) */}
                        <div className="inner-field">
                            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                                <input
                                    type="checkbox"
                                    checked={isRecurring}
                                    onChange={(e) => setIsRecurring(e.target.checked)}
                                />
                                <span>Trajet récurrent (se répète chaque semaine)</span>
                            </label>
                        </div>

                        {isRecurring && (
                            <>
                                <div className="inner-field">
                                    <label>Jours de répétition</label>
                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                                        {DAY_LABELS.map((label, i) => (
                                            <button
                                                key={i}
                                                type="button"
                                                onClick={() => setRecurrenceDays((prev) =>
                                                    prev.includes(i) ? prev.filter((d) => d !== i) : [...prev, i]
                                                )}
                                                style={{
                                                    padding: "6px 14px", borderRadius: 20, fontSize: 13, cursor: "pointer",
                                                    background: recurrenceDays.includes(i) ? "var(--blue)" : "rgba(255,255,255,0.07)",
                                                    color: recurrenceDays.includes(i) ? "#fff" : "var(--text-muted)",
                                                    border: `1px solid ${recurrenceDays.includes(i) ? "var(--blue)" : "var(--border-soft)"}`,
                                                }}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="inner-field">
                                    <label htmlFor="recurrenceEnd">Répéter jusqu&apos;au</label>
                                    <input
                                        id="recurrenceEnd"
                                        type="date"
                                        value={recurrenceEndDate}
                                        onChange={(e) => setRecurrenceEndDate(e.target.value)}
                                    />
                                </div>
                            </>
                        )}

                        {error && <p className="alert-error" style={{ marginBottom: "16px" }}>{error}</p>}

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn btn-primary btn-full"
                        >
                            {loading ? "Publication..." : isRecurring ? "Publier les trajets récurrents" : "Publier le trajet"}
                        </button>
                    </form>
                </div>
            </div>
        </main>
    );
}