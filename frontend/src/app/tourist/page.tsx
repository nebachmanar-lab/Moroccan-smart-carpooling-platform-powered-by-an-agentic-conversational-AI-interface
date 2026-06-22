"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { CATEGORY_STYLE } from "@/lib/tourist-constants";
import type { POI } from "@/lib/tourist-constants";

const POIMap = dynamic(() => import("@/components/POIMap"), {
    ssr: false,
    loading: () => <div className="poi-map-skeleton">Chargement de la carte...</div>,
});

// ── Types ──────────────────────────────────────────────────────────────────────

interface ExploreData {
    lat: number;
    lng: number;
    source: "foursquare" | "osm";
    pois: POI[];
    restaurants: POI[];
    accommodations: POI[];
}

interface Guide {
    city: string;
    description: string;
    highlights: string[];
    food: string[];
    accommodation: string[];
    tips: string[];
    best_time: string;
    language: string;
}

type Tab = "carte" | "monuments" | "restaurants" | "hebergements" | "guide";

const TABS: { id: Tab; label: string }[] = [
    { id: "carte",        label: "Carte & POI" },
    { id: "monuments",    label: "Monuments" },
    { id: "restaurants",  label: "Restaurants" },
    { id: "hebergements", label: "Hébergements" },
    { id: "guide",        label: "Guide IA" },
];

const CUISINE_FILTERS = ["Tous", "Marocaine", "Internationale", "Café / Snack", "Fast-food"];
const BUDGET_FILTERS  = ["Tous", "€", "€€", "€€€"];
const ACCOM_TYPES     = ["Tous", "Hôtel", "Riad / Maison d'hôtes", "Auberge"];

const MONUMENT_TYPES  = ["Tous", "Musée", "Mosquée", "Monument", "Historic", "Arts"];
const MONUMENT_MAP: Record<string, string[]> = {
    "Musée":     ["museum"],
    "Mosquée":   ["mosque", "prayer"],
    "Monument":  ["monument", "landmark", "palace", "castle", "fort", "medina", "kasbah"],
    "Historic":  ["historic", "heritage", "ruins", "archaeological"],
    "Arts":      ["art", "gallery", "theatre", "cinema"],
};

const CUISINE_MAP: Record<string, string[]> = {
    "Marocaine":      ["moroccan", "regional", "traditional", "maghrebi"],
    "Internationale": ["french", "italian", "international", "asian", "american", "spanish", "turkish"],
    "Café / Snack":   ["caf", "coffee", "sandwich", "snack", "tea"],  // "caf" matches both cafe and café
    "Fast-food":      ["fast", "burger", "pizza", "hotdog"],
};

const ACCOM_TAG_MAP: Record<string, string> = {
    "Hôtel":                 "hotel",
    "Riad / Maison d'hôtes": "guest_house",
    "Auberge":               "hostel",
};

const ACCOM_LABEL: Record<string, string> = {
    hotel: "Hôtel", hostel: "Auberge de jeunesse",
    guest_house: "Maison d'hôtes / Riad", motel: "Motel", apartment: "Appartement",
};

// ── Browser-side Overpass API ─────────────────────────────────────────────────
// Calls are made from the browser to avoid backend network restrictions.

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

interface OsmElement {
    id: number;
    type: string;
    lat?: number;
    lon?: number;
    center?: { lat: number; lon: number };
    tags?: Record<string, string>;
}

async function overpassFetch(query: string): Promise<OsmElement[]> {
    try {
        const res = await fetch(OVERPASS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `data=${encodeURIComponent(query)}`,
        });
        if (!res.ok) return [];
        const json = await res.json();
        return json.elements || [];
    } catch {
        return [];
    }
}

function cleanEls(
    elements: OsmElement[],
    category: POI["category"],
    enrich?: (item: POI, tags: Record<string, string>) => void
): POI[] {
    const result: POI[] = [];
    for (const el of elements) {
        const tags = el.tags || {};
        const name = tags.name || tags["name:fr"] || tags["name:ar"];
        if (!name) continue;
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (lat == null || lng == null) continue;
        const item: POI = {
            id: el.id,
            name,
            lat,
            lng,
            category,
            tags: {
                cuisine:       tags.cuisine || "",
                stars:         tags.stars || "",
                tourism:       tags.tourism || "",
                historic:      tags.historic || "",
                amenity:       tags.amenity || "",
                opening_hours: tags.opening_hours || "",
            },
        };
        if (enrich) enrich(item, tags);
        result.push(item);
    }
    return result.slice(0, 50);
}

