"use client";

type Mode = "classic" | "ai";

interface Props {
  mode: Mode;
  onChange: (m: Mode) => void;
}

export default function ModeToggle({ mode, onChange }: {
  mode: "classic" | "ai";
  onChange: (m: "classic" | "ai") => void;
}) {
  return (
    <div className="flex border rounded-lg overflow-hidden text-sm">
      {(["classic", "ai"] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`px-4 py-2 flex-1 transition-colors ${mode === m ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
        >
          {m === "classic" ? "Formulaire" : "Assistant IA"}
        </button>
      ))}
    </div>
  );
}