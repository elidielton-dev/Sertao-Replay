import { Goal } from "lucide-react";

export function FieldSelector({ fields, selectedField, onSelectField }) {
  return (
    <section className="mx-4 mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {fields.map((field) => {
        const active = field === selectedField;

        return (
          <button
            key={field}
            onClick={() => onSelectField(field)}
            className={[
              "flex h-28 flex-col items-center justify-center gap-3 rounded-2xl border text-center transition",
              active
                ? "border-neon-400 bg-neon-400/10 text-neon-400 shadow-glow"
                : "border-white/10 bg-white/[0.04] text-slate-400 shadow-card",
            ].join(" ")}
          >
            <Goal size={42} strokeWidth={1.8} />
            <span className="text-lg font-black uppercase tracking-wide">{field}</span>
          </button>
        );
      })}
    </section>
  );
}
