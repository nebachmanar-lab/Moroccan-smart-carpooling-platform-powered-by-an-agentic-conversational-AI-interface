export interface City {
    name: string;
    lat: number;
    lng: number;
}

let _cache: City[] | null = null;

export async function fetchCities(): Promise<City[]> {
    if (_cache) return _cache;
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/cities/`);
    if (!res.ok) throw new Error("Failed to load cities");
    const data: City[] = await res.json();
    _cache = data.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return _cache;
}