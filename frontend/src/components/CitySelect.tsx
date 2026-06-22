"use client";

import { City } from "@/lib/cities";

interface CitySelectProps {
    label: string;
    cities: City[];
    value: string;
    onChange: (city: City) => void;
}

export default function CitySelect({ label, cities, value, onChange }: CitySelectProps) {
    function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
        const selected = cities.find((c) => c.name === e.target.value);
        if (selected) onChange(selected);
    }

    return (
        <div className="inner-field">
            <label>{label}</label>
            <select value={value} onChange={handleChange}>
                <option value="">-- Choisir une ville --</option>
                {cities.map((city) => (
                    <option key={city.name} value={city.name}>
                        {city.name}
                    </option>
                ))}
            </select>
        </div>
    );
}