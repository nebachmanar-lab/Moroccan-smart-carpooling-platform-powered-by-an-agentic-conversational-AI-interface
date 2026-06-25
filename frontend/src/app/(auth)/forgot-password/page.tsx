"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState("");

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setLoading(true);
        setError("");
        try {
            const res = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001"}/auth/forgot-password`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email }),
                }
            );
            if (res.ok) {
                setDone(true);
            } else {
                setError("Erreur serveur. Veuillez réessayer.");
            }
        } catch {
            setError("Impossible de joindre le serveur.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="app-shell">
            <div className="page-layer">
                <nav className="navbar">
                    <Link href="/" className="brand">
                        <img src="/logo.png" alt="CovoMar" style={{height:"44px",width:"auto"}} onError={(e)=>{(e.target as HTMLImageElement).style.display="none";(e.target as HTMLImageElement).nextElementSibling!.setAttribute("style","display:inline")}} /><span style={{display:"none",fontWeight:900,fontSize:22}}>CovoMar</span>
                    </Link>
                    <div className="nav-actions">
                        <Link href="/login" className="btn btn-secondary btn-sm">Connexion</Link>
                    </div>
                </nav>
                <section className="auth-page">
                    <div className="glass-card auth-card">
                        {done ? (
                            <div style={{ textAlign: "center", padding: "16px 0" }}>
                                <div className="verify-icon">✉</div>
                                <h2 className="auth-title" style={{ marginTop: 12 }}>Vérifiez votre email</h2>
                                <p className="auth-subtitle">
                                    Si <strong>{email}</strong> est enregistré, un lien de réinitialisation a été envoyé.
                                </p>
                                <Link href="/login" className="btn btn-primary" style={{ marginTop: 24, display: "inline-block" }}>
                                    Retour à la connexion
                                </Link>
                            </div>
                        ) : (
                            <>
                                <h1 className="auth-title">
                                    <span className="gradient-text">Mot de passe oublié</span>
                                </h1>
                                <p className="auth-subtitle">
                                    Entrez votre email — nous vous enverrons un lien pour réinitialiser votre mot de passe.
                                </p>
                                <form onSubmit={handleSubmit} className="form">
                                    <div className="field">
                                        <label htmlFor="email">Email</label>
                                        <input
                                            id="email"
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            required
                                            placeholder="vous@exemple.ma"
                                            className="input"
                                        />
                                    </div>
                                    {error && <p className="alert-error">{error}</p>}
                                    <button type="submit" disabled={loading || !email} className="btn btn-primary btn-full">
                                        {loading ? "Envoi..." : "Envoyer le lien"}
                                    </button>
                                    <p style={{ textAlign: "center", fontSize: "13px", marginTop: "8px" }}>
                                        <Link href="/login" className="muted-link">Retour à la connexion</Link>
                                    </p>
                                </form>
                            </>
                        )}
                    </div>
                </section>
            </div>
        </main>
    );
}
