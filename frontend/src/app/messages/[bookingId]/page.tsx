"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

interface Msg {
    id: string;
    sender_id: string;
    sender_name: string;
    content: string;
    is_mine: boolean;
    created_at: string;
}

export default function MessagesPage() {
    const params = useParams();
    const bookingId = params?.bookingId as string;

    const [msgs, setMsgs] = useState<Msg[]>([]);
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const bottomRef = useRef<HTMLDivElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    async function load() {
        const res = await apiFetch(`/messages/${bookingId}`);
        if (res.ok) setMsgs(await res.json());
        setLoading(false);
    }

    useEffect(() => {
        if (!bookingId) return;
        load();
        pollRef.current = setInterval(load, 4000);
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bookingId]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [msgs]);

    async function send(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!text.trim()) return;
        setSending(true);
        setError("");
        try {
            const res = await apiFetch(`/messages/${bookingId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: text.trim() }),
            });
            if (res.ok) {
                const msg = await res.json();
                setMsgs((prev) => [...prev, msg]);
                setText("");
            } else {
                const d = await res.json();
                setError(d.detail || "Erreur");
            }
        } finally {
            setSending(false);
        }
    }

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
                    </div>
                </nav>

                <div className="chat-shell">
                    <div className="chat-header">
                        <Link href="/dashboard" className="page-back" style={{ margin: 0 }}>&larr;</Link>
                        <span>Messagerie — Réservation</span>
                    </div>

                    <div className="chat-messages">
                        {loading && <p style={{ textAlign: "center", color: "var(--text-muted)", padding: 20 }}>Chargement...</p>}
                        {!loading && msgs.length === 0 && (
                            <p style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>
                                Aucun message. Envoyez le premier !
                            </p>
                        )}
                        {msgs.map((m) => (
                            <div key={m.id} className={`chat-bubble-row ${m.is_mine ? "mine" : "theirs"}`}>
                                {!m.is_mine && <p className="chat-sender-name">{m.sender_name}</p>}
                                <div className={`chat-bubble ${m.is_mine ? "mine" : "theirs"}`}>
                                    {m.content}
                                </div>
                                <p className="chat-time">
                                    {new Date(m.created_at).toLocaleTimeString("fr-MA", { hour: "2-digit", minute: "2-digit" })}
                                </p>
                            </div>
                        ))}
                        <div ref={bottomRef} />
                    </div>

                    <form onSubmit={send} className="chat-input-row">
                        <input
                            type="text"
                            className="chat-input"
                            placeholder="Votre message..."
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            disabled={sending}
                            maxLength={1000}
                        />
                        <button type="submit" className="btn btn-primary btn-sm" disabled={sending || !text.trim()}>
                            {sending ? "..." : "Envoyer"}
                        </button>
                    </form>
                    {error && <p className="alert-error" style={{ margin: "8px 16px 0" }}>{error}</p>}
                </div>
            </div>
        </main>
    );
}