function estimateBudget(cuisine: string, amenity: string): string {
    const cl = cuisine.toLowerCase();
    if (amenity === "fast_food" || ["burger", "pizza", "sandwich", "hotdog"].some(k => cl.includes(k))) return "€";
    if (["french", "italian", "international", "seafood", "sushi"].some(k => cl.includes(k))) return "€€€";
    return "€€";
}

function accomPrice(tourismType: string, stars: string): string {
    if (tourismType === "hostel")     return "80 – 200 MAD/nuit";
    if (tourismType === "guest_house") return "250 – 700 MAD/nuit";
    if (tourismType === "motel")       return "150 – 350 MAD/nuit";
    if (tourismType === "apartment")   return "300 – 800 MAD/nuit";
    const n = parseInt(stars, 10);
    if (!isNaN(n)) {
        if (n <= 2) return "150 – 350 MAD/nuit";
        if (n === 3) return "350 – 700 MAD/nuit";
        if (n === 4) return "700 – 1 500 MAD/nuit";
        return "1 500+ MAD/nuit";
    }
    return "200 – 600 MAD/nuit";
}

async function fetchAllPOIs(lat: number, lng: number): Promise<Pick<ExploreData, "pois" | "restaurants" | "accommodations">> {
    const [poisEls, restEls, accomEls] = await Promise.all([
        overpassFetch(`[out:json][timeout:25];
(
  node["tourism"~"monument|attraction|viewpoint|museum|artwork|gallery"](around:5000,${lat},${lng});
  node["historic"~"monument|ruins|castle|mosque|palace|fort"](around:5000,${lat},${lng});
  node["amenity"~"place_of_worship|arts_centre|theatre|cinema"](around:5000,${lat},${lng});
  way["tourism"~"monument|attraction|museum"](around:5000,${lat},${lng});
  way["historic"](around:5000,${lat},${lng});
);
out center body;`),
        overpassFetch(`[out:json][timeout:25];
(
  node["amenity"~"restaurant|cafe|fast_food|food_court"](around:3000,${lat},${lng});
);
out body;`),
        overpassFetch(`[out:json][timeout:25];
(
  node["tourism"~"hotel|hostel|guest_house|motel|apartment"](around:5000,${lat},${lng});
  way["tourism"~"hotel|hostel|guest_house|motel"](around:5000,${lat},${lng});
);
out center body;`),
    ]);

    return {
        pois: cleanEls(poisEls, "poi"),
        restaurants: cleanEls(restEls, "restaurant", (item, tags) => {
            item.budget = estimateBudget(tags.cuisine || "", tags.amenity || "");
        }),
        accommodations: cleanEls(accomEls, "accommodation", (item, tags) => {
            const t = tags.tourism || "hotel";
            item.price_range = accomPrice(t, tags.stars || "");
            item.type_label  = ACCOM_LABEL[t] || "Hébergement";
            item.stars       = tags.stars || "";
        }),
    };
}

// ── Page ───────────────────────────────────────────────────────────────────────

