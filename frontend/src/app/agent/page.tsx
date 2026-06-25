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
    is_recurring?: boolean;
    recurrence_days?: string[];
    recurrence_end_date?: string | null;
    status?: string;
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

interface MyBooking {
    id: string;
    ride_id: string;
    status: string;
    seats_booked: number;
    total_price: number;
    created_at: string;
    ride?: { origin: string; destination: string; departure_time: string; price_per_seat: number; status: string } | null;
}

interface RidePassengers {
    ride_id: string;
    origin: string;
    destination: string;
    departure_time: string;
    passengers: { booking_id: string; passenger_id: string; passenger_name: string; seats: number; total_price: number; status: string }[];
    count: number;
}

interface DriverRevenue {
    total_rides: number;
    active_rides: number;
    completed_rides: number;
    cancelled_rides: number;
    confirmed_bookings: number;
    estimated_revenue_mad: number;
    note: string;
}

interface DriverDocuments {
    verified: boolean;
    documents: { id: string; type: string; status: string; uploaded_at: string | null; notes: string | null }[];
    count: number;
    message: string;
}

interface RecurringRideSetup {
    ride_id: string;
    origin: string;
    destination: string;
    departure_time: string;
    is_recurring: boolean;
    recurrence_days: string[];
    recurrence_end_date: string | null;
}

