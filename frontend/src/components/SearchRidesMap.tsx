"use client";

import { useEffect, useRef } from "react";

interface RidePin {
    id: string;
    origin: string;
    destination: string;
    departure_time: string;
    available_seats: number;
    price_per_seat: number;
    origin_lat: number;
    origin_lng: number;
    destination_lat: number | null;
    destination_lng: number | null;
}

interface Props {
    rides: RidePin[];
}

export default function SearchRidesMap({ rides }: Props) {
    const mapRef = useRef<HTMLDivElement>(null);
    const leafletRef = useRef<{ map: L.Map; markers: L.Layer[] } | null>(null);

    useEffect(() => {
        if (!mapRef.current) return;

        import("leaflet").then((L) => {
            // Destroy previous instance
            if (leafletRef.current) {
                leafletRef.current.map.remove();
                leafletRef.current = null;
            }

            const map = L.map(mapRef.current!, { zoomControl: true }).setView([31.5, -7], 5);
            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                attribution: "© OpenStreetMap",
            }).addTo(map);

            const markers: L.Layer[] = [];
            const bounds: [number, number][] = [];

            const originIcon = L.divIcon({
                className: "",
                html: `<div style="
                    background:#5367ff;
                    border:2px solid #fff;
                    border-radius:50%;
                    width:14px;height:14px;
                    box-shadow:0 2px 6px rgba(0,0,0,.4);
                "></div>`,
                iconSize: [14, 14],
                iconAnchor: [7, 7],
            });

            const destIcon = L.divIcon({
                className: "",
                html: `<div style="
                    background:#32e6b2;
                    border:2px solid #fff;
                    border-radius:50%;
                    width:10px;height:10px;
                    box-shadow:0 2px 4px rgba(0,0,0,.3);
                "></div>`,
                iconSize: [10, 10],
                iconAnchor: [5, 5],
            });

            for (const r of rides) {
                if (!r.origin_lat || !r.origin_lng) continue;

                const dep = new Date(r.departure_time).toLocaleString("fr-MA", {
                    weekday: "short", day: "numeric", month: "short",
                    hour: "2-digit", minute: "2-digit",
                });

                const popupHtml = `
                    <div style="font-family:sans-serif;min-width:180px;">
                        <p style="font-weight:700;font-size:14px;margin:0 0 4px">
                            ${r.origin} → ${r.destination}
                        </p>
                        <p style="font-size:12px;color:#555;margin:0 0 2px">${dep}</p>
                        <p style="font-size:12px;color:#555;margin:0 0 8px">
                            ${r.available_seats} place(s) · <strong>${r.price_per_seat} MAD</strong>
                        </p>
                        <a href="/rides/${r.id}"
                            style="background:#5367ff;color:#fff;padding:5px 12px;border-radius:6px;font-size:12px;text-decoration:none;font-weight:600;">
                            Voir &amp; réserver
                        </a>
                    </div>
                `;

                const originMarker = L.marker([r.origin_lat, r.origin_lng], { icon: originIcon })
                    .bindPopup(popupHtml, { maxWidth: 240 })
                    .addTo(map);
                markers.push(originMarker);
                bounds.push([r.origin_lat, r.origin_lng]);

                if (r.destination_lat && r.destination_lng) {
                    const destMarker = L.marker([r.destination_lat, r.destination_lng], { icon: destIcon })
                        .addTo(map);
                    markers.push(destMarker);
                    bounds.push([r.destination_lat, r.destination_lng]);

                    // Draw a line between origin and destination
                    const line = L.polyline(
                        [[r.origin_lat, r.origin_lng], [r.destination_lat, r.destination_lng]],
                        { color: "#5367ff", weight: 2, opacity: 0.5, dashArray: "6 4" }
                    ).addTo(map);
                    markers.push(line);
                }
            }

            if (bounds.length > 0) {
                map.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [40, 40] });
            }

            leafletRef.current = { map, markers };
        });

        return () => {
            leafletRef.current?.map.remove();
            leafletRef.current = null;
        };
    }, [rides]);

    return (
        <div style={{ position: "relative" }}>
            <div ref={mapRef} style={{
                width: "100%",
                height: "380px",
                borderRadius: "14px",
                overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.1)",
            }} />
            <div style={{
                position: "absolute",
                bottom: "12px",
                left: "12px",
                display: "flex",
                gap: "10px",
                fontSize: "11px",
                color: "#fff",
                pointerEvents: "none",
            }}>
                <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                    <span style={{
                        display: "inline-block", width: "10px", height: "10px",
                        background: "#5367ff", borderRadius: "50%", border: "2px solid #fff",
                    }} />
                    Départ
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                    <span style={{
                        display: "inline-block", width: "8px", height: "8px",
                        background: "#32e6b2", borderRadius: "50%", border: "2px solid #fff",
                    }} />
                    Arrivée
                </span>
            </div>
        </div>
    );
}
