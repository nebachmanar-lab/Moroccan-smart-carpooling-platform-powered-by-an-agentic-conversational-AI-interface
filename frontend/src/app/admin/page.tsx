"use client";

import { useEffect, useState } from "react";
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

type Tab = "stats" | "users" | "rides" | "documents" | "ratings";

export default function AdminPage() {
    const router = useRouter();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";
    const [tab, setTab] = useState<Tab>("stats");
    const [stats, setStats] = useState<Stats | null>(null);
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [rides, setRides] = useState<AdminRide[]>([]);
    const [docs, setDocs] = useState<AdminDoc[]>([]);
    const [ratings, setRatings] = useState<AdminRating[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [reviewNote, setReviewNote] = useState<Record<string, string>>({});

    useEffect(() => {
        apiFetch("/admin/stats")
            .then((r) => { if (r.status === 403) { router.push("/dashboard"); return null; } return r.json(); })
            .then((d) => { if (d) setStats(d); setLoading(false); })
            .catch(() => { setError("Accès refusé ou erreur."); setLoading(false); });
    }, [router]);

    useEffect(() => {
        if (tab === "users"     && users.length === 0)   apiFetch("/admin/users").then((r) => r.ok ? r.json() : []).then(setUsers);
        if (tab === "rides"     && rides.length === 0)   apiFetch("/admin/rides").then((r) => r.ok ? r.json() : []).then(setRides);
        if (tab === "documents" && docs.length === 0)    apiFetch("/documents/admin/all").then((r) => r.ok ? r.json() : []).then(setDocs);
        if (tab === "ratings"   && ratings.length === 0) apiFetch("/ratings/admin/all").then((r) => r.ok ? r.json() : []).then(setRatings);
    }, [tab, users.length, rides.length, docs.length, ratings.length]);

    async function changeRole(userId: string, newRole: string) {
        await apiFetch(`/admin/users/${userId}/role`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: newRole }) });
        setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role: newRole } : u));
    }

    async function deleteUser(userId: string) {
        if (!confirm("Supprimer cet utilisateur ?")) return;
        const res = await apiFetch(`/admin/users/${userId}`, { method: "DELETE" });
        if (res.ok) setUsers((prev) => prev.filter((u) => u.id !== userId));
    }

    async function cancelRide(rideId: string) {
        if (!confirm("Annuler ce trajet ?")) return;
        const res = await apiFetch(`/admin/rides/${rideId}`, { method: "DELETE" });
        if (res.ok) setRides((prev) => prev.map((r) => r.id === rideId ? { ...r, status: "CANCELLED" } : r));
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
        }
    }

    if (loading) return <main className="app-shell"><div className="page-layer loading-page"><p>Chargement...</p></div></main>;
    if (error)   return <main className="app-shell"><div className="page-layer"><div className="inner-page"><p className="alert-error">{error}</p></div></div></main>;

    const TABS: { id: Tab; label: string; badge?: number }[] = [
        { id: "stats",     label: "Statistiques" },
        { id: "users",     label: "Utilisateurs" },
        { id: "rides",     label: "Trajets" },
        { id: "documents", label: "Documents", badge: stats?.documents.pending },
        { id: "ratings",   label: "Avis" },
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
                            <p className="dashboard-subtitle">Modération et supervision de la plateforme</p>
                        </div>
                    </div>

                    <div className="admin-tabs">
                        {TABS.map((t) => (
                            <button key={t.id} className={`admin-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
                                {t.label}
                                {t.badge ? <span className="tab-count" style={{ background: "var(--red)", color: "#fff" }}>{t.badge}</span> : null}
                            </button>
                        ))}
                    </div>

                    {/* Stats */}
                    {tab === "stats" && stats && (
                        <>
                            <div className="admin-stats-grid">
                                <StatCard label="Utilisateurs" value={stats.users.total} sub={`${stats.users.drivers} conducteurs · ${stats.users.passengers} passagers`} />
                                <StatCard label="Trajets" value={stats.rides.total} sub={`${stats.rides.active} actifs · ${stats.rides.completed} terminés`} />
                                <StatCard label="Réservations" value={stats.bookings.total} sub={`${stats.bookings.confirmed} confirmées`} />
                                <StatCard label="Revenus confirmés" value={stats.revenue.total_confirmed_mad} sub="MAD total sur la plateforme" currency />
                                <StatCard label="Avis" value={stats.ratings.total} sub="Évaluations laissées" />
                                <StatCard label="Documents en attente" value={stats.documents.pending} sub="Vérifications conducteurs" alert={stats.documents.pending > 0} />
                            </div>
                        </>
                    )}

                    {/* Users */}
                    {tab === "users" && (
                        <section className="glass-card section-card">
                            <div className="section-header"><h2>Utilisateurs ({users.length})</h2></div>
                            <div className="admin-table-wrapper">
                                <table className="admin-table">
                                    <thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Trajets</th><th>Réservations</th><th>Vérifié</th><th>Actions</th></tr></thead>
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
                                                        {u.is_verified ? "Oui" : "Non"}
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

                    {/* Rides */}
                    {tab === "rides" && (
                        <section className="glass-card section-card">
                            <div className="section-header"><h2>Trajets ({rides.length})</h2></div>
                            <div className="admin-table-wrapper">
                                <table className="admin-table">
                                    <thead><tr><th>Trajet</th><th>Départ</th><th>Conducteur</th><th>Prix</th><th>Réservations</th><th>Statut</th><th>Actions</th></tr></thead>
                                    <tbody>
                                        {rides.map((r) => (
                                            <tr key={r.id} style={{ opacity: r.status === "CANCELLED" ? 0.5 : 1 }}>
                                                <td>{r.origin} → {r.destination}</td>
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

                    {/* Documents */}
                    {tab === "documents" && (
                        <section className="glass-card section-card">
                            <div className="section-header"><h2>Documents conducteurs ({docs.length})</h2></div>
                            {docs.length === 0 ? (
                                <p className="dash-empty">Aucun document soumis.</p>
                            ) : (
                                <div className="admin-doc-list">
                                    {docs.map((d) => (
                                        <div key={d.id} className="admin-doc-row">
                                            <div>
                                                <p className="admin-doc-driver">{d.driver_name} <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>{d.driver_email}</span></p>
                                                <p className="admin-doc-meta">{d.doc_type} · {d.original_name} · {new Date(d.created_at).toLocaleDateString("fr-MA")}</p>
                                                <a href={`${apiUrl}${d.file_url}`} target="_blank" rel="noopener noreferrer" className="admin-doc-link">Voir le fichier</a>
                                            </div>
                                            <div className="admin-doc-actions">
                                                <span className={`booking-badge ${d.status === "APPROVED" ? "confirmed" : d.status === "REJECTED" ? "cancelled" : "pending-badge-inline"}`}>
                                                    {d.status === "APPROVED" ? "Validé" : d.status === "REJECTED" ? "Rejeté" : "En attente"}
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

                    {/* Ratings */}
                    {tab === "ratings" && (
                        <section className="glass-card section-card">
                            <div className="section-header"><h2>Avis ({ratings.length})</h2></div>
                            {ratings.length === 0 ? (
                                <p className="dash-empty">Aucun avis pour le moment.</p>
                            ) : (
                                <div className="admin-ratings-list">
                                    {ratings.map((r) => (
                                        <div key={r.id} className="admin-rating-row">
                                            <div className="admin-rating-stars">{"★".repeat(r.stars)}{"☆".repeat(5 - r.stars)}</div>
                                            <p className="admin-rating-comment">{r.comment || <em style={{ color: "var(--text-muted)" }}>Sans commentaire</em>}</p>
                                            <p className="admin-rating-meta">{new Date(r.created_at).toLocaleDateString("fr-MA")}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}
                </section>
            </div>
        </main>
    );
}

function StatCard({ label, value, sub, currency, alert }: { label: string; value: number; sub: string; currency?: boolean; alert?: boolean }) {
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
