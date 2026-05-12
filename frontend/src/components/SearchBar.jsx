import { Search } from "lucide-react";

export function SearchBar({ value, onChange }) {
  return (
    <label className="mx-4 mt-5 flex h-16 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-slate-400 shadow-card">
      <Search size={28} strokeWidth={2.2} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-full min-w-0 flex-1 bg-transparent text-base font-medium text-white outline-none placeholder:text-slate-500"
        placeholder="Buscar replay, time ou jogador..."
      />
    </label>
  );
}
