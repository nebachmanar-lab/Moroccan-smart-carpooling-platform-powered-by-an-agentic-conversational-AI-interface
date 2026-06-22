"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import PaymentModal from "@/components/PaymentModal";
import { apiFetch } from "@/lib/api";

const LiveTracking = dynamic(() => import("@/components/LiveTracking"), { ssr: false });
const RideMap = dynamic(() => import("@/components/RideMap"), {
    ssr: false,
    loading: () => (
        <div style={{ height: "360px", borderRadius: "18px", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "14px" }}>
            Chargement de la carte...
        </div>
    ),
});

interface DriverPrefs {
    smoking_allowed: boolean;
    pets_allowed: boolean;
    music_allowed: boolean;
    talking_preference: string;
    luggage_size: string;
    air_conditioning: boolean;
    custom_note: string | null;
}

interface Ride {
    id: string;
    driver_id: string;
    origin: string;
    destination: string;
    origin_lat: number | null;
    origin_lng: number | null;
    destination_lat: number | null;
    destination_lng: number | null;
    departure_time: string;
    available_seats: number;
    price_per_seat: number;
    pickup_location: string | null;
    dropoff_location: string | null;
    status: string;
    driver_name: string | null;
    driver_avg_rating: number | null;
    driver_rating_count: number | null;
    driver_preferences: DriverPrefs | null;
}

interface MyBooking {
    id: string;
    status: string;
    seats_booked: number;
    total_price: number;
}

interface CurrentUser { id: string; first_name: string; last_name: string; role: string; }

const TALKING_LABELS: Record<string, string> = {
    quiet: "Calme",
    moderate: "Modéré",
    chatty: "Bavard",
    no_preference: "Sans préférence",
};

const LUGGAGE_LABELS: Record<string, string> = {
    small: "Sac à dos",
    medium: "Valise cabine",
    large: "Grande valise",
};

