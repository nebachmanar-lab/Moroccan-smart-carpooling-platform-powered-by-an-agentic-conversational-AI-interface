export const CATEGORY_STYLE: Record<string, { color: string; label: string }> = {
    poi:           { color: "#6366f1", label: "Site / Monument" },
    restaurant:    { color: "#f59e0b", label: "Restaurant / Café" },
    accommodation: { color: "#3b82f6", label: "Hébergement" },
};

export interface POI {
    id: number | string;
    name: string;
    lat: number;
    lng: number;
    category: "poi" | "restaurant" | "accommodation";
    tags: Record<string, string>;
    budget?: string;
    price_range?: string;
    type_label?: string;
    stars?: string;
    rating?: number | null;
    photo_url?: string | null;
    open_now?: boolean | null;
    hours_display?: string;
    cat_name?: string;
    website?: string | null;
    tel?: string | null;
    description?: string | null;
}
