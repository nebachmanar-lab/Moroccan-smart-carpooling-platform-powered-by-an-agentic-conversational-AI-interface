"use client";

import { useEffect, useRef } from "react";

interface Props {
    lat: number;
    lng: number;
    origin: string;
    destination: string;
}

export default function LiveTrackingMap({ lat, lng, origin, destination }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<{ map: L.Map; marker: L.Marker } | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        import("leaflet").then((L) => {
            if (mapRef.current) {
                mapRef.current.marker.setLatLng([lat, lng]);
                mapRef.current.map.panTo([lat, lng]);
                return;
            }
            const map = L.map(containerRef.current!, { zoomControl: true }).setView([lat, lng], 13);
            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                attribution: "© OpenStreetMap contributors",
            }).addTo(map);
            const icon = L.divIcon({
                html: `<div style="background:#1A56DB;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 3px #1A56DB66;"></div>`,
                className: "",
                iconSize: [16, 16],
                iconAnchor: [8, 8],
            });
            const marker = L.marker([lat, lng], { icon }).addTo(map);
            marker.bindPopup(`Conducteur en route<br><small>${origin} → ${destination}</small>`).openPopup();
            mapRef.current = { map, marker };
        });
    }, [lat, lng, origin, destination]);

    return (
        <>
            <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
            <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
        </>
    );
}
