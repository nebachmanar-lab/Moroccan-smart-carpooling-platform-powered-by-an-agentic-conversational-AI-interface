"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { apiFetch } from "@/lib/api";
import { City, fetchCities } from "@/lib/cities";
import RatingModal from "@/components/RatingModal";
import PassengerRatingModal from "@/components/PassengerRatingModal";

const SearchRidesMap = dynamic(() => import("@/components/SearchRidesMap"), { ssr: false });

// ── Interfaces ─────────────────────────────────────────────────────────────────

interface User {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    role: "DRIVER" | "PASSENGER" | string;
}

interface Ride {
    id: string;
    origin: string;
    destination: string;
    departure_time: string;
    available_seats: number;
    price_per_seat: number;
    pickup_location: string | null;
    dropoff_location: string | null;
    status: string;
    origin_lat: number | null;
    origin_lng: number | null;
    destination_lat: number | null;
    destination_lng: number | null;
    is_recurring?: boolean;
    recurrence_days?: number[] | null;
}

interface MyBooking {
    id: string;
    ride_id: string;
    status: string;
    seats_booked: number;
    total_price: number;
    created_at: string;
    origin: string;
    destination: string;
    departure_time: string;
    driver_name: string;
    driver_id: string;
    ride_status: string;
}

interface DriverBooking {
    booking_id: string;
    ride_id: string;
    origin: string;
    destination: string;
    departure_time: string;
    passenger_id: string;
    passenger_name: string;
    passenger_email: string;
    passenger_phone: string | null;
    seats_booked: number;
    total_price: number;
    status: string;
    ride_status: string;
    booked_at: string;
}

interface DriverPrefs {
    smoking_allowed: boolean;
    pets_allowed: boolean;
    music_allowed: boolean;
    talking_preference: string;
    luggage_size: string;
    air_conditioning: boolean;
    custom_note: string | null;
}

interface RideEditFields {
    departure_time: string;
    available_seats: number;
    price_per_seat: number;
    pickup_location: string;
    dropoff_location: string;
}

interface RevenueBreakdown {
    ride_id: string;
    origin: string;
    destination: string;
    departure_time: string;
    status: string;
    confirmed_bookings: number;
    passengers: number;
    earned: number;
}

interface RevenueSummary {
    total_earned: number;
    total_trips_with_passengers: number;
    total_passengers_transported: number;
    breakdown: RevenueBreakdown[];
}

interface DriverDoc {
    id: string;
    doc_type: string;
    original_name: string;
    file_url: string;
    status: string;
    admin_note: string | null;
    created_at: string;
}

type DriverTab = "trajets" | "reservations" | "passagers" | "habituels" | "preferences" | "revenus" | "documents";

