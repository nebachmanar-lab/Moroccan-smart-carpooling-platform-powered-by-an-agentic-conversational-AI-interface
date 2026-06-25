"use client";

import { useState } from "react";
import Link from "next/link";

export default function RegisterPage() {
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [role, setRole] = useState<"PASSENGER" | "DRIVER">("PASSENGER");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);
    const [autoVerified, setAutoVerified] = useState(false);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setLoading(true);
        setError("");
        try {
            const res = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001"}/auth/register`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ first_name: firstName, last_name: lastName, email, password, role }),
                }
            );
            const data = await res.json();
            if (!res.ok) {
                setError(
                    typeof data.detail === "string" ? data.detail
                    : Array.isArray(data.detail) ? data.detail.map((e: { msg: string }) => e.msg).join(", ")
                    : "Erreur lors de l'inscription."
                );
                return;
            }
            setAutoVerified(data.is_verified === true);
            setDone(true);
        } catch {
            setError("Erreur de connexion. Vérifiez que le serveur est démarré.");
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
                        <Link href="/login" className="btn btn-secondary btn-sm">Se connecter</Link>
                    </div>
                </nav>

                <section className="auth-page">
                    <div className="glass-card auth-card">
                        {done ? (
                            <div style={{ textAlign: "center", padding: "16px 0" }}>
                                <div className="verify-icon">{autoVerified ? "✓" : "✉"}</div>
                                <h2 className="auth-title" style={{ marginTop: 12 }}>
                                    {autoVerified ? "Compte créé !" : "Vérifiez votre email"}
                                </h2>
                                <p className="auth-subtitle" style={{ marginTop: 8 }}>
                                    {autoVerified
                                        ? "Votre compte a été activé automatiquement. Vous pouvez vous connecter."
                                        : <>Un lien de confirmation a été envoyé à <strong>{email}</strong>.<br />Cliquez sur le lien pour activer votre compte.</>
                                    }
                                </p>
                                <Link href="/login" className="btn btn-primary" style={{ marginTop: 24, display: "inline-block" }}>
                                    Aller à la connexion
                                </Link>
                            </div>
                        ) : (
                            <>
                                <h1 className="auth-title"><span className="gradient-text">Créer un compte</span></h1>
                                <p className="auth-subtitle">
                                    Déjà inscrit ?{" "}
                                    <Link href="/login" className="muted-link">Se connecter</Link>
                                </p>

                                <form onSubmit={handleSubmit} className="form">
                                    <div className="form-grid">
                                        <div className="field">
                                            <label htmlFor="firstName">Prénom</label>
                                            <input id="firstName" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required placeholder="Youssef" className="input" />
                                        </div>
                                        <div className="field">
                                            <label htmlFor="lastName">Nom</label>
                                            <input id="lastName" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required placeholder="El Amrani" className="input" />
                                        </div>
                                    </div>
                                    <div className="field">
                                        <label htmlFor="email">Email</label>
                                        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="vous@exemple.ma" className="input" />
                                    </div>
                                    <div className="field">
                                        <label htmlFor="password">Mot de passe</label>
                                        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} placeholder="Minimum 8 caractères" className="input" />
                                    </div>
                                    <div className="field">
                                        <label>Je suis...</label>
                                        <div className="role-grid">
                                            <button type="button" onClick={() => setRole("PASSENGER")} className={`role-btn${role === "PASSENGER" ? " active" : ""}`}>Passager</button>
                                            <button type="button" onClick={() => setRole("DRIVER")} className={`role-btn${role === "DRIVER" ? " active" : ""}`}>Conducteur</button>
                                        </div>
                                    </div>
                                    {error && <p className="alert-error">{error}</p>}
                                    <button type="submit" disabled={loading} className="btn btn-primary btn-full">
                                        {loading ? "Création..." : "Créer mon compte"}
                                    </button>
                                </form>
                            </>
                        )}
                    </div>
                </section>
            </div>
        </main>
    );
}
