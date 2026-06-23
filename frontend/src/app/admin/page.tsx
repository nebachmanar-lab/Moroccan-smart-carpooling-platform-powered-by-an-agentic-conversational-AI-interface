"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

interface Stats {
    users: { total: number; drivers: number; passengers: number };
    rides: { total: number; active: number; completed: number };
    bookings: { total: number; confirmed: number };
    documents: { pending: number };
    ratings: { total: number };
    revenue: { total_confirmed_mad: number };
}

interface AdminUser {
    id: string; first_name: string; last_name: string; email: string;
    phone: string | null; role: string; is_verified: boolean;
    created_at: string; rides_count: number; bookings_count: number;
}

interface AdminRide {
    id: string; origin: string; destination: string; departure_time: string;
    available_seats: number; price_per_seat: number; status: string;
    driver_name: string; bookings_count: number;
}

interface AdminDoc {
    id: string; driver_id: string; driver_name: string; driver_email: string;
    doc_type: string; original_name: string; file_url: string;
    status: string; admin_note: string | null; created_at: string;
}

interface AdminRating {
    id: string; ride_id: string; passenger_id: string; driver_id: string;
    stars: number; comment: string | null; created_at: string;
}

interface AdminReport {
    id: string; reporter_id: string | null; reporter_name: string;
    target_type: string; target_id: string; reason: string;
    status: string; admin_note: string | null; created_at: string;
}

type Tab = "stats" | "users" | "rides" | "documents" | "ratings" | "reports";

