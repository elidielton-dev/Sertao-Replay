import { ReplayCard } from "./ReplayCard.jsx";

export function ReplayList({ replays, favorites, onToggleFavorite }) {
  if (!replays.length) {
    return (
      <section className="mx-4 mt-5 rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-card">
        <p className="text-lg font-bold text-white">Nenhum replay encontrado.</p>
        <p className="mt-2 text-sm text-slate-400">Tente outro campo, filtro ou termo de busca.</p>
      </section>
    );
  }

  return (
    <section className="mx-4 mt-5 space-y-4 pb-28">
      {replays.map((replay) => (
        <ReplayCard
          key={replay.id}
          replay={replay}
          isFavorite={favorites.includes(replay.id)}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </section>
  );
}
