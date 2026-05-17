import {
  Activity,
  CalendarDays,
  Camera,
  CheckCircle2,
  Download,
  FileText,
  Home,
  KeyRound,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Send,
  Settings,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
const OPERATOR_TOKEN_KEY = "sertao_operator_token";
const REPLAY_HOTKEY_SECONDS = {
  F13: 15,
  F14: 15,
  F15: 15,
  F16: 15,
};

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

  if (value.startsWith("http")) {
    return value;
  }

  if (value.startsWith("/api")) {
    return `${API_BASE}${value.slice(4)}`;
  }

  if (value.startsWith("/")) {
    return value;
  }

  return `${API_BASE}/${value.replace(/^\//, "")}`;
}

async function apiRequest(path, { token, ...options } = {}) {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { "X-Operator-Token": token } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : data?.detail?.message;
    throw new Error(detail || "Nao foi possivel concluir a requisicao.");
  }

  return data;
}

function replayTitle(replay) {
  return replay.title || `Replay ${replay.duration || 15}s`;
}

function HomePage() {
  const [replays, setReplays] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  async function loadReplays({ silent = false } = {}) {
    if (!silent) {
      setStatus("loading");
    }

    try {
      const data = await apiRequest("/replays");
      setReplays(Array.isArray(data) ? data : []);
      setStatus("ready");
      setError("");
    } catch (requestError) {
      setStatus("error");
      setError(requestError.message);
    }
  }

  useEffect(() => {
    loadReplays();
    const timer = window.setInterval(() => loadReplays({ silent: true }), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const readyReplays = useMemo(
    () => replays.filter((replay) => replay.status === "ready" && replay.video_url),
    [replays],
  );

  return (
    <main className="home-shell">
      <header className="home-header">
        <a className="brand-mark" href="/teste" title="Abrir teste do operador">
          <RotateCcw size={28} strokeWidth={2.7} />
        </a>
        <div>
          <p className="eyebrow">Sertao Replay</p>
          <h1>Lances gravados</h1>
          <p className="header-copy">Assista aos replays gerados e baixe o video do seu lance.</p>
        </div>
      </header>

      {status === "loading" && (
        <section className="empty-state">
          <Loader2 className="spin" size={34} />
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
          <span>Quando o operador gerar um replay, o video aparece aqui automaticamente.</span>
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
                  <h2>{replayTitle(replay)}</h2>
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

function OperatorPage() {
  const [cameras, setCameras] = useState([]);
  const [cameraId, setCameraId] = useState("");
  const [label, setLabel] = useState("");
  const [replays, setReplays] = useState([]);
  const [apiStatus, setApiStatus] = useState("checking");
  const [message, setMessage] = useState("Conectando ao backend...");
  const [busy, setBusy] = useState(false);

  async function loadCameras() {
    const data = await apiRequest("/cameras");
    setCameras(Array.isArray(data) ? data : []);
    setCameraId((current) => current || data?.[0]?.id || "");
  }

  async function loadReplays() {
    const data = await apiRequest("/replays");
    setReplays(Array.isArray(data) ? data : []);
  }

  async function refresh({ silent = false } = {}) {
    try {
      await apiRequest("/health");
      await Promise.all([loadCameras(), loadReplays()]);
      setApiStatus("online");
      if (!silent) {
        setMessage("Backend online. Capture-server deve estar rodando na arena.");
      }
    } catch (error) {
      setApiStatus("offline");
      setMessage(error.message);
    }
  }

  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => refresh({ silent: true }), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const requestReplay = useCallback(async (seconds = 15) => {
    if (busy) {
      return;
    }

    if (!cameraId) {
      setMessage("Cadastre ou conecte uma camera antes de pedir replay.");
      return;
    }

    setBusy(true);
    setMessage(`Solicitacao de ${seconds}s enviada. Aguardando capture-server cortar e subir o MP4...`);

    try {
      const data = await apiRequest("/replay-requests", {
        method: "POST",
        body: JSON.stringify({
          camera_id: cameraId,
          seconds,
          label: label.trim() || null,
        }),
      });
      setMessage(data?.message || "Replay solicitado ao capture-server.");
      setLabel("");
      await loadReplays();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }, [busy, cameraId, label]);

  useEffect(() => {
    function handleReplayHotkey(event) {
      const seconds = REPLAY_HOTKEY_SECONDS[event.key];
      if (!seconds || event.repeat) {
        return;
      }

      event.preventDefault();
      requestReplay(seconds);
    }

    window.addEventListener("keydown", handleReplayHotkey);
    return () => window.removeEventListener("keydown", handleReplayHotkey);
  }, [requestReplay]);

  const selectedCamera = cameras.find((camera) => camera.id === cameraId);
  const readyReplays = replays.filter((replay) => replay.status === "ready" && replay.video_url).slice(0, 5);

  return (
    <main className="operator-shell">
      <header className="operator-topbar">
        <nav className="operator-nav" aria-label="Navegacao do operador">
          <a className="operator-brand" href="/">
            <Home size={18} />
            Home
          </a>
          <a className="operator-brand" href="/admin">
            <Settings size={18} />
            Admin
          </a>
        </nav>
        <span className={`status-pill status-${apiStatus}`}>
          {apiStatus === "online" ? "API online" : apiStatus === "offline" ? "API offline" : "Verificando API"}
        </span>
      </header>

      <section className="operator-hero">
        <div>
          <p className="eyebrow">Painel do operador</p>
          <h1>Replay 15s</h1>
          <p className="header-copy">
            Esta tela cria a solicitacao no backend. O capture-server local acessa o RTSP,
            gera o MP4 e publica o video na Home.
          </p>
        </div>
      </section>

      <section className="operator-grid">
        <article className="operator-panel">
          <div className="panel-heading">
            <Activity size={22} />
            <div>
              <h2>Camera</h2>
              <p>Status enviado pelo capture-server local.</p>
            </div>
          </div>

          <label htmlFor="cameraSelect">Camera cadastrada</label>
          <select id="cameraSelect" value={cameraId} onChange={(event) => setCameraId(event.target.value)}>
            {cameras.length ? (
              cameras.map((camera) => (
                <option key={camera.id} value={camera.id}>
                  {camera.name} ({camera.status || "unknown"})
                </option>
              ))
            ) : (
              <option value="">Nenhuma camera cadastrada</option>
            )}
          </select>

          <div className="status-box">
            <strong>{selectedCamera?.name || "Sem camera"}</strong>
            <span>{selectedCamera?.status || "Aguardando capture-server"}</span>
          </div>

          <button type="button" className="secondary-action" onClick={() => refresh()}>
            <RotateCcw size={18} />
            Atualizar
          </button>
        </article>

        <article className="operator-panel accent-panel">
          <div className="panel-heading">
            <Send size={22} />
            <div>
              <h2>Gerar replay</h2>
              <p>Cria uma solicitacao para os ultimos 15 segundos.</p>
            </div>
          </div>

          <label htmlFor="replayLabel">Titulo opcional</label>
          <input
            id="replayLabel"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Gol, defesa, lance decisivo..."
          />

          <button type="button" className="primary-action" onClick={() => requestReplay(15)} disabled={busy || !cameraId}>
            {busy ? <Loader2 className="spin" size={19} /> : <Video size={19} />}
            Replay 15s
          </button>

          <div className="result">
            <strong>Status</strong>
            <span>{message}</span>
          </div>
        </article>

        <article className="operator-panel">
          <div className="panel-heading">
            <CheckCircle2 size={22} />
            <div>
              <h2>Controle fisico</h2>
              <p>Arduino Leonardo conectado para gerar replay sem token.</p>
            </div>
          </div>

          <div className="status-box">
            <strong>Replay 15s</strong>
            <span>Botao fisico pronto para uso.</span>
          </div>
        </article>
      </section>

      <section className="operator-panel recent-panel">
        <div className="panel-heading">
          <Video size={22} />
          <div>
            <h2>Ultimos replays</h2>
            <p>A lista atualiza junto com a Home.</p>
          </div>
        </div>

        {readyReplays.length ? (
          <div className="recent-list">
            {readyReplays.map((replay) => (
              <a key={replay.id} className="recent-item" href={mediaUrl(replay.video_url)} target="_blank" rel="noreferrer">
                <strong>{replayTitle(replay)}</strong>
                <span>
                  {replay.camera_name} - {formatDate(replay.created_at)}
                </span>
              </a>
            ))}
          </div>
        ) : (
          <p className="muted">Nenhum replay pronto ainda.</p>
        )}
      </section>
    </main>
  );
}

function AdminPage() {
  const [token, setToken] = useState(() => localStorage.getItem(OPERATOR_TOKEN_KEY) || "");
  const [cameras, setCameras] = useState([]);
  const [logs, setLogs] = useState([]);
  const [apiStatus, setApiStatus] = useState("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Carregando painel admin...");
  const [form, setForm] = useState({
    id: "",
    name: "",
    rtsp_url: "",
    enabled: true,
    notes: "",
  });

  function tokenValue() {
    return token.trim();
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm({ id: "", name: "", rtsp_url: "", enabled: true, notes: "" });
  }

  async function loadCameras() {
    const path = tokenValue() ? "/cameras/admin" : "/cameras";
    const data = await apiRequest(path, tokenValue() ? { token: tokenValue() } : {});
    setCameras(Array.isArray(data) ? data : []);
  }

  async function loadLogs() {
    if (!tokenValue()) {
      setLogs([]);
      return;
    }

    const data = await apiRequest("/logs", { token: tokenValue() });
    setLogs(Array.isArray(data) ? data : []);
  }

  async function refreshStatus({ silent = false } = {}) {
    setBusy(true);
    try {
      await apiRequest("/health");
      await Promise.all([loadCameras(), loadLogs()]);
      setApiStatus("online");
      if (!silent) {
        setMessage("Status atualizado.");
      }
    } catch (error) {
      setApiStatus("error");
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refreshStatus();
    const timer = window.setInterval(() => refreshStatus({ silent: true }), 10000);
    return () => window.clearInterval(timer);
  }, []);

  function saveToken(event) {
    event.preventDefault();
    if (tokenValue()) {
      localStorage.setItem(OPERATOR_TOKEN_KEY, tokenValue());
    } else {
      localStorage.removeItem(OPERATOR_TOKEN_KEY);
    }
    setMessage("Token salvo neste navegador.");
    refreshStatus();
  }

  function editCamera(camera) {
    setForm({
      id: camera.id,
      name: camera.name,
      rtsp_url: camera.rtsp_url || "",
      enabled: Boolean(camera.enabled),
      notes: camera.notes || "",
    });
  }

  async function saveCamera(event) {
    event.preventDefault();
    if (!tokenValue()) {
      setMessage("Informe o token de operador antes de salvar.");
      return;
    }

    const payload = {
      id: form.id.trim(),
      name: form.name.trim(),
      rtsp_url: form.rtsp_url.trim(),
      enabled: form.enabled,
      notes: form.notes.trim() || null,
    };

    setBusy(true);
    try {
      const saved = await apiRequest("/cameras", {
        method: "POST",
        token: tokenValue(),
        body: JSON.stringify(payload),
      });
      setMessage(`Camera ${saved.id} salva.`);
      resetForm();
      await Promise.all([loadCameras(), loadLogs()]);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="operator-shell admin-shell">
      <header className="operator-topbar">
        <nav className="operator-nav" aria-label="Navegacao admin">
          <a className="operator-brand" href="/">
            <Home size={18} />
            Home
          </a>
          <a className="operator-brand" href="/teste">
            <Video size={18} />
            Teste
          </a>
        </nav>
        <span className={`status-pill status-${apiStatus}`}>
          {apiStatus === "online" ? "API online" : apiStatus === "error" ? "API erro" : "Verificando API"}
        </span>
      </header>

      <section className="operator-hero">
        <div>
          <p className="eyebrow">Painel admin</p>
          <h1>Cameras e logs</h1>
          <p className="header-copy">
            Cadastre cameras, acompanhe status do capture-server e consulte os logs operacionais.
          </p>
        </div>
      </section>

      <section className="admin-grid">
        <article className="operator-panel accent-panel">
          <div className="panel-heading">
            <Camera size={22} />
            <div>
              <h2>Camera</h2>
              <p>Cadastro usado pelo backend e pela tela de replay.</p>
            </div>
          </div>

          <form onSubmit={saveCamera} className="admin-form">
            <label htmlFor="adminCameraId">ID</label>
            <input
              id="adminCameraId"
              value={form.id}
              onChange={(event) => updateForm("id", event.target.value)}
              placeholder="campo-01"
              required
            />

            <label htmlFor="adminCameraName">Nome</label>
            <input
              id="adminCameraName"
              value={form.name}
              onChange={(event) => updateForm("name", event.target.value)}
              placeholder="Campo 01"
              required
            />

            <label htmlFor="adminCameraRtsp">URL RTSP</label>
            <input
              id="adminCameraRtsp"
              value={form.rtsp_url}
              onChange={(event) => updateForm("rtsp_url", event.target.value)}
              placeholder="rtsp://usuario:senha@192.168.0.6:554/onvif1"
              required
            />

            <label htmlFor="adminCameraNotes">Notas</label>
            <textarea
              id="adminCameraNotes"
              value={form.notes}
              onChange={(event) => updateForm("notes", event.target.value)}
              placeholder="Servidor local, posicao, observacoes"
            />

            <label className="toggle-row">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => updateForm("enabled", event.target.checked)}
              />
              <span>Camera ativa</span>
            </label>

            <div className="button-row">
              <button type="submit" className="primary-action" disabled={busy}>
                {busy ? <Loader2 className="spin" size={18} /> : <Save size={18} />}
                Salvar
              </button>
              <button type="button" className="secondary-action" onClick={resetForm}>
                <Plus size={18} />
                Nova
              </button>
            </div>
          </form>
        </article>

        <article className="operator-panel">
          <div className="panel-heading">
            <KeyRound size={22} />
            <div>
              <h2>Acesso</h2>
              <p>Token exigido para salvar cameras e abrir logs.</p>
            </div>
          </div>

          <form onSubmit={saveToken} className="token-form">
            <label htmlFor="adminOperatorToken">Token de operador</label>
            <input
              id="adminOperatorToken"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="token configurado no Render"
            />
            <button type="submit" className="secondary-action">
              <CheckCircle2 size={18} />
              Salvar token
            </button>
          </form>

          <button type="button" className="primary-action" onClick={() => refreshStatus()} disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} /> : <Activity size={18} />}
            Status
          </button>

          <div className="result">
            <strong>Resultado</strong>
            <span>{message}</span>
          </div>
        </article>
      </section>

      <section className="admin-grid lower-admin-grid">
        <article className="operator-panel">
          <div className="panel-heading">
            <Camera size={22} />
            <div>
              <h2>Cameras cadastradas</h2>
              <p>Status atualizado pelo capture-server.</p>
            </div>
          </div>

          <div className="camera-list">
            {cameras.length ? (
              cameras.map((camera) => (
                <button key={camera.id} type="button" className="camera-row" onClick={() => editCamera(camera)}>
                  <span>
                    <strong>{camera.name}</strong>
                    <small>{camera.id}</small>
                    {camera.rtsp_url ? <small className="rtsp-preview">{camera.rtsp_url}</small> : null}
                  </span>
                  <span className={`status-pill status-${camera.status || "unknown"}`}>
                    {camera.status || "unknown"}
                  </span>
                </button>
              ))
            ) : (
              <p className="muted">Nenhuma camera cadastrada.</p>
            )}
          </div>
        </article>

        <article className="operator-panel">
          <div className="panel-heading">
            <FileText size={22} />
            <div>
              <h2>Logs</h2>
              <p>Ultimos eventos do backend e capture-server.</p>
            </div>
          </div>

          <div className="log-list">
            {logs.length ? (
              logs.slice(0, 30).map((log) => (
                <div key={log.id} className="log-row">
                  <span className={`log-level level-${log.level}`}>{log.level}</span>
                  <div>
                    <strong>{log.source}{log.camera_id ? ` - ${log.camera_id}` : ""}</strong>
                    <p>{log.message}</p>
                    <small>{formatDate(log.created_at)}</small>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">Informe o token e clique em Status para carregar logs.</p>
            )}
          </div>
        </article>
      </section>
    </main>
  );
}

export default function App() {
  if (window.location.pathname.startsWith("/admin")) {
    return <AdminPage />;
  }

  if (window.location.pathname.startsWith("/teste")) {
    return <OperatorPage />;
  }

  return <HomePage />;
}
