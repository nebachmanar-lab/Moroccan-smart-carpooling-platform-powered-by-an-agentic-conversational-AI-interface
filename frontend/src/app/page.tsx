"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export default function HomePage() {
    const router = useRouter();

    function goAI() {
        const token = localStorage.getItem("access_token");
        if (token) {
            localStorage.setItem("interface_mode", "ai");
            router.push("/agent");
        } else {
            router.push("/login");
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
                        <Link href="/tourist">Tourisme</Link>
                        <Link href="/login">Connexion</Link>
                    </div>

                    <div className="nav-actions">
                        <div className="mode-pill">
                            <button className="mode-pill-btn active">Normal</button>
                            <button className="mode-pill-btn" onClick={goAI}>IA</button>
                        </div>
                        <Link href="/register" className="btn btn-primary">
                            Commencer
                        </Link>
                    </div>
                </nav>

                <section className="hero">
                    <div className="eyebrow">
                        Plateforme intelligente de covoiturage au Maroc
                    </div>

                    <h1 className="hero-title">
                        <span className="gradient-text">Voyagez plus malin</span>
                        <br />
                        <span className="pink-text">avec Covoit Maroc</span>
                    </h1>

                    <p className="hero-subtitle">
                        Publiez, recherchez et réservez des trajets entre villes marocaines
                        avec une expérience moderne, simple et adaptée au covoiturage local.
                    </p>

                    <div className="hero-actions">
                        <Link href="/register" className="btn btn-primary">
                            Créer un compte
                        </Link>

                        <Link href="/login" className="btn btn-secondary">
                            Se connecter
                        </Link>
                    </div>
                </section>

                <section className="hero-grid">
                    <Link href="/search" className="glass-card feature-card">
                        <div className="feature-icon">01</div>
                        <h3>Recherche simple</h3>
                        <p>
                            Trouvez rapidement un trajet selon la ville de départ, la
                            destination et la date.
                        </p>
                    </Link>

                    <Link href="/search" className="glass-card feature-card">
                        <div className="feature-icon">02</div>
                        <h3>Carte intégrée</h3>
                        <p>
                            Visualisez les points de départ et d'arrivée avec OpenStreetMap
                            et Leaflet, sans API payante.
                        </p>
                    </Link>

                    <Link href="/dashboard" className="glass-card feature-card">
                        <div className="feature-icon">03</div>
                        <h3>Espace conducteur</h3>
                        <p>
                            Les conducteurs peuvent publier leurs trajets et consulter leurs
                            réservations depuis un tableau de bord.
                        </p>
                    </Link>
                </section>
            </div>
        </main>
    );
}