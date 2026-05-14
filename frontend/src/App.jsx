import { CalendarDays, Download, RotateCcw, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const STATIC_REPLAYS_URL = "/replays/replays.json";

function formatDate(value) {
  if (!value) {
    return "Data indisponivel";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function mediaUrl(value) {
  if (!value) {
    return "";
  }

  if (value.startsWith("http") || value.startsWith("/")) {
    return value;
  }

  return `${API_BASE}${value}`;
}

export default function App() {
  const [replays, setReplays] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  async function loadReplays({ silent = false } = {}) {
    if (!silent) {
      setStatus("loading");
    }

    try {
      const response = await fetch(`${API_BASE}/replays`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.detail || "Nao foi possivel carregar os replays.");
      }

      const apiReplays = Array.isArray(data) ? data : [];
      setReplays(apiReplays.length ? apiReplays : await loadStaticReplays());
      setStatus("ready");
      setError("");
    } catch (requestError) {
      const staticReplays = await loadStaticReplays();
      if (staticReplays.length) {
        setReplays(staticReplays);
        setStatus("ready");
        setError("");
        return;
      }

      setStatus("error");
      setError(requestError.message);
    }
  }

  async function loadStaticReplays() {
    try {
      const response = await fetch(`${STATIC_REPLAYS_URL}?v=${Date.now()}`, {
        cache: "no-store",
      });
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  useEffect(() => {
    loadReplays();
    const timer = window.setInterval(() => loadReplays({ silent: true }), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const readyReplays = useMemo(
    () => replays.filter((replay) => replay.status === "ready" && replay.video_url),
    [replays],
  );

  return (
    <main className="home-shell">
      <header className="home-header">
        <div className="brand-mark">
          <RotateCcw size={28} strokeWidth={2.7} />
        </div>
        <div>
          <p className="eyebrow">Sertao Replay</p>
          <h1>Lances gravados</h1>
          <p className="header-copy">Assista aos replays gerados e baixe o video do seu lance.</p>
        </div>
      </header>

      {status === "loading" && (
        <section className="empty-state">
          <Video size={34} />
          <strong>Carregando replays...</strong>
        </section>
      )}

      {status === "error" && (
        <section className="empty-state error-state">
          <Video size={34} />
          <strong>Replays indisponiveis agora.</strong>
          <span>{error}</span>
        </section>
      )}

      {status === "ready" && !readyReplays.length && (
        <section className="empty-state">
          <Video size={34} />
          <strong>Nenhum replay publicado ainda.</strong>
          <span>Os videos gerados na pagina de teste aparecem aqui automaticamente.</span>
        </section>
      )}

      <section className="replay-feed" aria-label="Replays disponiveis">
        {readyReplays.map((replay) => {
          const videoUrl = mediaUrl(replay.video_url);
          const downloadUrl = mediaUrl(replay.download_url || replay.video_url);

          return (
            <article className="replay-card" key={replay.id}>
              <div className="video-frame">
                <video src={videoUrl} controls preload="metadata" playsInline />
              </div>

              <div className="replay-content">
                <div>
                  <p className="replay-camera">{replay.camera_name}</p>
                  <h2>{replay.title || `Replay ${replay.duration}s`}</h2>
                </div>

                <div className="replay-meta">
                  <span>
                    <CalendarDays size={17} />
                    {formatDate(replay.created_at)}
                  </span>
                  <span>{replay.duration}s</span>
                  {replay.size_mb ? <span>{replay.size_mb} MB</span> : null}
                </div>

                <a className="download-link" href={downloadUrl} download>
                  <Download size={19} />
                  Baixar video
                </a>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
