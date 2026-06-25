"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function LoginContent() {
    const router = useRouter();
    const params = useSearchParams();
    const resetOk = params.get("reset") === "ok";

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [notVerified, setNotVerified] = useState(false);
    const [resendLoading, setResendLoading] = useState(false);
    const [resendDone, setResendDone] = useState(false);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setError("");
        setNotVerified(false);
        setLoading(true);

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";
            const res = await fetch(`${apiUrl}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: email.trim(), password: password.trim() }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => null);
                if (res.status === 403 && data?.detail === "email_not_verified") {
                    setNotVerified(true);
                } else if (res.status === 401) {
                    setError("Email ou mot de passe incorrect.");
                } else {
                    setError("Erreur lors de la connexion.");
                }
                return;
            }

            const data = await res.json();
            sessionStorage.setItem("access_token", data.access_token);
            sessionStorage.setItem("refresh_token", data.refresh_token);
            sessionStorage.setItem("token_type", data.token_type || "bearer");
            router.push("/dashboard");
        } catch {
            setError("Erreur de connexion. Vérifiez que le serveur backend est démarré.");
        } finally {
            setLoading(false);
        }
    }

    async function resendVerification() {
        setResendLoading(true);
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";
            await fetch(`${apiUrl}/auth/resend-verification`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });
            setResendDone(true);
        } finally {
            setResendLoading(false);
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
                        <Link href="/register" className="btn btn-secondary btn-sm">Créer un compte</Link>
                    </div>
                </nav>

                <section className="auth-page">
                    <div className="glass-card auth-card">
                        <h1 className="auth-title">
                            <span className="gradient-text">Connexion</span>
                        </h1>
                        <p className="auth-subtitle">
                            Pas encore de compte ?{" "}
                            <Link href="/register" className="muted-link">Créer un compte</Link>
                        </p>

                        {resetOk && (
                            <div className="alert-success" style={{ marginBottom: 16 }}>
                                Mot de passe réinitialisé. Vous pouvez vous connecter.
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="form">
                            <div className="field">
                                <label htmlFor="email">Email</label>
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    autoComplete="email"
                                    placeholder="vous@exemple.ma"
                                    className="input"
                                />
                            </div>
                            <div className="field">
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                    <label htmlFor="password">Mot de passe</label>
                                    <Link href="/forgot-password" className="muted-link" style={{ fontSize: "12px" }}>
                                        Mot de passe oublié ?
                                    </Link>
                                </div>
                                <input
                                    id="password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    autoComplete="current-password"
                                    placeholder="Minimum 8 caractères"
                                    className="input"
                                />
                            </div>

                            {error && <p className="alert-error">{error}</p>}

                            {notVerified && (
                                <div className="alert-warning">
                                    <p>Votre email n&apos;est pas encore vérifié.</p>
                                    {resendDone ? (
                                        <p style={{ fontSize: "13px", marginTop: 6 }}>
                                            Nouveau lien envoyé — vérifiez votre boîte mail.
                                        </p>
                                    ) : (
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            style={{ marginTop: 8 }}
                                            onClick={resendVerification}
                                            disabled={resendLoading}
                                        >
                                            {resendLoading ? "Envoi..." : "Renvoyer l'email de vérification"}
                                        </button>
                                    )}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading || !email.trim() || !password.trim()}
                                className="btn btn-primary btn-full"
                            >
                                {loading ? "Connexion..." : "Se connecter"}
                            </button>
                        </form>
                    </div>
                </section>
            </div>
        </main>
    );
}

export default function LoginPage() {
    return (
        <Suspense>
            <LoginContent />
        </Suspense>
    );
}
