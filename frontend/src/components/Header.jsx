import { ArrowLeft, Filter, RotateCcw } from "lucide-react";

export function Header() {
  return (
    <header className="px-4 pt-6 text-center">
      <div className="mx-auto flex max-w-md items-center justify-between gap-3">
        <button
          aria-label="Voltar"
          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white shadow-card backdrop-blur"
        >
          <ArrowLeft size={28} strokeWidth={2.4} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-center gap-2">
            <span className="relative flex h-11 w-11 items-center justify-center rounded-full border-2 border-neon-400 text-neon-400 shadow-glow">
              <span className="text-xl">⚽</span>
              <RotateCcw className="absolute -right-1 -top-1 h-5 w-5 rounded-full bg-pitch-950" strokeWidth={3} />
            </span>
            <h1 className="truncate text-[1.75rem] font-black leading-none tracking-tight sm:text-4xl">
              <span className="text-white">SERTÃO</span>{" "}
              <span className="text-neon-400">REPLAY</span>
            </h1>
          </div>
          <p className="mt-3 text-sm font-medium text-slate-400 sm:text-base">
            Reveja os melhores lances do futebol amador
          </p>
        </div>

        <button
          aria-label="Filtros"
          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white shadow-card backdrop-blur"
        >
          <Filter size={25} strokeWidth={2.7} />
        </button>
      </div>
    </header>
  );
}
