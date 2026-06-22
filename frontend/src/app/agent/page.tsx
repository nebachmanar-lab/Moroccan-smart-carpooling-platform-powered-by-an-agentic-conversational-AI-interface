"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { apiFetch } from "@/lib/api";

const MiniMap = dynamic(() => import("@/components/RideMap"), {
    ssr: false,
    loading: () => <div className="mini-map-skeleton">Carte...</div>,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface User { id: string; first_name: string; last_name: string; role: string }

interface ConvListItem {
    id: string;
    title: string | null;
    created_at: string;
    updated_at: string;
}

interface ChatMessage {
    id?: string;
    role: "user" | "assistant";
    content: string;
    ui_action?: string;
    data?: Record<string, unknown>;
    needs_confirmation?: boolean;
    pending_action?: Record<string, unknown>;
}

interface AgentResponse {
    reply: string;
    ui_action: string;
    data?: Record<string, unknown>;
    needs_confirmation: boolean;
    pending_action?: Record<string, unknown>;
}

interface RideResult {
    id: string; origin: string; destination: string;
    departure_time: string; available_seats: number;
    price_per_seat: number; driver_name: string;
    driver_rating: number | null; distance_km: number | null;
    est_duration: string | null;
    origin_lat: number | null; origin_lng: number | null;
    destination_lat: number | null; destination_lng: number | null;
    pickup_location?: string | null;
    dropoff_location?: string | null;
    driver_preferences?: { smoking: boolean; pets: boolean; music: boolean; ac: boolean; talk: string } | null;
}

interface BookingSummary {
    ride_id: string; seats: number; origin: string; destination: string;
    departure_time: string; price_per_seat: number; total_price: number; driver_name: string;
}

interface TouristInfo {
    found: boolean; destination: string; description?: string;
    highlights?: string[]; food?: string[]; accommodation?: string[]; tip?: string; tags?: string[];
}

interface PaymentMethods {
    methods: { id: string; name: string; icon: string; description: string; available: boolean; note?: string }[];
    note: string;
}

// ---------------------------------------------------------------------------
// Preference learning — persists searched routes in localStorage (IA-05)
// ---------------------------------------------------------------------------
function recordSearchedRoute(origin: string, destination: string) {
    try {
        const stored = localStorage.getItem("searched_routes");
        const routes: { origin: string; destination: string; count: number }[] = stored ? JSON.parse(stored) : [];
        const existing = routes.find((r) => r.origin === origin && r.destination === destination);
        if (existing) { existing.count++; } else { routes.push({ origin, destination, count: 1 }); }
        // Keep only top 10 by count
        routes.sort((a, b) => b.count - a.count);
        localStorage.setItem("searched_routes", JSON.stringify(routes.slice(0, 10)));
    } catch { /* ignore */ }
}

function getLearnedSuggestions(): string[] {
    try {
        const stored = localStorage.getItem("searched_routes");
        if (!stored) return [];
        const routes: { origin: string; destination: string; count: number }[] = JSON.parse(stored);
        return routes.slice(0, 2).map((r) => `Je cherche un trajet ${r.origin} → ${r.destination}`);
    } catch { return []; }
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------
const SUGGESTIONS_PASSENGER = [
    "Je cherche un trajet Casablanca → Marrakech demain matin, max 120 DH",
    "بغيت نمشي من طنجة لفاس نهار السبت",
    "Find a ride Rabat → Agadir this weekend, 2 seats",
    "Je veux visiter Chefchaouen ce weekend",
];
const SUGGESTIONS_DRIVER = [
    "Je veux publier un trajet Casablanca → Rabat demain à 8h, 3 places, 80 DH",
    "Montre-moi mes trajets publiés",
    "Quelles sont mes préférences de conduite ?",
];

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function AgentPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [user, setUser] = useState<User | null>(null);
    const [conversations, setConversations] = useState<ConvListItem[]>([]);
    const [activeConvId, setActiveConvId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [pendingAction, setPendingAction] = useState<Record<string, unknown> | null>(null);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [showMap, setShowMap] = useState<string | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Auth + initial load
    useEffect(() => {
        const token = localStorage.getItem("access_token");
        if (!token) { router.push("/login"); return; }

        apiFetch("/auth/me").then(async (res) => {
            if (!res.ok) { router.push("/login"); return; }
            const u: User = await res.json();
            setUser(u);

            // MI-04: If coming from classic search with pre-filled state, auto-send search
            const origin = searchParams.get("origin");
            const destination = searchParams.get("destination");
            const date = searchParams.get("date");
            if (origin && destination && !searchParams.get("cid")) {
                const parts = [`Je cherche un trajet ${origin} → ${destination}`];
                if (date) parts.push(`le ${date}`);
                setInput(parts.join(" "));
            }
        }).catch(() => router.push("/login"));

        apiFetch("/ai/conversations").then(async (res) => {
            if (res.ok) setConversations(await res.json());
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router]);

    // Load conversation from URL param
    useEffect(() => {
        const cid = searchParams.get("cid");
        if (!cid) {
            setActiveConvId(null);
            setMessages([]);
            setPendingAction(null);
            return;
        }
        if (cid === activeConvId) return;
        apiFetch(`/ai/conversations/${cid}`).then(async (res) => {
            if (!res.ok) return;
            const data = await res.json();
            setActiveConvId(cid);
            setMessages(data.messages || []);
            const last = (data.messages || []).slice(-1)[0];
            if (last?.role === "assistant" && last.needs_confirmation && last.pending_action) {
                setPendingAction(last.pending_action);
            } else {
                setPendingAction(null);
            }
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, loading]);

    // Send message
    const sendMessage = useCallback(async (text?: string) => {
        const content = (text ?? input).trim();
        if (!content || loading) return;
        setInput("");
        setLoading(true);
        setPendingAction(null);

        // Ensure we have an active conversation.
        // We use window.history.pushState (not router.push) so the URL updates
        // without triggering the searchParams effect — avoiding the race where
        // the effect resets messages before the optimistic update lands.
        let cid = activeConvId;
        if (!cid) {
            try {
                const res = await apiFetch("/ai/conversations", { method: "POST" });
                if (!res.ok) {
                    const errBody = await res.json().catch(() => ({}));
                    throw new Error(`HTTP ${res.status}: ${errBody.detail || res.statusText}`);
                }
                const conv: ConvListItem = await res.json();
                cid = conv.id;
                setActiveConvId(cid);
                setConversations((prev) => [conv, ...prev]);
                window.history.pushState({}, "", `/agent?cid=${cid}`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                setMessages((prev) => [...prev, {
                    role: "assistant" as const,
                    content: `Erreur lors de la création de la conversation : ${msg}`,
                    ui_action: "error",
                }]);
                setLoading(false);
                return;
            }
        }

        // Optimistic user message
        setMessages((prev) => [...prev, { role: "user" as const, content }]);

        try {
            const res = await apiFetch(`/ai/conversations/${cid}/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: content }),
            });
            const data: AgentResponse = await res.json();
            setMessages((prev) => [...prev, {
                role: "assistant",
                content: data.reply,
                ui_action: data.ui_action,
                data: data.data,
                needs_confirmation: data.needs_confirmation,
                pending_action: data.pending_action,
            }]);
            if (data.needs_confirmation && data.pending_action) {
                setPendingAction(data.pending_action);
            }
            // IA-05: learn route from results
            if (data.ui_action === "show_rides" && Array.isArray(data.data?.rides)) {
                const rides = data.data!.rides as { origin: string; destination: string }[];
                if (rides.length > 0) recordSearchedRoute(rides[0].origin, rides[0].destination);
            }
            // Refresh sidebar list to pick up auto-generated title
            apiFetch("/ai/conversations").then(async (r) => {
                if (r.ok) setConversations(await r.json());
            });
        } catch {
            setMessages((prev) => [...prev, {
                role: "assistant" as const,
                content: "Désolé, une erreur est survenue. Réessayez.",
                ui_action: "error",
            }]);
        } finally {
            setLoading(false);
            inputRef.current?.focus();
        }
    }, [input, loading, activeConvId]);

    // Confirm booking
    const handleConfirm = useCallback(async () => {
        if (!pendingAction || !activeConvId) return;
        const snapshot = pendingAction;
        setPendingAction(null);
        setLoading(true);
        setMessages((prev) => [...prev, { role: "user", content: "Confirmer la réservation" }]);

        try {
            const res = await apiFetch(`/ai/conversations/${activeConvId}/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: "Confirmer", confirmed: true, pending_action: snapshot }),
            });
            const data: AgentResponse = await res.json();
            setMessages((prev) => [...prev, {
                role: "assistant", content: data.reply, ui_action: data.ui_action, data: data.data,
            }]);
        } catch {
            setMessages((prev) => [...prev, {
                role: "assistant", content: "Erreur lors de la confirmation.", ui_action: "error",
            }]);
        } finally {
            setLoading(false);
        }
    }, [pendingAction, activeConvId]);

    const handleCancel = useCallback(() => {
        setPendingAction(null);
        setMessages((prev) => [
            ...prev,
            { role: "user", content: "Annuler" },
            { role: "assistant", content: "Action annulée. Comment puis-je vous aider ?", ui_action: "none" },
        ]);
    }, []);

    // Delete conversation
    const deleteConversation = useCallback(async (cid: string, e: React.MouseEvent) => {
        e.stopPropagation();
        await apiFetch(`/ai/conversations/${cid}`, { method: "DELETE" });
        setConversations((prev) => prev.filter((c) => c.id !== cid));
        if (activeConvId === cid) {
            setActiveConvId(null);
            setMessages([]);
            router.push("/agent");
        }
    }, [activeConvId, router]);

    const bookRide = useCallback((id: string) => sendMessage(`Je veux réserver le trajet ${id}`), [sendMessage]);
    const showDetail = useCallback((id: string) => sendMessage(`Montre-moi les détails du trajet ${id}`), [sendMessage]);

    const showSuggestions = messages.length === 0 && !loading;
    const learnedSuggestions = user?.role !== "DRIVER" ? getLearnedSuggestions() : [];
    const suggestions = user?.role === "DRIVER"
        ? SUGGESTIONS_DRIVER
        : [...learnedSuggestions, ...SUGGESTIONS_PASSENGER].slice(0, 4);

    return (
        <main className="app-shell">
            <div className="page-layer copilot-page">
                {/* Navbar */}
                <nav className="navbar">
                    <Link href="/" className="brand">
                        <span className="brand-badge">CM</span>
                        <span>Covoit Maroc</span>
                    </Link>
                    <div className="nav-links">
                        <Link href="/dashboard">Dashboard</Link>
                    </div>
                    <div className="nav-actions">
                        <div className="mode-pill">
                            <button className="mode-pill-btn" onClick={() => { localStorage.setItem("interface_mode", "normal"); router.push("/dashboard"); }}>
                                Normal
                            </button>
                            <button className="mode-pill-btn active">IA Copilot</button>
                        </div>
                        <button className="btn btn-secondary btn-sm" onClick={() => {
                            localStorage.removeItem("access_token");
                            localStorage.removeItem("refresh_token");
                            router.push("/login");
                        }}>Déconnexion</button>
                    </div>
                </nav>

                <div className="copilot-body">
                    {/* Sidebar */}
                    <aside className={`conv-sidebar ${sidebarOpen ? "open" : "closed"}`}>
                        <div className="conv-sidebar-top">
                            <button className="new-chat-btn" onClick={() => { setMessages([]); setPendingAction(null); router.push("/agent"); }}>
                                Nouveau chat
                            </button>
                            <button className="sidebar-toggle-btn" onClick={() => setSidebarOpen((v) => !v)} title="Masquer le panneau">
                                {sidebarOpen ? "◀" : "▶"}
                            </button>
                        </div>

                        {sidebarOpen && (
                            <div className="conv-list">
                                {conversations.length === 0 && (
                                    <p className="conv-empty">Aucune conversation</p>
                                )}
                                {conversations.map((c) => (
                                    <div
                                        key={c.id}
                                        className={`conv-item ${activeConvId === c.id ? "active" : ""}`}
                                        onClick={() => router.push(`/agent?cid=${c.id}`)}
                                    >
                                        <span className="conv-item-title">
                                            {c.title || "Nouvelle conversation"}
                                        </span>
                                        <span className="conv-item-time">
                                            {relativeTime(c.updated_at)}
                                        </span>
                                        <button
                                            className="conv-delete-btn"
                                            onClick={(e) => deleteConversation(c.id, e)}
                                            title="Supprimer"
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </aside>

                    {/* Main chat area */}
                    <div className="copilot-main">
                        {/* Header */}
                        <div className="copilot-header">
                            <div className="copilot-avatar">
                                <span>R</span>
                                <span className="copilot-status-dot" />
                            </div>
                            <div className="copilot-header-text">
                                <h2 className="copilot-title">Rafi — Copilote CovoitMaroc</h2>
                                <p className="copilot-subtitle">Je cherche, compare et réserve des trajets pour vous</p>
                            </div>
                            <div className="copilot-caps">
                                <span className="cap-badge">Recherche</span>
                                <span className="cap-badge">Comparaison</span>
                                <span className="cap-badge">Réservation</span>
                                <span className="cap-badge">Carte</span>
                                <span className="cap-badge">Tourisme</span>
                            </div>
                        </div>

                        {/* Chat window */}
                        <div className="copilot-chat">
                            {showSuggestions && !activeConvId && (
                                <WelcomeScreen user={user} suggestions={suggestions} onSuggest={sendMessage} />
                            )}

                            {messages.map((msg, i) => (
                                <MessageBlock
                                    key={msg.id || i}
                                    msg={msg}
                                    onBookRide={bookRide}
                                    onShowDetail={showDetail}
                                    onShowMap={setShowMap}
                                />
                            ))}

                            {pendingAction && (
                                <div className="confirm-bar-v2">
                                    <p className="confirm-bar-text">Confirmez-vous la réservation ?</p>
                                    <div className="confirm-bar-actions">
                                        <button className="btn btn-primary btn-sm" onClick={handleConfirm}>Oui, confirmer</button>
                                        <button className="btn btn-secondary btn-sm" onClick={handleCancel}>Annuler</button>
                                    </div>
                                </div>
                            )}

                            {loading && (
                                <div className="msg-row assistant">
                                    <div className="msg-avatar-sm">R</div>
                                    <div className="typing-dots"><span /><span /><span /></div>
                                </div>
                            )}

                            <div ref={bottomRef} />
                        </div>

                        {/* Input */}
                        <div className="copilot-input-bar">
                            <textarea
                                ref={inputRef}
                                className="copilot-input"
                                rows={1}
                                placeholder="Décrivez votre trajet... / صف طلبك... / Type your request..."
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                                disabled={loading}
                                dir="auto"
                            />
                            <button
                                className="copilot-send-btn"
                                onClick={() => sendMessage()}
                                disabled={loading || !input.trim()}
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <line x1="22" y1="2" x2="11" y2="13" />
                                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {showMap && <MapOverlay rideId={showMap} onClose={() => setShowMap(null)} />}
        </main>
    );
}

// ---------------------------------------------------------------------------
// Welcome screen (shown when no conversation is active)
// ---------------------------------------------------------------------------
function WelcomeScreen({ user, suggestions, onSuggest }: {
    user: User | null; suggestions: string[]; onSuggest: (s: string) => void;
}) {
    return (
        <div className="welcome-screen">
            <div className="welcome-avatar">R</div>
            <h2 className="welcome-title">
                Bonjour{user ? ` ${user.first_name}` : ""} ! Je suis Rafi.
            </h2>
            <p className="welcome-sub">
                {user?.role === "DRIVER"
                    ? "Je peux publier vos trajets, les consulter et bien plus."
                    : "Je peux chercher, comparer et réserver des trajets pour vous."}
            </p>
            <div className="welcome-suggestions">
                {suggestions.map((s) => (
                    <button key={s} className="suggestion-chip" onClick={() => onSuggest(s)}>{s}</button>
                ))}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Message block
// ---------------------------------------------------------------------------
function MessageBlock({ msg, onBookRide, onShowDetail, onShowMap }: {
    msg: ChatMessage;
    onBookRide: (id: string) => void;
    onShowDetail: (id: string) => void;
    onShowMap: (id: string) => void;
}) {
    const rides = msg.data?.rides as RideResult[] | undefined;
    const rideDetail = msg.data?.ride_detail as RideResult | undefined;
    const bookingSummary = msg.data?.booking_summary as BookingSummary | undefined;
    const touristInfo = msg.data?.tourist_info as TouristInfo | undefined;
    const paymentMethods = msg.data?.payment_methods as PaymentMethods | undefined;
    const booking = msg.data?.booking as Record<string, unknown> | undefined;
    const distInfo = msg.data?.distance_info as Record<string, unknown> | undefined;
    const estDuration = msg.data?.est_duration as string | undefined;
    const distKm = msg.data?.distance_km as number | undefined;

    return (
        <div className={`msg-row ${msg.role}`}>
            {msg.role === "assistant" && <div className="msg-avatar-sm">R</div>}
            <div className="msg-block">
                <div className={`msg-bubble ${msg.role}`}>
                    <MarkdownText text={msg.content} />
                </div>

                {msg.role === "assistant" && (distKm || estDuration || distInfo) && (
                    <div className="route-meta-bar">
                        {!!(distKm ?? distInfo?.distance_km) && (
                            <span className="route-meta-badge">{distKm ?? String(distInfo?.distance_km)} km</span>
                        )}
                        {!!(estDuration ?? distInfo?.est_duration) && (
                            <span className="route-meta-badge">{estDuration ?? String(distInfo?.est_duration)}</span>
                        )}
                    </div>
                )}

                {msg.role === "assistant" && rides && rides.length > 0 && (
                    <div className="ride-results-grid">
                        {rides.map((r, i) => (
                            <RideCard key={r.id} ride={r} rank={i + 1}
                                onBook={() => onBookRide(r.id)}
                                onDetail={() => onShowDetail(r.id)}
                                onMap={() => { if (r.origin_lat) onShowMap(r.id); }}
                            />
                        ))}
                    </div>
                )}

                {msg.role === "assistant" && msg.ui_action === "show_rides" && rides && rides.length === 0 && (
                    <div className="no-results-card">
                        <p>Aucun trajet disponible.</p>
                        <p className="no-results-hint">Essayez une autre date ou des critères différents.</p>
                    </div>
                )}

                {msg.role === "assistant" && rideDetail && (
                    <RideDetailCard ride={rideDetail} onBook={() => onBookRide(rideDetail.id)} />
                )}

                {msg.role === "assistant" && bookingSummary && (
                    <BookingSummaryCard summary={bookingSummary} />
                )}

                {msg.role === "assistant" && msg.ui_action === "booking_confirmed" && booking && (
                    <BookingConfirmedCard booking={booking} />
                )}

                {msg.role === "assistant" && touristInfo?.found && (
                    <TouristCard info={touristInfo} />
                )}

                {msg.role === "assistant" && paymentMethods && (
                    <PaymentCard methods={paymentMethods} />
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Ride card
// ---------------------------------------------------------------------------
function RideCard({ ride, rank, onBook, onDetail, onMap }: {
    ride: RideResult; rank: number; onBook: () => void; onDetail: () => void; onMap: () => void;
}) {
    const dt = new Date(ride.departure_time);
    const dateStr = dt.toLocaleDateString("fr-MA", { weekday: "short", day: "numeric", month: "short" });
    const timeStr = dt.toLocaleTimeString("fr-MA", { hour: "2-digit", minute: "2-digit" });

    return (
        <div className={`ride-card-v2 ${rank === 1 ? "ride-card-best" : ""}`}>
            {rank === 1 && <div className="best-badge">Meilleure option</div>}
            <div className="ride-card-header">
                <div className="ride-card-route">
                    <span className="city-name">{ride.origin}</span>
                    <span className="route-arrow">→</span>
                    <span className="city-name">{ride.destination}</span>
                </div>
                <div className="ride-card-price">{ride.price_per_seat} <span>MAD</span></div>
            </div>
            <div className="ride-card-meta">
                <div className="meta-item"><span>{dateStr} · {timeStr}</span></div>
                <div className="meta-item"><span>{ride.driver_name}</span></div>
                <div className="meta-item"><span>{ride.available_seats} place(s)</span></div>
                {ride.est_duration && <div className="meta-item"><span>{ride.est_duration}</span></div>}
            </div>
            {ride.driver_preferences && (
                <div className="ride-prefs">
                    <PrefBadge active={ride.driver_preferences.ac} label="AC" />
                    <PrefBadge active={ride.driver_preferences.music} label="Musique" />
                    <PrefBadge active={!ride.driver_preferences.smoking} label="Non-fumeur" />
                    <PrefBadge active={ride.driver_preferences.pets} label="Animaux" />
                </div>
            )}
            <div className="ride-card-actions">
                <button className="btn btn-primary btn-sm" onClick={onBook}>Réserver</button>
                <button className="btn btn-secondary btn-sm" onClick={onDetail}>Détails</button>
                {ride.origin_lat && <button className="btn-icon-map" onClick={onMap} title="Carte">Carte</button>}
            </div>
        </div>
    );
}

function PrefBadge({ active, label }: { active: boolean; label: string }) {
    return <span className={`pref-badge ${active ? "pref-yes" : "pref-no"}`}>{label}</span>;
}

// ---------------------------------------------------------------------------
// Ride detail card
// ---------------------------------------------------------------------------
function RideDetailCard({ ride, onBook }: { ride: RideResult; onBook: () => void }) {
    const dt = new Date(ride.departure_time);
    const dateStr = dt.toLocaleString("fr-MA", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    return (
        <div className="detail-card">
            <h3 className="detail-card-title">{ride.origin} → {ride.destination}</h3>
            <p className="detail-card-date">{dateStr}</p>
            <div className="detail-grid">
                <InfoItem label="Conducteur" value={ride.driver_name} />
                <InfoItem label="Prix" value={`${ride.price_per_seat} MAD/place`} />
                <InfoItem label="Places" value={`${ride.available_seats}`} />
                {ride.distance_km && <InfoItem label="Distance" value={`${ride.distance_km} km`} />}
                {ride.est_duration && <InfoItem label="Durée" value={ride.est_duration} />}
                {ride.pickup_location && <InfoItem label="Départ" value={ride.pickup_location} />}
                {ride.dropoff_location && <InfoItem label="Arrivée" value={ride.dropoff_location} />}
            </div>
            {ride.driver_preferences && (
                <div className="detail-prefs">
                    <p className="detail-prefs-title">Préférences conducteur</p>
                    <div className="ride-prefs">
                        <PrefBadge active={ride.driver_preferences.ac} label="AC" />
                        <PrefBadge active={ride.driver_preferences.music} label="Musique" />
                        <PrefBadge active={!ride.driver_preferences.smoking} label="Non-fumeur" />
                        <PrefBadge active={ride.driver_preferences.pets} label="Animaux" />
                    </div>
                </div>
            )}
            {ride.origin_lat && ride.destination_lat && (
                <div className="mini-map-wrapper">
                    <MiniMap originName={ride.origin} destinationName={ride.destination}
                        originLat={ride.origin_lat!} originLng={ride.origin_lng!}
                        destinationLat={ride.destination_lat!} destinationLng={ride.destination_lng!} />
                </div>
            )}
            <button className="btn btn-primary btn-full" style={{ marginTop: 16 }} onClick={onBook}>
                Réserver — {ride.price_per_seat} MAD
            </button>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Booking summary card
// ---------------------------------------------------------------------------
function BookingSummaryCard({ summary }: { summary: BookingSummary }) {
    const dt = new Date(summary.departure_time);
    const dateStr = dt.toLocaleString("fr-MA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    return (
        <div className="booking-summary-card">
            <div className="booking-summary-header"><h4>Récapitulatif de réservation</h4></div>
            <div className="booking-route">
                <span className="city-name">{summary.origin}</span>
                <span className="route-arrow">→</span>
                <span className="city-name">{summary.destination}</span>
            </div>
            <div className="detail-grid" style={{ marginTop: 12 }}>
                <InfoItem label="Départ" value={dateStr} />
                <InfoItem label="Conducteur" value={summary.driver_name} />
                <InfoItem label="Places" value={`${summary.seats}`} />
                <InfoItem label="Total" value={`${summary.total_price} MAD`} />
                <InfoItem label="Paiement" value="Espèces au conducteur" />
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Booking confirmed
// ---------------------------------------------------------------------------
function BookingConfirmedCard({ booking }: { booking: Record<string, unknown> }) {
    return (
        <div className="booking-confirmed-card">
            <div className="confirmed-content">
                <h4>Réservation confirmée !</h4>
                <p>{String(booking.origin)} → {String(booking.destination)}</p>
                <p>{String(booking.seats_booked)} place(s) · {Number(booking.total_price).toFixed(0)} MAD</p>
            </div>
            <Link href={`/rides/${String(booking.ride_id)}`} className="btn btn-secondary btn-sm">Voir →</Link>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Tourist card
// ---------------------------------------------------------------------------
function TouristCard({ info }: { info: TouristInfo }) {
    return (
        <div className="tourist-card">
            <div className="tourist-card-header"><h4>{info.destination}</h4></div>
            {info.description && <p className="tourist-desc">{info.description}</p>}
            {info.tags && <div className="tourist-tags">{info.tags.map((t) => <span key={t} className="tourist-tag">{t}</span>)}</div>}
            {info.highlights && <TouristSection title="À voir" items={info.highlights} />}
            {info.food && <TouristSection title="Où manger" items={info.food} />}
            {info.accommodation && <TouristSection title="Où dormir" items={info.accommodation} />}
            {info.tip && <div className="tourist-tip">{info.tip}</div>}
            <Link
                href={`/tourist?destination=${encodeURIComponent(info.destination)}`}
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
            >
                Carte & POI · Mode Touriste →
            </Link>
        </div>
    );
}
function TouristSection({ title, items }: { title: string; items: string[] }) {
    return (
        <div className="tourist-section">
            <p className="tourist-section-title">{title}</p>
            <ul className="tourist-list">{items.map((i) => <li key={i}>{i}</li>)}</ul>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Payment card
// ---------------------------------------------------------------------------
function PaymentCard({ methods }: { methods: PaymentMethods }) {
    return (
        <div className="payment-card">
            <h4>Modes de paiement</h4>
            <div className="payment-list">
                {methods.methods.map((m) => (
                    <div key={m.id} className={`payment-method-row ${m.available ? "pay-active" : "pay-soon"}`}>
                        <span className="payment-icon">{m.icon}</span>
                        <div className="payment-info">
                            <p className="payment-name">{m.name}</p>
                            <p className="payment-desc">{m.description}</p>
                        </div>
                        {m.available ? <span className="pay-badge-active">✓</span> : <span className="pay-badge-soon">{m.note || "Bientôt"}</span>}
                    </div>
                ))}
            </div>
            <p className="payment-note">{methods.note}</p>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Map overlay
// ---------------------------------------------------------------------------
function MapOverlay({ rideId, onClose }: { rideId: string; onClose: () => void }) {
    const [ride, setRide] = useState<RideResult | null>(null);
    useEffect(() => {
        apiFetch(`/rides/${rideId}`).then((r) => r.json()).then(setRide).catch(() => null);
    }, [rideId]);
    return (
        <div className="map-overlay" onClick={onClose}>
            <div className="map-overlay-content" onClick={(e) => e.stopPropagation()}>
                <button className="map-overlay-close" onClick={onClose}>✕</button>
                {ride?.origin_lat && ride.destination_lat ? (
                    <MiniMap originName={ride.origin} destinationName={ride.destination}
                        originLat={ride.origin_lat} originLng={ride.origin_lng!}
                        destinationLat={ride.destination_lat} destinationLng={ride.destination_lng!} />
                ) : (
                    <div className="map-placeholder">{ride ? "Coordonnées non disponibles" : "Chargement..."}</div>
                )}
                {ride && <p className="map-caption">{ride.origin} → {ride.destination}</p>}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function MarkdownText({ text }: { text: string }) {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return (
        <p style={{ margin: 0, whiteSpace: "pre-line" }}>
            {parts.map((part, i) =>
                part.startsWith("**") && part.endsWith("**")
                    ? <strong key={i}>{part.slice(2, -2)}</strong>
                    : <span key={i}>{part}</span>
            )}
        </p>
    );
}

function InfoItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="info-item">
            <p className="info-item-label">{label}</p>
            <p className="info-item-value">{value}</p>
        </div>
    );
}

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "maintenant";
    if (m < 60) return `${m}min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}j`;
    return new Date(iso).toLocaleDateString("fr-MA", { day: "numeric", month: "short" });
}