interface DriverPreferences {
    found?: boolean;
    smoking: boolean;
    pets: boolean;
    music: boolean;
    ac: boolean;
    talk: string;
    luggage: string;
    note?: string | null;
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
    const [learnedSuggestions, setLearnedSuggestions] = useState<string[]>([]);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [showMap, setShowMap] = useState<string | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Auth + initial load
    useEffect(() => {
        const token = sessionStorage.getItem("access_token");
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
        setLearnedSuggestions(getLearnedSuggestions());
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

    function confirmLabel(action: Record<string, unknown> | null): string {
        if (!action) return "Oui, confirmer";
        const a = action.action as string | undefined;
        if (a === "accept_booking") return "Accepter la réservation";
        if (a === "refuse_booking") return "Refuser la réservation";
        if (a === "send_message_to_passenger") return "Envoyer le message";
        if (a === "cancel_booking" || a === "cancel_ride") return "Oui, annuler";
        if (a === "create_ride") return "Publier le trajet";
        if (a === "edit_ride") return "Confirmer les modifications";
        if (a === "create_report") return "Envoyer le signalement";
        if (a === "update_preferences") return "Enregistrer les préférences";
        return "Oui, confirmer";
    }

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
    const suggestions = user?.role === "DRIVER"
        ? SUGGESTIONS_DRIVER
        : [...learnedSuggestions, ...SUGGESTIONS_PASSENGER].slice(0, 4);

    return (
        <main className="app-shell">
            <div className="page-layer copilot-page">
                {/* Navbar */}
                <nav className="navbar">
                    <Link href="/" className="brand">
                        <img src="/logo.png" alt="CovoMar" style={{height:"44px",width:"auto"}} onError={(e)=>{(e.target as HTMLImageElement).style.display="none";(e.target as HTMLImageElement).nextElementSibling!.setAttribute("style","display:inline")}} /><span style={{display:"none",fontWeight:900,fontSize:22}}>CovoMar</span>
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
                            sessionStorage.removeItem("access_token");
                            sessionStorage.removeItem("refresh_token");
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
                                <h2 className="copilot-title">Rafi — Copilote CovoMar</h2>
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
                                    <p className="confirm-bar-text">Confirmez-vous ?</p>
                                    <div className="confirm-bar-actions">
                                        <button className="btn btn-primary btn-sm" onClick={handleConfirm}>{confirmLabel(pendingAction)}</button>
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
    const ridePassengers = msg.data?.passengers as RidePassengers | undefined;
    const driverRevenue = msg.data?.revenue as DriverRevenue | undefined;
    const driverDocuments = msg.data?.documents as DriverDocuments | undefined;
    const driverBookings = msg.data?.bookings as MyBooking[] | undefined;
    const driverPreferences = msg.data?.preferences as DriverPreferences | undefined;
    const recurringRide = msg.data?.recurring_ride as RecurringRideSetup | undefined;
    const shareUrl = msg.data?.share_url as string | undefined;

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
                                showBook={msg.ui_action !== "driver_rides"}
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
                    <RideDetailCard ride={rideDetail} onBook={() => onBookRide(rideDetail.id)}
                        showBook={msg.ui_action !== "driver_rides"} />
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

                {msg.role === "assistant" && ridePassengers && (
                    <RidePassengersCard data={ridePassengers} />
                )}

                {msg.role === "assistant" && driverRevenue && (
                    <DriverRevenueCard data={driverRevenue} />
                )}

                {msg.role === "assistant" && driverDocuments && (
                    <DriverDocumentsCard data={driverDocuments} />
                )}

                {msg.role === "assistant" && driverPreferences != null && msg.ui_action === "driver_preferences" && (
                    <DriverPreferencesCard data={driverPreferences} />
                )}

                {msg.role === "assistant" && recurringRide && msg.ui_action === "driver_set_recurring" && (
                    <RecurringDaysCard data={recurringRide} />
                )}

                {msg.role === "assistant" && driverBookings && msg.ui_action === "driver_bookings" && (
                    <DriverBookingsCard bookings={driverBookings} />
                )}

                {msg.role === "assistant" && shareUrl && (
                    <TrackingShareCard url={shareUrl} />
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Ride card
// ---------------------------------------------------------------------------
function RideCard({ ride, rank, onBook, onDetail, onMap, showBook = true }: {
    ride: RideResult; rank: number; onBook: () => void; onDetail: () => void; onMap: () => void; showBook?: boolean;
}) {
    const dt = new Date(ride.departure_time);
    const dateStr = dt.toLocaleDateString("fr-MA", { weekday: "short", day: "numeric", month: "short" });
    const timeStr = dt.toLocaleTimeString("fr-MA", { hour: "2-digit", minute: "2-digit" });
    const isDriverCard = !showBook;

    const [isHab, setIsHab] = useState(ride.is_recurring ?? false);
    const [selectedDays, setSelectedDays] = useState<Set<number>>(
        new Set((ride.recurrence_days ?? []).map((d) => DAY_INDICES[d] ?? -1).filter((d) => d >= 0))
    );
    const [endDate, setEndDate] = useState(ride.recurrence_end_date ? ride.recurrence_end_date.slice(0, 10) : "");
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [recurErr, setRecurErr] = useState("");

    const toggleDay = (idx: number) => {
        setSelectedDays((prev) => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
        setSaved(false);
    };

    const saveRecurring = async () => {
        if (isHab && selectedDays.size === 0) { setRecurErr("Sélectionnez au moins un jour."); return; }
        setSaving(true); setRecurErr(""); setSaved(false);
        try {
            const body: Record<string, unknown> = { is_recurring: isHab };
            if (isHab) {
                body.recurrence_days = Array.from(selectedDays).sort();
                if (endDate) body.recurrence_end_date = endDate + "T00:00:00";
            } else {
                body.recurrence_days = [];
                body.recurrence_end_date = null;
            }
            const res = await apiFetch(`/rides/${ride.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 3000); }
            else { const d = await res.json(); setRecurErr(d.detail || "Erreur"); }
        } catch { setRecurErr("Erreur réseau"); }
        finally { setSaving(false); }
    };

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

            {isDriverCard && (
                <div className="ride-habitualiser-section">
                    <label className="ride-habitualiser-toggle">
                        <input
                            type="checkbox"
                            checked={isHab}
                            onChange={(e) => { setIsHab(e.target.checked); setSaved(false); setRecurErr(""); }}
                        />
                        <span className="ride-habitualiser-label">Habitualiser</span>
                        {isHab && <span className="recurring-badge recurring-yes" style={{ marginLeft: 8 }}>Actif</span>}
                    </label>

                    {isHab && (
                        <div className="ride-habitualiser-days">
                            <div className="recurring-days-row">
                                {DAY_LABELS.map((label, idx) => (
                                    <button
                                        key={label}
                                        onClick={() => toggleDay(idx)}
                                        className={`recurring-day-btn${selectedDays.has(idx) ? " active" : ""}`}
                                    >
                                        {label.slice(0, 3)}
                                    </button>
                                ))}
                            </div>
                            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                <label style={{ fontSize: 12, color: "var(--text-soft)" }}>
                                    Date de fin :&nbsp;
                                    <input
                                        type="date"
                                        value={endDate}
                                        onChange={(e) => setEndDate(e.target.value)}
                                        style={{ fontSize: 12, padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border-soft)", background: "var(--bg-input, var(--bg-card))", color: "var(--text-main)" }}
                                    />
                                </label>
                                <button className="pref-save-btn" style={{ padding: "5px 18px", fontSize: 13 }} onClick={saveRecurring} disabled={saving}>
                                    {saving ? "…" : saved ? "Enregistré ✓" : "Enregistrer"}
                                </button>
                            </div>
                            {recurErr && <p style={{ color: "var(--red)", fontSize: 12, margin: "6px 0 0" }}>{recurErr}</p>}
                        </div>
                    )}
                </div>
            )}

            <div className="ride-card-actions">
                {showBook && <button className="btn btn-primary btn-sm" onClick={onBook}>Réserver</button>}
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
function RideDetailCard({ ride, onBook, showBook = true }: { ride: RideResult; onBook: () => void; showBook?: boolean }) {
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
            {showBook && (
                <button className="btn btn-primary btn-full" style={{ marginTop: 16 }} onClick={onBook}>
                    Réserver — {ride.price_per_seat} MAD
                </button>
            )}
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
// Tracking share card
// ---------------------------------------------------------------------------
function TrackingShareCard({ url }: { url: string }) {
    const [copied, setCopied] = useState(false);
    const [canNativeShare, setCanNativeShare] = useState(false);
    const shareText = `Suivez mon trajet en direct (CovoMar) : ${url}`;

    useEffect(() => {
        setCanNativeShare(!!navigator.share);
    }, []);

    const handleNativeShare = async () => {
        try {
            await navigator.share({ title: "Mon trajet en direct — CovoMar", text: shareText, url });
        } catch { /* cancelled */ }
    };

    const copy = () => {
        navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        });
    };

    const btnStyle = (bg: string, color = "#fff"): React.CSSProperties => ({
        display: "flex", alignItems: "center", gap: 8,
        background: bg, color, borderRadius: 10,
        padding: "10px 18px", fontWeight: 600, fontSize: 14,
        textDecoration: "none", border: "none", cursor: "pointer",
    });

    return (
        <div className="detail-card" style={{ marginTop: 10 }}>
            <p style={{ fontWeight: 700, marginBottom: 4, fontSize: 15 }}>Partager ma position GPS</p>
            <p style={{ fontSize: 12, color: "var(--text-soft)", marginBottom: 14 }}>
                Envoyez ce lien à votre famille pour qu&apos;ils suivent votre trajet en temps réel.
            </p>

            {/* Link box with copy */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-main)", border: "1px solid var(--border-soft)", borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
                <span style={{ fontSize: 12, color: "var(--text-soft)", flex: 1, wordBreak: "break-all", fontFamily: "monospace" }}>{url}</span>
                <button onClick={copy} style={{ ...btnStyle(copied ? "#22c55e" : "var(--orange)"), flexShrink: 0, padding: "6px 12px", fontSize: 13 }}>
                    {copied ? "✓ Copié" : "Copier"}
                </button>
            </div>

            {/* Share buttons */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {canNativeShare && (
                    <button onClick={handleNativeShare} style={btnStyle("var(--orange)")}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                        Partager
                    </button>
                )}
                <a href={`https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`}
                    target="_blank" rel="noopener noreferrer"
                    style={btnStyle("#25D366")}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.125.556 4.12 1.528 5.854L.057 23.667l5.94-1.557A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.015-1.375l-.36-.213-3.527.925.941-3.44-.234-.374A9.817 9.817 0 012.182 12c0-5.42 4.398-9.818 9.818-9.818 5.42 0 9.818 4.398 9.818 9.818 0 5.42-4.398 9.818-9.818 9.818z"/></svg>
                    WhatsApp
                </a>
                <a href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent("Suivez mon trajet en direct (CovoMar)")}`}
                    target="_blank" rel="noopener noreferrer"
                    style={btnStyle("#229ED9")}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                    Telegram
                </a>
                <a href={`mailto:?subject=Mon trajet en direct&body=${encodeURIComponent(shareText)}`}
                    style={btnStyle("var(--bg-card-strong)", "var(--text-main)")}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                    Email
                </a>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Driver-specific cards
// ---------------------------------------------------------------------------
function RidePassengersCard({ data }: { data: RidePassengers }) {
    const statusLabel = (s: string) => ({ CONFIRMED: "Confirmé", PENDING: "En attente", CANCELLED: "Annulé" }[s] ?? s);
    const statusColor = (s: string) => ({ CONFIRMED: "#22c55e", PENDING: "#f59e0b", CANCELLED: "#ef4444" }[s] ?? "#888");
    return (
        <div className="detail-card">
            <h4 style={{ margin: "0 0 12px" }}>Passagers — {data.origin} → {data.destination}</h4>
            {data.passengers.length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Aucune réservation pour ce trajet.</p>
            ) : (
                data.passengers.map((p) => (
                    <div key={p.booking_id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border-soft)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                            <p style={{ margin: 0, fontWeight: 600 }}>{p.passenger_name}</p>
                            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-soft)" }}>{p.seats} place(s) · {p.total_price.toFixed(0)} MAD</p>
                        </div>
                        <span style={{ color: statusColor(p.status), fontWeight: 600, fontSize: 13 }}>{statusLabel(p.status)}</span>
                    </div>
                ))
            )}
        </div>
    );
}

function DriverRevenueCard({ data }: { data: DriverRevenue }) {
    return (
        <div className="detail-card">
            <h4 style={{ margin: "0 0 16px" }}>Tableau de bord conducteur</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                {[
                    { label: "Trajets publiés", value: data.total_rides, color: "#3b82f6" },
                    { label: "Trajets actifs", value: data.active_rides, color: "#22c55e" },
                    { label: "Trajets terminés", value: data.completed_rides, color: "#8b5cf6" },
                    { label: "Réservations confirmées", value: data.confirmed_bookings, color: "#f59e0b" },
                ].map((s) => (
                    <div key={s.label} style={{ background: "var(--bg-card-strong)", borderRadius: 10, padding: 12, textAlign: "center" }}>
                        <p style={{ margin: 0, fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</p>
                        <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-soft)" }}>{s.label}</p>
                    </div>
                ))}
            </div>
            <div style={{ background: "var(--bg-card-strong)", borderRadius: 10, padding: 14, textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "var(--orange)" }}>{data.estimated_revenue_mad.toFixed(0)} MAD</p>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-soft)" }}>Revenus estimés (espèces)</p>
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 11, color: "var(--text-muted)" }}>{data.note}</p>
        </div>
    );
}

function DriverDocumentsCard({ data }: { data: DriverDocuments }) {
    const statusColor = (s: string) => ({ APPROVED: "#22c55e", REJECTED: "#ef4444", PENDING: "#f59e0b" }[s] ?? "#888");
    const statusLabel = (s: string) => ({ APPROVED: "Validé ✓", REJECTED: "Rejeté ✗", PENDING: "En attente..." }[s] ?? s);

    const [docs, setDocs] = useState(data.documents);
    const [uploading, setUploading] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState("");

    // Recompute verified status from actual doc statuses (not the backend flag which may be stale)
    const isVerified = docs.some((d) => d.status === "APPROVED");
    const hasPending = docs.some((d) => d.status === "PENDING");
    const verifiedBadge = isVerified
        ? { label: "✓ Vérifié par l'admin", color: "#22c55e" }
        : hasPending
        ? { label: "⏳ En attente de validation", color: "#f59e0b" }
        : { label: "✗ Non vérifié", color: "#ef4444" };

    const upload = async (file: File, docType: "CIN" | "PERMIS") => {
        setUploading(docType);
        setUploadError("");
        try {
            const form = new FormData();
            form.append("file", file);
            form.append("doc_type", docType);
            const res = await apiFetch("/documents", {
                method: "POST",
                body: form,
            });
            if (res.ok) {
                const doc = await res.json();
                setDocs((prev) => [
                    { id: doc.id, type: doc.doc_type, status: doc.status, uploaded_at: doc.created_at, notes: doc.admin_note },
                    ...prev.filter((d) => d.type !== docType),
                ]);
            } else {
                const err = await res.json();
                setUploadError(err.detail || "Erreur lors de l'upload.");
            }
        } catch {
            setUploadError("Erreur réseau.");
        } finally {
            setUploading(null);
        }
    };

    const DocSlot = ({ docType, label }: { docType: "CIN" | "PERMIS"; label: string }) => {
        const existing = docs.find((d) => d.type === docType);
        const isUploading = uploading === docType;
        return (
            <div style={{ background: "var(--bg-main)", border: "1px solid var(--border-soft)", borderRadius: 12, padding: 16 }}>
                <p style={{ fontWeight: 700, fontSize: 14, margin: "0 0 10px" }}>{label}</p>
                {existing ? (
                    <div>
                        <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, background: statusColor(existing.status) + "22", color: statusColor(existing.status), fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                            {statusLabel(existing.status)}
                        </span>
                        {existing.notes && (
                            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 8px" }}>Note : {existing.notes}</p>
                        )}
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, color: "var(--orange)", fontWeight: 600, opacity: isUploading ? 0.5 : 1 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                            {isUploading ? "Upload…" : "Remplacer"}
                            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" style={{ display: "none" }} disabled={!!uploading}
                                onChange={(e) => { if (e.target.files?.[0]) upload(e.target.files[0], docType); }} />
                        </label>
                    </div>
                ) : (
                    <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, border: "2px dashed var(--border-soft)", borderRadius: 10, padding: "20px 16px", cursor: isUploading ? "not-allowed" : "pointer", opacity: isUploading ? 0.5 : 1, transition: "border-color 0.2s" }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <span style={{ fontSize: 13, fontWeight: 600, color: isUploading ? "var(--text-muted)" : "var(--orange)" }}>
                            {isUploading ? "Upload en cours…" : "Choisir un fichier"}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>JPG, PNG, PDF</span>
                        <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" style={{ display: "none" }} disabled={!!uploading}
                            onChange={(e) => { if (e.target.files?.[0]) upload(e.target.files[0], docType); }} />
                    </label>
                )}
            </div>
        );
    };

    return (
        <div className="detail-card">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <h4 style={{ margin: 0 }}>Mes Documents</h4>
                <span style={{ marginLeft: "auto", fontWeight: 600, color: verifiedBadge.color, fontSize: 13 }}>
                    {verifiedBadge.label}
                </span>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-soft)" }}>
                {isVerified
                    ? "Vos documents ont été validés par l'admin."
                    : "Uploadez votre CIN et votre permis de conduire pour que l'admin puisse valider votre profil conducteur."}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: uploadError ? 10 : 0 }}>
                <DocSlot docType="CIN" label="Carte Nationale d'Identité (CIN)" />
                <DocSlot docType="PERMIS" label="Permis de conduire" />
            </div>
            {uploadError && (
                <p style={{ color: "#ef4444", fontSize: 13, marginTop: 8 }}>{uploadError}</p>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Recurring days picker card
// ---------------------------------------------------------------------------

const DAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const DAY_INDICES: Record<string, number> = {
    "Lundi": 0, "Mardi": 1, "Mercredi": 2, "Jeudi": 3,
    "Vendredi": 4, "Samedi": 5, "Dimanche": 6,
};

function RecurringDaysCard({ data }: { data: RecurringRideSetup }) {
    const initialDays = new Set<number>(data.recurrence_days.map((d) => DAY_INDICES[d] ?? -1).filter((d) => d >= 0));
    const [selectedDays, setSelectedDays] = useState<Set<number>>(initialDays);
    const [endDate, setEndDate] = useState(data.recurrence_end_date ? data.recurrence_end_date.slice(0, 10) : "");
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");

    const toggleDay = (idx: number) => {
        setSelectedDays((prev) => {
            const next = new Set(prev);
            next.has(idx) ? next.delete(idx) : next.add(idx);
            return next;
        });
        setSaved(false);
    };

    const save = async () => {
        if (selectedDays.size === 0) { setError("Sélectionnez au moins un jour."); return; }
        setSaving(true); setError(""); setSaved(false);
        try {
            const body: Record<string, unknown> = {
                is_recurring: true,
                recurrence_days: Array.from(selectedDays).sort(),
            };
            if (endDate) body.recurrence_end_date = endDate + "T00:00:00";
            const res = await apiFetch(`/rides/${data.ride_id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 3000); }
            else { const d = await res.json(); setError(d.detail || "Erreur de sauvegarde"); }
        } catch { setError("Erreur réseau"); }
        finally { setSaving(false); }
    };

    const dt = new Date(data.departure_time);
    const dateStr = dt.toLocaleString("fr-MA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

    return (
        <div className="pref-card" style={{ maxWidth: 420 }}>
            <div className="pref-card-header">
                <span className="pref-card-title">Jours habituels</span>
                <span className="pref-card-subtitle">{data.origin} → {data.destination} · {dateStr}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "14px 0" }}>
                {DAY_LABELS.map((label, idx) => (
                    <button
                        key={label}
                        onClick={() => toggleDay(idx)}
                        className={`recurring-day-btn${selectedDays.has(idx) ? " active" : ""}`}
                    >
                        {label.slice(0, 3)}
                    </button>
                ))}
            </div>
            <div style={{ marginBottom: 14 }}>
                <label className="pref-label" style={{ display: "block", marginBottom: 6 }}>Date de fin (optionnel)</label>
                <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="pref-note-input"
                    style={{ padding: "6px 10px", fontSize: 13 }}
                />
            </div>
            {error && <p style={{ color: "var(--red)", fontSize: 12, margin: "0 0 10px" }}>{error}</p>}
            <button className="pref-save-btn" onClick={save} disabled={saving}>
                {saving ? "Enregistrement…" : saved ? "Enregistré ✓" : "Enregistrer"}
            </button>
        </div>
    );
}

function DriverPreferencesCard({ data }: { data: DriverPreferences & { found?: boolean } }) {
    const defaults: DriverPreferences = { smoking: false, pets: false, music: true, ac: true, talk: "no_preference", luggage: "medium" };
    const [prefs, setPrefs] = useState<DriverPreferences>(data.found === false ? defaults : data);
    const [exists, setExists] = useState(data.found !== false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");

    const buildBody = (p: DriverPreferences, note?: string) => ({
        smoking_allowed: p.smoking, pets_allowed: p.pets,
        music_allowed: p.music, air_conditioning: p.ac,
        talking_preference: p.talk, luggage_size: p.luggage,
        custom_note: note !== undefined ? note : (p.note ?? null),
    });

    const save = async (updated: DriverPreferences) => {
        setSaving(true);
        setSaved(false);
        setError("");
        try {
            const body = JSON.stringify(buildBody(updated));
            let res = await apiFetch("/preferences", {
                method: exists ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                body,
            });
            // If POST was rejected because prefs already exist, retry with PUT
            if (!res.ok && !exists) {
                const d = await res.json();
                if (typeof d.detail === "string" && d.detail.toLowerCase().includes("already exist")) {
                    setExists(true);
                    res = await apiFetch("/preferences", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body,
                    });
                }
            }
            if (res.ok) {
                setExists(true);
                setSaved(true);
                setTimeout(() => setSaved(false), 2500);
            } else {
                const d = await res.json();
                setError(d.detail || "Erreur de sauvegarde");
            }
        } catch {
            setError("Erreur réseau");
        } finally {
            setSaving(false);
        }
    };

    const toggle = (field: keyof DriverPreferences) => {
        const updated = { ...prefs, [field]: !prefs[field] } as DriverPreferences;
        setPrefs(updated);
        save(updated);
    };

    const setSelect = (field: keyof DriverPreferences, value: string) => {
        const updated = { ...prefs, [field]: value } as DriverPreferences;
        setPrefs(updated);
        save(updated);
    };

    const [noteText, setNoteText] = useState(prefs.note ?? "");
    const [noteSaving, setNoteSaving] = useState(false);

    const saveNote = async () => {
        setNoteSaving(true);
        setError("");
        try {
            const body = JSON.stringify(buildBody(prefs, noteText));
            let res = await apiFetch("/preferences", {
                method: exists ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                body,
            });
            if (!res.ok && !exists) {
                const d = await res.json();
                if (typeof d.detail === "string" && d.detail.toLowerCase().includes("already exist")) {
                    setExists(true);
                    res = await apiFetch("/preferences", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body,
                    });
                }
            }
            if (res.ok) {
                setExists(true);
                setPrefs((p) => ({ ...p, note: noteText }));
                setSaved(true);
                setTimeout(() => setSaved(false), 2500);
            } else {
                const d = await res.json();
                setError(d.detail || "Erreur");
            }
        } finally {
            setNoteSaving(false);
        }
    };

    const NoteField = () => (
        <div style={{ marginTop: 12, background: "var(--bg-main)", border: "1px solid var(--border-soft)", borderRadius: 12, padding: "10px 14px" }}>
            <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--text-muted)" }}>Mes préférences personnelles</p>
            <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="ex. Je préfère les passagers ponctuels, pas de nourriture dans la voiture..."
                rows={3}
                style={{ width: "100%", background: "transparent", border: "none", resize: "vertical", fontSize: 13, color: "var(--text-main)", outline: "none", fontFamily: "inherit" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                <button onClick={saveNote} disabled={noteSaving}
                    style={{ padding: "5px 16px", borderRadius: 20, border: "none", cursor: noteSaving ? "not-allowed" : "pointer",
                        background: "var(--orange)", color: "#fff", fontWeight: 700, fontSize: 13, opacity: noteSaving ? 0.6 : 1 }}>
                    {noteSaving ? "Enregistrement…" : "Enregistrer"}
                </button>
            </div>
        </div>
    );

    const Toggle = ({ field, label }: { field: "music" | "ac" | "smoking" | "pets"; label: string }) => (
        <div style={{ background: "var(--bg-main)", border: "1px solid var(--border-soft)", borderRadius: 12, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
            <button
                onClick={() => toggle(field)}
                disabled={saving}
                style={{ padding: "4px 14px", borderRadius: 20, border: "none", cursor: saving ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13,
                    background: prefs[field] ? "#22c55e22" : "#ef444422",
                    color: prefs[field] ? "#22c55e" : "#ef4444",
                    opacity: saving ? 0.6 : 1, transition: "all 0.15s" }}>
                {prefs[field] ? "Oui" : "Non"}
            </button>
        </div>
    );

    return (
        <div className="detail-card">
            <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
                <h4 style={{ margin: 0 }}>Mes Préférences de Conduite</h4>
                {saved && <span style={{ marginLeft: "auto", color: "#22c55e", fontSize: 13, fontWeight: 600 }}>✓ Enregistré</span>}
                {saving && <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: 13 }}>Sauvegarde…</span>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <Toggle field="music" label="Musique" />
                <Toggle field="ac" label="Climatisation" />
                <Toggle field="smoking" label="Tabac autorisé" />
                <Toggle field="pets" label="Animaux acceptés" />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ background: "var(--bg-main)", border: "1px solid var(--border-soft)", borderRadius: 12, padding: "10px 14px" }}>
                    <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--text-muted)" }}>Ambiance en voiture</p>
                    <select value={prefs.talk} disabled={saving}
                        onChange={(e) => setSelect("talk", e.target.value)}
                        style={{ width: "100%", background: "transparent", border: "none", fontSize: 14, fontWeight: 600, color: "var(--text-main)", outline: "none", cursor: "pointer" }}>
                        <option value="silent">Silencieux</option>
                        <option value="no_preference">Pas de préférence</option>
                        <option value="talkative">Bavard</option>
                    </select>
                </div>
                <div style={{ background: "var(--bg-main)", border: "1px solid var(--border-soft)", borderRadius: 12, padding: "10px 14px" }}>
                    <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--text-muted)" }}>Taille max des bagages</p>
                    <select value={prefs.luggage} disabled={saving}
                        onChange={(e) => setSelect("luggage", e.target.value)}
                        style={{ width: "100%", background: "transparent", border: "none", fontSize: 14, fontWeight: 600, color: "var(--text-main)", outline: "none", cursor: "pointer" }}>
                        <option value="small">Petit (sac à dos)</option>
                        <option value="medium">Moyen (valise cabine)</option>
                        <option value="large">Grand (valise soute)</option>
                    </select>
                </div>
            </div>
            <NoteField />
            {error && <p style={{ color: "#ef4444", fontSize: 13, marginTop: 8 }}>{error}</p>}
        </div>
    );
}

function DriverBookingsCard({ bookings }: { bookings: MyBooking[] }) {
    const statusLabel = (s: string) => ({ CONFIRMED: "Confirmé", PENDING: "En attente", CANCELLED: "Annulé" }[s] ?? s);
    const statusColor = (s: string) => ({ CONFIRMED: "#22c55e", PENDING: "#f59e0b", CANCELLED: "#ef4444" }[s] ?? "#888");
    if (bookings.length === 0) return <div className="no-results-card"><p>Aucune réservation reçue.</p></div>;
    return (
        <div className="booking-list-card">
            {bookings.map((b) => (
                <div key={b.id} className="booking-list-item">
                    <div className="booking-list-route">
                        <span className="city-name">{b.ride?.origin ?? "?"}</span>
                        <span className="route-arrow">→</span>
                        <span className="city-name">{b.ride?.destination ?? "?"}</span>
                    </div>
                    <div className="booking-list-meta">
                        {b.ride && <span>{new Date(b.ride.departure_time).toLocaleDateString("fr-MA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
                        <span>{b.seats_booked} place(s) · {b.total_price.toFixed(0)} MAD</span>
                        <span style={{ color: statusColor(b.status), fontWeight: 600 }}>{statusLabel(b.status)}</span>
                    </div>
                </div>
            ))}
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
    const parts = (text ?? "").split(/(\*\*[^*]+\*\*)/g);
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
