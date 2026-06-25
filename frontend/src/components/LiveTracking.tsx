"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
    rideId: string;
    role: "driver" | "watcher";
    driverName?: string;
}

interface Location {
    lat: number;
    lng: number;
    speed?: number;
    heading?: number;
}

const WS_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001")
    .replace(/^http/, "ws");

export default function LiveTracking({ rideId, role, driverName }: Props) {
    const [active, setActive] = useState(false);
    const [status, setStatus] = useState<"idle" | "connecting" | "live" | "waiting" | "error">("idle");
    const [driverLocation, setDriverLocation] = useState<Location | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const watchRef = useRef<number | null>(null);
    const mapRef = useRef<HTMLDivElement>(null);
    const leafletRef = useRef<{ map: L.Map; marker: L.Marker } | null>(null);

    const getToken = () => sessionStorage.getItem("access_token") || "";

    // Initialize Leaflet map
    useEffect(() => {
        if (!active || !mapRef.current || leafletRef.current) return;
        import("leaflet").then((L) => {
            const map = L.map(mapRef.current!, { zoomControl: true }).setView([33.5, -7.6], 7);
            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                attribution: "© OpenStreetMap",
            }).addTo(map);
            const icon = L.divIcon({
                className: "",
                html: `<div style="font-size:28px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))">🚗</div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 16],
            });
            const marker = L.marker([33.5, -7.6], { icon }).addTo(map);
            leafletRef.current = { map, marker };
        });
        return () => {
            leafletRef.current?.map.remove();
            leafletRef.current = null;
        };
    }, [active]);

    // Move marker when location updates
    useEffect(() => {
        if (!driverLocation || !leafletRef.current) return;
        const { map, marker } = leafletRef.current;
        const latlng: [number, number] = [driverLocation.lat, driverLocation.lng];
        marker.setLatLng(latlng);
        map.panTo(latlng, { animate: true, duration: 0.5 });
    }, [driverLocation]);

    const connect = () => {
        const token = getToken();
        if (!token) return;
        setStatus("connecting");
        const ws = new WebSocket(
            `${WS_BASE}/ws/tracking/${rideId}?role=${role}&token=${token}`
        );
        wsRef.current = ws;

        ws.onopen = () => setStatus(role === "driver" ? "live" : "waiting");

        ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.type === "location") {
                setDriverLocation({ lat: data.lat, lng: data.lng, speed: data.speed });
                setStatus("live");
            } else if (data.type === "waiting") {
                setStatus("waiting");
            } else if (data.type === "driver_disconnected") {
                setStatus("waiting");
                setDriverLocation(null);
            }
        };

        ws.onerror = () => setStatus("error");
        ws.onclose = () => {
            if (status !== "idle") setStatus("idle");
        };

        // Driver: start broadcasting GPS
        if (role === "driver") {
            watchRef.current = navigator.geolocation.watchPosition(
                (pos) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            lat: pos.coords.latitude,
                            lng: pos.coords.longitude,
                            speed: pos.coords.speed,
                            heading: pos.coords.heading,
                        }));
                    }
                },
                (err) => console.error("GPS error:", err),
                { enableHighAccuracy: true, maximumAge: 2000 }
            );
        }
    };

    const disconnect = () => {
        if (watchRef.current !== null) {
            navigator.geolocation.clearWatch(watchRef.current);
            watchRef.current = null;
        }
        wsRef.current?.close();
        wsRef.current = null;
        setStatus("idle");
        setDriverLocation(null);
        setActive(false);
    };

    const toggle = () => {
        if (active) {
            disconnect();
        } else {
            setActive(true);
            setTimeout(connect, 100);
        }
    };

    const statusLabel: Record<typeof status, string> = {
        idle: "",
        connecting: "Connexion…",
        live: role === "driver" ? "📡 Position partagée en direct" : `🚗 ${driverName || "Conducteur"} en route`,
        waiting: "⏳ En attente du conducteur…",
        error: "❌ Erreur de connexion",
    };

    return (
        <div className="live-tracking-card">
            <div className="live-tracking-header">
                <div>
                    <div className="live-tracking-title">
                        {role === "driver" ? "Partager ma position" : "Suivre le trajet en direct"}
                    </div>
                    {status !== "idle" && (
                        <div className={`live-tracking-status ${status}`}>
                            {statusLabel[status]}
                        </div>
                    )}
                </div>
                <button
                    className={`live-tracking-btn ${active ? "stop" : "start"}`}
                    onClick={toggle}
                >
                    {active ? "Arrêter" : role === "driver" ? "Partager" : "Suivre"}
                </button>
            </div>

            {active && (
                <div ref={mapRef} className="live-tracking-map" />
            )}

            {active && driverLocation && (
                <div className="live-tracking-coords">
                    {driverLocation.lat.toFixed(5)}, {driverLocation.lng.toFixed(5)}
                    {driverLocation.speed != null && ` · ${Math.round((driverLocation.speed || 0) * 3.6)} km/h`}
                </div>
            )}
        </div>
    );
}
