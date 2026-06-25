"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Stats {
    users: { total: number; admins: number; drivers: number; passengers: number; verified: number; unverified: number };
    rides: { total: number; active: number; completed: number; cancelled: number };
    bookings: { total: number; confirmed: number; pending: number };
    documents: { pending: number };
    ratings: { total: number };
    reports: { total: number; pending: number };
    revenue: { total_confirmed_mad: number };
    top_origins: { city: string; count: number }[];
    top_destinations: { city: string; count: number }[];
    top_drivers: { id: string; name: string; count: number }[];
    suspicious_count: number;
}
interface AdminUser {
    id: string; first_name: string; last_name: string; email: string;
    phone: string | null; role: string; is_verified: boolean;
    created_at: string; rides_count: number; bookings_count: number;
    reports_received_count: number;
}
interface AdminRide {
    id: string; origin: string; destination: string; departure_time: string;
    available_seats: number; price_per_seat: number; status: string;
    driver_name: string; driver_id: string; bookings_count: number;
    reports_count: number; suspect: boolean;
}
interface RideDetail {
    id: string; origin: string; destination: string; departure_time: string;
    available_seats: number; price_per_seat: number; status: string;
    pickup_location: string | null; dropoff_location: string | null;
    driver: { id: string; name: string; email: string } | null;
    bookings: { id: string; passenger_name: string; passenger_email: string; seats: number; status: string; total_price: number }[];
    reports: { id: string; reason: string; status: string; reporter: string; created_at: string }[];
}
interface AdminDoc {
    id: string; driver_id: string; driver_name: string; driver_email: string;
    doc_type: string; original_name: string; file_url: string;
    status: string; admin_note: string | null; created_at: string;
}
interface AdminRating {
    id: string; ride_id: string; passenger_id: string; driver_id: string;
    stars: number; comment: string | null; created_at: string;
    passenger_name: string; driver_name: string;
}
interface AdminReport {
    id: string; reporter_id: string | null; reporter_name: string;
    target_type: string; target_id: string; reason: string;
    status: string; admin_note: string | null; created_at: string;
}
interface SuspRating  { id: string; stars: number; comment: string | null; created_at: string; passenger_name: string; driver_name: string; reason: string; level: string; }
interface SuspRide    { id: string; origin: string; destination: string; price_per_seat: number; avg_price: number; driver_name: string; driver_id: string; departure_time: string; status: string; reason: string; level: string; }
interface SuspUser    { id: string; name: string; email: string; role: string; reports_count: number; reason: string; level: string; }
interface SuspData    { ratings: SuspRating[]; rides: SuspRide[]; users: SuspUser[]; }
interface ConfirmModal { title: string; message: string; danger?: boolean; withNote?: boolean; notePlaceholder?: string; onConfirm: (note?: string) => Promise<void> | void; }

type Section = "overview" | "users" | "rides" | "reports" | "documents" | "ratings" | "stats";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";

