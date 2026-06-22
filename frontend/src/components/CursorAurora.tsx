"use client";

import { useEffect } from "react";

export default function CursorAurora() {
    useEffect(() => {
        let rafId: number | null = null;
        let lastX = window.innerWidth / 2;
        let lastY = window.innerHeight / 2;
        let targetX = lastX;
        let targetY = lastY;
        let hideTimer: ReturnType<typeof setTimeout> | null = null;

        function updateAurora() {
            lastX += (targetX - lastX) * 0.08;
            lastY += (targetY - lastY) * 0.08;

            document.documentElement.style.setProperty("--aurora-x", `${lastX}px`);
            document.documentElement.style.setProperty("--aurora-y", `${lastY}px`);

            rafId = requestAnimationFrame(updateAurora);
        }

        function showAurora() {
            document.documentElement.classList.add("aurora-active");

            if (hideTimer) {
                clearTimeout(hideTimer);
            }

            hideTimer = setTimeout(() => {
                document.documentElement.classList.remove("aurora-active");
            }, 900);
        }

        function handleMouseMove(event: MouseEvent) {
            targetX = event.clientX;
            targetY = event.clientY;
            showAurora();
        }

        function handleTouchMove(event: TouchEvent) {
            const touch = event.touches[0];

            if (!touch) {
                return;
            }

            targetX = touch.clientX;
            targetY = touch.clientY;
            showAurora();
        }

        function handleLeave() {
            document.documentElement.classList.remove("aurora-active");
        }

        rafId = requestAnimationFrame(updateAurora);

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("touchmove", handleTouchMove, { passive: true });
        document.addEventListener("mouseleave", handleLeave);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("touchmove", handleTouchMove);
            document.removeEventListener("mouseleave", handleLeave);

            if (rafId) {
                cancelAnimationFrame(rafId);
            }

            if (hideTimer) {
                clearTimeout(hideTimer);
            }
        };
    }, []);

    return (
        <div className="aurora-background" aria-hidden="true">
            <div className="aurora-water aurora-water-one" />
            <div className="aurora-water aurora-water-two" />
            <div className="aurora-soft-light" />
            <div className="aurora-vignette" />
        </div>
    );
}