export default function AdminPage() {
    const router = useRouter();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";
    const [tab, setTab] = useState<Tab>("stats");
    const [stats, setStats] = useState<Stats | null>(null);
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [rides, setRides] = useState<AdminRide[]>([]);
    const [docs, setDocs] = useState<AdminDoc[]>([]);
    const [ratings, setRatings] = useState<AdminRating[]>([]);
    const [reports, setReports] = useState<AdminReport[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [reviewNote, setReviewNote] = useState<Record<string, string>>({});
    const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

    // ADM-02: fetch stats (called on mount + auto-refresh)
    const fetchStats = useCallback(() => {
        apiFetch("/admin/stats")
            .then((r) => {
                if (r.status === 403) { router.push("/dashboard"); return null; }
                return r.json();
            })
            .then((d) => {
                if (d) { setStats(d); setLastRefresh(new Date()); setLoading(false); }
            })
            .catch(() => { setError("Accès refusé ou erreur."); setLoading(false); });
    }, [router]);

    // Initial load
    useEffect(() => { fetchStats(); }, [fetchStats]);

    // ADM-02: auto-refresh stats every 30 seconds
    useEffect(() => {
        const interval = setInterval(fetchStats, 30_000);
        return () => clearInterval(interval);
    }, [fetchStats]);

    // Lazy-load per tab
    useEffect(() => {
        if (tab === "users"     && users.length === 0)   apiFetch("/admin/users").then((r) => r.ok ? r.json() : []).then(setUsers);
        if (tab === "rides"     && rides.length === 0)   apiFetch("/admin/rides").then((r) => r.ok ? r.json() : []).then(setRides);
        if (tab === "documents" && docs.length === 0)    apiFetch("/documents/admin/all").then((r) => r.ok ? r.json() : []).then(setDocs);
        if (tab === "ratings"   && ratings.length === 0) apiFetch("/ratings/admin/all").then((r) => r.ok ? r.json() : []).then(setRatings);
        if (tab === "reports"   && reports.length === 0) apiFetch("/admin/reports").then((r) => r.ok ? r.json() : []).then(setReports);
    }, [tab, users.length, rides.length, docs.length, ratings.length, reports.length]);

    async function changeRole(userId: string, newRole: string) {
        await apiFetch(`/admin/users/${userId}/role`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: newRole }),
        });
        setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role: newRole } : u));
    }

    async function deleteUser(userId: string) {
        if (!confirm("Supprimer cet utilisateur ? Cette action est irréversible.")) return;
        const res = await apiFetch(`/admin/users/${userId}`, { method: "DELETE" });
        if (res.ok) setUsers((prev) => prev.filter((u) => u.id !== userId));
    }

    async function cancelRide(rideId: string) {
        if (!confirm("Annuler ce trajet ?")) return;
        const res = await apiFetch(`/admin/rides/${rideId}`, { method: "DELETE" });
        if (res.ok) setRides((prev) => prev.map((r) => r.id === rideId ? { ...r, status: "CANCELLED" } : r));
    }

    async function resolveReport(reportId: string, status: "RESOLVED" | "DISMISSED") {
        const note = status === "RESOLVED" ? (prompt("Note admin (optionnel) :") ?? undefined) : undefined;
        const res = await apiFetch(`/admin/reports/${reportId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status, admin_note: note || null }),
        });
        if (res.ok) setReports((prev) => prev.map((r) => r.id === reportId ? { ...r, status } : r));
    }

    // ADM-01: ban user directly from report
    async function banUserFromReport(userId: string, reportId: string) {
        if (!confirm("Bannir cet utilisateur (supprimer son compte) ?")) return;
        const res = await apiFetch(`/admin/users/${userId}`, { method: "DELETE" });
        if (res.ok) {
            setReports((prev) => prev.map((r) => r.id === reportId ? { ...r, status: "RESOLVED", admin_note: "Utilisateur banni" } : r));
            await apiFetch(`/admin/reports/${reportId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "RESOLVED", admin_note: "Utilisateur banni" }),
            });
        }
    }

    async function reviewDoc(docId: string, status: "APPROVED" | "REJECTED") {
        const res = await apiFetch(`/documents/admin/${docId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status, admin_note: reviewNote[docId] || null }),
        });
        if (res.ok) {
            const updated = await res.json();
            setDocs((prev) => prev.map((d) => d.id === docId ? { ...d, ...updated } : d));
            // Reflect is_verified change in users list if loaded
            if (status === "APPROVED" && users.length > 0) {
                const doc = docs.find((d) => d.id === docId);
                if (doc) setUsers((prev) => prev.map((u) => u.id === doc.driver_id ? { ...u, is_verified: true } : u));
            }
        }
    }

    // ADM-04: delete suspicious rating
    async function deleteRating(ratingId: string) {
        if (!confirm("Supprimer cet avis ?")) return;
        const res = await apiFetch(`/admin/ratings/${ratingId}`, { method: "DELETE" });
        if (res.ok) setRatings((prev) => prev.filter((r) => r.id !== ratingId));
    }

    if (loading) return <main className="app-shell"><div className="page-layer loading-page"><p>Chargement...</p></div></main>;
    if (error)   return <main className="app-shell"><div className="page-layer"><div className="inner-page"><p className="alert-error">{error}</p></div></div></main>;

    const pendingReports = reports.filter((r) => r.status === "PENDING").length;

    const TABS: { id: Tab; label: string; badge?: number }[] = [
        { id: "stats",     label: "Statistiques" },
        { id: "users",     label: "Utilisateurs" },
        { id: "rides",     label: "Trajets" },
        { id: "documents", label: "Documents", badge: stats?.documents.pending },
        { id: "ratings",   label: "Avis" },
        { id: "reports",   label: "Signalements", badge: pendingReports || undefined },
    ];

    return (
        <main className="app-shell">
            <div className="page-layer">
                <nav className="navbar">
                    <Link href="/" className="brand"><span className="brand-badge">CM</span><span>Covoit Maroc</span></Link>
                    <div className="nav-links"><Link href="/dashboard">Dashboard</Link></div>
                    <div className="nav-actions">
                        <span style={{ fontSize: "12px", color: "var(--text-muted)", padding: "4px 10px", border: "1px solid var(--border-soft)", borderRadius: "8px" }}>Admin</span>
                    </div>
                </nav>

                <section className="dashboard">
                    <div className="glass-card dashboard-header">
                        <div>
                            <h1 className="dashboard-title">Tableau de bord <span className="pink-text">Admin</span></h1>
                            <p className="dashboard-subtitle">
                                Modération et supervision · Mis à jour à {lastRefresh.toLocaleTimeString("fr-MA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                <button onClick={fetchStats} style={{ marginLeft: 10, background: "none", border: "none", color: "var(--blue)", cursor: "pointer", fontSize: 12 }}>↻ Actualiser</button>
                            </p>
                        </div>
                        {pendingReports > 0 && (
                            <div style={{ padding: "10px 16px", borderRadius: 10, background: "rgba(239,68,68,.12)", border: "1px solid rgba(239,68,68,.3)", fontSize: 13, color: "#ef4444", fontWeight: 600 }}>
                                ⚠ {pendingReports} signalement{pendingReports > 1 ? "s" : ""} en attente
                            </div>
                        )}
                    </div>

                    <div className="admin-tabs">
                        {TABS.map((t) => (
                            <button key={t.id} className={`admin-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
                                {t.label}
                                {t.badge ? <span className="tab-count" style={{ background: "var(--red)", color: "#fff" }}>{t.badge}</span> : null}
                            </button>
                        ))}
                    </div>

                    {/* ── Stats (ADM-02) ── */}
                    {tab === "stats" && stats && (
                        <div className="admin-stats-grid">
                            <StatCard label="Utilisateurs" value={stats.users.total} sub={`${stats.users.drivers} conducteurs · ${stats.users.passengers} passagers`} />
                            <StatCard label="Trajets publiés" value={stats.rides.total} sub={`${stats.rides.active} actifs · ${stats.rides.completed} terminés`} />
                            <StatCard label="Réservations" value={stats.bookings.total} sub={`${stats.bookings.confirmed} confirmées`} />
                            <StatCard label="Revenus confirmés" value={stats.revenue.total_confirmed_mad} sub="MAD total sur la plateforme" currency />
                            <StatCard label="Avis" value={stats.ratings.total} sub="Évaluations laissées" />
                            <StatCard label="Documents en attente" value={stats.documents.pending} sub="Vérifications conducteurs à traiter" alert={stats.documents.pending > 0} />
                        </div>
                    )}

                    {/* ── Users ── */}
                    {tab === "users" && (
                        <section className="glass-card section-card">
                            <div className="section-header"><h2>Utilisateurs ({users.length})</h2></div>
                            <div className="admin-table-wrapper">
                                <table className="admin-table">
                                    <thead>
                                        <tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Trajets</th><th>Rés.</th><th>Vérifié</th><th>Actions</th></tr>
                                    </thead>
                                    <tbody>
                                        {users.map((u) => (
                                            <tr key={u.id}>
                                                <td>{u.first_name} {u.last_name}</td>
                                                <td style={{ fontSize: "12px", color: "var(--text-muted)" }}>{u.email}</td>
                                                <td>
                                                    <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value)} className="admin-role-select">
                                                        <option value="PASSENGER">Passager</option>
                                                        <option value="DRIVER">Conducteur</option>
                                                        <option value="ADMIN">Admin</option>
                                                    </select>
                                                </td>
                                                <td style={{ textAlign: "center" }}>{u.rides_count}</td>
                                                <td style={{ textAlign: "center" }}>{u.bookings_count}</td>
                                                <td style={{ textAlign: "center" }}>
                                                    <span style={{ color: u.is_verified ? "var(--green)" : "var(--red)", fontSize: "12px" }}>
                                                        {u.is_verified ? "✓" : "✗"}
                                                    </span>
                                                </td>
                                                <td><button className="btn-cancel-booking" onClick={() => deleteUser(u.id)}>Supprimer</button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    )}

                    {/* ── Rides ── */}
                    {tab === "rides" && (
                        <section className="glass-card section-card">
                            <div className="section-header"><h2>Trajets ({rides.length})</h2></div>
                            <div className="admin-table-wrapper">
                                <table className="admin-table">
                                    <thead>
                                        <tr><th>Trajet</th><th>Départ</th><th>Conducteur</th><th>Prix</th><th>Rés.</th><th>Statut</th><th>Actions</th></tr>
                                    </thead>
                                    <tbody>
                                        {rides.map((r) => (
                                            <tr key={r.id} style={{ opacity: r.status === "CANCELLED" ? 0.5 : 1 }}>
                                                <td>
                                                    <Link href={`/rides/${r.id}`} target="_blank" style={{ color: "var(--blue)", textDecoration: "none" }}>
                                                        {r.origin} → {r.destination}
                                                    </Link>
                                                </td>
                                                <td style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                                                    {new Date(r.departure_time).toLocaleString("fr-MA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                                                </td>
                                                <td>{r.driver_name}</td>
                                                <td>{r.price_per_seat} MAD</td>
                                                <td style={{ textAlign: "center" }}>{r.bookings_count}</td>
                                                <td><span className={`booking-badge ${r.status === "ACTIVE" ? "confirmed" : "cancelled"}`}>{r.status}</span></td>
                                                <td>{r.status === "ACTIVE" && <button className="btn-cancel-booking" onClick={() => cancelRide(r.id)}>Annuler</button>}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    )}

                    {/* ── Documents (ADM-03) ── */}
                    {tab === "documents" && (
                        <section className="glass-card section-card">
                            <div className="section-header">
                                <h2>Vérification identité conducteurs ({docs.length})</h2>
                                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
                                    Valider un document marque automatiquement le conducteur comme vérifié ✓
                                </p>
                            </div>
                            {docs.length === 0 ? (
                                <p className="dash-empty">Aucun document soumis.</p>
                            ) : (
                                <div className="admin-doc-list">
                                    {docs.map((d) => (
                                        <div key={d.id} className="admin-doc-row">
                                            <div>
                                                <p className="admin-doc-driver">
                                                    {d.driver_name}
                                                    <span style={{ color: "var(--text-muted)", fontSize: "12px", marginLeft: 8 }}>{d.driver_email}</span>
                                                </p>
                                                <p className="admin-doc-meta">
                                                    <strong>{d.doc_type}</strong> · {d.original_name} · {new Date(d.created_at).toLocaleDateString("fr-MA")}
                                                </p>
                                                <a href={`${apiUrl}${d.file_url}`} target="_blank" rel="noopener noreferrer" className="admin-doc-link">
                                                    Voir le document →
                                                </a>
                                            </div>
                                            <div className="admin-doc-actions">
                                                <span className={`booking-badge ${d.status === "APPROVED" ? "confirmed" : d.status === "REJECTED" ? "cancelled" : "pending-badge-inline"}`}>
                                                    {d.status === "APPROVED" ? "✓ Validé" : d.status === "REJECTED" ? "✗ Rejeté" : "⏳ En attente"}
                                                </span>
                                                {d.status === "PENDING" && (
                                                    <>
                                                        <input
                                                            type="text"
                                                            placeholder="Note (optionnel)"
                                                            className="admin-doc-note-input"
                                                            value={reviewNote[d.id] ?? ""}
                                                            onChange={(e) => setReviewNote((p) => ({ ...p, [d.id]: e.target.value }))}
                                                        />
                                                        <button className="btn-accept-booking" onClick={() => reviewDoc(d.id, "APPROVED")}>Valider</button>
                                                        <button className="btn-cancel-booking" onClick={() => reviewDoc(d.id, "REJECTED")}>Rejeter</button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}

                    {/* ── Reports (ADM-01) ── */}
                    {tab === "reports" && (
                        <section className="glass-card section-card">
                            <div className="section-header">
                                <h2>Signalements · {reports.filter((r) => r.status === "PENDING").length} en attente</h2>
                            </div>
                            {reports.length === 0 ? (
                                <p className="dash-empty">Aucun signalement pour le moment.</p>
                            ) : (
                                <div className="admin-doc-list">
                                    {reports.map((r) => (
                                        <div key={r.id} className="admin-doc-row">
                                            <div style={{ flex: 1 }}>
                                                <p style={{ fontWeight: 600, margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                                    <span style={{
                                                        textTransform: "uppercase", fontSize: 11, padding: "2px 7px", borderRadius: 4,
                                                        background: r.target_type === "ride" ? "#1A56DB22" : "#dc262622",
                                                        color: r.target_type === "ride" ? "#1A56DB" : "#dc2626",
                                                    }}>
                                                        {r.target_type === "ride" ? "Trajet" : "Utilisateur"}
                                                    </span>
                                                    {r.reason}
                                                </p>
                                                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 4px", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                                                    <span>Signalé par <strong>{r.reporter_name}</strong> · {new Date(r.created_at).toLocaleDateString("fr-MA")}</span>
                                                    {/* ADM-01: links to the reported entity */}
                                                    {r.target_type === "ride" && (
                                                        <Link href={`/rides/${r.target_id}`} target="_blank" style={{ color: "var(--blue)" }}>Voir le trajet →</Link>
                                                    )}
                                                    {r.target_type === "user" && (
                                                        <Link href={`/drivers/${r.target_id}`} target="_blank" style={{ color: "var(--blue)" }}>Voir le profil →</Link>
                                                    )}
                                                </p>
                                                {r.admin_note && <p style={{ fontSize: 12, color: "#22c55e", margin: 0 }}>Note : {r.admin_note}</p>}
                                            </div>
                                            <div className="admin-doc-actions" style={{ flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                                                <span className={`booking-badge ${r.status === "RESOLVED" ? "confirmed" : r.status === "DISMISSED" ? "cancelled" : "pending-badge-inline"}`}>
                                                    {r.status === "RESOLVED" ? "Résolu" : r.status === "DISMISSED" ? "Ignoré" : "En attente"}
                                                </span>
                                                {r.status === "PENDING" && (
                                                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                                        <button className="btn-accept-booking" onClick={() => resolveReport(r.id, "RESOLVED")}>Résoudre</button>
                                                        <button className="btn-cancel-booking" onClick={() => resolveReport(r.id, "DISMISSED")}>Ignorer</button>
                                                        {/* ADM-01: ban user directly from report */}
                                                        {r.target_type === "user" && (
                                                            <button
                                                                onClick={() => banUserFromReport(r.target_id, r.id)}
                                                                style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: "#7f1d1d", color: "#fca5a5", border: "1px solid #991b1b", cursor: "pointer" }}
                                                            >
                                                                Bannir
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}

                    {/* ── Ratings (ADM-04) ── */}
                    {tab === "ratings" && (
                        <section className="glass-card section-card">
                            <div className="section-header">
                                <h2>Avis ({ratings.length})</h2>
                                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
                                    Détection basique : avis ≤ 2 étoiles sans commentaire → badge ⚠ Suspect.
                                    La détection automatisée par IA (IA-06) n&apos;est pas encore implémentée — la modération reste manuelle.
                                </p>
                            </div>
                            {ratings.length === 0 ? (
                                <p className="dash-empty">Aucun avis pour le moment.</p>
                            ) : (
                                <div className="admin-ratings-list">
                                    {ratings.map((r) => {
                                        // ADM-04: auto-flag suspicious reviews (very low stars, no comment)
                                        const suspicious = r.stars <= 2 && !r.comment;
                                        return (
                                            <div key={r.id} className="admin-rating-row" style={suspicious ? { borderColor: "rgba(239,68,68,.35)", background: "rgba(239,68,68,.04)" } : undefined}>
                                                <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, flexWrap: "wrap" }}>
                                                    <div className="admin-rating-stars" style={{ color: r.stars <= 2 ? "#ef4444" : "#fbbf24" }}>
                                                        {"★".repeat(r.stars)}{"☆".repeat(5 - r.stars)}
                                                    </div>
                                                    {suspicious && (
                                                        <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: "rgba(239,68,68,.15)", color: "#ef4444", fontWeight: 600 }}>
                                                            ⚠ Suspect
                                                        </span>
                                                    )}
                                                    <p className="admin-rating-comment" style={{ margin: 0, flex: 1 }}>
                                                        {r.comment || <em style={{ color: "var(--text-muted)" }}>Sans commentaire</em>}
                                                    </p>
                                                    <p className="admin-rating-meta" style={{ margin: 0, whiteSpace: "nowrap" }}>
                                                        {new Date(r.created_at).toLocaleDateString("fr-MA")}
                                                    </p>
                                                </div>
                                                <button
                                                    className="btn-cancel-booking"
                                                    onClick={() => deleteRating(r.id)}
                                                    style={{ marginLeft: 12, flexShrink: 0 }}
                                                >
                                                    Supprimer
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                    )}
                </section>
            </div>
        </main>
    );
}

function StatCard({ label, value, sub, currency, alert }: {
    label: string; value: number; sub: string; currency?: boolean; alert?: boolean;
}) {
    return (
        <div className="glass-card admin-stat-card" style={alert && value > 0 ? { borderColor: "rgba(255,93,135,.4)" } : undefined}>
            <p className="admin-stat-label">{label}</p>
            <p className="admin-stat-value" style={alert && value > 0 ? { color: "var(--red)" } : undefined}>
                {currency ? `${value.toLocaleString("fr-MA")} MAD` : value}
            </p>
            <p className="admin-stat-sub">{sub}</p>
        </div>
    );
}