const DRIVER_TABS: { id: DriverTab; label: string }[] = [
    { id: "trajets",      label: "Mes Trajets" },
    { id: "reservations", label: "Réservations" },
    { id: "passagers",    label: "Passagers" },
    { id: "habituels",    label: "Habituels" },
    { id: "preferences",  label: "Préférences" },
    { id: "revenus",      label: "Revenus" },
    { id: "documents",    label: "Documents" },
];

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
    const router = useRouter();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";
    const [user, setUser] = useState<User | null>(null);
    const [rides, setRides] = useState<Ride[]>([]);
    const [loading, setLoading] = useState(true);

    // Driver state
    const [driverTab, setDriverTab] = useState<DriverTab>("trajets");
    const [driverBookings, setDriverBookings] = useState<DriverBooking[]>([]);
    const [driverBookingsLoaded, setDriverBookingsLoaded] = useState(false);
    const [actioningId, setActioningId] = useState<string | null>(null);
    const [prefs, setPrefs] = useState<DriverPrefs | null>(null);
    const [editPrefs, setEditPrefs] = useState<DriverPrefs>({
        smoking_allowed: false,
        pets_allowed: false,
        music_allowed: true,
        talking_preference: "no_preference",
        luggage_size: "medium",
        air_conditioning: true,
        custom_note: null,
    });
    const [prefsSaving, setPrefsSaving] = useState(false);
    const [prefsSaved, setPrefsSaved] = useState(false);
    const [locationCopied, setLocationCopied] = useState(false);
    const [locationError, setLocationError] = useState("");
    const [shareUrl, setShareUrl] = useState<string | null>(null);
    const [shareMenuOpen, setShareMenuOpen] = useState(false);
    const [gettingLocation, setGettingLocation] = useState(false);

    // Passenger state
    const [bookings, setBookings] = useState<MyBooking[]>([]);
    const [bookingsLoading, setBookingsLoading] = useState(false);
    const [cancellingId, setCancellingId] = useState<string | null>(null);

    // Profile editing state
    const [editProfile, setEditProfile] = useState({ first_name: "", last_name: "", phone: "" });
    const [profileSaving, setProfileSaving] = useState(false);
    const [profileSaved, setProfileSaved] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);

    // Password change state
    const [pwCurrent, setPwCurrent] = useState("");
    const [pwNew, setPwNew] = useState("");
    const [pwSaving, setPwSaving] = useState(false);
    const [pwMsg, setPwMsg] = useState<{ text: string; ok: boolean } | null>(null);

    // Ride edit state
    const [editingRideId, setEditingRideId] = useState<string | null>(null);
    const [cancellingRideId, setCancellingRideId] = useState<string | null>(null);
    const [completingRideId, setCompletingRideId] = useState<string | null>(null);

    // Revenue
    const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
    const [revenueLoading, setRevenueLoading] = useState(false);

    // Driver documents
    const [docs, setDocs] = useState<DriverDoc[]>([]);
    const [docsLoaded, setDocsLoaded] = useState(false);
    const [uploadingDoc, setUploadingDoc] = useState(false);
    const [docError, setDocError] = useState("");

    // Unread messages
    const [unreadCount, setUnreadCount] = useState(0);
    const unreadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Rating modals
    const [ratingTarget, setRatingTarget] = useState<{ bookingId: string; rideId: string; driverId: string; driverName: string; origin: string; destination: string } | null>(null);
    const [ratedRideIds, setRatedRideIds] = useState<Set<string>>(new Set());
    const [passengerRatingTarget, setPassengerRatingTarget] = useState<{ rideId: string; passengerId: string; passengerName: string; origin: string; destination: string } | null>(null);
    const [ratedPassengerKeys, setRatedPassengerKeys] = useState<Set<string>>(new Set());

    // Search state
    const [cities, setCities] = useState<City[]>([]);
    const [searchOrigin, setSearchOrigin] = useState("");
    const [searchDest, setSearchDest] = useState("");
    const [searchDate, setSearchDate] = useState("");
    const [searchResults, setSearchResults] = useState<Ride[]>([]);
    const [searching, setSearching] = useState(false);
    const [searched, setSearched] = useState(false);
    const [searchView, setSearchView] = useState<"list" | "map">("list");

    const loadBookings = useCallback(async () => {
        setBookingsLoading(true);
        try {
            const res = await apiFetch("/bookings/me");
            if (res.ok) setBookings(await res.json());
        } finally {
            setBookingsLoading(false);
        }
    }, []);

    const loadDriverBookings = useCallback(async () => {
        const res = await apiFetch("/bookings/driver");
        if (res.ok) {
            setDriverBookings(await res.json());
            setDriverBookingsLoaded(true);
        }
    }, []);

    const loadPrefs = useCallback(async () => {
        const res = await apiFetch("/preferences");
        if (res.ok) {
            const data: DriverPrefs = await res.json();
            setPrefs(data);
            setEditPrefs(data);
        }
    }, []);

    useEffect(() => {
        const token = sessionStorage.getItem("access_token");
        if (!token) { router.push("/login"); return; }

        const pollUnread = async () => {
            const res = await apiFetch("/messages/unread/count");
            if (res.ok) { const d = await res.json(); setUnreadCount(d.unread ?? 0); }
        };

        async function load() {
            try {
                // Try cached user first for instant render, refresh in background
                const cachedRaw = sessionStorage.getItem("dashboard_user");
                let u: User | null = null;
                if (cachedRaw) {
                    try { u = JSON.parse(cachedRaw); } catch { /* ignore */ }
                }
                if (u) {
                    setUser(u);
                    setEditProfile({ first_name: u.first_name, last_name: u.last_name, phone: u.phone ?? "" });
                    setLoading(false);
                }

                // Always refresh from server (background if cache hit)
                const userRes = await apiFetch("/auth/me");
                if (!userRes.ok) throw new Error();
                const fresh: User = await userRes.json();
                sessionStorage.setItem("dashboard_user", JSON.stringify(fresh));
                setUser(fresh);
                setEditProfile({ first_name: fresh.first_name, last_name: fresh.last_name, phone: fresh.phone ?? "" });
                u = fresh;

                // Fire all role-appropriate requests in parallel
                if (u.role === "DRIVER") {
                    const [ridesRes] = await Promise.all([
                        apiFetch("/rides/my"),
                        loadPrefs(),
                        pollUnread(),
                        fetchCities().then(setCities).catch(console.error),
                    ]);
                    if (ridesRes.ok) setRides(await ridesRes.json());
                } else {
                    await Promise.all([
                        loadBookings(),
                        pollUnread(),
                        fetchCities().then(setCities).catch(console.error),
                    ]);
                }

                unreadPollRef.current = setInterval(pollUnread, 15000);
            } catch {
                router.push("/login");
            } finally {
                setLoading(false);
            }
        }
        load();
        return () => { if (unreadPollRef.current) clearInterval(unreadPollRef.current); };
    }, [router, loadBookings, loadPrefs]);

    // Lazy-load driver bookings when those tabs are first visited
    useEffect(() => {
        if ((driverTab === "reservations" || driverTab === "passagers") && !driverBookingsLoaded) {
            loadDriverBookings();
        }
        if (driverTab === "documents" && !docsLoaded) {
            apiFetch("/documents/me")
                .then((r) => r.ok ? r.json() : [])
                .then((d) => { setDocs(d); setDocsLoaded(true); });
        }
        if (driverTab === "revenus" && !revenue && !revenueLoading) {
            setRevenueLoading(true);
            apiFetch("/rides/revenue/summary")
                .then((r) => r.ok ? r.json() : null)
                .then((d) => { if (d) setRevenue(d); })
                .finally(() => setRevenueLoading(false));
        }
    }, [driverTab, driverBookingsLoaded, loadDriverBookings, revenue, revenueLoading]);

    function logout() {
        sessionStorage.removeItem("access_token");
        sessionStorage.removeItem("refresh_token");
        sessionStorage.removeItem("token_type");
        sessionStorage.removeItem("dashboard_user");
        router.push("/login");
    }

    async function handleSearch(e: { preventDefault(): void }) {
        e.preventDefault();
        if (!searchOrigin || !searchDest) return;
        setSearching(true);
        setSearched(false);
        const params = new URLSearchParams({ origin: searchOrigin, destination: searchDest });
        if (searchDate) params.set("date", searchDate);
        try {
            const res = await fetch(`${apiUrl}/rides?${params}`);
            const raw = await res.json();
            setSearchResults(Array.isArray(raw) ? raw : []);
        } catch {
            setSearchResults([]);
        } finally {
            setSearching(false);
            setSearched(true);
        }
    }

    async function cancelBooking(bookingId: string) {
        if (!confirm("Annuler cette réservation ?")) return;
        setCancellingId(bookingId);
        try {
            const res = await apiFetch(`/bookings/${bookingId}`, { method: "DELETE" });
            if (res.ok) await loadBookings();
        } finally {
            setCancellingId(null);
        }
    }

    async function handleBookingAction(bookingId: string, action: "accept" | "refuse") {
        setActioningId(bookingId);
        try {
            const res = await apiFetch(`/bookings/${bookingId}/${action}`, { method: "POST" });
            if (res.ok) {
                setDriverBookings((prev) =>
                    prev.map((b) =>
                        b.booking_id === bookingId
                            ? { ...b, status: action === "accept" ? "CONFIRMED" : "CANCELLED" }
                            : b
                    )
                );
            }
        } finally {
            setActioningId(null);
        }
    }

    async function shareLocation() {
        setLocationError("");
        setLocationCopied(false);
        setShareMenuOpen(false);

        if (!navigator.geolocation) {
            setLocationError("Géolocalisation non supportée par ce navigateur.");
            return;
        }

        setGettingLocation(true);
        let pos: GeolocationPosition;
        try {
            pos = await new Promise<GeolocationPosition>((resolve, reject) =>
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    timeout: 10000,
                    enableHighAccuracy: true,
                })
            );
        } catch (err) {
            const code = (err as { code?: number }).code;
            if (code === 1) {
                setLocationError("Accès refusé. Autorisez la localisation dans les paramètres du navigateur puis réessayez.");
            } else if (code === 2) {
                setLocationError("Position indisponible. Activez le GPS ou réessayez en extérieur.");
            } else {
                setLocationError("Délai dépassé. Vérifiez votre connexion GPS.");
            }
            setGettingLocation(false);
            return;
        }
        setGettingLocation(false);

        const { latitude: lat, longitude: lng } = pos.coords;
        const url = `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lng.toFixed(6)}&zoom=15`;
        setShareUrl(url);

        // Native share sheet (mobile / supported browsers)
        if (navigator.share) {
            try {
                await navigator.share({
                    title: "Ma position — CovoMar",
                    text: "Ma position en temps réel (CovoMar)",
                    url,
                });
                return;
            } catch (e) {
                // AbortError = user dismissed the sheet → fall through to menu
                if ((e as { name?: string }).name !== "AbortError") {
                    setShareMenuOpen(true);
                }
                return;
            }
        }

        // Desktop fallback: show manual share menu
        setShareMenuOpen(true);
    }

    function copyShareLink() {
        if (!shareUrl) return;
        navigator.clipboard.writeText(`Ma position (CovoMar) : ${shareUrl}`);
        setLocationCopied(true);
        setTimeout(() => setLocationCopied(false), 2500);
    }

    async function savePreferences() {
        setPrefsSaving(true);
        setPrefsSaved(false);
        try {
            const method = prefs ? "PUT" : "POST";
            const res = await apiFetch("/preferences", {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(editPrefs),
            });
            if (res.ok) {
                const updated = await res.json();
                setPrefs(updated);
                setEditPrefs(updated);
                setPrefsSaved(true);
                setTimeout(() => setPrefsSaved(false), 3000);
            }
        } finally {
            setPrefsSaving(false);
        }
    }

    async function changePassword() {
        if (!pwCurrent || !pwNew) return;
        setPwSaving(true);
        setPwMsg(null);
        try {
            const res = await apiFetch("/auth/me/change-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ current_password: pwCurrent, new_password: pwNew }),
            });
            const data = await res.json();
            if (res.ok) {
                setPwMsg({ text: data.message || "Mot de passe modifié.", ok: true });
                setPwCurrent("");
                setPwNew("");
            } else {
                setPwMsg({ text: data.detail || "Erreur.", ok: false });
            }
        } finally {
            setPwSaving(false);
        }
    }

    async function saveProfile() {
        setProfileSaving(true);
        setProfileSaved(false);
        try {
            const body: Record<string, string> = {};
            if (editProfile.first_name) body.first_name = editProfile.first_name;
            if (editProfile.last_name)  body.last_name  = editProfile.last_name;
            if (editProfile.phone)      body.phone      = editProfile.phone;
            const res = await apiFetch("/auth/me", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                const updated: User = await res.json();
                sessionStorage.setItem("dashboard_user", JSON.stringify(updated));
                setUser(updated);
                setEditProfile({ first_name: updated.first_name, last_name: updated.last_name, phone: updated.phone ?? "" });
                setProfileSaved(true);
                setTimeout(() => setProfileSaved(false), 3000);
            }
        } finally {
            setProfileSaving(false);
        }
    }

    async function completeRide(rideId: string) {
        if (!confirm("Marquer ce trajet comme terminé ? Les passagers pourront ensuite laisser une évaluation.")) return;
        setCompletingRideId(rideId);
        try {
            const res = await apiFetch(`/rides/${rideId}/complete`, { method: "POST" });
            if (res.ok) setRides((prev) => prev.map((r) => r.id === rideId ? { ...r, status: "COMPLETED" } : r));
        } finally {
            setCompletingRideId(null);
        }
    }

    async function uploadDocument(file: File, docType: "CIN" | "PERMIS") {
        setUploadingDoc(true);
        setDocError("");
        try {
            const form = new FormData();
            form.append("file", file);
            form.append("doc_type", docType);
            const token = sessionStorage.getItem("access_token");
            const res = await fetch(`${apiUrl}/documents`, {
                method: "POST",
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                body: form,
            });
            if (res.ok) {
                const doc = await res.json();
                setDocs((prev) => [doc, ...prev.filter((d) => d.doc_type !== docType)]);
            } else {
                const d = await res.json();
                setDocError(d.detail || "Erreur d'upload");
            }
        } finally {
            setUploadingDoc(false);
        }
    }

    async function cancelRide(rideId: string) {
        if (!confirm("Annuler ce trajet ? Les passagers confirmés seront affectés.")) return;
        setCancellingRideId(rideId);
        try {
            const res = await apiFetch(`/rides/${rideId}`, { method: "DELETE" });
            if (res.ok) setRides((prev) => prev.map((r) => r.id === rideId ? { ...r, status: "CANCELLED" } : r));
        } finally {
            setCancellingRideId(null);
            setEditingRideId(null);
        }
    }

    async function updateRide(rideId: string, fields: Partial<RideEditFields>) {
        const body: Record<string, string | number> = {};
        if (fields.departure_time)  body.departure_time  = fields.departure_time;
        if (fields.available_seats) body.available_seats = fields.available_seats;
        if (fields.price_per_seat)  body.price_per_seat  = fields.price_per_seat;
        if (fields.pickup_location  !== undefined) body.pickup_location  = fields.pickup_location;
        if (fields.dropoff_location !== undefined) body.dropoff_location = fields.dropoff_location;
        const res = await apiFetch(`/rides/${rideId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (res.ok) {
            const updated = await res.json();
            setRides((prev) => prev.map((r) => r.id === rideId ? { ...r, ...updated } : r));
            setEditingRideId(null);
        }
    }

    // Passenger frequent routes
    const frequentRoutes = (() => {
        const count: Record<string, { origin: string; destination: string; n: number }> = {};
        for (const b of bookings) {
            const key = `${b.origin}→${b.destination}`;
            if (!count[key]) count[key] = { origin: b.origin, destination: b.destination, n: 0 };
            count[key].n++;
        }
        return Object.values(count)
            .filter((r) => r.n >= 2)
            .sort((a, b) => b.n - a.n)
            .slice(0, 4);
    })();

    // Driver frequent routes (most published)
    const driverFrequentRoutes = (() => {
        const count: Record<string, { origin: string; destination: string; n: number }> = {};
        for (const r of rides) {
            const key = `${r.origin}→${r.destination}`;
            if (!count[key]) count[key] = { origin: r.origin, destination: r.destination, n: 0 };
            count[key].n++;
        }
        return Object.values(count).sort((a, b) => b.n - a.n).slice(0, 6);
    })();

    // Unique passengers across all driver bookings
    const allPassengers = (() => {
        const seen = new Set<string>();
        return driverBookings.filter((b) => {
            if (seen.has(b.passenger_email)) return false;
            seen.add(b.passenger_email);
            return true;
        });
    })();

    if (loading) {
        return (
            <main className="app-shell">
                <div className="page-layer loading-page"><p>Chargement...</p></div>
            </main>
        );
    }

    if (!user) return null;

    const firstName = user.first_name || "Utilisateur";
    const isDriver = user.role === "DRIVER";
    const isPassenger = user.role === "PASSENGER";
    const isAdmin = user.role === "ADMIN";
    const confirmedBookings = bookings.filter((b) => b.status === "CONFIRMED" || b.status === "PENDING");
    const pastBookings = bookings.filter((b) => b.status === "CANCELLED");

    return (
        <>
        <main className="app-shell">
            <div className="page-layer">
                <nav className="navbar">
                    <Link href="/" className="brand">
                        <img src="/logo.png" alt="CovoMar" style={{height:"44px",width:"auto"}} onError={(e)=>{(e.target as HTMLImageElement).style.display="none";(e.target as HTMLImageElement).nextElementSibling!.setAttribute("style","display:inline")}} /><span style={{display:"none",fontWeight:900,fontSize:22}}>CovoMar</span>
                    </Link>
                    <div className="nav-links">
                        <Link href="/dashboard">Dashboard</Link>
                        {isDriver && <Link href="/rides/new">Publier un trajet</Link>}
                        {isPassenger && <Link href="/search">Rechercher</Link>}
                        <Link href="/tourist">Tourisme</Link>
                        {isAdmin && (
                            <Link href="/admin" style={{ color: "#f59e0b", fontWeight: 700 }}>
                                ⚙ Admin
                            </Link>
                        )}
                        <button
                            className="nav-link-badge-wrap"
                            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", color: "inherit" }}
                            onClick={() => {
                                if (isDriver) setDriverTab("reservations");
                                window.scrollTo({ top: 400, behavior: "smooth" });
                            }}
                        >
                            Messages
                            {unreadCount > 0 && (
                                <span className="nav-unread-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
                            )}
                        </button>
                    </div>
                    <div className="nav-actions">
                        <div className="mode-pill">
                            <button className="mode-pill-btn active">Normal</button>
                            <button
                                className="mode-pill-btn"
                                onClick={() => {
                                    localStorage.setItem("interface_mode", "ai");
                                    router.push("/agent");
                                }}
                            >
                                IA
                            </button>
                        </div>

                        {/* Profile avatar button */}
                        <div style={{ position: "relative" }}>
                            <button
                                className="profile-avatar-btn"
                                onClick={() => setProfileOpen((v) => !v)}
                                aria-label="Mon profil"
                            >
                                {(user.first_name[0] ?? "?").toUpperCase()}{(user.last_name[0] ?? "").toUpperCase()}
                            </button>

                            {profileOpen && (
                                <>
                                    <div className="profile-dropdown-overlay" onClick={() => setProfileOpen(false)} />
                                    <div className="profile-dropdown">
                                        <div className="profile-dropdown-header">
                                            <p className="profile-dropdown-name">{user.first_name} {user.last_name}</p>
                                            <p className="profile-dropdown-email">{user.email}</p>
                                        </div>
                                        <div className="profile-dropdown-fields">
                                            <label>Prénom</label>
                                            <input
                                                type="text"
                                                value={editProfile.first_name}
                                                onChange={(e) => setEditProfile({ ...editProfile, first_name: e.target.value })}
                                            />
                                            <label>Nom</label>
                                            <input
                                                type="text"
                                                value={editProfile.last_name}
                                                onChange={(e) => setEditProfile({ ...editProfile, last_name: e.target.value })}
                                            />
                                            <label>Téléphone</label>
                                            <input
                                                type="tel"
                                                placeholder="+212 6XX XXX XXX"
                                                value={editProfile.phone}
                                                onChange={(e) => setEditProfile({ ...editProfile, phone: e.target.value })}
                                            />
                                        </div>
                                        <div className="profile-dropdown-actions">
                                            {profileSaved && <span className="profile-saved-msg">Mis à jour.</span>}
                                            <button
                                                className="btn btn-primary btn-sm"
                                                onClick={saveProfile}
                                                disabled={profileSaving}
                                            >
                                                {profileSaving ? "..." : "Enregistrer"}
                                            </button>
                                        </div>

                                        <div className="profile-dropdown-divider" />
                                        <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: ".06em" }}>
                                            Changer le mot de passe
                                        </p>
                                        <div className="profile-dropdown-fields">
                                            <label>Mot de passe actuel</label>
                                            <input
                                                type="password"
                                                placeholder="••••••••"
                                                value={pwCurrent}
                                                onChange={(e) => setPwCurrent(e.target.value)}
                                            />
                                            <label>Nouveau mot de passe</label>
                                            <input
                                                type="password"
                                                placeholder="8 caractères minimum"
                                                value={pwNew}
                                                onChange={(e) => setPwNew(e.target.value)}
                                            />
                                        </div>
                                        {pwMsg && (
                                            <p style={{ fontSize: "12px", color: pwMsg.ok ? "var(--green, #22c55e)" : "var(--red, #ef4444)", marginBottom: "6px" }}>
                                                {pwMsg.text}
                                            </p>
                                        )}
                                        <div className="profile-dropdown-actions">
                                            <button
                                                className="btn btn-secondary btn-sm"
                                                onClick={changePassword}
                                                disabled={pwSaving || !pwCurrent || !pwNew}
                                            >
                                                {pwSaving ? "..." : "Modifier"}
                                            </button>
                                        </div>

                                        <button className="profile-dropdown-logout" onClick={logout}>
                                            Déconnexion
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </nav>

                <section className="dashboard">
                    {/* Header */}
                    <div className="glass-card dashboard-header">
                        <div>
                            <h1 className="dashboard-title">
                                Bonjour, <span className="pink-text">{firstName}</span>
                            </h1>
                            <p className="dashboard-subtitle">
                                {isDriver ? "Compte conducteur" : "Compte passager"} · {user.email}
                            </p>
                        </div>
                        {isDriver && (
                            <div style={{ position: "relative" }}>
                                <button
                                    className="btn btn-secondary btn-sm share-location-btn"
                                    onClick={shareLocation}
                                    disabled={gettingLocation}
                                >
                                    {gettingLocation ? "Localisation..." : "Partager ma position"}
                                </button>

                                {shareMenuOpen && shareUrl && (
                                    <>
                                        <div className="share-overlay" onClick={() => setShareMenuOpen(false)} />
                                        <div className="share-menu">
                                            <p className="share-menu-title">Partager via</p>
                                            <a
                                                href={`https://wa.me/?text=${encodeURIComponent("Ma position (CovoMar) : " + shareUrl)}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="share-option"
                                                onClick={() => setShareMenuOpen(false)}
                                            >
                                                <span className="share-option-icon">WhatsApp</span>
                                            </a>
                                            <a
                                                href={`mailto:?subject=Ma position&body=${encodeURIComponent("Ma position en temps réel (CovoMar) : " + shareUrl)}`}
                                                className="share-option"
                                                onClick={() => setShareMenuOpen(false)}
                                            >
                                                <span className="share-option-icon">Email</span>
                                            </a>
                                            <a
                                                href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent("Ma position (CovoMar)")}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="share-option"
                                                onClick={() => setShareMenuOpen(false)}
                                            >
                                                <span className="share-option-icon">Telegram</span>
                                            </a>
                                            <button
                                                className="share-option"
                                                onClick={() => { copyShareLink(); setShareMenuOpen(false); }}
                                            >
                                                <span className="share-option-icon">
                                                    {locationCopied ? "Copié !" : "Copier le lien"}
                                                </span>
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {locationError && (
                        <p className="alert-error" style={{ margin: "0 0 12px 0" }}>{locationError}</p>
                    )}

                    {/* ── DRIVER ── */}
                    {isDriver && (
                        <>
                            {/* Tab bar */}
                            <div className="driver-tabs">
                                {DRIVER_TABS.map((t) => (
                                    <button
                                        key={t.id}
                                        className={`driver-tab ${driverTab === t.id ? "active" : ""}`}
                                        onClick={() => setDriverTab(t.id)}
                                    >
                                        {t.label}
                                        {t.id === "trajets" && rides.length > 0 && (
                                            <span className="tab-count">{rides.length}</span>
                                        )}
                                        {t.id === "reservations" && driverBookings.length > 0 && (
                                            <span className="tab-count">{driverBookings.length}</span>
                                        )}
                                        {t.id === "passagers" && allPassengers.length > 0 && (
                                            <span className="tab-count">{allPassengers.length}</span>
                                        )}
                                    </button>
                                ))}
                            </div>

                            {/* Tab: Mes Trajets */}
                            {driverTab === "trajets" && (
                                <section className="glass-card section-card">
                                    <div className="section-header">
                                        <h2>Trajets Publiés</h2>
                                        <Link href="/rides/new" className="btn btn-primary btn-sm">
                                            + Publier
                                        </Link>
                                    </div>
                                    {rides.length === 0 ? (
                                        <div className="empty-state">
                                            <p>Vous n&apos;avez pas encore publié de trajet.</p>
                                            <br />
                                            <Link href="/rides/new" className="muted-link">
                                                Publier mon premier trajet &rarr;
                                            </Link>
                                        </div>
                                    ) : (
                                        <div className="ride-list">
                                            {rides.map((ride) => (
                                                <RideCard
                                                    key={ride.id}
                                                    ride={ride}
                                                    editing={editingRideId === ride.id}
                                                    onStartEdit={() => setEditingRideId(ride.id)}
                                                    onCancelEdit={() => setEditingRideId(null)}
                                                    onSaveEdit={(fields) => updateRide(ride.id, fields)}
                                                    onCancelRide={() => cancelRide(ride.id)}
                                                    onCompleteRide={() => completeRide(ride.id)}
                                                    cancelling={cancellingRideId === ride.id}
                                                    completing={completingRideId === ride.id}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </section>
                            )}

                            {/* Tab: Réservations reçues */}
                            {driverTab === "reservations" && (() => {
                                const pending   = driverBookings.filter((b) => b.status === "PENDING");
                                const confirmed = driverBookings.filter((b) => b.status === "CONFIRMED");
                                const cancelled = driverBookings.filter((b) => b.status === "CANCELLED");
                                return (
                                    <section className="glass-card section-card">
                                        <div className="section-header">
                                            <h2>Réservations Reçues</h2>
                                            {pending.length > 0 && (
                                                <span className="pending-badge">{pending.length} en attente</span>
                                            )}
                                        </div>
                                        {!driverBookingsLoaded ? (
                                            <p className="dash-empty">Chargement...</p>
                                        ) : driverBookings.length === 0 ? (
                                            <div className="empty-state"><p>Aucune réservation reçue pour le moment.</p></div>
                                        ) : (
                                            <>
                                                {pending.length > 0 && (
                                                    <div style={{ marginBottom: 20 }}>
                                                        <p className="bookings-section-label">En attente de votre réponse</p>
                                                        <div className="booking-list">
                                                            {pending.map((b) => (
                                                                <DriverBookingCard
                                                                    key={b.booking_id}
                                                                    booking={b}
                                                                    onAccept={() => handleBookingAction(b.booking_id, "accept")}
                                                                    onRefuse={() => handleBookingAction(b.booking_id, "refuse")}
                                                                    actioning={actioningId === b.booking_id}
                                                                    onMessageClick={() => setUnreadCount(0)}
                                                                />
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {confirmed.length > 0 && (
                                                    <div style={{ marginBottom: 20 }}>
                                                        <p className="bookings-section-label">Acceptées</p>
                                                        <div className="booking-list">
                                                            {confirmed.map((b) => {
                                                                const ratingKey = `${b.ride_id}-${b.passenger_id}`;
                                                                const canRatePassenger = b.ride_status === "COMPLETED" && !ratedPassengerKeys.has(ratingKey);
                                                                return (
                                                                    <DriverBookingCard
                                                                        key={b.booking_id}
                                                                        booking={b}
                                                                        onRefuse={b.ride_status !== "COMPLETED" ? () => handleBookingAction(b.booking_id, "refuse") : undefined}
                                                                        actioning={actioningId === b.booking_id}
                                                                        onMessageClick={() => setUnreadCount(0)}
                                                                        onRatePassenger={canRatePassenger ? () => setPassengerRatingTarget({ rideId: b.ride_id, passengerId: b.passenger_id, passengerName: b.passenger_name, origin: b.origin, destination: b.destination }) : undefined}
                                                                        alreadyRatedPassenger={ratedPassengerKeys.has(ratingKey)}
                                                                    />
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                                {cancelled.length > 0 && (
                                                    <details>
                                                        <summary style={{ cursor: "pointer", fontSize: "13px", color: "var(--text-muted)" }}>
                                                            Refusées / annulées ({cancelled.length})
                                                        </summary>
                                                        <div className="booking-list" style={{ marginTop: 8 }}>
                                                            {cancelled.map((b) => (
                                                                <DriverBookingCard key={b.booking_id} booking={b} />
                                                            ))}
                                                        </div>
                                                    </details>
                                                )}
                                            </>
                                        )}
                                    </section>
                                );
                            })()}

                            {/* Tab: Passagers */}
                            {driverTab === "passagers" && (
                                <section className="glass-card section-card">
                                    <div className="section-header">
                                        <h2>Mes Passagers</h2>
                                    </div>
                                    {!driverBookingsLoaded ? (
                                        <p className="dash-empty">Chargement...</p>
                                    ) : allPassengers.length === 0 ? (
                                        <div className="empty-state">
                                            <p>Aucun passager pour l&apos;instant.</p>
                                        </div>
                                    ) : (
                                        <div className="passenger-grid">
                                            {allPassengers.map((p) => (
                                                <div key={p.passenger_email} className="passenger-card">
                                                    <p className="passenger-name">{p.passenger_name}</p>
                                                    <p className="passenger-meta">{p.passenger_email}</p>
                                                    {p.passenger_phone && (
                                                        <p className="passenger-meta">{p.passenger_phone}</p>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </section>
                            )}

                            {/* Tab: Trajets habituels */}
                            {driverTab === "habituels" && (
                                <section className="glass-card section-card">
                                    <h2>Trajets Habituels</h2>
                                    <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "14px" }}>
                                        Vos itinéraires les plus publiés. Cliquez pour republier rapidement.
                                    </p>
                                    {driverFrequentRoutes.length === 0 ? (
                                        <div className="empty-state">
                                            <p>Publiez plusieurs trajets pour voir vos itinéraires habituels ici.</p>
                                        </div>
                                    ) : (
                                        <div className="frequent-routes">
                                            {driverFrequentRoutes.map((r) => (
                                                <Link
                                                    key={`${r.origin}-${r.destination}`}
                                                    href={`/rides/new?origin=${encodeURIComponent(r.origin)}&destination=${encodeURIComponent(r.destination)}`}
                                                    className="frequent-route-btn"
                                                >
                                                    <span className="frequent-route-cities">
                                                        {r.origin} → {r.destination}
                                                    </span>
                                                    <span className="frequent-route-count">
                                                        {r.n}× publié
                                                    </span>
                                                </Link>
                                            ))}
                                        </div>
                                    )}
                                </section>
                            )}

                            {/* Tab: Préférences */}
                            {driverTab === "preferences" && (
                                <section className="glass-card section-card">
                                    <div className="section-header">
                                        <h2>Préférences Conducteur</h2>
                                    </div>
                                    <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "20px" }}>
                                        Affichées aux passagers sur la page de vos trajets.
                                    </p>
                                    <div className="pref-grid">
                                        <PrefToggle
                                            label="Tabac autorisé"
                                            value={editPrefs.smoking_allowed}
                                            onChange={(v) => setEditPrefs({ ...editPrefs, smoking_allowed: v })}
                                        />
                                        <PrefToggle
                                            label="Animaux acceptés"
                                            value={editPrefs.pets_allowed}
                                            onChange={(v) => setEditPrefs({ ...editPrefs, pets_allowed: v })}
                                        />
                                        <PrefToggle
                                            label="Musique"
                                            value={editPrefs.music_allowed}
                                            onChange={(v) => setEditPrefs({ ...editPrefs, music_allowed: v })}
                                        />
                                        <PrefToggle
                                            label="Climatisation"
                                            value={editPrefs.air_conditioning}
                                            onChange={(v) => setEditPrefs({ ...editPrefs, air_conditioning: v })}
                                        />
                                        <div className="pref-item pref-item-wide">
                                            <label className="pref-label">Ambiance en voiture</label>
                                            <select
                                                className="dash-select"
                                                value={editPrefs.talking_preference}
                                                onChange={(e) => setEditPrefs({ ...editPrefs, talking_preference: e.target.value })}
                                            >
                                                <option value="quiet">Calme — pas de conversation</option>
                                                <option value="moderate">Modéré — selon l&apos;humeur</option>
                                                <option value="chatty">Bavard — j&apos;adore discuter</option>
                                                <option value="no_preference">Pas de préférence</option>
                                            </select>
                                        </div>
                                        <div className="pref-item pref-item-wide">
                                            <label className="pref-label">Taille max des bagages</label>
                                            <select
                                                className="dash-select"
                                                value={editPrefs.luggage_size}
                                                onChange={(e) => setEditPrefs({ ...editPrefs, luggage_size: e.target.value })}
                                            >
                                                <option value="small">Petit — sac à dos uniquement</option>
                                                <option value="medium">Moyen — valise cabine</option>
                                                <option value="large">Grand — valise soute</option>
                                            </select>
                                        </div>
                                        <div className="pref-item pref-item-wide">
                                            <label className="pref-label">Mes préférences personnelles</label>
                                            <textarea
                                                className="pref-textarea"
                                                rows={3}
                                                maxLength={300}
                                                placeholder="Exprimez-vous librement : ex. Je préfère que les passagers soient ponctuels, pas de nourriture dans la voiture, je m'arrête pour une pause si le trajet dépasse 2h..."
                                                value={editPrefs.custom_note ?? ""}
                                                onChange={(e) => setEditPrefs({ ...editPrefs, custom_note: e.target.value || null })}
                                            />
                                            <span className="pref-char-count">
                                                {(editPrefs.custom_note ?? "").length}/300
                                            </span>
                                        </div>
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "20px" }}>
                                        <button
                                            className="btn btn-primary"
                                            onClick={savePreferences}
                                            disabled={prefsSaving}
                                        >
                                            {prefsSaving ? "Enregistrement..." : "Enregistrer"}
                                        </button>
                                        {prefsSaved && (
                                            <span style={{ fontSize: "13px", color: "var(--green, #22c55e)" }}>
                                                Préférences enregistrées.
                                            </span>
                                        )}
                                    </div>
                                </section>
                            )}

                            {/* Tab: Revenus */}
                            {driverTab === "revenus" && (
                                <section className="glass-card section-card">
                                    <div className="section-header">
                                        <h2>Revenus</h2>
                                    </div>
                                    {revenueLoading ? (
                                        <p className="dash-empty">Chargement...</p>
                                    ) : !revenue ? (
                                        <p className="dash-empty">Aucune donnée disponible.</p>
                                    ) : (
                                        <>
                                            <div className="revenue-kpis">
                                                <div className="revenue-kpi">
                                                    <p className="revenue-kpi-value">{revenue.total_earned.toFixed(2)} MAD</p>
                                                    <p className="revenue-kpi-label">Total gagné</p>
                                                </div>
                                                <div className="revenue-kpi">
                                                    <p className="revenue-kpi-value">{revenue.total_trips_with_passengers}</p>
                                                    <p className="revenue-kpi-label">Trajets réalisés</p>
                                                </div>
                                                <div className="revenue-kpi">
                                                    <p className="revenue-kpi-value">{revenue.total_passengers_transported}</p>
                                                    <p className="revenue-kpi-label">Passagers transportés</p>
                                                </div>
                                            </div>
                                            <div style={{ marginTop: 20 }}>
                                                <p className="bookings-section-label">Détail par trajet</p>
                                                {revenue.breakdown.filter((b) => b.earned > 0).length === 0 ? (
                                                    <p className="dash-empty">Aucune réservation confirmée pour le moment.</p>
                                                ) : (
                                                    <div className="revenue-list">
                                                        {revenue.breakdown.filter((b) => b.earned > 0).map((b) => (
                                                            <div key={b.ride_id} className="revenue-row">
                                                                <div>
                                                                    <p className="revenue-route">{b.origin} → {b.destination}</p>
                                                                    <p className="revenue-meta">
                                                                        {new Date(b.departure_time).toLocaleDateString("fr-MA")} · {b.passengers} passager(s) · {b.status}
                                                                    </p>
                                                                </div>
                                                                <p className="revenue-amount">{b.earned.toFixed(2)} MAD</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </section>
                            )}
                            {/* Tab: Documents */}
                            {driverTab === "documents" && (
                                <section className="glass-card section-card">
                                    <div className="section-header">
                                        <h2>Mes Documents</h2>
                                    </div>
                                    <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: 20 }}>
                                        Uploadez votre CIN et votre permis de conduire pour que l&apos;admin puisse valider votre profil conducteur.
                                    </p>
                                    {docError && <p className="alert-error" style={{ marginBottom: 12 }}>{docError}</p>}
                                    <div className="doc-upload-grid">
                                        <DocUploadCard
                                            label="Carte Nationale d'Identité (CIN)"
                                            docType="CIN"
                                            existing={docs.find((d) => d.doc_type === "CIN")}
                                            onUpload={(f) => uploadDocument(f, "CIN")}
                                            uploading={uploadingDoc}
                                        />
                                        <DocUploadCard
                                            label="Permis de conduire"
                                            docType="PERMIS"
                                            existing={docs.find((d) => d.doc_type === "PERMIS")}
                                            onUpload={(f) => uploadDocument(f, "PERMIS")}
                                            uploading={uploadingDoc}
                                        />
                                    </div>
                                </section>
                            )}
                        </>
                    )}

                    {/* ── PASSENGER ── */}
                    {isPassenger && (
                        <>
                            {/* 1. Search */}
                            <section className="glass-card section-card">
                                <h2>Rechercher un trajet</h2>
                                <form onSubmit={handleSearch} className="dash-search-form">
                                    <select
                                        value={searchOrigin}
                                        onChange={(e) => setSearchOrigin(e.target.value)}
                                        className="dash-select"
                                        required
                                    >
                                        <option value="">Ville de départ</option>
                                        {cities.map((c) => (
                                            <option key={c.name} value={c.name}>{c.name}</option>
                                        ))}
                                    </select>
                                    <select
                                        value={searchDest}
                                        onChange={(e) => setSearchDest(e.target.value)}
                                        className="dash-select"
                                        required
                                    >
                                        <option value="">Ville d&apos;arrivée</option>
                                        {cities.map((c) => (
                                            <option key={c.name} value={c.name}>{c.name}</option>
                                        ))}
                                    </select>
                                    <input
                                        type="date"
                                        value={searchDate}
                                        onChange={(e) => setSearchDate(e.target.value)}
                                        className="dash-select"
                                    />
                                    <button type="submit" className="btn btn-primary btn-sm" disabled={searching}>
                                        {searching ? "..." : "Rechercher"}
                                    </button>
                                </form>

                                {searched && (
                                    <div style={{ marginTop: "16px" }}>
                                        {searchResults.length === 0 ? (
                                            <p className="dash-empty">Aucun trajet trouvé.</p>
                                        ) : (
                                            <>
                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                                                    <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                                                        {searchResults.length} trajet(s) trouvé(s)
                                                    </span>
                                                    <div className="mode-pill" style={{ scale: "0.9" }}>
                                                        <button
                                                            className={`mode-pill-btn ${searchView === "list" ? "active" : ""}`}
                                                            onClick={() => setSearchView("list")}
                                                        >
                                                            Liste
                                                        </button>
                                                        <button
                                                            className={`mode-pill-btn ${searchView === "map" ? "active" : ""}`}
                                                            onClick={() => setSearchView("map")}
                                                        >
                                                            Carte
                                                        </button>
                                                    </div>
                                                </div>
                                                {searchView === "list" ? (
                                                    <div className="ride-list">
                                                        {searchResults.map((r) => (
                                                            <SearchResultCard key={r.id} ride={r} />
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <SearchRidesMap
                                                        rides={searchResults
                                                            .filter((r) => r.origin_lat != null && r.origin_lng != null)
                                                            .map((r) => ({
                                                                id: r.id,
                                                                origin: r.origin,
                                                                destination: r.destination,
                                                                departure_time: r.departure_time,
                                                                available_seats: r.available_seats,
                                                                price_per_seat: r.price_per_seat,
                                                                origin_lat: r.origin_lat!,
                                                                origin_lng: r.origin_lng!,
                                                                destination_lat: r.destination_lat,
                                                                destination_lng: r.destination_lng,
                                                            }))}
                                                    />
                                                )}
                                            </>
                                        )}
                                    </div>
                                )}
                            </section>

                            {/* 2. My bookings */}
                            <section className="glass-card section-card">
                                <div className="section-header">
                                    <h2>Mes Réservations</h2>
                                    {bookingsLoading && (
                                        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Chargement...</span>
                                    )}
                                </div>
                                {confirmedBookings.length === 0 && !bookingsLoading ? (
                                    <div className="empty-state">
                                        <p>Aucune réservation active.</p>
                                        <br />
                                        <Link href="/search" className="muted-link">Trouver un trajet &rarr;</Link>
                                    </div>
                                ) : (
                                    <div className="booking-list">
                                        {confirmedBookings.map((b) => (
                                            <BookingItem
                                                key={b.id}
                                                booking={b}
                                                onCancel={cancelBooking}
                                                cancelling={cancellingId === b.id}
                                                onRate={b.ride_status === "COMPLETED" && b.status === "CONFIRMED" && !ratedRideIds.has(b.ride_id)
                                                    ? () => setRatingTarget({ bookingId: b.id, rideId: b.ride_id, driverId: b.driver_id, driverName: b.driver_name, origin: b.origin, destination: b.destination })
                                                    : undefined}
                                                alreadyRated={ratedRideIds.has(b.ride_id)}
                                                onMessageClick={() => setUnreadCount(0)}
                                            />
                                        ))}
                                    </div>
                                )}
                                {pastBookings.length > 0 && (
                                    <details style={{ marginTop: "16px" }}>
                                        <summary style={{ cursor: "pointer", fontSize: "13px", color: "var(--text-muted)" }}>
                                            Historique ({pastBookings.length} annulée{pastBookings.length > 1 ? "s" : ""})
                                        </summary>
                                        <div className="booking-list" style={{ marginTop: "8px" }}>
                                            {pastBookings.map((b) => (
                                                <BookingItem key={b.id} booking={b} onCancel={cancelBooking} cancelling={false} />
                                            ))}
                                        </div>
                                    </details>
                                )}
                            </section>

                            {/* 3. Frequent routes + alerts */}
                            <HabitualsAlertsSection
                                apiUrl={apiUrl}
                                frequentRoutes={frequentRoutes}
                                onQuickSearch={(origin, dest) => {
                                    setSearchOrigin(origin);
                                    setSearchDest(dest);
                                    setSearchDate("");
                                    setSearched(false);
                                    window.scrollTo({ top: 0, behavior: "smooth" });
                                }}
                            />
                        </>
                    )}

                    {!isDriver && !isPassenger && isAdmin && (
                        <section className="glass-card section-card" style={{ textAlign: "center", padding: "40px 24px" }}>
                            <h2 style={{ marginBottom: 12 }}>Tableau de bord administrateur</h2>
                            <p className="dashboard-subtitle" style={{ marginBottom: 24 }}>Vous êtes connecté en tant qu&apos;administrateur. Accédez au panneau de contrôle complet.</p>
                            <a href="/admin" style={{ display: "inline-block", padding: "10px 28px", background: "#ff6a1a", color: "#fff", borderRadius: 10, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>
                                Ouvrir le dashboard Admin
                            </a>
                        </section>
                    )}
                    {!isDriver && !isPassenger && !isAdmin && (
                        <section className="glass-card section-card">
                            <h2>Rôle inconnu</h2>
                            <p className="dashboard-subtitle">Rôle actuel : {user.role}</p>
                        </section>
                    )}
                </section>
            </div>
        </main>
        {ratingTarget && (
            <RatingModal
                rideId={ratingTarget.rideId}
                driverId={ratingTarget.driverId}
                driverName={ratingTarget.driverName}
                origin={ratingTarget.origin}
                destination={ratingTarget.destination}
                onClose={() => setRatingTarget(null)}
                onSuccess={() => {
                    setRatedRideIds((prev) => new Set([...prev, ratingTarget.rideId]));
                    setRatingTarget(null);
                }}
            />
        )}
        {passengerRatingTarget && (
            <PassengerRatingModal
                rideId={passengerRatingTarget.rideId}
                passengerId={passengerRatingTarget.passengerId}
                passengerName={passengerRatingTarget.passengerName}
                origin={passengerRatingTarget.origin}
                destination={passengerRatingTarget.destination}
                onClose={() => setPassengerRatingTarget(null)}
                onSuccess={() => {
                    const key = `${passengerRatingTarget.rideId}-${passengerRatingTarget.passengerId}`;
                    setRatedPassengerKeys((prev) => new Set([...prev, key]));
                    setPassengerRatingTarget(null);
                }}
            />
        )}
        </>
    );
}


// ── Sub-components ─────────────────────────────────────────────────────────────

interface Passenger {
    booking_id: string;
    passenger_id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    seats_booked: number;
    total_price: number;
    status: string;
    booked_at: string;
}

function RideCard({
    ride,
    editing,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onCancelRide,
    onCompleteRide,
    cancelling,
    completing,
}: {
    ride: Ride;
    editing?: boolean;
    onStartEdit?: () => void;
    onCancelEdit?: () => void;
    onSaveEdit?: (fields: Partial<RideEditFields>) => void;
    onCancelRide?: () => void;
    onCompleteRide?: () => void;
    cancelling?: boolean;
    completing?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [passengers, setPassengers] = useState<Passenger[]>([]);
    const [loadingP, setLoadingP] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editFields, setEditFields] = useState<RideEditFields>({
        departure_time: ride.departure_time.slice(0, 16),
        available_seats: ride.available_seats,
        price_per_seat: ride.price_per_seat,
        pickup_location: ride.pickup_location ?? "",
        dropoff_location: ride.dropoff_location ?? "",
    });

    const isCancelled = ride.status === "CANCELLED";
    const date = new Date(ride.departure_time).toLocaleString("fr-MA", {
        weekday: "short", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
    });

    async function togglePassengers() {
        if (open) { setOpen(false); return; }
        setOpen(true);
        if (passengers.length > 0) return;
        setLoadingP(true);
        try {
            const res = await apiFetch(`/rides/${ride.id}/passengers`);
            if (res.ok) setPassengers(await res.json());
        } finally {
            setLoadingP(false);
        }
    }

    async function handleSave() {
        setSaving(true);
        try { onSaveEdit?.(editFields); }
        finally { setSaving(false); }
    }

    return (
        <div className={`ride-card-driver ${isCancelled ? "cancelled" : ""}`}>
            <div className="ride-card-driver-top" onClick={togglePassengers}>
                <div>
                    <p className="ride-card-title">
                        {ride.origin} &rarr; {ride.destination}
                        {ride.is_recurring && (
                            <span style={{ marginLeft: 8, fontSize: 11, padding: "2px 7px", borderRadius: 10, background: "rgba(99,102,241,.18)", color: "#818cf8", fontWeight: 600, verticalAlign: "middle" }}>
                                ↻ Récurrent
                            </span>
                        )}
                    </p>
                    <p className="ride-card-meta">{date} · {ride.status}</p>
                </div>
                <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                    <p className="ride-card-price">{ride.price_per_seat} MAD</p>
                    <span className="badge">{ride.available_seats} place(s) libre(s)</span>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                        {open ? "Masquer ▲" : "Passagers ▼"}
                    </span>
                </div>
            </div>

            {!isCancelled && (
                <div className="ride-card-actions">
                    {!editing ? (
                        <>
                            <button className="btn-edit-ride" onClick={(e) => { e.stopPropagation(); onStartEdit?.(); }}>
                                Modifier
                            </button>
                            {ride.status === "ACTIVE" && (
                                <button className="btn-complete-ride" onClick={(e) => { e.stopPropagation(); onCompleteRide?.(); }} disabled={completing}>
                                    {completing ? "..." : "Terminer le trajet"}
                                </button>
                            )}
                            <button className="btn-cancel-ride" onClick={(e) => { e.stopPropagation(); onCancelRide?.(); }} disabled={cancelling}>
                                {cancelling ? "..." : "Annuler"}
                            </button>
                        </>
                    ) : (
                        <div className="ride-edit-form" onClick={(e) => e.stopPropagation()}>
                            <div className="form-row">
                                <div>
                                    <label>Date et heure</label>
                                    <input
                                        type="datetime-local"
                                        value={editFields.departure_time}
                                        onChange={(e) => setEditFields({ ...editFields, departure_time: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label>Places disponibles</label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={editFields.available_seats}
                                        onChange={(e) => setEditFields({ ...editFields, available_seats: +e.target.value })}
                                    />
                                </div>
                            </div>
                            <div className="form-row">
                                <div>
                                    <label>Prix / place (MAD)</label>
                                    <input
                                        type="number"
                                        min={0}
                                        value={editFields.price_per_seat}
                                        onChange={(e) => setEditFields({ ...editFields, price_per_seat: +e.target.value })}
                                    />
                                </div>
                            </div>
                            <div>
                                <label>Point de prise en charge (optionnel)</label>
                                <input
                                    type="text"
                                    placeholder="Ex: Café Central, Gare Routière..."
                                    value={editFields.pickup_location}
                                    onChange={(e) => setEditFields({ ...editFields, pickup_location: e.target.value })}
                                />
                            </div>
                            <div>
                                <label>Point de dépose (optionnel)</label>
                                <input
                                    type="text"
                                    placeholder="Ex: Centre-ville, Université..."
                                    value={editFields.dropoff_location}
                                    onChange={(e) => setEditFields({ ...editFields, dropoff_location: e.target.value })}
                                />
                            </div>
                            <div className="ride-edit-form-actions">
                                <button className="btn-edit-ride" onClick={onCancelEdit}>Annuler</button>
                                <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                                    {saving ? "Enregistrement..." : "Enregistrer"}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {open && (
                <div className="passenger-list">
                    {loadingP && <p className="dash-empty">Chargement...</p>}
                    {!loadingP && passengers.length === 0 && (
                        <p className="dash-empty">Aucune réservation pour ce trajet.</p>
                    )}
                    {passengers.map((p) => (
                        <div key={p.booking_id} className={`passenger-item ${p.status === "CANCELLED" ? "cancelled" : ""}`}>
                            <div>
                                <p className="passenger-name">{p.first_name} {p.last_name}</p>
                                <p className="passenger-meta">{p.email}{p.phone ? ` · ${p.phone}` : ""}</p>
                                <p className="passenger-meta">{p.seats_booked} place(s) · {p.total_price} MAD</p>
                            </div>
                            <span className={`booking-badge ${p.status === "CONFIRMED" ? "confirmed" : "cancelled"}`}>
                                {p.status === "CONFIRMED" ? "Confirmé" : "Annulé"}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function DriverBookingCard({
    booking,
    onAccept,
    onRefuse,
    actioning,
    onMessageClick,
    onRatePassenger,
    alreadyRatedPassenger,
}: {
    booking: DriverBooking;
    onAccept?: () => void;
    onRefuse?: () => void;
    actioning?: boolean;
    onMessageClick?: () => void;
    onRatePassenger?: () => void;
    alreadyRatedPassenger?: boolean;
}) {
    const date = new Date(booking.departure_time).toLocaleString("fr-MA", {
        weekday: "short", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
    });
    const isPending   = booking.status === "PENDING";
    const isConfirmed = booking.status === "CONFIRMED";
    const isCompleted = booking.ride_status === "COMPLETED";

    return (
        <div className={`booking-item ${booking.status === "CANCELLED" ? "cancelled" : ""} ${isPending ? "pending" : ""}`}>
            <div className="booking-item-info">
                <Link href={`/rides/${booking.ride_id}`} className="booking-route">
                    {booking.origin} → {booking.destination}
                </Link>
                <p className="booking-meta">
                    {date} · {booking.passenger_name} · {booking.seats_booked} place(s)
                </p>
                <p className="booking-price">{booking.total_price} MAD</p>
            </div>
            <div className="booking-item-actions">
                <span className={`booking-badge ${isConfirmed ? "confirmed" : isPending ? "pending-badge-inline" : "cancelled"}`}>
                    {isConfirmed ? (isCompleted ? "Terminée" : "Acceptée") : isPending ? "En attente" : "Refusée"}
                </span>
                {(isPending || isConfirmed) && !isCompleted && (
                    <Link href={`/messages/${booking.booking_id}`} className="btn-message" onClick={onMessageClick}>
                        Message
                    </Link>
                )}
                {isPending && onAccept && (
                    <button className="btn-accept-booking" onClick={onAccept} disabled={actioning}>
                        {actioning ? "..." : "Accepter"}
                    </button>
                )}
                {(isPending || isConfirmed) && onRefuse && !isCompleted && (
                    <button className="btn-cancel-booking" onClick={onRefuse} disabled={actioning}>
                        {actioning ? "..." : "Refuser"}
                    </button>
                )}
                {isConfirmed && isCompleted && (
                    alreadyRatedPassenger ? (
                        <span style={{ fontSize: 12, color: "#22c55e", fontWeight: 600 }}>★ Évalué</span>
                    ) : onRatePassenger ? (
                        <button className="btn btn-secondary btn-sm" style={{ fontSize: 12 }} onClick={onRatePassenger}>
                            ★ Évaluer
                        </button>
                    ) : null
                )}
            </div>
        </div>
    );
}

function SearchResultCard({ ride }: { ride: Ride }) {
    const date = new Date(ride.departure_time).toLocaleString("fr-MA", {
        weekday: "short", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
    });
    return (
        <Link href={`/rides/${ride.id}`} className="ride-card">
            <div>
                <p className="ride-card-title">{ride.origin} &rarr; {ride.destination}</p>
                <p className="ride-card-meta">{date} · {ride.available_seats} place(s)</p>
            </div>
            <div style={{ textAlign: "right" }}>
                <p className="ride-card-price">{ride.price_per_seat} MAD</p>
                <span className="badge" style={{ background: "rgba(99,102,241,0.15)", color: "#a5b4fc" }}>Voir</span>
            </div>
        </Link>
    );
}

function BookingItem({
    booking,
    onCancel,
    cancelling,
    onRate,
    alreadyRated,
    onMessageClick,
}: {
    booking: MyBooking;
    onCancel: (id: string) => void;
    cancelling: boolean;
    onRate?: () => void;
    alreadyRated?: boolean;
    onMessageClick?: () => void;
}) {
    const date = new Date(booking.departure_time).toLocaleString("fr-MA", {
        weekday: "short", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
    });
    const isConfirmed = booking.status === "CONFIRMED";
    const isPending   = booking.status === "PENDING";
    const isCancelled = booking.status === "CANCELLED";

    return (
        <div className={`booking-item ${isCancelled ? "cancelled" : ""} ${isPending ? "pending" : ""}`}>
            <div className="booking-item-info">
                <Link href={`/rides/${booking.ride_id}`} className="booking-route">
                    {booking.origin} → {booking.destination}
                </Link>
                <p className="booking-meta">
                    {date} · {booking.driver_name} · {booking.seats_booked} place(s)
                </p>
                <p className="booking-price">{booking.total_price} MAD</p>
            </div>
            <div className="booking-item-actions">
                <span className={`booking-badge ${isConfirmed ? "confirmed" : isPending ? "pending-badge-inline" : "cancelled"}`}>
                    {isConfirmed ? "Confirmée" : isPending ? "En attente" : "Annulée"}
                </span>
                {(isConfirmed || isPending) && (
                    <button
                        className="btn-cancel-booking"
                        onClick={() => onCancel(booking.id)}
                        disabled={cancelling}
                    >
                        {cancelling ? "..." : "Annuler"}
                    </button>
                )}
                {(isConfirmed || isPending) && (
                    <Link href={`/messages/${booking.id}`} className="btn-message" onClick={onMessageClick}>
                        Message
                    </Link>
                )}
                {onRate && !alreadyRated && (
                    <button className="btn-rate-driver" onClick={onRate}>
                        Évaluer
                    </button>
                )}
                {alreadyRated && (
                    <span style={{ fontSize: "12px", color: "var(--green)" }}>Noté ★</span>
                )}
            </div>
        </div>
    );
}


function DocUploadCard({
    label,
    docType,
    existing,
    onUpload,
    uploading,
}: {
    label: string;
    docType: "CIN" | "PERMIS";
    existing?: DriverDoc;
    onUpload: (f: File) => void;
    uploading: boolean;
}) {
    const statusColors: Record<string, string> = {
        PENDING: "#facc15",
        APPROVED: "var(--green)",
        REJECTED: "var(--red)",
    };
    const statusLabels: Record<string, string> = {
        PENDING: "En attente de validation",
        APPROVED: "Validé",
        REJECTED: "Rejeté",
    };

    return (
        <div className="doc-upload-card">
            <p className="doc-upload-label">{label}</p>
            {existing ? (
                <div>
                    <p className="doc-filename">{existing.original_name}</p>
                    <span className="doc-status" style={{ color: statusColors[existing.status] ?? "var(--text-muted)" }}>
                        {statusLabels[existing.status] ?? existing.status}
                    </span>
                    {existing.admin_note && (
                        <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: 4 }}>
                            Note admin : {existing.admin_note}
                        </p>
                    )}
                    <label className="doc-replace-btn">
                        Remplacer
                        <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            style={{ display: "none" }}
                            disabled={uploading}
                            onChange={(e) => { if (e.target.files?.[0]) onUpload(e.target.files[0]); }}
                        />
                    </label>
                </div>
            ) : (
                <label className="doc-upload-btn">
                    {uploading ? "Upload en cours..." : "Choisir un fichier"}
                    <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        style={{ display: "none" }}
                        disabled={uploading}
                        onChange={(e) => { if (e.target.files?.[0]) onUpload(e.target.files[0]); }}
                    />
                </label>
            )}
        </div>
    );
}

function PrefToggle({
    label,
    value,
    onChange,
}: {
    label: string;
    value: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <div className="pref-item">
            <span className="pref-label">{label}</span>
            <button
                type="button"
                className={`pref-toggle ${value ? "on" : "off"}`}
                onClick={() => onChange(!value)}
            >
                {value ? "Oui" : "Non"}
            </button>
        </div>
    );
}

interface Alert { id: string; origin: string; destination: string; created_at: string; }

interface FreqRoute { origin: string; destination: string; n: number; }

function HabitualsAlertsSection({
    apiUrl,
    frequentRoutes,
    onQuickSearch,
}: {
    apiUrl: string;
    frequentRoutes: FreqRoute[];
    onQuickSearch: (origin: string, dest: string) => void;
}) {
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);

    useEffect(() => {
        const token = sessionStorage.getItem("access_token");
        if (!token) return;
        fetch(`${apiUrl}/alerts/me`, { headers: { Authorization: `Bearer ${token}` } })
            .then((r) => r.ok ? r.json() : [])
            .then((d) => { setAlerts(Array.isArray(d) ? d : []); setLoaded(true); });
    }, [apiUrl]);

    function alertFor(origin: string, dest: string) {
        return alerts.find(
            (a) => a.origin.toLowerCase() === origin.toLowerCase() &&
                   a.destination.toLowerCase() === dest.toLowerCase()
        );
    }

    async function enableAlert(origin: string, destination: string) {
        const key = `${origin}-${destination}`;
        const token = sessionStorage.getItem("access_token");
        if (!token) return;
        setSaving(key);
        try {
            const res = await fetch(`${apiUrl}/alerts`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ origin, destination }),
            });
            if (res.ok) {
                const newAlert = await res.json();
                setAlerts((prev) => [...prev, newAlert]);
            } else if (res.status === 409) {
                const r2 = await fetch(`${apiUrl}/alerts/me`, { headers: { Authorization: `Bearer ${token}` } });
                if (r2.ok) setAlerts(await r2.json());
            }
        } finally {
            setSaving(null);
        }
    }

    async function disableAlert(id: string) {
        const token = sessionStorage.getItem("access_token");
        if (!token) return;
        setDeleting(id);
        await fetch(`${apiUrl}/alerts/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
        setAlerts((prev) => prev.filter((a) => a.id !== id));
        setDeleting(null);
    }

    const extraAlerts = loaded
        ? alerts.filter((a) => !frequentRoutes.some(
            (r) => r.origin.toLowerCase() === a.origin.toLowerCase() &&
                   r.destination.toLowerCase() === a.destination.toLowerCase()
          ))
        : [];

    if (frequentRoutes.length === 0 && extraAlerts.length === 0 && (!loaded || alerts.length === 0)) return null;

    return (
        <section className="glass-card section-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                    <h2 style={{ margin: 0 }}>Trajets Habituels</h2>
                    <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                        Activez les alertes pour être notifié par email dès qu'un trajet est publié
                    </p>
                </div>
            </div>

            {frequentRoutes.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {frequentRoutes.map((r) => {
                        const alert = alertFor(r.origin, r.destination);
                        const key = `${r.origin}-${r.destination}`;
                        const isSaving = saving === key;
                        const isDeleting = alert ? deleting === alert.id : false;
                        return (
                            <div
                                key={key}
                                style={{
                                    display: "flex", alignItems: "center", justifyContent: "space-between",
                                    gap: 12, padding: "12px 16px", borderRadius: 12,
                                    background: alert ? "rgba(34,197,94,.06)" : "rgba(255,255,255,0.04)",
                                    border: alert ? "1px solid rgba(34,197,94,.25)" : "1px solid var(--border-soft)",
                                }}
                            >
                                <button
                                    onClick={() => onQuickSearch(r.origin, r.destination)}
                                    style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", flex: 1 }}
                                >
                                    <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "var(--text-main)" }}>
                                        {r.origin} → {r.destination}
                                    </p>
                                    <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                                        {r.n}× effectué · cliquer pour rechercher
                                    </p>
                                </button>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                                    {alert ? (
                                        <>
                                            <span style={{ fontSize: 12, color: "#22c55e", fontWeight: 600, whiteSpace: "nowrap" }}>
                                                🔔 Alertes actives
                                            </span>
                                            <button
                                                onClick={() => disableAlert(alert.id)}
                                                disabled={isDeleting}
                                                className="btn btn-secondary btn-sm"
                                                style={{ fontSize: 11 }}
                                            >
                                                {isDeleting ? "…" : "Désactiver"}
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            onClick={() => enableAlert(r.origin, r.destination)}
                                            disabled={isSaving}
                                            className="btn btn-primary btn-sm"
                                            style={{ fontSize: 12 }}
                                        >
                                            {isSaving ? "…" : "🔔 Activer"}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    Effectuez au moins un trajet pour voir vos itinéraires habituels ici.
                </p>
            )}

            {extraAlerts.length > 0 && (
                <div style={{ marginTop: 16, borderTop: "1px solid var(--border-soft)", paddingTop: 16 }}>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, fontWeight: 600 }}>
                        Autres alertes actives
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {extraAlerts.map((a) => (
                            <div
                                key={a.id}
                                style={{
                                    display: "flex", alignItems: "center", justifyContent: "space-between",
                                    gap: 12, padding: "9px 14px", borderRadius: 10,
                                    background: "rgba(99,102,241,.06)", border: "1px solid rgba(99,102,241,.18)",
                                }}
                            >
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{a.origin} → {a.destination}</span>
                                <button
                                    onClick={() => disableAlert(a.id)}
                                    disabled={deleting === a.id}
                                    className="btn btn-secondary btn-sm"
                                    style={{ fontSize: 11 }}
                                >
                                    {deleting === a.id ? "…" : "Supprimer"}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </section>
    );
}
