import "./globals.css";
import "leaflet/dist/leaflet.css";
import CursorAurora from "@/components/CursorAurora";

export const metadata = {
    title: "CovoMar",
    description: "Moroccan intelligent carpooling platform",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="fr">
            <body>
                <CursorAurora />
                {children}
            </body>
        </html>
    );
}