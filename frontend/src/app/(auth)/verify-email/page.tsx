"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function VerifyEmailContent() {
    const params = useSearchParams();
    const token = params.get("token");
    const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
    const [message, setMessage] = useState("");

    useEffect(() => {
        if (!token) {
            setStatus("error");
            setMessage("Lien invalide — aucun token trouvé.");
            return;
        }
        const api = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";
        fetch(`${api}/auth/verify-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
        })
            .then(async (res) => {
                const data = await res.json();
                if (res.ok) {
                    setStatus("success");
                    setMessage(data.message || "Email vérifié avec succès.");
                } else {
                    setStatus("error");
                    setMessage(data.detail || "Lien invalide ou expiré.");
                }
            })
            .catch(() => {
                setStatus("error");
                setMessage("Impossible de joindre le serveur.");
            });
    }, [token]);

    return (
        <main className="app-shell">
            <div className="page-layer">
                <nav className="navbar">
                    <Link href="/" className="brand">
                        <img src="/logo.png" alt="CovoMar" style={{height:"44px",width:"auto"}} onError={(e)=>{(e.target as HTMLImageElement).style.display="none";(e.target as HTMLImageElement).nextElementSibling!.setAttribute("style","display:inline")}} /><span style={{display:"none",fontWeight:900,fontSize:22}}>CovoMar</span>
                    </Link>
                </nav>
                <section className="auth-page">
                    <div className="glass-card auth-card" style={{ textAlign: "center" }}>
                        {status === "loading" && (
                            <>
                                <p className="auth-title">Vérification en cours...</p>
                                <p className="auth-subtitle">Merci de patienter.</p>
                            </>
                        )}
                        {status === "success" && (
                            <>
                                <div className="verify-icon">✓</div>
                                <h1 className="auth-title" style={{ marginTop: 12 }}>
                                    <span className="gradient-text">Email vérifié !</span>
                                </h1>
                                <p className="auth-subtitle">{message}</p>
                                <Link href="/login" className="btn btn-primary" style={{ marginTop: 24, display: "inline-block" }}>
                                    Se connecter
                                </Link>
                            </>
                        )}
                        {status === "error" && (
                            <>
                                <div className="verify-icon" style={{ color: "var(--red, #ef4444)" }}>✗</div>
                                <h1 className="auth-title" style={{ marginTop: 12 }}>Lien invalide</h1>
                                <p className="auth-subtitle">{message}</p>
                                <Link href="/login" className="btn btn-secondary" style={{ marginTop: 24, display: "inline-block" }}>
                                    Retour à la connexion
                                </Link>
                            </>
                        )}
                    </div>
                </section>
            </div>
        </main>
    );
}

export default function VerifyEmailPage() {
    return (
        <Suspense>
            <VerifyEmailContent />
        </Suspense>
    );
}
