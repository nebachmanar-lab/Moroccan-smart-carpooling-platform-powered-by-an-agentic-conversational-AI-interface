"use client";

import { MapContainer, TileLayer, Marker, Polyline, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const greenIcon = new L.Icon({
    iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
    shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

const redIcon = new L.Icon({
    iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
    shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface RideMapProps {
    originName: string;
    destinationName: string;
    originLat: number;
    originLng: number;
    destinationLat: number;
    destinationLng: number;
    pickupLocation?: string | null;
    dropoffLocation?: string | null;
}

export default function RideMap({
    originName, destinationName,
    originLat, originLng,
    destinationLat, destinationLng,
    pickupLocation, dropoffLocation,
}: RideMapProps) {
    const originPos: [number, number] = [originLat, originLng];
    const destinationPos: [number, number] = [destinationLat, destinationLng];
    const centerLat = (originLat + destinationLat) / 2;
    const centerLng = (originLng + destinationLng) / 2;
    const maxDiff = Math.max(Math.abs(originLat - destinationLat), Math.abs(originLng - destinationLng));
    const zoom = maxDiff > 5 ? 6 : maxDiff > 2 ? 7 : 9;

    const distKm = Math.round(haversineKm(originLat, originLng, destinationLat, destinationLng));
    const durationMin = Math.round((distKm / 100) * 60);
    const durationStr = durationMin >= 60
        ? `${Math.floor(durationMin / 60)}h${durationMin % 60 > 0 ? String(durationMin % 60).padStart(2, "0") : ""}`
        : `${durationMin} min`;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <MapContainer
                center={[centerLat, centerLng]}
                zoom={zoom}
                style={{ height: "360px", width: "100%", borderRadius: "12px" }}
                scrollWheelZoom={false}
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <Marker position={originPos} icon={greenIcon}>
                    <Popup>
                        <strong>Départ</strong><br />{originName}
                        {pickupLocation && <><br /><span style={{ color: "#f97316" }}>📍 {pickupLocation}</span></>}
                    </Popup>
                </Marker>
                <Marker position={destinationPos} icon={redIcon}>
                    <Popup>
                        <strong>Arrivée</strong><br />{destinationName}
                        {dropoffLocation && <><br /><span style={{ color: "#f97316" }}>📍 {dropoffLocation}</span></>}
                    </Popup>
                </Marker>
                <Polyline
                    positions={[originPos, destinationPos]}
                    pathOptions={{ color: "#3B82F6", weight: 3, dashArray: "6 4" }}
                />
            </MapContainer>

            {/* Distance + duration */}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "13px", color: "var(--text-muted)", background: "rgba(255,255,255,0.06)", border: "1px solid var(--border-soft)", borderRadius: "8px", padding: "5px 12px" }}>
                    📏 {distKm} km
                </span>
                <span style={{ fontSize: "13px", color: "var(--text-muted)", background: "rgba(255,255,255,0.06)", border: "1px solid var(--border-soft)", borderRadius: "8px", padding: "5px 12px" }}>
                    ⏱ ~{durationStr} de trajet
                </span>
                {pickupLocation && (
                    <span style={{ fontSize: "13px", color: "#f97316", background: "rgba(249,115,22,.1)", border: "1px solid rgba(249,115,22,.3)", borderRadius: "8px", padding: "5px 12px" }}>
                        📍 Rendez-vous : {pickupLocation}
                    </span>
                )}
                {dropoffLocation && (
                    <span style={{ fontSize: "13px", color: "#f97316", background: "rgba(249,115,22,.1)", border: "1px solid rgba(249,115,22,.3)", borderRadius: "8px", padding: "5px 12px" }}>
                        📍 Dépôt : {dropoffLocation}
                    </span>
                )}
            </div>

            <a
                href={`https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${destinationLat},${destinationLng}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: "12px", color: "#3b82f6", textDecoration: "none", alignSelf: "flex-end" }}
            >
                Ouvrir dans Google Maps →
            </a>
        </div>
    );
}