export default function RideDetailPage() {
    const params = useParams();
    const id = params?.id as string;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";

    const [ride, setRide] = useState<Ride | null>(null);
    const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
    const [myBooking, setMyBooking] = useState<MyBooking | null>(null);
    const [loading, setLoading] = useState(true);
    const [showPayment, setShowPayment] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [error, setError] = useState("");

    async function handleCancelBooking() {
        if (!myBooking || !confirm("Annuler votre réservation ?")) return;
        setCancelling(true);
        try {
            const res = await apiFetch(`/bookings/${myBooking.id}`, { method: "DELETE" });
            if (res.ok) setMyBooking(null);
        } finally {
            setCancelling(false);
        }
    }

    useEffect(() => {
        const token = localStorage.getItem("access_token");
        if (token) {
            apiFetch("/auth/me")
                .then((r) => r.ok ? r.json() : null)
                .then((u) => { if (u) setCurrentUser(u); });
        }
    }, []);

    useEffect(() => {
        if (!id) return;
        fetch(`${apiUrl}/rides/${id}`, { cache: "no-store" })
            .then((r) => r.json())
            .then((data) => {
                if (data.detail) setError(data.detail);
                else setRide(data);
            })
            .catch(() => setError("Impossible de charger ce trajet."))
            .finally(() => setLoading(false));
    }, [id, apiUrl]);

    // Check if current user already has a booking on this ride
    useEffect(() => {
        if (!id || !currentUser) return;
        apiFetch(`/bookings/ride/${id}`)
            .then((r) => r.ok ? r.json() : null)
            .then((b) => { if (b) setMyBooking(b); });
    }, [id, currentUser]);

    if (loading) return (
        <main className="app-shell"><div className="page-layer loading-page"><p>Chargement...</p></div></main>
    );

    if (error || !ride) return (
        <main className="app-shell"><div className="page-layer"><div className="inner-page">
            <p className="alert-error">{error || "Trajet introuvable."}</p>
            <Link href="/search" className="page-back" style={{ marginTop: "16px" }}>&larr; Retour à la recherche</Link>
        </div></div></main>
    );

    const isDriver = !!currentUser && ride.driver_id === currentUser.id;
    const hasMap = ride.origin_lat != null && ride.origin_lng != null && ride.destination_lat != null && ride.destination_lng != null;
    const p = ride.driver_preferences;

    const departureDate = new Date(ride.departure_time).toLocaleString("fr-MA", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
        hour: "2-digit", minute: "2-digit",
    });

    return (
        <main className="app-shell">
            <div className="page-layer">
                <nav className="navbar">
                    <Link href="/" className="brand">
                        <span className="brand-badge">CM</span>
                        <span>Covoit Maroc</span>
                    </Link>
                    <div className="nav-links">
                        <Link href="/search">Rechercher</Link>
                        <Link href="/dashboard">Dashboard</Link>
                    </div>
                </nav>

                <div className="inner-page">
                    <Link href="/search" className="page-back">&larr; Retour aux résultats</Link>

                    <h1 style={{ margin: "0 0 4px", fontSize: "clamp(24px,4vw,36px)", letterSpacing: "-0.05em" }}>
                        {ride.origin} &rarr; {ride.destination}
                    </h1>
                    <p style={{ color: "var(--text-muted)", marginBottom: "8px", textTransform: "capitalize" }}>
                        {departureDate}
                    </p>
                    {ride.driver_name && (
                        <p style={{ color: "var(--text-muted)", fontSize: "14px", marginBottom: "28px" }}>
                            Conducteur :{" "}
                            <Link href={`/drivers/${ride.driver_id}`} style={{ color: "var(--text-main)", fontWeight: 700, textDecoration: "underline", textUnderlineOffset: "3px" }}>
                                {ride.driver_name}
                            </Link>
                            {ride.driver_avg_rating != null && (
                                <span style={{ marginLeft: "10px", color: "#fbbf24" }}>
                                    ★ {ride.driver_avg_rating.toFixed(1)}
                                    {ride.driver_rating_count ? (
                                        <span style={{ color: "var(--text-muted)", fontSize: "12px" }}> ({ride.driver_rating_count} avis)</span>
                                    ) : null}
                                </span>
                            )}
                        </p>
                    )}

                    {/* Map */}
                    <div style={{ marginBottom: "24px" }}>
                        {hasMap ? (
                            <>
                                <RideMap
                                    originName={ride.origin}
                                    destinationName={ride.destination}
                                    originLat={ride.origin_lat!}
                                    originLng={ride.origin_lng!}
                                    destinationLat={ride.destination_lat!}
                                    destinationLng={ride.destination_lng!}
                                    pickupLocation={ride.pickup_location}
                                    dropoffLocation={ride.dropoff_location}
                                />
                            </>
                        ) : (
                            <div style={{ height: "80px", borderRadius: "18px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                                Carte non disponible
                            </div>
                        )}
                    </div>

                    {/* Live tracking */}
                    <LiveTracking
                        rideId={String(ride.id)}
                        role={isDriver ? "driver" : "watcher"}
                        driverName={isDriver ? undefined : (ride.driver_name ?? "Conducteur")}
                    />

                    {/* Info grid */}
                    <div className="info-grid">
                        <InfoCard label="Places disponibles" value={`${ride.available_seats} place(s)`} />
                        <InfoCard label="Prix par place" value={`${ride.price_per_seat} MAD`} />
                        <InfoCard label="Statut" value={ride.status} />
                        {ride.pickup_location && <InfoCard label="Point de départ" value={ride.pickup_location} />}
                        {ride.dropoff_location && <InfoCard label="Point d'arrivée" value={ride.dropoff_location} />}
                    </div>

                    {/* Driver preferences */}
                    {p && (
                        <div className="glass-card" style={{ padding: "20px", margin: "24px 0" }}>
                            <h3 style={{ margin: "0 0 16px", fontSize: "15px", fontWeight: 600 }}>
                                Préférences du conducteur
                            </h3>
                            <div className="ride-prefs-grid">
                                <PrefBadge label="Tabac" value={p.smoking_allowed} />
                                <PrefBadge label="Animaux" value={p.pets_allowed} />
                                <PrefBadge label="Musique" value={p.music_allowed} />
                                <PrefBadge label="Climatisation" value={p.air_conditioning} />
                                <div className="ride-pref-item">
                                    <span className="ride-pref-label">Ambiance</span>
                                    <span className="ride-pref-value">{TALKING_LABELS[p.talking_preference] ?? p.talking_preference}</span>
                                </div>
                                <div className="ride-pref-item">
                                    <span className="ride-pref-label">Bagages</span>
                                    <span className="ride-pref-value">{LUGGAGE_LABELS[p.luggage_size] ?? p.luggage_size}</span>
                                </div>
                            </div>
                            {p.custom_note && (
                                <p style={{ marginTop: "14px", fontSize: "13px", color: "var(--text-muted)", fontStyle: "italic", borderTop: "1px solid var(--border-soft)", paddingTop: "12px" }}>
                                    &ldquo;{p.custom_note}&rdquo;
                                </p>
                            )}
                        </div>
                    )}

                    {/* Navigation + tourist mode */}
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "20px 0 0" }}>
                        <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(ride.destination + ", Maroc")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-secondary btn-sm"
                        >
                            Naviguer vers {ride.destination}
                        </a>
                        <Link
                            href={`/tourist?origin=${encodeURIComponent(ride.origin)}&destination=${encodeURIComponent(ride.destination)}`}
                            className="btn btn-secondary btn-sm"
                        >
                            🗺 Explorer {ride.destination}
                        </Link>
                    </div>

                    {/* Tourist mode contextual banner */}
                    <Link
                        href={`/tourist?origin=${encodeURIComponent(ride.origin)}&destination=${encodeURIComponent(ride.destination)}`}
                        className="tourist-ride-banner"
                    >
                        <div className="tourist-ride-banner-icon">🏛</div>
                        <div>
                            <p className="tourist-ride-banner-title">Découvrez {ride.destination} en mode touristique</p>
                            <p className="tourist-ride-banner-sub">Monuments, restaurants, hébergements et sous-trajets autour de votre destination</p>
                        </div>
                        <span className="tourist-ride-banner-arrow">→</span>
                    </Link>

                    {/* Booking section */}
                    {isDriver ? (
                        <div className="booking-status-banner driver">
                            Vous êtes le conducteur de ce trajet.
                            <Link href="/dashboard" style={{ marginLeft: 12, fontSize: "13px", color: "var(--blue)" }}>
                                Gérer &rarr;
                            </Link>
                        </div>
                    ) : myBooking ? (
                        <div className={`booking-status-banner ${myBooking.status === "CONFIRMED" ? "confirmed" : "pending"}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                            <span>
                                {myBooking.status === "CONFIRMED"
                                    ? `Place réservée · ${myBooking.seats_booked} place(s) · ${myBooking.total_price} MAD`
                                    : `Réservation en attente de confirmation du conducteur`}
                            </span>
                            {ride.status === "ACTIVE" && (
                                <button
                                    onClick={handleCancelBooking}
                                    disabled={cancelling}
                                    className="btn btn-secondary btn-sm"
                                    style={{ flexShrink: 0, fontSize: "12px" }}
                                >
                                    {cancelling ? "…" : "Annuler"}
                                </button>
                            )}
                        </div>
                    ) : (
                        <button
                            onClick={() => setShowPayment(true)}
                            disabled={ride.available_seats === 0 || ride.status !== "ACTIVE"}
                            className="btn btn-primary btn-full"
                            style={{ marginTop: "8px" }}
                        >
                            {ride.available_seats === 0
                                ? "Complet"
                                : ride.status !== "ACTIVE"
                                ? "Trajet non disponible"
                                : `Réserver une place — ${ride.price_per_seat} MAD`}
                        </button>
                    )}
                </div>
            </div>

            {showPayment && (
                <PaymentModal
                    ride={ride}
                    onClose={() => setShowPayment(false)}
                    onSuccess={() => {
                        setShowPayment(false);
                        setMyBooking({ id: "pending", status: "PENDING", seats_booked: 1, total_price: ride.price_per_seat });
                    }}
                />
            )}
        </main>
    );
}

function InfoCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="info-card">
            <p className="info-card-label">{label}</p>
            <p className="info-card-value">{value}</p>
        </div>
    );
}

function PrefBadge({ label, value }: { label: string; value: boolean }) {
    return (
        <div className="ride-pref-item">
            <span className="ride-pref-label">{label}</span>
            <span className={`ride-pref-badge ${value ? "yes" : "no"}`}>{value ? "Oui" : "Non"}</span>
        </div>
    );
}
