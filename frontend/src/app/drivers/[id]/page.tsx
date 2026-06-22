"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface DriverProfile {
    id: string;
    first_name: string;
    last_name: string;
    avg_rating: number | null;
    rating_count: number;
}

interface Review {
    id: string;
    stars: number;
    comment: string | null;
    created_at: string;
}

interface Ride {
    id: string;
    driver_id: string;
    origin: string;
    destination: string;
    departure_time: string;
    available_seats: number;
    price_per_seat: number;
    driver_name?: string;
}

interface Prefs {
    smoking_allowed: boolean;
    pets_allowed: boolean;
    music_allowed: boolean;
    air_conditioning: boolean;
    talking_preference: string;
    luggage_size: string;
    custom_note: string | null;
}

const TALKING: Record<string, string> = { quiet: "Calme", moderate: "Modéré", chatty: "Bavard", no_preference: "Sans préférence" };
const LUGGAGE: Record<string, string> = { small: "Sac à dos", medium: "Valise cabine", large: "Grande valise" };

export default function DriverProfilePage() {
    const { id } = useParams<{ id: string }>();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";

    const [profile, setProfile] = useState<DriverProfile | null>(null);
    const [reviews, setReviews] = useState<Review[]>([]);
    const [rides, setRides] = useState<Ride[]>([]);
    const [prefs, setPrefs] = useState<Prefs | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [reportSent, setReportSent] = useState(false);

    async function handleReport() {
        const token = localStorage.getItem("access_token");
        if (!token) { alert("Connectez-vous pour signaler ce conducteur."); return; }
        const reason = prompt("Raison du signalement :");
        if (!reason?.trim()) return;
        const res = await fetch(`${apiUrl}/reports`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ target_type: "user", target_id: id, reason: reason.trim() }),
        });
        if (res.ok || res.status === 409) setReportSent(true);
    }

    useEffect(() => {
        async function load() {
            try {
                const [ratingsRes, ridesRes, prefsRes] = await Promise.all([
                    fetch(`${apiUrl}/ratings/driver/${id}`),
                    fetch(`${apiUrl}/rides?origin=&destination=`),
                    fetch(`${apiUrl}/preferences/driver/${id}`),
                ]);

                // Ratings
                if (ratingsRes.ok) {
                    const data = await ratingsRes.json();
                    setReviews(Array.isArray(data.reviews) ? data.reviews : []);
                    setProfile({
                        id,
                        first_name: "",
                        last_name: "",
                        avg_rating: data.avg_stars ?? null,
                        rating_count: data.total_reviews ?? 0,
                    });
                }

                // Rides (driver_id is in RideResponse)
                if (ridesRes.ok) {
                    const allRides: Ride[] = await ridesRes.json();
                    const driverRides = allRides.filter((r) => r.driver_id === id);
                    setRides(driverRides);
                    // Extract driver name from first ride
                    const nameFromRide = driverRides[0]?.driver_name ?? "";
                    if (nameFromRide) {
                        const parts = nameFromRide.split(" ");
                        setProfile((prev) => prev ? {
                            ...prev,
                            first_name: parts[0] ?? "",
                            last_name: parts.slice(1).join(" "),
                        } : prev);
                    }
                }

                // Preferences (may 404 if not set)
                if (prefsRes.ok) {
                    setPrefs(await prefsRes.json());
                }
            } catch {
                setError("Impossible de charger le profil.");
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [id, apiUrl]);

    function Stars({ n }: { n: number }) {
        return (
            <span style={{ color: "#fbbf24" }}>
                {Array.from({ length: 5 }, (_, i) => (
                    <span key={i} style={{ opacity: i < n ? 1 : 0.25 }}>★</span>
                ))}
            </span>
        );
    }

    if (loading) return <main className="app-shell"><div className="page-layer loading-page"><p>Chargement...</p></div></main>;
    if (error || !profile) return (
        <main className="app-shell"><div className="page-layer"><div className="inner-page">
            <p className="alert-error">{error || "Profil introuvable."}</p>
            <Link href="/dashboard" className="page-back">&larr; Retour</Link>
        </div></div></main>
    );

    const fullName = `${profile.first_name} ${profile.last_name}`.trim() || "Conducteur";

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
                        <Link href="/search">Rechercher</Link>
                    </div>
                </nav>

                <div className="inner-page">
                    <Link href="/search" className="page-back">&larr; Retour</Link>

                    {/* Driver card */}
                    <div className="glass-card" style={{ padding: "28px", marginBottom: "24px", display: "flex", alignItems: "center", gap: "20px" }}>
                        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg,#6366f1,#ec4899)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                            {fullName[0]?.toUpperCase() ?? "?"}
                        </div>
                        <div style={{ flex: 1 }}>
                            <h1 style={{ margin: 0, fontSize: "clamp(20px,3vw,28px)", letterSpacing: "-.04em" }}>{fullName}</h1>
                            <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 10 }}>
                                {profile.avg_rating != null ? (
                                    <>
                                        <Stars n={Math.round(profile.avg_rating)} />
                                        <span style={{ fontWeight: 700 }}>{profile.avg_rating.toFixed(1)}</span>
                                        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>({profile.rating_count} avis)</span>
                                    </>
                                ) : (
                                    <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Aucun avis pour le moment</span>
                                )}
                            </div>
                        </div>
                        {/* ADM-01: report driver */}
                        <div style={{ flexShrink: 0, textAlign: "right" }}>
                            {reportSent ? (
                                <span style={{ fontSize: 12, color: "#22c55e" }}>✓ Signalement envoyé</span>
                            ) : (
                                <button
                                    onClick={handleReport}
                                    style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
                                >
                                    Signaler ce conducteur
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Preferences */}
                    {prefs && (
                        <div className="glass-card" style={{ padding: "24px", marginBottom: "24px" }}>
                            <h2 style={{ margin: "0 0 16px", fontSize: 16, letterSpacing: "-.03em" }}>Préférences du conducteur</h2>
                            <div className="ride-prefs-grid">
                                {[
                                    { label: "Tabac", value: prefs.smoking_allowed },
                                    { label: "Animaux", value: prefs.pets_allowed },
                                    { label: "Musique", value: prefs.music_allowed },
                                    { label: "Climatisation", value: prefs.air_conditioning },
                                ].map(({ label, value }) => (
                                    <div key={label} className="ride-pref-item">
                                        <span className="ride-pref-label">{label}</span>
                                        <span className={`ride-pref-badge ${value ? "yes" : "no"}`}>{value ? "Oui" : "Non"}</span>
                                    </div>
                                ))}
                                <div className="ride-pref-item">
                                    <span className="ride-pref-label">Ambiance</span>
                                    <span className="ride-pref-value">{TALKING[prefs.talking_preference] ?? prefs.talking_preference}</span>
                                </div>
                                <div className="ride-pref-item">
                                    <span className="ride-pref-label">Bagages</span>
                                    <span className="ride-pref-value">{LUGGAGE[prefs.luggage_size] ?? prefs.luggage_size}</span>
                                </div>
                            </div>
                            {prefs.custom_note && (
                                <p style={{ marginTop: 14, fontSize: 13, color: "var(--text-muted)", fontStyle: "italic", borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
                                    &ldquo;{prefs.custom_note}&rdquo;
                                </p>
                            )}
                        </div>
                    )}

                    {/* Active rides */}
                    {rides.length > 0 && (
                        <div className="glass-card" style={{ padding: "24px", marginBottom: "24px" }}>
                            <h2 style={{ margin: "0 0 16px", fontSize: 16, letterSpacing: "-.03em" }}>Trajets disponibles</h2>
                            <div className="ride-list">
                                {rides.map((r) => {
                                    const date = new Date(r.departure_time).toLocaleString("fr-MA", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
                                    return (
                                        <Link key={r.id} href={`/rides/${r.id}`} className="ride-card">
                                            <div>
                                                <p className="ride-card-title">{r.origin} &rarr; {r.destination}</p>
                                                <p className="ride-card-meta">{date} · {r.available_seats} place(s)</p>
                                            </div>
                                            <p className="ride-card-price">{r.price_per_seat} MAD</p>
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Reviews */}
                    <div className="glass-card" style={{ padding: "24px" }}>
                        <h2 style={{ margin: "0 0 16px", fontSize: 16, letterSpacing: "-.03em" }}>Avis ({reviews.length})</h2>
                        {reviews.length === 0 ? (
                            <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Aucun avis pour le moment.</p>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                                {reviews.map((r) => (
                                    <div key={r.id} style={{ padding: "14px 16px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                            <Stars n={r.stars} />
                                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{new Date(r.created_at).toLocaleDateString("fr-MA")}</span>
                                        </div>
                                        {r.comment && <p style={{ margin: 0, fontSize: 14, color: "var(--text-soft)" }}>{r.comment}</p>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
}
