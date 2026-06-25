"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";

const LiveMap = dynamic(() => import("@/components/LiveTrackingMap"), {
    ssr: false,
    loading: () => <div style={{ height: 400, display: "flex", alignItems: "center", justifyContent: "center", background: "#111" }}>Chargement de la carte…</div>,
});

interface Location {
    lat: number;
    lng: number;
    speed?: number | null;
    heading?: number | null;
}

interface RideInfo {
    id: string;
    origin: string;
    destination: string;
    departure_time: string;
    driver_name: string | null;
}

export default function PublicTrackingPage() {
    const { ride_id } = useParams<{ ride_id: string }>();
    const searchParams = useSearchParams();
    const shareToken = searchParams.get("token");

    const [location, setLocation] = useState<Location | null>(null);
    const [ride, setRide] = useState<RideInfo | null>(null);
    const [status, setStatus] = useState<"connecting" | "waiting" | "live" | "disconnected" | "error">("connecting");
    const wsRef = useRef<WebSocket | null>(null);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";
    const wsUrl = apiUrl.replace(/^http/, "ws");

    // Fetch ride info
    useEffect(() => {
        fetch(`${apiUrl}/rides/${ride_id}`)
            .then((r) => r.json())
            .then(setRide)
            .catch(() => null);
    }, [ride_id, apiUrl]);

    // Connect to WebSocket
    useEffect(() => {
        if (!ride_id) return;

        const params = new URLSearchParams({ role: "watcher" });
        if (shareToken) {
            params.set("share_token", shareToken);
        } else {
            const token = typeof window !== "undefined" ? sessionStorage.getItem("access_token") : null;
            if (token) params.set("token", token);
            else { setStatus("error"); return; }
        }

        const ws = new WebSocket(`${wsUrl}/ws/tracking/${ride_id}?${params}`);
        wsRef.current = ws;

        ws.onopen = () => setStatus("connecting");

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === "location") {
                setLocation({ lat: data.lat, lng: data.lng, speed: data.speed, heading: data.heading });
                setStatus("live");
            } else if (data.type === "waiting") {
                setStatus("waiting");
            } else if (data.type === "driver_disconnected") {
                setStatus("disconnected");
            }
        };

        ws.onclose = () => setStatus((s) => s === "live" ? "disconnected" : s);
        ws.onerror = () => setStatus("error");

        return () => { ws.close(); };
    }, [ride_id, shareToken, wsUrl]);

    const statusLabel = {
        connecting: "Connexion…",
        waiting: "En attente du conducteur…",
        live: "Suivi en direct",
        disconnected: "Conducteur déconnecté",
        error: "Lien invalide ou expiré",
    }[status];

    const statusColor = {
        connecting: "#f59e0b",
        waiting: "var(--blue)",
        live: "#22c55e",
        disconnected: "#ef4444",
        error: "#ef4444",
    }[status];

    return (
        <main style={{ minHeight: "100vh", background: "var(--bg-main)", color: "var(--text-main)", fontFamily: "system-ui, sans-serif" }}>
            <nav style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 24px", borderBottom: "1px solid var(--border-soft)" }}>
                <Link href="/" style={{ textDecoration: "none" }}>
                    <img src="/logo.png" alt="CovoMar" style={{ height: 44, width: "auto" }} />
                </Link>
                <span style={{ color: "var(--text-muted)", marginLeft: "auto", fontSize: 13 }}>Suivi de trajet</span>
            </nav>

            <div style={{ maxWidth: 700, margin: "0 auto", padding: "32px 16px" }}>
                {ride && (
                    <div style={{ marginBottom: 24 }}>
                        <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>
                            {ride.origin} → {ride.destination}
                        </h1>
                        {ride.driver_name && (
                            <p style={{ color: "var(--text-soft)", margin: 0, fontSize: 14 }}>Conducteur : {ride.driver_name}</p>
                        )}
                    </div>
                )}

                <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "12px 16px", borderRadius: 10,
                    background: "var(--bg-card-strong)", border: `1px solid ${statusColor}33`,
                    marginBottom: 20,
                }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
                    <span style={{ color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
                    {location?.speed != null && (
                        <span style={{ color: "var(--text-muted)", fontSize: 13, marginLeft: "auto" }}>{Math.round(location.speed)} km/h</span>
                    )}
                </div>

                <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid var(--border-soft)", height: 420 }}>
                    {location ? (
                        <LiveMap
                            lat={location.lat}
                            lng={location.lng}
                            origin={ride?.origin ?? ""}
                            destination={ride?.destination ?? ""}
                        />
                    ) : (
                        <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#111", color: "#666" }}>
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: 16, opacity: 0.4 }}>
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            <p style={{ margin: 0 }}>
                                {status === "error" ? "Impossible de se connecter. Vérifiez le lien." : "Position non disponible pour l'instant."}
                            </p>
                        </div>
                    )}
                </div>

                {status !== "error" && (
                    <p style={{ fontSize: 12, color: "#444", textAlign: "center", marginTop: 16 }}>
                        La position se met à jour automatiquement en temps réel.
                    </p>
                )}
            </div>
        </main>
    );
}
