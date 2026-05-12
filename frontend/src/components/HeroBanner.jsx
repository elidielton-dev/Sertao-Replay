import { Play } from "lucide-react";

export function HeroBanner() {
  return (
    <section className="mx-4 mt-8 overflow-hidden rounded-[1.75rem] border border-neon-400/20 bg-[radial-gradient(circle_at_80%_20%,rgba(135,255,63,0.36),transparent_15rem),linear-gradient(135deg,#0b2418,#08110d_55%,#112a1f)] p-6 shadow-card">
      <div className="grid min-h-56 grid-cols-[1.05fr_0.95fr] items-center gap-2">
        <div className="relative z-10">
          <h2 className="text-3xl font-black leading-tight text-white">
            Reveja os <span className="text-neon-400">melhores lances</span> das partidas.
          </h2>
          <p className="mt-5 text-base font-medium leading-relaxed text-slate-300">
            Assista, analise e compartilhe os gols, defesas e jogadas que fizeram a diferença.
          </p>
        </div>

        <div className="relative h-full min-h-48">
          <div className="absolute right-0 top-4 h-32 w-40 rotate-6 rounded-3xl border border-neon-300/70 bg-neon-400/15 shadow-glow backdrop-blur-sm">
            <div className="flex h-full flex-col items-center justify-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-neon-400 text-pitch-950 shadow-glow">
                <Play fill="currentColor" size={34} />
              </div>
              <div className="h-2 w-24 rounded-full bg-neon-300/70">
                <div className="h-2 w-12 rounded-full bg-white" />
              </div>
            </div>
          </div>

          <div className="absolute bottom-6 right-1 h-24 w-24 rounded-full border border-white/40 bg-white/90 shadow-glow">
            <div className="flex h-full items-center justify-center text-5xl">⚽</div>
          </div>

          <div className="absolute bottom-0 right-3 h-32 w-32 rounded-full border border-neon-400/30" />
          <div className="absolute bottom-8 right-8 h-44 w-px rotate-45 bg-neon-300/30" />
          <div className="absolute bottom-4 right-20 h-40 w-px rotate-[65deg] bg-neon-300/20" />
        </div>
      </div>
    </section>
  );
}