function TouristPageInner() {
    const apiUrl   = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";
    const params   = useSearchParams();

    // Inputs — pre-filled from URL params (?origin=...&destination=...)
    const [originInput, setOriginInput] = useState(params.get("origin") ?? "");
    const [destInput,   setDestInput]   = useState(params.get("destination") ?? "");

    // Confirmed trip
    const [origin, setOrigin] = useState<string>("");
    const [city,   setCity]   = useState<string | null>(null);

    // Data
    const [exploreData,    setExploreData]    = useState<ExploreData | null>(null);
    const [exploreLoading, setExploreLoading] = useState(false);
    const [exploreError,   setExploreError]   = useState("");
    const [guide,          setGuide]          = useState<Guide | null>(null);
    const [guideLoading,   setGuideLoading]   = useState(false);

    // UI
    const [activeTab, setActiveTab] = useState<Tab>("carte");

    // Filters
    const [monumentFilter, setMonumentFilter] = useState("Tous");
    const [cuisineFilter,  setCuisineFilter]  = useState("Tous");
    const [budgetFilter,   setBudgetFilter]   = useState("Tous");
    const [accomFilter,    setAccomFilter]    = useState("Tous");
    const [showCat, setShowCat] = useState<Set<string>>(new Set(["poi", "restaurant", "accommodation"]));

    // ── Select trip (origin optional, destination required) ──────────────────────

    const selectTrip = useCallback(async (dest: string, org: string = "") => {
        const destination = dest.trim();
        if (!destination) return;

        setCity(destination);
        setOrigin(org.trim());
        setExploreData(null);
        setGuide(null);
        setExploreError("");
        setActiveTab("carte");
        setExploreLoading(true);

        try {
            // Backend geocodes + optionally calls Foursquare if API key is set
            const res = await fetch(`${apiUrl}/tourist/explore/${encodeURIComponent(destination)}`);
            if (!res.ok) throw new Error("Ville introuvable");
            const data = await res.json();

            if (data.source === "foursquare") {
                // Rich Foursquare data — use directly
                setExploreData(data as ExploreData);
            } else {
                // No Foursquare key — fetch POIs from Overpass directly in the browser
                const poiData = await fetchAllPOIs(data.lat, data.lng);
                setExploreData({ lat: data.lat, lng: data.lng, source: "osm", ...poiData });
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Erreur";
            setExploreError(`${msg}. Essayez l'onglet Guide IA.`);
        } finally {
            setExploreLoading(false);
        }
    }, [apiUrl]);

    // ── Load guide on demand ─────────────────────────────────────────────────────

    const loadGuide = useCallback(async () => {
        if (guide || guideLoading || !city) return;
        setGuideLoading(true);
        try {
            const res = await fetch(`${apiUrl}/tourist/guide/${encodeURIComponent(city)}`);
            const d = await res.json();
            if (d.city) setGuide(d);
        } catch {}
        finally { setGuideLoading(false); }
    }, [guide, guideLoading, city, apiUrl]);

    useEffect(() => {
        if (activeTab === "guide") loadGuide();
    }, [activeTab, loadGuide]);

    // Auto-launch if destination was passed via URL (coming from search or ride page)
    useEffect(() => {
        const dest = params.get("destination");
        const org  = params.get("origin") ?? "";
        if (dest) selectTrip(dest, org);
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Filtered data ────────────────────────────────────────────────────────────

    const filteredMonuments = (exploreData?.pois ?? []).filter((m) => {
        if (monumentFilter === "Tous") return true;
        const haystack = (m.cat_name ?? m.tags?.tourism ?? m.tags?.historic ?? "")
            .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        const terms = MONUMENT_MAP[monumentFilter] ?? [];
        return terms.some((t) => haystack.includes(t));
    });

    const filteredRestaurants = (exploreData?.restaurants ?? []).filter((r) => {
        // Normalize accents so "café" matches "caf"
        const cuisine = (r.cat_name ?? r.tags?.cuisine ?? "")
            .toLowerCase()
            .normalize("NFD").replace(/[̀-ͯ]/g, "");
        if (cuisineFilter !== "Tous") {
            const terms = CUISINE_MAP[cuisineFilter] ?? [];
            if (!terms.some((t) => cuisine.includes(t))) return false;
        }
        if (budgetFilter !== "Tous" && r.budget !== budgetFilter) return false;
        return true;
    });

    const filteredAccoms = (exploreData?.accommodations ?? []).filter((a) => {
        if (accomFilter === "Tous") return true;
        return a.tags?.tourism === ACCOM_TAG_MAP[accomFilter];
    });

    const mapPOIs = [
        ...(showCat.has("poi")           ? (exploreData?.pois           ?? []) : []),
        ...(showCat.has("restaurant")    ? (exploreData?.restaurants    ?? []) : []),
        ...(showCat.has("accommodation") ? (exploreData?.accommodations ?? []) : []),
    ];

    // ── Search screen ────────────────────────────────────────────────────────────

    if (!city) {
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
                            <Link href="/search">Covoiturage</Link>
                            <Link href="/agent">Mode IA</Link>
                        </div>
                    </nav>

                    <div className="tourist-search-screen">
                        <p className="tourist-eyebrow">Mode Touristique</p>
                        <h1 className="tourist-hero-title">
                            Explorez le <span className="gradient-text">Maroc</span>
                        </h1>
                        <p className="tourist-hero-sub">
                            Indiquez votre trajet et découvrez les sites, restaurants et
                            hébergements autour de votre destination.
                        </p>

                        <form
                            className="tourist-trip-form"
                            onSubmit={(e: { preventDefault(): void }) => {
                                e.preventDefault();
                                selectTrip(destInput, originInput);
                            }}
                        >
                            <div className="tourist-trip-inputs">
                                <div className="tourist-input-row">
                                    <span className="tourist-input-dot departure" />
                                    <input
                                        className="tourist-city-input"
                                        type="text"
                                        placeholder="Ville de départ (optionnel)"
                                        value={originInput}
                                        onChange={(e) => setOriginInput(e.target.value)}
                                    />
                                </div>
                                <div className="tourist-input-connector" />
                                <div className="tourist-input-row">
                                    <span className="tourist-input-dot destination" />
                                    <input
                                        className="tourist-city-input"
                                        type="text"
                                        placeholder="Destination — ex : Chefchaouen, Fès..."
                                        value={destInput}
                                        onChange={(e) => setDestInput(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                            </div>
                            <button className="btn btn-primary" disabled={!destInput.trim()}>
                                Explorer la destination
                            </button>
                        </form>

                        <div className="tourist-quick-cities">
                            {["Marrakech", "Chefchaouen", "Fès", "Essaouira", "Agadir", "Ouarzazate", "Merzouga", "Tanger"].map((c) => (
                                <button
                                    key={c}
                                    className="tourist-quick-btn"
                                    onClick={() => { setDestInput(c); selectTrip(c, originInput); }}
                                >
                                    {c}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </main>
        );
    }

    // ── Main tourist view ────────────────────────────────────────────────────────

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
                        <Link href="/search">Covoiturage</Link>
                    </div>
                </nav>

                <div className="tourist-main">
                    {/* Header */}
                    <div className="tourist-city-header">
                        <button className="page-back" onClick={() => { setCity(null); setExploreData(null); }}>
                            ← Changer le trajet
                        </button>
                        <div>
                            {origin ? (
                                <h1 className="tourist-city-name">
                                    <span className="tourist-origin-label">{origin}</span>
                                    <span className="tourist-route-arrow"> → </span>
                                    {city}
                                </h1>
                            ) : (
                                <h1 className="tourist-city-name">{city}</h1>
                            )}
                            <p className="tourist-city-sub">Mode touristique · Destination</p>
                        </div>
                        <Link
                            href={`/search?${origin ? `origin=${encodeURIComponent(origin)}&` : ""}destination=${encodeURIComponent(city)}`}
                            className="btn btn-primary btn-sm"
                            style={{ marginLeft: "auto" }}
                        >
                            Trouver un covoiturage →
                        </Link>
                    </div>

                    {/* Tab bar */}
                    <div className="tourist-tab-bar">
                        {TABS.map((t) => (
                            <button
                                key={t.id}
                                className={`tourist-tab-btn ${activeTab === t.id ? "active" : ""}`}
                                onClick={() => setActiveTab(t.id)}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>

                    {/* ── Tab: Carte (T-01) ── */}
                    {activeTab === "carte" && (
                        <div className="tourist-tab-content">
                            <div className="poi-legend">
                                {(["poi", "restaurant", "accommodation"] as const).map((cat) => {
                                    const style = CATEGORY_STYLE[cat];
                                    const active = showCat.has(cat);
                                    const count = cat === "poi" ? exploreData?.pois.length
                                        : cat === "restaurant" ? exploreData?.restaurants.length
                                        : exploreData?.accommodations.length;
                                    return (
                                        <button
                                            key={cat}
                                            className={`poi-chip ${active ? "active" : ""}`}
                                            style={{ "--chip-color": style.color } as React.CSSProperties}
                                            onClick={() => setShowCat((prev) => {
                                                const next = new Set(prev);
                                                next.has(cat) ? next.delete(cat) : next.add(cat);
                                                return next;
                                            })}
                                        >
                                            <span className="poi-chip-dot" />
                                            {style.label}
                                            {exploreData != null && (
                                                <span className="poi-chip-count">{count ?? 0}</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>

                            {exploreLoading && (
                                <div className="tourist-loading">
                                    <span />
                                    <p>Chargement des données OpenStreetMap…</p>
                                </div>
                            )}
                            {exploreError && <p className="alert-error">{exploreError}</p>}

                            {exploreData && (
                                <POIMap
                                    lat={exploreData.lat}
                                    lng={exploreData.lng}
                                    city={city}
                                    pois={mapPOIs}
                                    height="520px"
                                />
                            )}

                            {exploreData && mapPOIs.length === 0 && !exploreLoading && (
                                <p className="tourist-empty">Aucun point d&apos;intérêt trouvé avec ces filtres.</p>
                            )}

                            <p className="tourist-osm-credit">
                                {exploreData?.source === "foursquare"
                                    ? <>Données : © <a href="https://foursquare.com" target="_blank" rel="noopener noreferrer">Foursquare</a> Places API</>
                                    : <>Données : © <a href="https://openstreetmap.org" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> · Overpass API</>
                                }
                            </p>
                        </div>
                    )}

                    {/* ── Tab: Monuments ── */}
                    {activeTab === "monuments" && (
                        <div className="tourist-tab-content">
                            <div className="tourist-filters">
                                <div className="tourist-filter-group">
                                    <span className="tourist-filter-label">Type</span>
                                    <div className="tourist-chips">
                                        {MONUMENT_TYPES.map((f) => (
                                            <button key={f}
                                                className={`tourist-filter-chip ${monumentFilter === f ? "active" : ""}`}
                                                onClick={() => setMonumentFilter(f)}>{f}</button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {exploreLoading && <p className="tourist-loading-text">Chargement…</p>}
                            {!exploreLoading && !exploreError && (
                                <p className="tourist-count">
                                    {filteredMonuments.length} site{filteredMonuments.length !== 1 ? "s" : ""}
                                    {filteredMonuments.length < (exploreData?.pois?.length ?? 0) && (
                                        <span> sur {exploreData?.pois?.length} au total</span>
                                    )}
                                </p>
                            )}
                            {exploreError && <p className="alert-error">{exploreError}</p>}

                            <div className="tourist-card-grid">
                                {filteredMonuments.map((m) => (
                                    <div key={m.id} className="tourist-poi-card">
                                        {m.photo_url && (
                                            <img src={m.photo_url} alt={m.name} className="tourist-poi-photo" />
                                        )}
                                        <div className="tourist-poi-card-top">
                                            <p className="tourist-poi-name">{m.name}</p>
                                            {m.rating != null && (
                                                <span className={`tourist-rating-badge ${m.rating >= 8 ? "high" : m.rating >= 6 ? "medium" : "low"}`}>
                                                    ★ {m.rating.toFixed(1)}
                                                </span>
                                            )}
                                        </div>
                                        <p className="tourist-poi-sub">{m.cat_name || m.tags?.tourism || m.tags?.historic}</p>
                                        {m.open_now != null && (
                                            <span className={`tourist-open-badge ${m.open_now ? "open" : "closed"}`}>
                                                {m.open_now ? "● Ouvert" : "● Fermé"}
                                            </span>
                                        )}
                                        {(m.hours_display || m.tags?.opening_hours) && (
                                            <p className="tourist-poi-meta">{m.hours_display || m.tags?.opening_hours}</p>
                                        )}
                                        <div className="tourist-poi-actions">
                                            {m.website && (
                                                <a href={m.website} target="_blank" rel="noopener noreferrer" className="tourist-poi-link">
                                                    Site web →
                                                </a>
                                            )}
                                            <a href={`https://www.openstreetmap.org/?mlat=${m.lat}&mlon=${m.lng}&zoom=18`}
                                                target="_blank" rel="noopener noreferrer" className="tourist-poi-link">
                                                Carte →
                                            </a>
                                        </div>
                                    </div>
                                ))}
                                {!exploreLoading && filteredMonuments.length === 0 && !exploreError && (
                                    <p className="tourist-empty">Aucun monument trouvé avec ce filtre.</p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── Tab: Restaurants (T-02) ── */}
                    {activeTab === "restaurants" && (
                        <div className="tourist-tab-content">
                            <div className="tourist-filters">
                                <div className="tourist-filter-group">
                                    <span className="tourist-filter-label">Cuisine</span>
                                    <div className="tourist-chips">
                                        {CUISINE_FILTERS.map((f) => (
                                            <button key={f}
                                                className={`tourist-filter-chip ${cuisineFilter === f ? "active" : ""}`}
                                                onClick={() => setCuisineFilter(f)}>{f}</button>
                                        ))}
                                    </div>
                                </div>
                                <div className="tourist-filter-group">
                                    <span className="tourist-filter-label">Budget</span>
                                    <div className="tourist-chips">
                                        {BUDGET_FILTERS.map((f) => (
                                            <button key={f}
                                                className={`tourist-filter-chip ${budgetFilter === f ? "active" : ""}`}
                                                onClick={() => setBudgetFilter(f)}>{f}</button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {exploreLoading && <p className="tourist-loading-text">Chargement…</p>}
                            {!exploreLoading && !exploreError && (
                                <p className="tourist-count">
                                    {filteredRestaurants.length} restaurant{filteredRestaurants.length !== 1 ? "s" : ""}
                                    {filteredRestaurants.length < (exploreData?.restaurants?.length ?? 0) && (
                                        <span> sur {exploreData?.restaurants?.length} au total</span>
                                    )}
                                </p>
                            )}

                            {exploreError && <p className="alert-error">{exploreError}</p>}

                            <div className="tourist-card-grid">
                                {filteredRestaurants.map((r) => (
                                    <div key={r.id} className="tourist-poi-card">
                                        {r.photo_url && (
                                            <img src={r.photo_url} alt={r.name} className="tourist-poi-photo" />
                                        )}
                                        <div className="tourist-poi-card-top">
                                            <p className="tourist-poi-name">{r.name}</p>
                                            <div className="tourist-poi-badges">
                                                {r.rating != null && (
                                                    <span className={`tourist-rating-badge ${r.rating >= 8 ? "high" : r.rating >= 6 ? "medium" : "low"}`}>
                                                        ★ {r.rating.toFixed(1)}
                                                    </span>
                                                )}
                                                {r.budget && (
                                                    <span className={`tourist-budget-badge budget-${r.budget.replace(/€/g, "e")}`}>
                                                        {r.budget}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <p className="tourist-poi-sub">{r.cat_name || r.tags?.cuisine}</p>
                                        {r.open_now != null && (
                                            <span className={`tourist-open-badge ${r.open_now ? "open" : "closed"}`}>
                                                {r.open_now ? "● Ouvert" : "● Fermé"}
                                            </span>
                                        )}
                                        {(r.hours_display || r.tags?.opening_hours) && (
                                            <p className="tourist-poi-meta">{r.hours_display || r.tags?.opening_hours}</p>
                                        )}
                                        <div className="tourist-poi-actions">
                                            {r.website && (
                                                <a href={r.website} target="_blank" rel="noopener noreferrer" className="tourist-poi-link">
                                                    Site web →
                                                </a>
                                            )}
                                            <a href={`https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}&zoom=18`}
                                                target="_blank" rel="noopener noreferrer" className="tourist-poi-link">
                                                Carte →
                                            </a>
                                        </div>
                                    </div>
                                ))}
                                {!exploreLoading && filteredRestaurants.length === 0 && !exploreError && (
                                    <p className="tourist-empty">Aucun restaurant trouvé. Les données peuvent être incomplètes pour certaines villes.</p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── Tab: Hébergements (T-03) ── */}
                    {activeTab === "hebergements" && (
                        <div className="tourist-tab-content">
                            <div className="tourist-filters">
                                <div className="tourist-filter-group">
                                    <span className="tourist-filter-label">Type</span>
                                    <div className="tourist-chips">
                                        {ACCOM_TYPES.map((f) => (
                                            <button key={f}
                                                className={`tourist-filter-chip ${accomFilter === f ? "active" : ""}`}
                                                onClick={() => setAccomFilter(f)}>{f}</button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {exploreLoading && <p className="tourist-loading-text">Chargement…</p>}
                            {!exploreLoading && !exploreError && (
                                <p className="tourist-count">
                                    {filteredAccoms.length} hébergement{filteredAccoms.length !== 1 ? "s" : ""}
                                </p>
                            )}
                            {exploreError && <p className="alert-error">{exploreError}</p>}

                            <div className="tourist-card-grid">
                                {filteredAccoms.map((a) => (
                                    <div key={a.id} className="tourist-poi-card">
                                        {a.photo_url && (
                                            <img src={a.photo_url} alt={a.name} className="tourist-poi-photo" />
                                        )}
                                        <div className="tourist-poi-card-top">
                                            <p className="tourist-poi-name">{a.name}</p>
                                            <div className="tourist-poi-badges">
                                                {a.rating != null && (
                                                    <span className={`tourist-rating-badge ${a.rating >= 8 ? "high" : a.rating >= 6 ? "medium" : "low"}`}>
                                                        ★ {a.rating.toFixed(1)}
                                                    </span>
                                                )}
                                                {a.stars && (
                                                    <span className="tourist-stars">
                                                        {"★".repeat(Math.min(parseInt(a.stars, 10), 5))}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <p className="tourist-poi-sub">{a.cat_name || a.type_label}</p>
                                        {a.open_now != null && (
                                            <span className={`tourist-open-badge ${a.open_now ? "open" : "closed"}`}>
                                                {a.open_now ? "● Ouvert" : "● Fermé"}
                                            </span>
                                        )}
                                        {a.budget && <div className="tourist-price-badge">{a.budget}</div>}
                                        {a.price_range && <div className="tourist-price-badge">{a.price_range}</div>}
                                        <div className="tourist-poi-actions">
                                            {a.website && (
                                                <a href={a.website} target="_blank" rel="noopener noreferrer" className="tourist-poi-link">
                                                    Site web →
                                                </a>
                                            )}
                                            <a href={`https://www.openstreetmap.org/?mlat=${a.lat}&mlon=${a.lng}&zoom=18`}
                                                target="_blank" rel="noopener noreferrer" className="tourist-poi-link">
                                                Carte →
                                            </a>
                                        </div>
                                    </div>
                                ))}
                                {!exploreLoading && filteredAccoms.length === 0 && !exploreError && (
                                    <p className="tourist-empty">Aucun hébergement trouvé. Essayez le Guide IA pour des suggestions.</p>
                                )}
                            </div>

                            <div className="tourist-accom-note">
                                Prix indicatifs basés sur le type d&apos;hébergement · Réservez directement auprès de l&apos;établissement.
                            </div>
                        </div>
                    )}

                    {/* ── Tab: Guide IA (T-05) ── */}
                    {activeTab === "guide" && (
                        <div className="tourist-tab-content">
                            {guideLoading && (
                                <div className="tourist-guide-loading">
                                    <div className="tourist-loading-dots"><span /><span /><span /></div>
                                    <p>Génération du guide pour <strong>{city}</strong>…</p>
                                </div>
                            )}

                            {!guideLoading && !guide && (
                                <button className="btn btn-primary" onClick={loadGuide}>
                                    Générer le guide IA
                                </button>
                            )}

                            {guide && (
                                <div className="tourist-guide">
                                    <div className="tourist-guide-hero">
                                        <h2>{guide.city}</h2>
                                        <p>{guide.description}</p>
                                        <div className="tourist-guide-badges">
                                            <span className="tourist-guide-badge">Meilleure période : {guide.best_time}</span>
                                            <span className="tourist-guide-badge">Langues : {guide.language}</span>
                                        </div>
                                    </div>

                                    <div className="tourist-guide-grid">
                                        <GuideSection title="À voir absolument" items={guide.highlights} color="#6366f1" numbered />
                                        <GuideSection title="Gastronomie"       items={guide.food}       color="#ec4899" />
                                        <GuideSection title="Où dormir"         items={guide.accommodation} color="#3b82f6" />
                                        <GuideSection title="Conseils pratiques" items={guide.tips}      color="#10b981" />
                                    </div>

                                    <div className="tourist-guide-cta">
                                        <p>Prêt à partir pour {city} ?</p>
                                        <Link
                                            href={`/search?${origin ? `origin=${encodeURIComponent(origin)}&` : ""}destination=${encodeURIComponent(city)}`}
                                            className="btn btn-primary"
                                        >
                                            Trouver un covoiturage
                                        </Link>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}

export default function TouristPage() {
    return (
        <Suspense fallback={<main className="app-shell"><div className="page-layer loading-page"><p>Chargement…</p></div></main>}>
            <TouristPageInner />
        </Suspense>
    );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function GuideSection({ title, items, color, numbered = false }: {
    title: string; items: string[]; color: string; numbered?: boolean;
}) {
    return (
        <div className="tourist-guide-section">
            <h3 style={{ color }}>{title}</h3>
            {numbered ? (
                <ol className="tourist-guide-numbered">
                    {items.map((item, i) => (
                        <li key={i} className="tourist-guide-item">
                            <span className="tourist-guide-num" style={{ background: color + "30", color }}>{i + 1}</span>
                            <span>{item}</span>
                        </li>
                    ))}
                </ol>
            ) : (
                <ul className="tourist-guide-list">
                    {items.map((item, i) => (
                        <li key={i} className="tourist-guide-item">
                            <span className="tourist-guide-dot" style={{ background: color }} />
                            <span>{item}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
