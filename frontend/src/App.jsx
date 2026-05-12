import { useMemo, useState } from "react";
import { BottomNavigation } from "./components/BottomNavigation.jsx";
import { FieldSelector } from "./components/FieldSelector.jsx";
import { Header } from "./components/Header.jsx";
import { HeroBanner } from "./components/HeroBanner.jsx";
import { ReplayFilters } from "./components/ReplayFilters.jsx";
import { ReplayList } from "./components/ReplayList.jsx";
import { SearchBar } from "./components/SearchBar.jsx";
import { fields, filters, replays } from "./data/replays.js";

export default function App() {
  const [selectedField, setSelectedField] = useState("Campo 01");
  const [activeFilter, setActiveFilter] = useState("Recentes");
  const [searchTerm, setSearchTerm] = useState("");
  const [favorites, setFavorites] = useState(
    replays.filter((replay) => replay.favorite).map((replay) => replay.id),
  );

  const visibleReplays = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return replays.filter((replay) => {
      const matchesField = replay.field === selectedField;
      const matchesFilter = activeFilter === "Recentes" || replay.filter === activeFilter;
      const matchesSearch =
        !normalizedSearch ||
        [replay.title, replay.teams, replay.player, replay.field]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);

      return matchesField && matchesFilter && matchesSearch;
    });
  }, [activeFilter, searchTerm, selectedField]);

  function toggleFavorite(replayId) {
    setFavorites((current) =>
      current.includes(replayId)
        ? current.filter((id) => id !== replayId)
        : [...current, replayId],
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-md overflow-hidden bg-pitch-950/20">
      <Header />
      <HeroBanner />
      <FieldSelector
        fields={fields}
        selectedField={selectedField}
        onSelectField={setSelectedField}
      />
      <SearchBar value={searchTerm} onChange={setSearchTerm} />
      <ReplayFilters filters={filters} activeFilter={activeFilter} onSelectFilter={setActiveFilter} />
      <ReplayList
        replays={visibleReplays}
        favorites={favorites}
        onToggleFavorite={toggleFavorite}
      />
      <BottomNavigation />
    </div>
  );
}
