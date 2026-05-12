import { BarChart3, Home, RotateCcw, Trophy, User } from "lucide-react";

const items = [
  { label: "Início", icon: Home },
  { label: "Partidas", icon: Trophy },
  { label: "Replays", icon: RotateCcw },
  { label: "Estatísticas", icon: BarChart3 },
  { label: "Perfil", icon: User },
];

export function BottomNavigation() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-pitch-950/90 px-3 pb-4 pt-3 shadow-card backdrop-blur-xl">
      <div className="mx-auto flex max-w-md items-center justify-between">
        {items.map(({ label, icon: Icon }) => {
          const active = label === "Replays";

          return (
            <button
              key={label}
              className={[
                "flex min-w-0 flex-1 flex-col items-center gap-1 text-[0.68rem] font-black uppercase",
                active ? "text-neon-400" : "text-slate-500",
              ].join(" ")}
            >
              <Icon size={27} strokeWidth={active ? 2.8 : 2.2} />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
      <div className="mx-auto mt-4 h-1 w-36 rounded-full bg-white/60" />
    </nav>
  );
}