const NAV: { id: Section; label: string; icon: string }[] = [
    { id: "overview",   label: "Vue d'ensemble", icon: "◈" },
    { id: "users",      label: "Utilisateurs",   icon: "◉" },
    { id: "rides",      label: "Trajets",         icon: "◎" },
    { id: "reports",    label: "Signalements",    icon: "⚑" },
    { id: "documents",  label: "Documents",       icon: "▤" },
    { id: "ratings",    label: "Avis & Abus",     icon: "◆" },
    { id: "stats",      label: "Statistiques",    icon: "▣" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string) {
    return new Date(s).toLocaleDateString("fr-MA", { day: "numeric", month: "short", year: "numeric" });
}
function fmtDatetime(s: string) {
    return new Date(s).toLocaleDateString("fr-MA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Badge({ text, color }: { text: string; color: "green" | "red" | "orange" | "yellow" | "blue" | "gray" | "purple" }) {
    return <span className={`adm-badge adm-badge-${color}`}>{text}</span>;
}

function roleBadge(role: string) {
    if (role === "ADMIN")     return <Badge text="Admin"      color="orange" />;
    if (role === "DRIVER")    return <Badge text="Conducteur" color="blue" />;
    if (role === "PASSENGER") return <Badge text="Passager"   color="gray" />;
    return <Badge text={role} color="gray" />;
}

function statusBadge(s: string) {
    const map: Record<string, [string, "green" | "red" | "orange" | "yellow" | "blue" | "gray"]> = {
        ACTIVE: ["Actif", "green"], FULL: ["Complet", "yellow"], COMPLETED: ["Terminé", "blue"],
        CANCELLED: ["Annulé", "red"], CONFIRMED: ["Confirmée", "green"],
        PENDING: ["En attente", "yellow"], RESOLVED: ["Résolu", "blue"], DISMISSED: ["Ignoré", "gray"],
        APPROVED: ["Validé", "green"], REJECTED: ["Rejeté", "red"],
    };
    const [label, color] = map[s] ?? [s, "gray"];
    return <Badge text={label} color={color} />;
}

function levelBadge(level: string) {
    if (level === "high")   return <Badge text="Critique" color="red" />;
    if (level === "medium") return <Badge text="Moyen"    color="yellow" />;
    return <Badge text="Faible" color="gray" />;
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
    const pct = max > 0 ? Math.round((value / max) * 100) : 0;
    return (
        <div className="adm-bar-track">
            <div className="adm-bar-fill" style={{ width: `${pct}%`, background: color }} />
        </div>
    );
}

function EmptyState({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
    return (
        <div className="adm-empty">
            <div className="adm-empty-icon">{icon}</div>
            <div className="adm-empty-title">{title}</div>
            {sub && <div className="adm-empty-sub">{sub}</div>}
        </div>
    );
}

function Spinner() {
    return (
        <div style={{ padding: "40px 20px", textAlign: "center" }}>
            <div style={{ width: 28, height: 28, border: "2px solid rgba(255,255,255,0.06)", borderTopColor: "#ff6a1a", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto" }} />
        </div>
    );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: "orange" | "red" | "green" | "blue" | "yellow" }) {
    return (
        <div className={`adm-stat${accent ? ` accent-${accent}` : ""}`}>
            <div className="adm-stat-label">{label}</div>
            <div className="adm-stat-value">{value}</div>
            {sub && <div className="adm-stat-sub">{sub}</div>}
        </div>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdminPage() {
    const router = useRouter();

    // Auth
    const [admin, setAdmin]           = useState<{ id: string; first_name: string; email: string } | null>(null);
    const [accessDenied, setDenied]   = useState(false);
    const [authLoading, setAuthLoad]  = useState(true);

    // Section
    const [section, setSection] = useState<Section>("overview");

    // Data
    const [stats,    setStats]    = useState<Stats | null>(null);
    const [users,    setUsers]    = useState<AdminUser[]>([]);
    const [rides,    setRides]    = useState<AdminRide[]>([]);
    const [docs,     setDocs]     = useState<AdminDoc[]>([]);
    const [ratings,  setRatings]  = useState<AdminRating[]>([]);
    const [reports,  setReports]  = useState<AdminReport[]>([]);
    const [susp,     setSusp]     = useState<SuspData | null>(null);

    // Section loading
    const [loading, setLoading] = useState(false);

    // Loaded flags (lazy-load per section)
    const loaded = useRef<Set<string>>(new Set());

    // Filters – users
    const [uSearch,    setUSearch]    = useState("");
    const [uRole,      setURole]      = useState("ALL");
    const [uVerified,  setUVerified]  = useState("ALL");
    const [uReported,  setUReported]  = useState(false);

    // Filters – rides
    const [rSearch,    setRSearch]    = useState("");
    const [rStatus,    setRStatus]    = useState("ALL");
    const [rSuspect,   setRSuspect]   = useState(false);

    // Filters – reports
    const [rpStatus,   setRpStatus]   = useState("ALL");
    const [rpType,     setRpType]     = useState("ALL");

    // Filters – docs
    const [dStatus,    setDStatus]    = useState("PENDING");
    const [dType,      setDType]      = useState("ALL");

    // Filters – ratings
    const [ratSuspect, setRatSuspect] = useState(false);

    // Modal
    const [modal, setModal]             = useState<ConfirmModal | null>(null);
    const [modalNote, setModalNote]     = useState("");
    const [modalLoading, setModalLoad]  = useState(false);

    // Drawer
    const [drawer, setDrawer]            = useState<{ type: "user" | "ride" | "report"; data: AdminUser | RideDetail | AdminReport } | null>(null);
    const [drawerLoading, setDrawerLoad] = useState(false);

    // Misc
    const [lastRefresh, setLastRefresh] = useState(new Date());
    const [countdown,   setCountdown]   = useState(30);
    const [docNote,     setDocNote]     = useState<Record<string, string>>({});
    const [suspTab,     setSuspTab]     = useState<"ratings" | "rides" | "users">("ratings");

    // ── Auth / initial load ───────────────────────────────────────────────────
    useEffect(() => {
        apiFetch("/auth/me")
            .then(r => {
                if (r.status === 401) { router.push("/login"); return null; }
                if (r.status === 403) { setDenied(true); setAuthLoad(false); return null; }
                return r.json();
            })
            .then(d => {
                if (!d) return;
                if (d.role !== "ADMIN") { setDenied(true); setAuthLoad(false); return; }
                setAdmin({ id: d.id, first_name: d.first_name, email: d.email });
                setAuthLoad(false);
            })
            .catch(() => { router.push("/login"); });
    }, [router]);

    // ── Stats fetch + auto-refresh ────────────────────────────────────────────
    const fetchStats = useCallback(() => {
        apiFetch("/admin/stats")
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) { setStats(d); setLastRefresh(new Date()); setCountdown(30); } });
    }, []);

    useEffect(() => {
        if (!admin) return;
        fetchStats();
        const id = setInterval(fetchStats, 30_000);
        return () => clearInterval(id);
    }, [admin, fetchStats]);

    // Countdown tick
    useEffect(() => {
        const id = setInterval(() => setCountdown(c => c <= 1 ? 30 : c - 1), 1000);
        return () => clearInterval(id);
    }, []);

    // ── Lazy-load per section ─────────────────────────────────────────────────
    const loadSection = useCallback(async (sec: Section) => {
        if (loaded.current.has(sec)) return;
        setLoading(true);
        try {
            if (sec === "users") {
                const r = await apiFetch("/admin/users");
                if (r.ok) setUsers(await r.json());
                loaded.current.add("users");
            }
            if (sec === "rides") {
                const r = await apiFetch("/admin/rides");
                if (r.ok) setRides(await r.json());
                loaded.current.add("rides");
            }
            if (sec === "documents") {
                const r = await apiFetch("/documents/admin/all");
                if (r.ok) setDocs(await r.json());
                loaded.current.add("documents");
            }
            if (sec === "ratings") {
                const [rr, rs] = await Promise.all([apiFetch("/admin/ratings"), apiFetch("/admin/suspicious")]);
                if (rr.ok) setRatings(await rr.json());
                if (rs.ok) setSusp(await rs.json());
                loaded.current.add("ratings");
            }
            if (sec === "reports") {
                const r = await apiFetch("/admin/reports");
                if (r.ok) setReports(await r.json());
                loaded.current.add("reports");
            }
        } finally {
            setLoading(false);
        }
    }, []);

    const switchSection = (s: Section) => {
        setSection(s);
        loadSection(s);
    };

    // ── Confirm modal helper ──────────────────────────────────────────────────
    function confirm(m: ConfirmModal) { setModal(m); setModalNote(""); }
    async function runModal() {
        if (!modal) return;
        setModalLoad(true);
        try { await modal.onConfirm(modal.withNote ? modalNote : undefined); }
        finally { setModalLoad(false); setModal(null); }
    }

    // ── Ride detail drawer ────────────────────────────────────────────────────
    async function openRide(rideId: string) {
        setDrawerLoad(true);
        setDrawer(null);
        const r = await apiFetch(`/admin/rides/${rideId}`);
        if (r.ok) {
            const d = await r.json();
            setDrawer({ type: "ride", data: d as RideDetail });
        }
        setDrawerLoad(false);
    }

    // ── Actions ───────────────────────────────────────────────────────────────
    async function changeRole(userId: string, newRole: string) {
        const res = await apiFetch(`/admin/users/${userId}/role`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: newRole }),
        });
        if (res.ok) {
            setUsers(u => u.map(x => x.id === userId ? { ...x, role: newRole } : x));
        } else {
            const d = await res.json().catch(() => ({}));
            alert(d.detail || "Erreur lors du changement de rôle.");
        }
    }

    async function toggleVerify(userId: string) {
        const res = await apiFetch(`/admin/users/${userId}/verify`, { method: "PATCH" });
        if (res.ok) {
            const d = await res.json();
            setUsers(u => u.map(x => x.id === userId ? { ...x, is_verified: d.is_verified } : x));
        }
    }

    async function deleteUser(userId: string) {
        const res = await apiFetch(`/admin/users/${userId}`, { method: "DELETE" });
        if (res.ok) setUsers(u => u.filter(x => x.id !== userId));
        else alert("Erreur lors de la suppression.");
    }

    async function cancelRide(rideId: string) {
        const res = await apiFetch(`/admin/rides/${rideId}`, { method: "DELETE" });
        if (res.ok) {
            setRides(r => r.map(x => x.id === rideId ? { ...x, status: "CANCELLED" } : x));
            if (drawer?.type === "ride" && (drawer.data as RideDetail).id === rideId) {
                setDrawer(d => d ? { ...d, data: { ...(d.data as RideDetail), status: "CANCELLED" } } : null);
            }
        } else alert("Erreur lors de l'annulation.");
    }

    async function resolveReport(reportId: string, status: "RESOLVED" | "DISMISSED", note?: string) {
        const res = await apiFetch(`/admin/reports/${reportId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status, admin_note: note || null }),
        });
        if (res.ok) {
            const d = await res.json();
            setReports(r => r.map(x => x.id === reportId ? { ...x, status: d.status, admin_note: d.admin_note } : x));
        }
    }

    async function deleteRating(ratingId: string) {
        const res = await apiFetch(`/admin/ratings/${ratingId}`, { method: "DELETE" });
        if (res.ok) {
            setRatings(r => r.filter(x => x.id !== ratingId));
            if (susp) setSusp({ ...susp, ratings: susp.ratings.filter(x => x.id !== ratingId) });
        }
    }

    async function reviewDoc(docId: string, status: "APPROVED" | "REJECTED") {
        const res = await apiFetch(`/documents/admin/${docId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status, admin_note: docNote[docId] || null }),
        });
        if (res.ok) {
            const d = await res.json();
            setDocs(docs => docs.map(x => x.id === docId ? { ...x, ...d } : x));
        }
    }

    async function banUser(userId: string) {
        const res = await apiFetch(`/admin/users/${userId}`, { method: "DELETE" });
        if (res.ok) {
            setUsers(u => u.filter(x => x.id !== userId));
            if (susp) setSusp({ ...susp, users: susp.users.filter(x => x.id !== userId) });
        }
    }

    // ── Computed / filtered ───────────────────────────────────────────────────
    const filteredUsers = useMemo(() => users.filter(u => {
        const s = uSearch.toLowerCase();
        if (s && !`${u.first_name} ${u.last_name} ${u.email} ${u.phone ?? ""}`.toLowerCase().includes(s)) return false;
        if (uRole !== "ALL" && u.role !== uRole) return false;
        if (uVerified === "YES" && !u.is_verified) return false;
        if (uVerified === "NO"  && u.is_verified) return false;
        if (uReported && u.reports_received_count === 0) return false;
        return true;
    }), [users, uSearch, uRole, uVerified, uReported]);

    const filteredRides = useMemo(() => rides.filter(r => {
        const s = rSearch.toLowerCase();
        if (s && !`${r.origin} ${r.destination} ${r.driver_name}`.toLowerCase().includes(s)) return false;
        if (rStatus !== "ALL" && r.status !== rStatus) return false;
        if (rSuspect && !r.suspect) return false;
        return true;
    }), [rides, rSearch, rStatus, rSuspect]);

    const filteredReports = useMemo(() => reports.filter(r => {
        if (rpStatus !== "ALL" && r.status !== rpStatus) return false;
        if (rpType !== "ALL" && r.target_type !== rpType) return false;
        return true;
    }), [reports, rpStatus, rpType]);

    const filteredDocs = useMemo(() => docs.filter(d => {
        if (dStatus !== "ALL" && d.status !== dStatus) return false;
        if (dType !== "ALL" && d.doc_type !== dType) return false;
        return true;
    }), [docs, dStatus, dType]);

    const filteredRatings = useMemo(() => ratings.filter(r =>
        !ratSuspect || (r.stars <= 2 && !r.comment)
    ), [ratings, ratSuspect]);

    const pendingReports  = stats?.reports.pending ?? 0;
    const pendingDocs     = stats?.documents.pending ?? 0;
    const suspCount       = stats?.suspicious_count ?? 0;

    // ── Guards ────────────────────────────────────────────────────────────────
    if (authLoading) return (
        <div className="adm-shell" style={{ alignItems: "center", justifyContent: "center" }}>
            <Spinner />
        </div>
    );

    if (accessDenied) return (
        <div className="adm-shell" style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 48 }}>403</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>Accès refusé</div>
            <div style={{ fontSize: 14, color: "#71717a" }}>Vous n&apos;avez pas les droits administrateur.</div>
            <Link href="/dashboard" style={{ marginTop: 8, padding: "8px 20px", background: "#ff6a1a", color: "#fff", borderRadius: 8, fontWeight: 600, fontSize: 13, textDecoration: "none" }}>
                Retour au dashboard
            </Link>
        </div>
    );

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="adm-shell">
            {/* SIDEBAR */}
            <aside className="adm-sidebar">
                <div className="adm-sidebar-header">
                    <div className="adm-sidebar-logo">CovoMar</div>
                    <div className="adm-sidebar-tag">Admin</div>
                </div>
                <nav className="adm-nav">
                    <div className="adm-nav-section">Navigation</div>
                    {NAV.map(n => (
                        <div key={n.id}
                            className={`adm-nav-item${section === n.id ? " active" : ""}`}
                            onClick={() => switchSection(n.id)}
                        >
                            <span className="adm-nav-icon">{n.icon}</span>
                            <span className="adm-nav-label">{n.label}</span>
                            {n.id === "reports"   && pendingReports > 0 && <span className="adm-nav-badge">{pendingReports}</span>}
                            {n.id === "documents" && pendingDocs > 0    && <span className="adm-nav-badge">{pendingDocs}</span>}
                            {n.id === "ratings"   && suspCount > 0      && <span className="adm-nav-badge">{suspCount}</span>}
                        </div>
                    ))}
                </nav>
                <div className="adm-sidebar-footer">
                    <div className="adm-sidebar-user-name">{admin?.first_name ?? "Admin"}</div>
                    <div className="adm-sidebar-user-email">{admin?.email}</div>
                    <button className="adm-sidebar-logout" onClick={() => { localStorage.clear(); router.push("/login"); }}>
                        Se déconnecter
                    </button>
                </div>
            </aside>

            {/* MAIN */}
            <div className="adm-main">
                {/* Topbar */}
                <header className="adm-topbar">
                    <span className="adm-topbar-title">Covoit Maroc Admin</span>
                    <div className="adm-topbar-sep" />
                    <span className="adm-topbar-page">{NAV.find(n => n.id === section)?.label}</span>
                    <div style={{ flex: 1 }} />
                    <div className="adm-topbar-actions">
                        <span className="adm-refresh-pill">Refresh {countdown}s</span>
                        <button className="adm-topbar-btn" onClick={() => { fetchStats(); loaded.current.clear(); loadSection(section); }}>
                            Actualiser
                        </button>
                        <div
                            className={`adm-notif-dot${(pendingReports + pendingDocs) > 0 ? " has-notif" : ""}`}
                            onClick={() => switchSection("reports")}
                            title="Signalements en attente"
                            style={{ cursor: "pointer" }}
                        >
                            ⚑
                        </div>
                    </div>
                </header>

                {/* Content */}
                <main className="adm-content">
                    {loading ? (
                        <Spinner />
                    ) : (
                        <>
                            {section === "overview"  && <OverviewSection  stats={stats} pendingReports={pendingReports} pendingDocs={pendingDocs} suspCount={suspCount} switchSection={switchSection} admin={admin} lastRefresh={lastRefresh} />}
                            {section === "users"     && <UsersSection     users={filteredUsers} allCount={users.length} admin={admin} uSearch={uSearch} setUSearch={setUSearch} uRole={uRole} setURole={setURole} uVerified={uVerified} setUVerified={setUVerified} uReported={uReported} setUReported={setUReported} onChangeRole={(id, r) => confirm({ title: "Changer le rôle", message: `Attribuer le rôle "${r}" à cet utilisateur ?`, danger: r !== "ADMIN", onConfirm: () => changeRole(id, r) })} onToggleVerify={toggleVerify} onDelete={u => confirm({ title: "Supprimer le compte", message: `Supprimer définitivement ${u.first_name} ${u.last_name} (${u.email}) ?`, danger: true, onConfirm: () => deleteUser(u.id) })} onView={u => setDrawer({ type: "user", data: u })} />}
                            {section === "rides"     && <RidesSection     rides={filteredRides} allCount={rides.length} rSearch={rSearch} setRSearch={setRSearch} rStatus={rStatus} setRStatus={setRStatus} rSuspect={rSuspect} setRSuspect={setRSuspect} onView={openRide} onCancel={r => confirm({ title: "Annuler le trajet", message: `Annuler ${r.origin} → ${r.destination} de ${r.driver_name} ?`, danger: true, onConfirm: () => cancelRide(r.id) })} />}
                            {section === "reports"   && <ReportsSection   reports={filteredReports} allCount={reports.length} rpStatus={rpStatus} setRpStatus={setRpStatus} rpType={rpType} setRpType={setRpType} onView={r => setDrawer({ type: "report", data: r })} onResolve={(id) => confirm({ title: "Résoudre", message: "Marquer ce signalement comme résolu ?", withNote: true, notePlaceholder: "Note admin (optionnel)", onConfirm: (n) => resolveReport(id, "RESOLVED", n) })} onDismiss={id => confirm({ title: "Ignorer", message: "Ignorer ce signalement ?", onConfirm: () => resolveReport(id, "DISMISSED") })} onBan={(uid, name) => confirm({ title: "Bannir", message: `Bannir et supprimer ${name} ?`, danger: true, onConfirm: () => banUser(uid) })} />}
                            {section === "documents" && <DocsSection      docs={filteredDocs} allCount={docs.length} dStatus={dStatus} setDStatus={setDStatus} dType={dType} setDType={setDType} docNote={docNote} setDocNote={setDocNote} apiUrl={API_URL} onApprove={id => confirm({ title: "Approuver", message: "Valider ce document ?", onConfirm: () => reviewDoc(id, "APPROVED") })} onReject={id => confirm({ title: "Rejeter", message: "Rejeter ce document ?", danger: true, onConfirm: () => reviewDoc(id, "REJECTED") })} />}
                            {section === "ratings"   && <RatingsSection   ratings={filteredRatings} allCount={ratings.length} ratSuspect={ratSuspect} setRatSuspect={setRatSuspect} susp={susp} suspTab={suspTab} setSuspTab={setSuspTab} admin={admin} onDeleteRating={id => confirm({ title: "Supprimer l'avis", message: "Supprimer cet avis ?", danger: true, onConfirm: () => deleteRating(id) })} onCancelRide={r => confirm({ title: "Annuler le trajet", message: `Annuler ${r.origin} → ${r.destination} ?`, danger: true, onConfirm: () => cancelRide(r.id) })} onBanUser={(uid, name) => confirm({ title: "Bannir", message: `Bannir ${name} ?`, danger: true, onConfirm: () => banUser(uid) })} onViewRide={openRide} />}
                            {section === "stats"     && <StatsSection     stats={stats} lastRefresh={lastRefresh} onRefresh={fetchStats} />}
                        </>
                    )}
                </main>
            </div>

            {/* CONFIRM MODAL */}
            {modal && (
                <div className="adm-modal-overlay" onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
                    <div className="adm-modal">
                        <div className="adm-modal-title">{modal.title}</div>
                        <div className="adm-modal-msg">{modal.message}</div>
                        {modal.withNote && (
                            <textarea className="adm-modal-note" placeholder={modal.notePlaceholder ?? "Note…"}
                                value={modalNote} onChange={e => setModalNote(e.target.value)} />
                        )}
                        <div className="adm-modal-actions">
                            <button className="adm-btn adm-btn-ghost" onClick={() => setModal(null)} disabled={modalLoading}>Annuler</button>
                            <button className={`adm-btn ${modal.danger ? "adm-btn-danger" : "adm-btn-primary"}`}
                                onClick={runModal} disabled={modalLoading}>
                                {modalLoading ? "Traitement…" : "Confirmer"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* DRAWER */}
            {(drawer || drawerLoading) && (
                <>
                    <div className="adm-drawer-overlay" onClick={() => setDrawer(null)} />
                    <aside className="adm-drawer">
                        <div className="adm-drawer-hd">
                            <span className="adm-drawer-title">
                                {drawerLoading ? "Chargement…" : drawer?.type === "user" ? "Détail utilisateur" : drawer?.type === "ride" ? "Détail trajet" : "Détail signalement"}
                            </span>
                            <button className="adm-drawer-close" onClick={() => setDrawer(null)}>×</button>
                        </div>
                        {drawerLoading && <Spinner />}
                        {!drawerLoading && drawer?.type === "user"   && <UserDrawer   u={drawer.data as AdminUser} />}
                        {!drawerLoading && drawer?.type === "ride"   && <RideDrawer   r={drawer.data as RideDetail} />}
                        {!drawerLoading && drawer?.type === "report" && <ReportDrawer r={drawer.data as AdminReport} />}
                    </aside>
                </>
            )}
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION: Overview
// ══════════════════════════════════════════════════════════════════════════════
function OverviewSection({ stats, pendingReports, pendingDocs, suspCount, switchSection, admin, lastRefresh }: {
    stats: Stats | null; pendingReports: number; pendingDocs: number; suspCount: number;
    switchSection: (s: Section) => void; admin: { first_name: string } | null; lastRefresh: Date;
}) {
    if (!stats) return (
        <div className="adm-card" style={{ padding: 24 }}>
            <div className="adm-stats-grid">
                {Array(8).fill(0).map((_, i) => (
                    <div key={i} className="adm-stat">
                        <div className="adm-skeleton" style={{ height: 12, width: "60%", marginBottom: 12 }} />
                        <div className="adm-skeleton" style={{ height: 32, width: "80%" }} />
                    </div>
                ))}
            </div>
        </div>
    );

    type UrgentItem = { color: string; label: string; sub: string; action: () => void; cta: string };
    const urgentItems: UrgentItem[] = [
        ...(pendingReports > 0 ? [{ color: "#ef4444", label: `${pendingReports} signalement${pendingReports > 1 ? "s" : ""} en attente`, sub: "Modération requise", action: () => switchSection("reports"), cta: "Gérer" }] : []),
        ...(pendingDocs > 0    ? [{ color: "#f59e0b", label: `${pendingDocs} document${pendingDocs > 1 ? "s" : ""} à vérifier`, sub: "CIN ou permis conducteur", action: () => switchSection("documents"), cta: "Vérifier" }] : []),
        ...(suspCount > 0      ? [{ color: "#ff6a1a", label: `${suspCount} alerte${suspCount > 1 ? "s" : ""} automatique${suspCount > 1 ? "s" : ""}`, sub: "Avis suspects, prix aberrants, utilisateurs signalés", action: () => switchSection("ratings"), cta: "Voir" }] : []),
    ];

    return (
        <>
            {/* Greeting */}
            <div className="adm-card">
                <div className="adm-card-body" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                    <div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>
                            Bonjour, <span style={{ color: "#ff6a1a" }}>{admin?.first_name ?? "Admin"}</span>
                        </div>
                        <div style={{ fontSize: 13, color: "#71717a", marginTop: 4 }}>
                            Mis à jour à {lastRefresh.toLocaleTimeString("fr-MA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · Auto-refresh 30s
                        </div>
                    </div>
                    <div>
                        {urgentItems.length === 0
                            ? <Badge text="Tout est en ordre" color="green" />
                            : <Badge text={`${urgentItems.length} action${urgentItems.length > 1 ? "s" : ""} requise${urgentItems.length > 1 ? "s" : ""}`} color="red" />
                        }
                    </div>
                </div>
            </div>

            {/* Urgent actions */}
            {urgentItems.length > 0 && (
                <div className="adm-card">
                    <div className="adm-card-hd"><div className="adm-card-hd-info"><div className="adm-card-title">Actions urgentes</div></div></div>
                    <div className="adm-card-body">
                        <div className="adm-urgent-grid">
                            {urgentItems.map((item, i) => (
                                <div key={i} className="adm-urgent-item">
                                    <div className="adm-urgent-dot" style={{ background: item.color }} />
                                    <div className="adm-urgent-text">
                                        <div className="adm-urgent-label">{item.label}</div>
                                        <div className="adm-urgent-sub">{item.sub}</div>
                                    </div>
                                    <div className="adm-urgent-actions">
                                        <button className="adm-btn adm-btn-primary adm-btn-sm" onClick={item.action}>{item.cta}</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Stats grid */}
            <div className="adm-card">
                <div className="adm-card-hd">
                    <div className="adm-card-hd-info">
                        <div className="adm-card-title">Statistiques globales</div>
                        <div className="adm-card-sub">Auto-refresh toutes les 30 secondes</div>
                    </div>
                </div>
                <div className="adm-card-body">
                    <div className="adm-stats-grid">
                        <StatCard label="Utilisateurs"    value={stats.users.total}      sub={`${stats.users.admins} admin · ${stats.users.drivers} conducteurs`} />
                        <StatCard label="Passagers"       value={stats.users.passengers} sub={`${stats.users.verified} vérifiés`} />
                        <StatCard label="Conducteurs"     value={stats.users.drivers}    accent="blue" />
                        <StatCard label="Admins"          value={stats.users.admins}     accent="orange" />
                        <StatCard label="Trajets total"   value={stats.rides.total}      sub={`${stats.rides.active} actifs`} />
                        <StatCard label="Trajets actifs"  value={stats.rides.active}     accent="green" />
                        <StatCard label="Terminés"        value={stats.rides.completed}  accent="blue" />
                        <StatCard label="Annulés"         value={stats.rides.cancelled}  accent={stats.rides.cancelled > stats.rides.completed ? "red" : undefined} />
                        <StatCard label="Réservations"    value={stats.bookings.total}   sub={`${stats.bookings.confirmed} confirmées`} />
                        <StatCard label="Confirmées"      value={stats.bookings.confirmed} accent="green" />
                        <StatCard label="En attente"      value={stats.bookings.pending} accent={stats.bookings.pending > 0 ? "yellow" : undefined} />
                        <StatCard label="Revenus (MAD)"   value={stats.revenue.total_confirmed_mad.toLocaleString("fr-MA")} accent="orange" />
                        <StatCard label="Avis"            value={stats.ratings.total} />
                        <StatCard label="Signalements"    value={stats.reports.pending}  sub={`${stats.reports.total} total`} accent={stats.reports.pending > 0 ? "red" : undefined} />
                        <StatCard label="Docs en attente" value={stats.documents.pending} accent={stats.documents.pending > 0 ? "yellow" : undefined} />
                        <StatCard label="Alertes auto"    value={stats.suspicious_count} accent={stats.suspicious_count > 0 ? "orange" : undefined} />
                    </div>
                </div>
            </div>
        </>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION: Users
// ══════════════════════════════════════════════════════════════════════════════
function UsersSection({ users, allCount, admin, uSearch, setUSearch, uRole, setURole, uVerified, setUVerified, uReported, setUReported, onChangeRole, onToggleVerify, onDelete, onView }: {
    users: AdminUser[]; allCount: number; admin: { id: string } | null;
    uSearch: string; setUSearch: (v: string) => void;
    uRole: string; setURole: (v: string) => void;
    uVerified: string; setUVerified: (v: string) => void;
    uReported: boolean; setUReported: (v: boolean) => void;
    onChangeRole: (id: string, role: string) => void;
    onToggleVerify: (id: string) => void;
    onDelete: (u: AdminUser) => void;
    onView: (u: AdminUser) => void;
}) {
    return (
        <div className="adm-card">
            <div className="adm-card-hd">
                <div className="adm-card-hd-info">
                    <div className="adm-card-title">Utilisateurs</div>
                    <div className="adm-card-sub">{allCount} comptes</div>
                </div>
            </div>
            <div className="adm-filter-bar">
                <input className="adm-input" placeholder="Nom, email, téléphone…" value={uSearch} onChange={e => setUSearch(e.target.value)} style={{ minWidth: 220 }} />
                <select className="adm-select" value={uRole} onChange={e => setURole(e.target.value)}>
                    <option value="ALL">Tous les rôles</option>
                    <option value="PASSENGER">Passager</option>
                    <option value="DRIVER">Conducteur</option>
                    <option value="ADMIN">Admin</option>
                </select>
                <select className="adm-select" value={uVerified} onChange={e => setUVerified(e.target.value)}>
                    <option value="ALL">Tous</option>
                    <option value="YES">Vérifiés</option>
                    <option value="NO">Non vérifiés</option>
                </select>
                <label className="adm-checkbox-label">
                    <input type="checkbox" checked={uReported} onChange={e => setUReported(e.target.checked)} />
                    Signalés uniquement
                </label>
                <span className="adm-filter-count">{users.length} résultat{users.length !== 1 ? "s" : ""}</span>
            </div>
            {users.length === 0
                ? <EmptyState icon="◉" title="Aucun utilisateur" sub="Aucun résultat pour ces filtres." />
                : (
                    <div className="adm-table-wrap">
                        <table className="adm-table">
                            <thead>
                                <tr>
                                    <th>Nom</th><th>Email</th><th>Téléphone</th><th>Rôle</th>
                                    <th>Vérifié</th><th>Trajets</th><th>Rés.</th><th>Signalements</th>
                                    <th>Inscrit</th><th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map(u => {
                                    const isSelf = u.id === admin?.id;
                                    return (
                                        <tr key={u.id} onClick={() => onView(u)} style={{ cursor: "pointer" }}>
                                            <td>
                                                <span style={{ fontWeight: 600, color: "#fff" }}>{u.first_name} {u.last_name}</span>
                                                {isSelf && <span style={{ fontSize: 10, marginLeft: 6, color: "#ff6a1a", fontWeight: 700 }}>VOUS</span>}
                                            </td>
                                            <td className="muted">{u.email}</td>
                                            <td className="muted">{u.phone ?? "—"}</td>
                                            <td onClick={e => e.stopPropagation()}>{roleBadge(u.role)}</td>
                                            <td onClick={e => e.stopPropagation()}>
                                                <button
                                                    className={`adm-btn adm-btn-sm ${u.is_verified ? "adm-btn-success" : "adm-btn-ghost"}`}
                                                    onClick={() => onToggleVerify(u.id)}
                                                    title={u.is_verified ? "Cliquer pour révoquer" : "Cliquer pour vérifier"}
                                                >
                                                    {u.is_verified ? "Vérifié" : "Non vérifié"}
                                                </button>
                                            </td>
                                            <td style={{ textAlign: "center" }}>{u.rides_count}</td>
                                            <td style={{ textAlign: "center" }}>{u.bookings_count}</td>
                                            <td style={{ textAlign: "center" }}>
                                                {u.reports_received_count > 0
                                                    ? <Badge text={`${u.reports_received_count}`} color={u.reports_received_count >= 3 ? "red" : "yellow"} />
                                                    : <span className="muted">0</span>}
                                            </td>
                                            <td className="muted">{fmtDate(u.created_at)}</td>
                                            <td onClick={e => e.stopPropagation()}>
                                                {!isSelf && (
                                                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                                        <select className="adm-select" value={u.role}
                                                            onChange={e => onChangeRole(u.id, e.target.value)}
                                                            style={{ padding: "3px 7px", fontSize: 11 }}>
                                                            <option value="PASSENGER">Passager</option>
                                                            <option value="DRIVER">Conducteur</option>
                                                            <option value="ADMIN">Admin</option>
                                                        </select>
                                                        <button className="adm-btn adm-btn-sm adm-btn-danger" onClick={() => onDelete(u)}>
                                                            Supprimer
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )
            }
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION: Rides
// ══════════════════════════════════════════════════════════════════════════════
function RidesSection({ rides, allCount, rSearch, setRSearch, rStatus, setRStatus, rSuspect, setRSuspect, onView, onCancel }: {
    rides: AdminRide[]; allCount: number;
    rSearch: string; setRSearch: (v: string) => void;
    rStatus: string; setRStatus: (v: string) => void;
    rSuspect: boolean; setRSuspect: (v: boolean) => void;
    onView: (id: string) => void;
    onCancel: (r: AdminRide) => void;
}) {
    return (
        <div className="adm-card">
            <div className="adm-card-hd">
                <div className="adm-card-hd-info">
                    <div className="adm-card-title">Trajets</div>
                    <div className="adm-card-sub">{allCount} trajets au total</div>
                </div>
            </div>
            <div className="adm-filter-bar">
                <input className="adm-input" placeholder="Origine, destination, conducteur…" value={rSearch} onChange={e => setRSearch(e.target.value)} style={{ minWidth: 260 }} />
                <select className="adm-select" value={rStatus} onChange={e => setRStatus(e.target.value)}>
                    <option value="ALL">Tous les statuts</option>
                    <option value="ACTIVE">Actif</option>
                    <option value="FULL">Complet</option>
                    <option value="COMPLETED">Terminé</option>
                    <option value="CANCELLED">Annulé</option>
                </select>
                <label className="adm-checkbox-label">
                    <input type="checkbox" checked={rSuspect} onChange={e => setRSuspect(e.target.checked)} />
                    Prix suspects
                </label>
                <span className="adm-filter-count">{rides.length} résultat{rides.length !== 1 ? "s" : ""}</span>
            </div>
            {rides.length === 0
                ? <EmptyState icon="◎" title="Aucun trajet" sub="Aucun trajet pour ces filtres." />
                : (
                    <div className="adm-table-wrap">
                        <table className="adm-table">
                            <thead>
                                <tr>
                                    <th>Trajet</th><th>Conducteur</th><th>Départ</th>
                                    <th>Prix</th><th>Places</th><th>Rés.</th><th>Signalements</th><th>Statut</th><th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rides.map(r => (
                                    <tr key={r.id} style={{ opacity: r.status === "CANCELLED" ? 0.55 : 1 }} onClick={() => onView(r.id)}>
                                        <td>
                                            <span style={{ fontWeight: 600, color: "#fff" }}>{r.origin} → {r.destination}</span>
                                            {r.suspect && <span style={{ marginLeft: 8, fontSize: 10, padding: "2px 6px", background: "rgba(245,158,11,0.15)", color: "#f59e0b", borderRadius: 4, fontWeight: 700 }}>Suspect</span>}
                                            {r.reports_count > 0 && <span style={{ marginLeft: 4, fontSize: 10, padding: "2px 6px", background: "rgba(239,68,68,0.15)", color: "#ef4444", borderRadius: 4, fontWeight: 700 }}>{r.reports_count} signalement{r.reports_count > 1 ? "s" : ""}</span>}
                                        </td>
                                        <td className="muted">{r.driver_name}</td>
                                        <td className="muted">{fmtDatetime(r.departure_time)}</td>
                                        <td style={{ color: r.suspect ? "#f59e0b" : "#d4d4d8", fontWeight: r.suspect ? 700 : 400 }}>{r.price_per_seat} MAD</td>
                                        <td style={{ textAlign: "center" }}>{r.available_seats}</td>
                                        <td style={{ textAlign: "center" }}>{r.bookings_count}</td>
                                        <td style={{ textAlign: "center" }}>
                                            {r.reports_count > 0
                                                ? <Badge text={`${r.reports_count}`} color="red" />
                                                : <span className="muted">0</span>}
                                        </td>
                                        <td>{statusBadge(r.status)}</td>
                                        <td onClick={e => e.stopPropagation()}>
                                            <div style={{ display: "flex", gap: 6 }}>
                                                <button className="adm-btn adm-btn-sm adm-btn-ghost" onClick={() => onView(r.id)}>Détail</button>
                                                {r.status === "ACTIVE" && (
                                                    <button className="adm-btn adm-btn-sm adm-btn-danger" onClick={() => onCancel(r)}>Annuler</button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )
            }
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION: Reports
// ══════════════════════════════════════════════════════════════════════════════
function ReportsSection({ reports, allCount, rpStatus, setRpStatus, rpType, setRpType, onView, onResolve, onDismiss, onBan }: {
    reports: AdminReport[]; allCount: number;
    rpStatus: string; setRpStatus: (v: string) => void;
    rpType: string; setRpType: (v: string) => void;
    onView: (r: AdminReport) => void;
    onResolve: (id: string) => void;
    onDismiss: (id: string) => void;
    onBan: (uid: string, name: string) => void;
}) {
    const pending = reports.filter(r => r.status === "PENDING").length;
    return (
        <div className="adm-card">
            <div className="adm-card-hd">
                <div className="adm-card-hd-info">
                    <div className="adm-card-title">Signalements · Modération (ADM-01)</div>
                    <div className="adm-card-sub">{allCount} signalements · {pending} en attente (filtrés)</div>
                </div>
                {pending > 0 && <Badge text={`${pending} en attente`} color="red" />}
            </div>
            <div className="adm-filter-bar">
                <select className="adm-select" value={rpStatus} onChange={e => setRpStatus(e.target.value)}>
                    <option value="ALL">Tous les statuts</option>
                    <option value="PENDING">En attente</option>
                    <option value="RESOLVED">Résolus</option>
                    <option value="DISMISSED">Ignorés</option>
                </select>
                <select className="adm-select" value={rpType} onChange={e => setRpType(e.target.value)}>
                    <option value="ALL">Tous les types</option>
                    <option value="ride">Trajet</option>
                    <option value="user">Utilisateur</option>
                </select>
                <span className="adm-filter-count">{reports.length} résultat{reports.length !== 1 ? "s" : ""}</span>
            </div>
            {reports.length === 0
                ? <EmptyState icon="⚑" title="Aucun signalement" sub="Aucun signalement pour ces filtres." />
                : reports.map(r => (
                    <div key={r.id}
                        style={{ padding: "12px 18px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", gap: 14, alignItems: "flex-start" }}
                        onClick={() => onView(r)}
                    >
                        <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                                <Badge text={r.target_type === "ride" ? "Trajet" : "Utilisateur"} color={r.target_type === "ride" ? "blue" : "orange"} />
                                <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{r.reason}</span>
                                {statusBadge(r.status)}
                            </div>
                            <div style={{ fontSize: 12, color: "#71717a" }}>
                                Par <strong style={{ color: "#a1a1aa" }}>{r.reporter_name}</strong> · {fmtDate(r.created_at)}
                            </div>
                            {r.admin_note && <div style={{ fontSize: 12, color: "#22c55e", marginTop: 4 }}>Note : {r.admin_note}</div>}
                        </div>
                        {r.status === "PENDING" && (
                            <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                                <button className="adm-btn adm-btn-sm adm-btn-success" onClick={() => onResolve(r.id)}>Résoudre</button>
                                <button className="adm-btn adm-btn-sm adm-btn-ghost"   onClick={() => onDismiss(r.id)}>Ignorer</button>
                                {r.target_type === "user" && (
                                    <button className="adm-btn adm-btn-sm adm-btn-danger" onClick={() => onBan(r.target_id, r.reporter_name)}>Bannir</button>
                                )}
                            </div>
                        )}
                    </div>
                ))
            }
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION: Documents
// ══════════════════════════════════════════════════════════════════════════════
function DocsSection({ docs, allCount, dStatus, setDStatus, dType, setDType, docNote, setDocNote, apiUrl, onApprove, onReject }: {
    docs: AdminDoc[]; allCount: number;
    dStatus: string; setDStatus: (v: string) => void;
    dType: string; setDType: (v: string) => void;
    docNote: Record<string, string>;
    setDocNote: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    apiUrl: string;
    onApprove: (id: string) => void;
    onReject: (id: string) => void;
}) {
    return (
        <div className="adm-card">
            <div className="adm-card-hd">
                <div className="adm-card-hd-info">
                    <div className="adm-card-title">Documents conducteurs · Vérification identité (ADM-03)</div>
                    <div className="adm-card-sub">{allCount} documents soumis</div>
                </div>
            </div>
            <div className="adm-filter-bar">
                <select className="adm-select" value={dStatus} onChange={e => setDStatus(e.target.value)}>
                    <option value="ALL">Tous les statuts</option>
                    <option value="PENDING">En attente</option>
                    <option value="APPROVED">Approuvés</option>
                    <option value="REJECTED">Rejetés</option>
                </select>
                <select className="adm-select" value={dType} onChange={e => setDType(e.target.value)}>
                    <option value="ALL">Tous les types</option>
                    <option value="CIN">CIN</option>
                    <option value="PERMIS">Permis</option>
                </select>
                <span className="adm-filter-count">{docs.length} résultat{docs.length !== 1 ? "s" : ""}</span>
            </div>
            {docs.length === 0
                ? <EmptyState icon="▤" title="Aucun document" sub="Aucun document pour ces filtres." />
                : (
                    <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                        {docs.map(d => (
                            <div key={d.id} className="adm-doc-card">
                                <div className="adm-doc-info">
                                    <div className="adm-doc-driver">
                                        {d.driver_name}
                                        <span style={{ fontSize: 11, color: "#71717a", marginLeft: 8 }}>{d.driver_email}</span>
                                    </div>
                                    <div className="adm-doc-meta">
                                        <strong>{d.doc_type}</strong> · {d.original_name} · {fmtDate(d.created_at)}
                                    </div>
                                    <a href={`${apiUrl}${d.file_url}`} target="_blank" rel="noopener noreferrer" className="adm-doc-link" onClick={e => e.stopPropagation()}>
                                        Voir le document →
                                    </a>
                                    {d.admin_note && <div style={{ fontSize: 12, color: "#71717a", marginTop: 4 }}>Note : {d.admin_note}</div>}
                                </div>
                                <div className="adm-doc-actions">
                                    {statusBadge(d.status)}
                                    {d.status === "PENDING" && (
                                        <>
                                            <input
                                                className="adm-input adm-doc-note"
                                                placeholder="Note admin (optionnel)"
                                                value={docNote[d.id] ?? ""}
                                                onChange={e => setDocNote(p => ({ ...p, [d.id]: e.target.value }))}
                                            />
                                            <button className="adm-btn adm-btn-sm adm-btn-success" onClick={() => onApprove(d.id)}>Approuver</button>
                                            <button className="adm-btn adm-btn-sm adm-btn-danger"  onClick={() => onReject(d.id)}>Rejeter</button>
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )
            }
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION: Ratings & Abuse
// ══════════════════════════════════════════════════════════════════════════════
function RatingsSection({ ratings, allCount, ratSuspect, setRatSuspect, susp, suspTab, setSuspTab, admin, onDeleteRating, onCancelRide, onBanUser, onViewRide }: {
    ratings: AdminRating[]; allCount: number;
    ratSuspect: boolean; setRatSuspect: (v: boolean) => void;
    susp: SuspData | null; suspTab: "ratings" | "rides" | "users"; setSuspTab: (v: "ratings" | "rides" | "users") => void;
    admin: { id: string } | null;
    onDeleteRating: (id: string) => void;
    onCancelRide: (r: SuspRide) => void;
    onBanUser: (id: string, name: string) => void;
    onViewRide: (id: string) => void;
}) {
    const totalSusp = susp ? susp.ratings.length + susp.rides.length + susp.users.length : 0;
    return (
        <>
            {/* Suspicious alerts */}
            <div className="adm-card">
                <div className="adm-card-hd">
                    <div className="adm-card-hd-info">
                        <div className="adm-card-title">Alertes automatiques · Détection par règles (ADM-04)</div>
                        <div className="adm-card-sub">Heuristiques simples. L&apos;admin vérifie et décide.</div>
                    </div>
                    {totalSusp > 0 && <Badge text={`${totalSusp} alerte${totalSusp > 1 ? "s" : ""}`} color="orange" />}
                </div>

                {/* Sub-tabs */}
                <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    {([ ["ratings", "Avis suspects", susp?.ratings.length], ["rides", "Trajets suspects", susp?.rides.length], ["users", "Utilisateurs suspects", susp?.users.length] ] as [string, string, number | undefined][]).map(([id, label, cnt]) => (
                        <button key={id} onClick={() => setSuspTab(id as "ratings" | "rides" | "users")}
                            style={{ padding: "10px 18px", fontSize: 13, fontWeight: suspTab === id ? 700 : 500, color: suspTab === id ? "#ff6a1a" : "#71717a", background: "none", border: "none", borderBottom: `2px solid ${suspTab === id ? "#ff6a1a" : "transparent"}`, cursor: "pointer", transition: "all 0.12s", display: "flex", alignItems: "center", gap: 6 }}>
                            {label}
                            {cnt !== undefined && cnt > 0 && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", background: "rgba(255,106,26,0.15)", color: "#ff6a1a", borderRadius: 10 }}>{cnt}</span>}
                        </button>
                    ))}
                </div>

                <div style={{ padding: "14px 18px" }}>
                    {!susp && <Spinner />}
                    {susp && suspTab === "ratings" && (
                        susp.ratings.length === 0
                            ? <EmptyState icon="◆" title="Aucun avis suspect" />
                            : susp.ratings.map(r => (
                                <div key={r.id} className="adm-rating-row suspect" style={{ marginBottom: 8 }}>
                                    <div className="adm-rating-stars" style={{ color: "#ef4444" }}>{"★".repeat(r.stars)}{"☆".repeat(5 - r.stars)}</div>
                                    <div className="adm-rating-body">
                                        <div className="adm-rating-comment">{r.comment || <em style={{ color: "#52525b" }}>Sans commentaire</em>}</div>
                                        <div className="adm-rating-meta">{r.passenger_name} → {r.driver_name} · {r.created_at ? fmtDate(r.created_at) : "—"}</div>
                                        <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                                            {levelBadge(r.level)}
                                            <span style={{ fontSize: 11, color: "#71717a" }}>{r.reason}</span>
                                        </div>
                                    </div>
                                    <button className="adm-btn adm-btn-sm adm-btn-danger" style={{ flexShrink: 0 }} onClick={() => onDeleteRating(r.id)}>Supprimer</button>
                                </div>
                            ))
                    )}
                    {susp && suspTab === "rides" && (
                        susp.rides.length === 0
                            ? <EmptyState icon="◎" title="Aucun trajet suspect" />
                            : susp.rides.map(r => (
                                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", marginBottom: 8, background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 10 }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, color: "#fff", fontSize: 13 }}>{r.origin} → {r.destination}</div>
                                        <div style={{ fontSize: 12, color: "#71717a", marginTop: 2 }}>{r.driver_name} · {fmtDatetime(r.departure_time)} · <strong style={{ color: "#f59e0b" }}>{r.price_per_seat} MAD</strong></div>
                                        <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}>
                                            {levelBadge(r.level)}
                                            <span style={{ fontSize: 11, color: "#71717a" }}>{r.reason}</span>
                                        </div>
                                    </div>
                                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                                        <button className="adm-btn adm-btn-sm adm-btn-ghost"  onClick={() => onViewRide(r.id)}>Détail</button>
                                        <button className="adm-btn adm-btn-sm adm-btn-danger" onClick={() => onCancelRide(r)}>Annuler</button>
                                    </div>
                                </div>
                            ))
                    )}
                    {susp && suspTab === "users" && (
                        susp.users.length === 0
                            ? <EmptyState icon="◉" title="Aucun utilisateur suspect" />
                            : susp.users.map(u => (
                                <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", marginBottom: 8, background: "rgba(239,68,68,0.03)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 10 }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, color: "#fff", fontSize: 13 }}>{u.name} {roleBadge(u.role)}</div>
                                        <div style={{ fontSize: 12, color: "#71717a", marginTop: 2 }}>{u.email}</div>
                                        <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}>
                                            {levelBadge(u.level)}
                                            <span style={{ fontSize: 11, color: "#71717a" }}>{u.reason}</span>
                                        </div>
                                    </div>
                                    {u.id !== admin?.id && (
                                        <button className="adm-btn adm-btn-sm adm-btn-danger" style={{ flexShrink: 0 }} onClick={() => onBanUser(u.id, u.name)}>Bannir</button>
                                    )}
                                </div>
                            ))
                    )}
                </div>
            </div>

            {/* All ratings */}
            <div className="adm-card">
                <div className="adm-card-hd">
                    <div className="adm-card-hd-info">
                        <div className="adm-card-title">Tous les avis ({allCount})</div>
                    </div>
                    <label className="adm-checkbox-label">
                        <input type="checkbox" checked={ratSuspect} onChange={e => setRatSuspect(e.target.checked)} />
                        Suspects uniquement
                    </label>
                </div>
                {ratings.length === 0
                    ? <EmptyState icon="◆" title="Aucun avis" sub="Aucun avis pour ces filtres." />
                    : (
                        <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
                            {ratings.map(r => {
                                const suspicious = r.stars <= 2 && !r.comment;
                                return (
                                    <div key={r.id} className={`adm-rating-row${suspicious ? " suspect" : ""}`}>
                                        <div className="adm-rating-stars" style={{ color: r.stars <= 2 ? "#ef4444" : "#f59e0b" }}>
                                            {"★".repeat(r.stars)}{"☆".repeat(5 - r.stars)}
                                        </div>
                                        <div className="adm-rating-body" style={{ flex: 1 }}>
                                            <div className="adm-rating-comment">{r.comment || <em style={{ color: "#52525b" }}>Sans commentaire</em>}</div>
                                            <div className="adm-rating-meta">
                                                Par <strong style={{ color: "#a1a1aa" }}>{r.passenger_name}</strong> · Conducteur : <strong style={{ color: "#a1a1aa" }}>{r.driver_name}</strong>
                                                {r.created_at && <> · {fmtDate(r.created_at)}</>}
                                            </div>
                                            {suspicious && <Badge text="Suspect" color="red" />}
                                        </div>
                                        <button className="adm-btn adm-btn-sm adm-btn-danger" style={{ flexShrink: 0 }} onClick={() => onDeleteRating(r.id)}>Supprimer</button>
                                    </div>
                                );
                            })}
                        </div>
                    )
                }
            </div>
        </>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION: Stats
// ══════════════════════════════════════════════════════════════════════════════
function StatsSection({ stats, lastRefresh, onRefresh }: { stats: Stats | null; lastRefresh: Date; onRefresh: () => void }) {
    if (!stats) return <Spinner />;
    const maxOrigin = Math.max(1, ...stats.top_origins.map(x => x.count));
    const maxDest   = Math.max(1, ...stats.top_destinations.map(x => x.count));
    const maxDriver = Math.max(1, ...stats.top_drivers.map(x => x.count));

    return (
        <>
            <div className="adm-card">
                <div className="adm-card-body" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>Statistiques plateforme (ADM-02)</div>
                        <div style={{ fontSize: 12, color: "#71717a", marginTop: 3 }}>
                            Mise à jour : {lastRefresh.toLocaleTimeString("fr-MA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · Auto-refresh 30s
                        </div>
                    </div>
                    <button className="adm-btn adm-btn-ghost" onClick={onRefresh}>Actualiser</button>
                </div>
            </div>

            <div className="adm-card">
                <div className="adm-card-hd"><div className="adm-card-hd-info"><div className="adm-card-title">Utilisateurs</div></div></div>
                <div className="adm-card-body">
                    <div className="adm-stats-grid">
                        <StatCard label="Total"        value={stats.users.total} />
                        <StatCard label="Passagers"    value={stats.users.passengers} accent="blue" />
                        <StatCard label="Conducteurs"  value={stats.users.drivers}    accent="blue" />
                        <StatCard label="Admins"       value={stats.users.admins}     accent="orange" />
                        <StatCard label="Vérifiés"     value={stats.users.verified}   accent="green" sub={`${stats.users.total > 0 ? Math.round(stats.users.verified / stats.users.total * 100) : 0}%`} />
                        <StatCard label="Non vérifiés" value={stats.users.unverified} accent={stats.users.unverified > 0 ? "red" : undefined} />
                    </div>
                </div>
            </div>

            <div className="adm-card">
                <div className="adm-card-hd"><div className="adm-card-hd-info"><div className="adm-card-title">Trajets & Réservations</div></div></div>
                <div className="adm-card-body">
                    <div className="adm-stats-grid">
                        <StatCard label="Trajets total"   value={stats.rides.total} />
                        <StatCard label="Actifs"          value={stats.rides.active}         accent="green" />
                        <StatCard label="Terminés"        value={stats.rides.completed}      accent="blue" />
                        <StatCard label="Annulés"         value={stats.rides.cancelled}      accent="red" />
                        <StatCard label="Réservations"    value={stats.bookings.total} />
                        <StatCard label="Confirmées"      value={stats.bookings.confirmed}   accent="green" />
                        <StatCard label="En attente"      value={stats.bookings.pending}     accent={stats.bookings.pending > 0 ? "yellow" : undefined} />
                        <StatCard label="Revenus (MAD)"   value={stats.revenue.total_confirmed_mad.toLocaleString("fr-MA")} accent="orange" />
                    </div>
                </div>
            </div>

            {/* Bar charts */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div className="adm-card">
                    <div className="adm-card-hd"><div className="adm-card-hd-info"><div className="adm-card-title">Top départs</div></div></div>
                    <div className="adm-card-body">
                        {stats.top_origins.length === 0 ? <EmptyState icon="◎" title="Pas de données" /> : stats.top_origins.map((x, i) => (
                            <div key={i} className="adm-bar-row">
                                <div className="adm-bar-label">{x.city}</div>
                                <MiniBar value={x.count} max={maxOrigin} color="#ff6a1a" />
                                <div className="adm-bar-count">{x.count}</div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="adm-card">
                    <div className="adm-card-hd"><div className="adm-card-hd-info"><div className="adm-card-title">Top arrivées</div></div></div>
                    <div className="adm-card-body">
                        {stats.top_destinations.length === 0 ? <EmptyState icon="◎" title="Pas de données" /> : stats.top_destinations.map((x, i) => (
                            <div key={i} className="adm-bar-row">
                                <div className="adm-bar-label">{x.city}</div>
                                <MiniBar value={x.count} max={maxDest} color="#38bdf8" />
                                <div className="adm-bar-count">{x.count}</div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="adm-card">
                    <div className="adm-card-hd"><div className="adm-card-hd-info"><div className="adm-card-title">Top conducteurs</div></div></div>
                    <div className="adm-card-body">
                        {stats.top_drivers.length === 0 ? <EmptyState icon="◉" title="Pas de données" /> : stats.top_drivers.map((x, i) => (
                            <div key={i} className="adm-bar-row">
                                <div className="adm-bar-label">{x.name}</div>
                                <MiniBar value={x.count} max={maxDriver} color="#22c55e" />
                                <div className="adm-bar-count">{x.count}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="adm-card">
                <div className="adm-card-hd"><div className="adm-card-hd-info"><div className="adm-card-title">Modération</div></div></div>
                <div className="adm-card-body">
                    <div className="adm-stats-grid">
                        <StatCard label="Avis total"              value={stats.ratings.total} />
                        <StatCard label="Signalements total"      value={stats.reports.total} />
                        <StatCard label="Signalements en attente" value={stats.reports.pending}   accent={stats.reports.pending > 0 ? "red" : undefined} />
                        <StatCard label="Docs à vérifier"         value={stats.documents.pending} accent={stats.documents.pending > 0 ? "yellow" : undefined} />
                        <StatCard label="Alertes auto"            value={stats.suspicious_count}  accent={stats.suspicious_count > 0 ? "orange" : undefined} />
                    </div>
                </div>
            </div>
        </>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// DRAWERS
// ══════════════════════════════════════════════════════════════════════════════

function DR({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="adm-drawer-row">
            <span className="adm-drawer-key">{label}</span>
            <span className="adm-drawer-val">{value}</span>
        </div>
    );
}

function UserDrawer({ u }: { u: AdminUser }) {
    return (
        <>
            <div className="adm-drawer-section">
                <div className="adm-drawer-section-title">Informations</div>
                <DR label="Nom complet" value={`${u.first_name} ${u.last_name}`} />
                <DR label="Email"       value={u.email} />
                <DR label="Téléphone"   value={u.phone ?? "—"} />
                <DR label="Rôle"        value={roleBadge(u.role)} />
                <DR label="Vérifié"     value={u.is_verified ? <Badge text="Oui" color="green" /> : <Badge text="Non" color="red" />} />
                <DR label="Inscrit le"  value={fmtDate(u.created_at)} />
            </div>
            <div className="adm-drawer-section">
                <div className="adm-drawer-section-title">Activité</div>
                <DR label="Trajets publiés"    value={u.rides_count} />
                <DR label="Réservations"       value={u.bookings_count} />
                <DR label="Signalements reçus" value={u.reports_received_count > 0
                    ? <Badge text={`${u.reports_received_count}`} color={u.reports_received_count >= 3 ? "red" : "yellow"} />
                    : "0"} />
            </div>
        </>
    );
}

function RideDrawer({ r }: { r: RideDetail }) {
    return (
        <>
            <div className="adm-drawer-section">
                <div className="adm-drawer-section-title">Trajet</div>
                <DR label="Origine"       value={r.origin} />
                <DR label="Destination"   value={r.destination} />
                <DR label="Départ"        value={fmtDatetime(r.departure_time)} />
                <DR label="Prix/place"    value={`${r.price_per_seat} MAD`} />
                <DR label="Places dispo." value={r.available_seats} />
                <DR label="Statut"        value={statusBadge(r.status)} />
                {r.pickup_location  && <DR label="Point prise en charge" value={r.pickup_location} />}
                {r.dropoff_location && <DR label="Point dépose"          value={r.dropoff_location} />}
            </div>
            {r.driver && (
                <div className="adm-drawer-section">
                    <div className="adm-drawer-section-title">Conducteur</div>
                    <DR label="Nom"   value={r.driver.name} />
                    <DR label="Email" value={r.driver.email} />
                </div>
            )}
            {r.bookings.length > 0 && (
                <div className="adm-drawer-section">
                    <div className="adm-drawer-section-title">Réservations ({r.bookings.length})</div>
                    {r.bookings.map(b => (
                        <div key={b.id} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                            <DR label={b.passenger_name} value={statusBadge(b.status)} />
                            <DR label="Places / Prix" value={`${b.seats} place${b.seats > 1 ? "s" : ""} · ${b.total_price} MAD`} />
                        </div>
                    ))}
                </div>
            )}
            {r.reports.length > 0 && (
                <div className="adm-drawer-section">
                    <div className="adm-drawer-section-title">Signalements ({r.reports.length})</div>
                    {r.reports.map(rep => (
                        <div key={rep.id} style={{ marginBottom: 6 }}>
                            <DR label={rep.reporter} value={statusBadge(rep.status)} />
                            <DR label="Raison"       value={rep.reason} />
                        </div>
                    ))}
                </div>
            )}
        </>
    );
}

function ReportDrawer({ r }: { r: AdminReport }) {
    return (
        <>
            <div className="adm-drawer-section">
                <div className="adm-drawer-section-title">Signalement</div>
                <DR label="Type cible"  value={<Badge text={r.target_type === "ride" ? "Trajet" : "Utilisateur"} color={r.target_type === "ride" ? "blue" : "orange"} />} />
                <DR label="Raison"      value={r.reason} />
                <DR label="Statut"      value={statusBadge(r.status)} />
                <DR label="Signalé par" value={r.reporter_name} />
                <DR label="Date"        value={fmtDate(r.created_at)} />
                {r.admin_note && <DR label="Note admin" value={r.admin_note} />}
            </div>
            <div className="adm-drawer-section">
                <div className="adm-drawer-section-title">Cible</div>
                <DR label="ID" value={<span style={{ fontSize: 11, color: "#71717a", wordBreak: "break-all" }}>{r.target_id}</span>} />
                {r.target_type === "ride" && (
                    <Link href={`/rides/${r.target_id}`} target="_blank" style={{ fontSize: 12, color: "#38bdf8", textDecoration: "none" }}>
                        Voir le trajet →
                    </Link>
                )}
                {r.target_type === "user" && (
                    <Link href={`/drivers/${r.target_id}`} target="_blank" style={{ fontSize: 12, color: "#38bdf8", textDecoration: "none" }}>
                        Voir le profil →
                    </Link>
                )}
            </div>
        </>
    );
}
