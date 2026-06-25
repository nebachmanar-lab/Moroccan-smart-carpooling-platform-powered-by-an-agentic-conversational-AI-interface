"use client";

import { MapContainer, TileLayer, CircleMarker, Popup, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { CATEGORY_STYLE } from "@/lib/tourist-constants";
import type { POI } from "@/lib/tourist-constants";

interface Props {
    lat: number;
    lng: number;
    city: string;
    pois: POI[];
    height?: string;
}

const centerIcon = new L.DivIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:#C2410C;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
});

function ratingColor(r: number): string {
    if (r >= 8) return "#22c55e";
    if (r >= 6) return "#f59e0b";
    return "#ef4444";
}

// Re-fits the map view every time the POI list changes
function FitBounds({ pois, centerLat, centerLng }: { pois: POI[]; centerLat: number; centerLng: number }) {
    const map = useMap();
    useEffect(() => {
        const points: [number, number][] = [[centerLat, centerLng], ...pois.map(p => [p.lat, p.lng] as [number, number])];
        if (points.length === 1) {
            map.setView([centerLat, centerLng], 13);
        } else {
            map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15, animate: true });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pois]);
    return null;
}

export default function POIMap({ lat, lng, city, pois, height = "420px" }: Props) {
    return (
        <MapContainer
            key={`${lat}-${lng}`}
            center={[lat, lng]}
            zoom={13}
            style={{ height, width: "100%", borderRadius: "14px" }}
            scrollWheelZoom={false}
        >
            <TileLayer
                attribution='© <a href="https://openstreetmap.org">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <FitBounds pois={pois} centerLat={lat} centerLng={lng} />

            <Marker position={[lat, lng]} icon={centerIcon}>
                <Popup><strong>{city}</strong><br />Centre ville</Popup>
            </Marker>

            {pois.map((poi) => {
                const style = CATEGORY_STYLE[poi.category] ?? CATEGORY_STYLE.poi;
                return (
                    <CircleMarker
                        key={`${poi.category}-${poi.id}`}
                        center={[poi.lat, poi.lng]}
                        radius={7}
                        pathOptions={{
                            color:       poi.rating != null ? ratingColor(poi.rating) : style.color,
                            fillColor:   poi.rating != null ? ratingColor(poi.rating) : style.color,
                            fillOpacity: 0.85,
                            weight: 2,
                        }}
                    >
                        <Popup>
                            <strong>{poi.name}</strong><br />
                            <span style={{ color: style.color, fontWeight: 600 }}>
                                {poi.cat_name || style.label}
                            </span>
                            {poi.open_now === true  && <><br /><span style={{ color: "#22c55e" }}>● Ouvert</span></>}
                            {poi.open_now === false && <><br /><span style={{ color: "#ef4444" }}>● Fermé</span></>}
                            {poi.budget && <><br />Prix : <strong>{poi.budget}</strong></>}
                            {poi.hours_display && <><br />{poi.hours_display}</>}
                            {poi.website && (
                                <><br /><a href={poi.website} target="_blank" rel="noopener noreferrer">Site web</a></>
                            )}
                        </Popup>
                    </CircleMarker>
                );
            })}
        </MapContainer>
    );
}
