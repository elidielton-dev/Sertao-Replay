import { CalendarDays, MoreVertical, Play, Shield, Star } from "lucide-react";

const categoryColors = {
  GOL: "text-neon-400",
  FALTA: "text-neon-300",
  DEFESA: "text-neon-400",
  "MELHORES LANCES": "text-neon-300",
};

export function ReplayCard({ replay, isFavorite, onToggleFavorite }) {
  return (
    <article className="grid grid-cols-[42%_1fr] gap-4 rounded-3xl border border-white/10 bg-white/[0.045] p-3 shadow-card backdrop-blur">
      <div className="relative min-h-36 overflow-hidden rounded-2xl bg-pitch-800">
        <img className="h-full w-full object-cover" src={replay.image} alt={replay.title} />
        <div className="absolute inset-0 bg-gradient-to-tr from-black/65 via-transparent to-neon-400/10" />
        <button
          aria-label={`Assistir ${replay.title}`}
          className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur"
        >
          <Play fill="currentColor" size={30} />
        </button>
        <span className="absolute bottom-2 right-2 rounded-lg bg-black/75 px-2 py-1 text-sm font-black text-white">
          {replay.duration}
        </span>
      </div>

      <div className="min-w-0 py-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={`m-0 text-sm font-black uppercase ${categoryColors[replay.category]}`}>
              {replay.category}
            </p>
            <h3 className="mt-1 truncate text-xl font-black leading-tight text-white">
              {replay.title}
            </h3>
          </div>

          <div className="flex shrink-0 items-center gap-1 text-slate-400">
            <button
              aria-label="Favoritar replay"
              onClick={() => onToggleFavorite(replay.id)}
              className={isFavorite ? "text-yellow-300" : "text-slate-500"}
            >
              <Star fill={isFavorite ? "currentColor" : "none"} size={27} />
            </button>
            <button aria-label="Mais opções" className="text-slate-500">
              <MoreVertical size={25} />
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
          <Shield className="h-5 w-5 text-neon-400" />
          <span className="truncate">{replay.homeTeam}</span>
          <strong className="shrink-0 text-lg text-white">{replay.score}</strong>
          <span className="truncate">{replay.awayTeam}</span>
        </div>

        <div className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-400">
          <CalendarDays className="h-4 w-4" />
          <span>
            {replay.date} • {replay.time}
          </span>
        </div>

        <p className="mt-1 text-sm font-bold text-neon-400">{replay.field}</p>
      </div>
    </article>
  );
}
