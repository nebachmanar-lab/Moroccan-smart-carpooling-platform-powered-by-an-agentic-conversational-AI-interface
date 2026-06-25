"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

function ResetPasswordContent() {
    const params = useSearchParams();
    const token = params.get("token") ?? "";
    const router = useRouter();
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (password !== confirm) { setError("Les mots de passe ne correspondent pas."); return; }
        if (password.length < 8) { setError("Le mot de passe doit contenir au moins 8 caractères."); return; }
        setLoading(true);
        setError("");
        try {
            const res = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001"}/auth/reset-password`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ token, password }),
                }
            );
            if (res.ok) {
                router.push("/login?reset=ok");
            } else {
                const data = await res.json();
                setError(data.detail || "Lien invalide ou expiré.");
            }
        } catch {
            setError("Impossible de joindre le serveur.");
        } finally {
            setLoading(false);
        }
    }

    if (!token) {
        return (
            <main className="app-shell">
                <div className="page-layer">
                    <section className="auth-page">
                        <div className="glass-card auth-card" style={{ textAlign: "center" }}>
                            <p className="auth-title">Lien invalide</p>
                            <Link href="/forgot-password" className="btn btn-secondary" style={{ marginTop: 16, display: "inline-block" }}>
                                Redemander un lien
                            </Link>
                        </div>
                    </section>
                </div>
            </main>
        );
    }

    return (
        <main className="app-shell">
            <div className="page-layer">
                <nav className="navbar">
                    <Link href="/" className="brand">
                        <img src="/logo.png" alt="CovoMar" style={{height:"44px",width:"auto"}} onError={(e)=>{(e.target as HTMLImageElement).style.display="none";(e.target as HTMLImageElement).nextElementSibling!.setAttribute("style","display:inline")}} /><span style={{display:"none",fontWeight:900,fontSize:22}}>CovoMar</span>
                    </Link>
                </nav>
                <section className="auth-page">
                    <div className="glass-card auth-card">
                        <h1 className="auth-title">
                            <span className="gradient-text">Nouveau mot de passe</span>
                        </h1>
                        <p className="auth-subtitle">Choisissez un mot de passe sécurisé d&apos;au moins 8 caractères.</p>
                        <form onSubmit={handleSubmit} className="form">
                            <div className="field">
                                <label htmlFor="password">Nouveau mot de passe</label>
                                <input
                                    id="password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    minLength={8}
                                    placeholder="Minimum 8 caractères"
                                    className="input"
                                />
                            </div>
                            <div className="field">
                                <label htmlFor="confirm">Confirmer le mot de passe</label>
                                <input
                                    id="confirm"
                                    type="password"
                                    value={confirm}
                                    onChange={(e) => setConfirm(e.target.value)}
                                    required
                                    placeholder="Répétez le mot de passe"
                                    className="input"
                                />
                            </div>
                            {error && <p className="alert-error">{error}</p>}
                            <button type="submit" disabled={loading || !password || !confirm} className="btn btn-primary btn-full">
                                {loading ? "Enregistrement..." : "Réinitialiser"}
                            </button>
                        </form>
                    </div>
                </section>
            </div>
        </main>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense>
            <ResetPasswordContent />
        </Suspense>
    );
}
