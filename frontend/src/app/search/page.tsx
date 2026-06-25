"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

interface Ride {
    id: string;
    origin: string;
    destination: string;
    departure_time: string;
    available_seats: number;
    price_per_seat: number;
    driver_name: string | null;
    driver_avg_rating: number | null;
    driver_rating_count: number | null;
    is_recurring?: boolean;
}

function SearchContent() {
    const router = useRouter();
    const params = useSearchParams();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";

    const [origin, setOrigin] = useState(params.get("origin") ?? "");
    const [destination, setDestination] = useState(params.get("destination") ?? "");
    const [date, setDate] = useState("");
    const [maxPrice, setMaxPrice] = useState("");
    const [minSeats, setMinSeats] = useState("");
    const [rides, setRides] = useState<Ride[]>([]);
    const [searched, setSearched] = useState(false);
    const [loading, setLoading] = useState(false);
    const [alertSaving, setAlertSaving] = useState(false);
    const [alertSaved, setAlertSaved] = useState(false);

    async function handleCreateAlert() {
        if (!origin || !destination) return;
        setAlertSaving(true);
        try {
            const token = sessionStorage.getItem("access_token");
            if (!token) { router.push("/login"); return; }
            const res = await fetch(`${apiUrl}/alerts`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ origin, destination }),
            });
            if (res.ok || res.status === 409) setAlertSaved(true);
        } finally {
            setAlertSaving(false);
        }
    }

    // Auto-search when arriving from destination guide CTA
    useEffect(() => {
        const dest = params.get("destination");
        if (dest) { setDestination(dest); }
    }, [params]);

    async function handleSearch(e: { preventDefault(): void }) {
        e.preventDefault();
        if (!origin || !destination) return;
        setLoading(true);
        setSearched(false);
        const qs = new URLSearchParams({ origin, destination });
        if (date) qs.set("date", date);
        try {
            const res = await fetch(`${apiUrl}/rides?${qs}`);
            const raw: Ride[] = await res.json();
            const data = Array.isArray(raw) ? raw : [];
            setRides(data.filter((r) => {
                if (minSeats && r.available_seats < +minSeats) return false;
                if (maxPrice && r.price_per_seat > +maxPrice) return false;
                return true;
            }));
        } catch {
            setRides([]);
        } finally {
            setSearched(true);
            setLoading(false);
        }
    }

    return (
        <main className="app-shell">
            <div className="page-layer">
                <nav className="navbar">
                    <Link href="/" className="brand">
                        <img src="/logo.png" alt="CovoMar" style={{height:"44px",width:"auto"}} onError={(e)=>{(e.target as HTMLImageElement).style.display="none";(e.target as HTMLImageElement).nextElementSibling!.setAttribute("style","display:inline")}} /><span style={{display:"none",fontWeight:900,fontSize:22}}>CovoMar</span>
                    </Link>
                    <div className="nav-links">
                        <Link href="/dashboard">Dashboard</Link>
                        <Link href="/agent">Mode IA</Link>
                    </div>
                </nav>

                <div className="inner-page">
                    <Link href="/dashboard" className="page-back">&larr; Dashboard</Link>
                    <h1 style={{ margin: "0 0 24px", fontSize: "clamp(24px,4vw,36px)", letterSpacing: "-.05em" }}>
                        Trouver un <span className="pink-text">trajet</span>
                    </h1>

                    <form onSubmit={handleSearch} className="glass-card" style={{ padding: "24px", marginBottom: "24px", display: "flex", flexDirection: "column", gap: "14px" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                            <div>
                                <label style={{ display: "block", fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px", fontWeight: 600 }}>Départ</label>
                                <input
                                    className="input"
                                    type="text"
                                    placeholder="Ex: Casablanca"
                                    value={origin}
                                    onChange={(e) => setOrigin(e.target.value)}
                                    required
                                />
                            </div>
                            <div>
                                <label style={{ display: "block", fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px", fontWeight: 600 }}>Arrivée</label>
                                <input
                                    className="input"
                                    type="text"
                                    placeholder="Ex: Marrakech"
                                    value={destination}
                                    onChange={(e) => setDestination(e.target.value)}
                                    required
                                />
                            </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                            <div>
                                <label style={{ display: "block", fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px", fontWeight: 600 }}>Date</label>
                                <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                            </div>
                            <div>
                                <label style={{ display: "block", fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px", fontWeight: 600 }}>Places min.</label>
                                <input className="input" type="number" min={1} max={8} placeholder="1" value={minSeats} onChange={(e) => setMinSeats(e.target.value)} />
                            </div>
                            <div>
                                <label style={{ display: "block", fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px", fontWeight: 600 }}>Prix max (MAD)</label>
                                <input className="input" type="number" min={0} placeholder="Ex: 150" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
                            </div>
                        </div>
                        <div style={{ display: "flex", gap: "10px" }}>
                            <button type="submit" className="btn btn-primary" disabled={loading || !origin || !destination} style={{ flex: 1 }}>
                                {loading ? "Recherche..." : "Rechercher"}
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{ whiteSpace: "nowrap" }}
                                onClick={() => {
                                    const params = new URLSearchParams();
                                    if (origin) params.set("origin", origin);
                                    if (destination) params.set("destination", destination);
                                    if (date) params.set("date", date);
                                    router.push(`/agent?${params.toString()}`);
                                }}
                            >
                                Essayer le mode IA
                            </button>
                        </div>
                    </form>

                    {searched && (
                        rides.length === 0 ? (
                            <div className="empty-state">
                                <p style={{ fontWeight: 700 }}>Aucun trajet trouvé.</p>
                                <p style={{ marginTop: 8, fontSize: "14px", color: "var(--text-muted)" }}>Essayez une autre date ou ajustez les filtres.</p>
                                {!alertSaved ? (
                                    <button
                                        onClick={handleCreateAlert}
                                        disabled={alertSaving}
                                        className="btn btn-secondary btn-sm"
                                        style={{ marginTop: 16 }}
                                    >
                                        {alertSaving ? "Enregistrement…" : "🔔 M'alerter quand un trajet est disponible"}
                                    </button>
                                ) : (
                                    <p style={{ marginTop: 16, fontSize: "13px", color: "#22c55e", fontWeight: 600 }}>
                                        ✓ Alerte créée — vous serez notifié par email dès qu'un trajet {origin} → {destination} est publié.
                                    </p>
                                )}
                            </div>
                        ) : (
                            <div>
                                <p style={{ color: "var(--text-muted)", fontSize: "13px", marginBottom: "14px" }}>
                                    {rides.length} trajet(s) trouvé(s)
                                </p>
                                <div className="ride-list">
                                    {rides.map((r) => <RideCard key={r.id} ride={r} />)}
                                </div>
                            </div>
                        )
                    )}

                    {/* Tourist mode suggestion — shown whenever destination is filled */}
                    {destination && (
                        <Link
                            href={`/tourist?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`}
                            className="tourist-ride-banner"
                            style={{ marginTop: searched ? "24px" : "8px" }}
                        >
                            <div className="tourist-ride-banner-icon">🏛</div>
                            <div>
                                <p className="tourist-ride-banner-title">Que faire à {destination} ?</p>
                                <p className="tourist-ride-banner-sub">Monuments, restaurants, hébergements · Mode touristique</p>
                            </div>
                            <span className="tourist-ride-banner-arrow">→</span>
                        </Link>
                    )}
                </div>
            </div>
        </main>
    );
}

function RideCard({ ride }: { ride: Ride }) {
    const date = new Date(ride.departure_time).toLocaleString("fr-MA", {
        weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    return (
        <Link href={`/rides/${ride.id}`} className="ride-card">
            <div>
                <p className="ride-card-title">{ride.origin} &rarr; {ride.destination}</p>
                <p className="ride-card-meta">
                    {date}
                    {ride.driver_name && ` · ${ride.driver_name}`}
                    {ride.driver_avg_rating != null && (
                        <span style={{ color: "#fbbf24", marginLeft: 6 }}>
                            ★ {ride.driver_avg_rating.toFixed(1)}
                            {ride.driver_rating_count ? <span style={{ color: "var(--text-muted)", fontSize: "11px" }}> ({ride.driver_rating_count})</span> : null}
                        </span>
                    )}
                </p>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
                <p className="ride-card-price">{ride.price_per_seat} MAD</p>
                <span className="badge">{ride.available_seats} place(s)</span>
                {ride.is_recurring && (
                    <span style={{ display: "block", marginTop: 4, fontSize: 11, padding: "2px 7px", borderRadius: 10,
                        background: "rgba(99,102,241,.18)", color: "#818cf8", fontWeight: 600 }}>
                        ↻ Récurrent
                    </span>
                )}
            </div>
        </Link>
    );
}

export default function SearchPage() {
    return (
        <Suspense>
            <SearchContent />
        </Suspense>
    );
}
