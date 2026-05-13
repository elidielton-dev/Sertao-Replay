const apiStorageKey = "sertao_api_base_url";
let api = normalizeApiBase(
  new URLSearchParams(window.location.search).get("api") ||
    localStorage.getItem(apiStorageKey) ||
    "/api",
);

function normalizeApiBase(value) {
  const cleaned = String(value || "/api").trim() || "/api";
  return cleaned.endsWith("/") ? cleaned.slice(0, -1) : cleaned;
}

function apiUrl(path) {
  return `${api}${path}`;
}

function replayFileUrl(fileName) {
  return apiUrl(`/replays/file/${encodeURIComponent(fileName)}`);
}

function redactRtspText(value) {
  return String(value).replace(/rtsp:\/\/([^:@/\s]+):([^@/\s]+)@/gi, "rtsp://***:***@");
}

function redactForLog(value) {
  if (typeof value === "string") {
    return redactRtspText(value);
  }

  if (Array.isArray(value)) {
    return value.map(redactForLog);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactForLog(item)]),
    );
  }

  return value;
}

function log(message, data = null) {
  const logEl = document.getElementById("log");
  const time = new Date().toLocaleTimeString();
  const payload = data ? `\n${JSON.stringify(redactForLog(data), null, 2)}` : "";
  logEl.textContent = `[${time}] ${message}${payload}\n\n` + logEl.textContent;
}

async function request(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.detail || "Erro na requisição");
  }

  return data;
}

function initApiConfig() {
  const form = document.getElementById("apiConfigForm");
  const input = document.getElementById("apiBaseUrl");

  if (!form || !input) {
    return;
  }

  input.value = api;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    api = normalizeApiBase(input.value);
    localStorage.setItem(apiStorageKey, api);
    log("API configurada", { api });
    await checkHealth();
    await loadCameras();
    await loadReplays();
  });
}

async function checkHealth() {
  try {
    const data = await request("/health");
    document.getElementById("apiStatus").textContent = "API online";
    log("API online", data);
  } catch (error) {
    document.getElementById("apiStatus").textContent = "API offline";
    log("Erro ao conectar na API", { error: error.message });
  }
}

async function checkSystem() {
  try {
    const data = await request("/system/check");
    log("Verificação do sistema", data);
  } catch (error) {
    log("Erro ao verificar sistema", { error: error.message });
  }
}

async function loadCameras() {
  try {
    const cameras = await request("/cameras");
    const select = document.getElementById("cameraSelect");
    select.innerHTML = "";

    cameras.forEach((camera) => {
      const option = document.createElement("option");
      option.value = camera.id;
      option.textContent = `${camera.name} (${camera.id})`;
      select.appendChild(option);
    });

    log("Câmeras carregadas", cameras);
  } catch (error) {
    log("Erro ao carregar câmeras", { error: error.message });
  }
}

function selectedCameraId() {
  return document.getElementById("cameraSelect").value || "cam1";
}

async function showGStreamerPipeline() {
  try {
    const data = await request(`/cameras/${selectedCameraId()}/gstreamer-pipeline`);
    log("Pipeline GStreamer", data);
  } catch (error) {
    log("Erro ao gerar pipeline GStreamer", { error: error.message });
  }
}

async function startRecorder() {
  try {
    const data = await request(`/recorders/${selectedCameraId()}/start`, { method: "POST" });
    log("Gravação iniciada", data);
  } catch (error) {
    log("Erro ao iniciar gravação", { error: error.message });
  }
}

async function stopRecorder() {
  try {
    const data = await request(`/recorders/${selectedCameraId()}/stop`, { method: "POST" });
    log("Gravação parada", data);
  } catch (error) {
    log("Erro ao parar gravação", { error: error.message });
  }
}

async function recorderStatus() {
  try {
    const data = await request("/recorders/status");
    log("Status da gravação", data);
  } catch (error) {
    log("Erro ao verificar gravação", { error: error.message });
  }
}

async function createReplay(seconds) {
  try {
    const label = document.getElementById("replayLabel").value || null;
    const data = await request("/replay", {
      method: "POST",
      body: JSON.stringify({
        camera_id: selectedCameraId(),
        seconds,
        label,
      }),
    });
    log(`Replay ${seconds}s solicitado`, data);
    renderReplayResult(data);
    await loadReplays();
  } catch (error) {
    log("Erro ao gerar replay", { error: error.message });
  }
}

function renderReplayResult(data) {
  const root = document.getElementById("replayResult");
  if (!root) {
    return;
  }

  if (!data?.ok || !data.file_name) {
    root.innerHTML = `<strong>Replay indisponivel</strong><br /><small>${
      data?.message || "Inicie a gravacao e tente de novo em alguns segundos."
    }</small>`;
    return;
  }

  root.innerHTML = `
    <strong>Replay pronto:</strong><br />
    <small>${data.file_name}</small><br />
    <a href="${replayFileUrl(data.file_name)}" download>Salvar video no aparelho</a>
  `;
}

async function loadReplays() {
  try {
    const replays = await request("/replays");
    const root = document.getElementById("replays");
    root.innerHTML = "";

    replays.forEach((replay) => {
      const item = document.createElement("div");
      item.className = "replay-item";
      item.innerHTML = `
        <strong>${replay.name}</strong><br />
        <small>${replay.size_mb} MB</small><br />
        <a href="${replayFileUrl(replay.name)}" target="_blank">Abrir replay</a>
        <a href="${replayFileUrl(replay.name)}" download>Salvar video</a>
      `;
      root.appendChild(item);
    });

    log("Replays carregados", replays);
  } catch (error) {
    log("Erro ao carregar replays", { error: error.message });
  }
}

initApiConfig();
checkHealth();
loadCameras();
loadReplays();
