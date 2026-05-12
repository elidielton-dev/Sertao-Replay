import { Clock, Goal, Shield, Star, Target } from "lucide-react";

const icons = {
  Recentes: Clock,
  Gols: Goal,
  "Melhores lances": Star,
  Defesas: Shield,
  Faltas: Target,
};

export function ReplayFilters({ filters, activeFilter, onSelectFilter }) {
  return (
    <section className="mx-4 mt-5 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.04] p-2 shadow-card no-scrollbar">
      <div className="flex min-w-max gap-2">
        {filters.map((filter) => {
          const Icon = icons[filter];
          const active = filter === activeFilter;

          return (
            <button
              key={filter}
              onClick={() => onSelectFilter(filter)}
              className={[
                "flex h-12 items-center gap-2 rounded-2xl border px-4 text-sm font-black uppercase transition",
                active
                  ? "border-neon-400 bg-neon-400/15 text-neon-400"
                  : "border-transparent text-slate-400",
              ].join(" ")}
            >
              <Icon size={22} />
              {filter}
            </button>
          );
        })}
      </div>
    </section>
  );
}
