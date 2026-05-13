const apiStorageKey = "sertao_api_base_url";
let api = normalizeApiBase(
  new URLSearchParams(window.location.search).get("api") ||
    localStorage.getItem(apiStorageKey) ||
    "/api",
);
let currentPreviewCameraId = null;
let previewMonitorTimer = null;

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
  if (!logEl) {
    console.log(message, data);
    return;
  }

  const time = new Date().toLocaleTimeString();
  const payload = data ? `\n${JSON.stringify(redactForLog(data), null, 2)}` : "";
  logEl.textContent = `[${time}] ${message}${payload}\n\n` + logEl.textContent;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function request(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.detail || "Erro na requisicao");
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
    await checkAdminHealth();
    await loadAdminCameras();
    await loadRecorderStatus(true);
    await loadReplays(true);
  });
}

async function checkAdminHealth() {
  try {
    const data = await request("/health");
    document.getElementById("apiStatus").textContent = "API online";
    log("API online", data);
  } catch (error) {
    document.getElementById("apiStatus").textContent = "API offline";
    log("Erro ao conectar na API", { error: error.message });
  }
}

async function loadAdminCameras() {
  try {
    const cameras = await request("/admin/cameras");
    const root = document.getElementById("adminCameras");
    root.innerHTML = "";

    if (!cameras.length) {
      root.innerHTML = '<p class="muted">Nenhuma camera cadastrada.</p>';
      log("Nenhuma camera cadastrada");
      return;
    }

    cameras.forEach((camera) => {
      const item = document.createElement("div");
      item.className = "camera-admin-item";
      item.innerHTML = `
        <strong>${escapeHtml(camera.name)}</strong>
        <small>${escapeHtml(camera.id)} - ${camera.enabled ? "ativa" : "inativa"}</small>
        <code>${escapeHtml(redactRtspText(camera.rtsp_url))}</code>
        <div class="camera-admin-actions">
          <button type="button" data-action="edit">Editar</button>
          <button type="button" data-action="test">Testar câmera</button>
          <button type="button" data-action="preview">Visualizar</button>
          <button type="button" data-action="start">Monitorar</button>
          <button type="button" data-action="replay">Replay 60s</button>
          <button type="button" class="secondary" data-action="stop">Parar</button>
          <button type="button" class="danger" data-action="delete">Remover</button>
        </div>
      `;

      item.querySelector('[data-action="edit"]').addEventListener("click", () => fillCameraForm(camera));
      item.querySelector('[data-action="test"]').addEventListener("click", () => testCamera(camera.id));
      item.querySelector('[data-action="preview"]').addEventListener("click", () => openCameraPreview(camera));
      item.querySelector('[data-action="start"]').addEventListener("click", () => startCameraRecorder(camera.id));
      item.querySelector('[data-action="replay"]').addEventListener("click", () => createReplay(camera.id, 60));
      item.querySelector('[data-action="stop"]').addEventListener("click", () => stopCameraRecorder(camera.id));
      item.querySelector('[data-action="delete"]').addEventListener("click", () => deleteCamera(camera.id));
      root.appendChild(item);
    });

    log("Cameras carregadas", cameras);
  } catch (error) {
    log("Erro ao carregar cameras", { error: error.message });
  }
}

function fillCameraForm(camera) {
  document.getElementById("cameraId").value = camera.id;
  document.getElementById("cameraName").value = camera.name;
  document.getElementById("cameraRtsp").value = camera.rtsp_url;
  document.getElementById("cameraEnabled").checked = camera.enabled;
}

function clearCameraForm() {
  document.getElementById("cameraForm").reset();
  document.getElementById("cameraId").value = "";
  document.getElementById("cameraEnabled").checked = true;
  log("Formulario limpo para nova camera");
}

async function testCamera(cameraId) {
  try {
    log(`Testando camera ${cameraId}...`);
    const data = await request(`/cameras/${encodeURIComponent(cameraId)}/test`, {
      method: "POST",
    });
    log(data.ok ? "Camera testada com sucesso" : cameraFailureTitle(data), data);
    return data;
  } catch (error) {
    const data = { ok: false, error: error.message };
    log("Erro ao testar camera", data);
    return data;
  }
}

function cameraFailureTitle(data) {
  if (data?.hint?.includes("Vercel")) {
    return "Camera fora do alcance da Vercel";
  }

  return "Camera nao respondeu";
}

function cameraFailureText(data) {
  return data?.hint || data?.message || data?.error || "Nao foi possivel visualizar a camera.";
}

async function openCameraPreview(camera) {
  currentPreviewCameraId = camera.id;

  const preview = document.getElementById("cameraPreview");
  const title = document.getElementById("cameraPreviewTitle");
  const placeholder = document.getElementById("cameraPreviewPlaceholder");

  preview.classList.remove("hidden");
  title.textContent = `Visualizacao: ${camera.name} (${camera.id})`;
  placeholder.textContent = "Conectando na camera e carregando imagem...";

  const result = await testCamera(camera.id);
  if (!result.ok) {
    placeholder.textContent = cameraFailureText(result);
    return;
  }

  refreshCameraPreview();
}

function refreshCameraPreview() {
  if (!currentPreviewCameraId) {
    log("Selecione uma camera para visualizar.");
    return;
  }

  const image = document.getElementById("cameraPreviewImage");
  const placeholder = document.getElementById("cameraPreviewPlaceholder");
  placeholder.textContent = "Atualizando imagem da camera...";
  image.removeAttribute("src");
  image.src = apiUrl(`/cameras/${encodeURIComponent(currentPreviewCameraId)}/snapshot?ts=${Date.now()}`);
  log("Snapshot da camera solicitado", { camera_id: currentPreviewCameraId });
}

function closeCameraPreview() {
  stopPreviewMonitor(false);
  currentPreviewCameraId = null;
  document.getElementById("cameraPreview").classList.add("hidden");
  document.getElementById("cameraPreviewImage").removeAttribute("src");
  document.getElementById("cameraPreviewPlaceholder").textContent =
    "Clique em Visualizar para carregar um snapshot da camera.";
  log("Visualizacao da camera fechada");
}

async function saveCamera(event) {
  event.preventDefault();

  const camera = {
    id: document.getElementById("cameraId").value.trim(),
    name: document.getElementById("cameraName").value.trim(),
    rtsp_url: document.getElementById("cameraRtsp").value.trim(),
    enabled: document.getElementById("cameraEnabled").checked,
  };

  try {
    const data = await request("/cameras", {
      method: "POST",
      body: JSON.stringify(camera),
    });
    log("Camera salva no banco de dados", data);
    await loadAdminCameras();
  } catch (error) {
    log("Erro ao salvar camera", { error: error.message });
  }
}

async function deleteCamera(cameraId) {
  if (!confirm(`Remover a camera ${cameraId}?`)) {
    return;
  }

  try {
    const data = await request(`/cameras/${encodeURIComponent(cameraId)}`, {
      method: "DELETE",
    });
    log("Camera removida", data);
    clearCameraForm();
    await loadAdminCameras();
  } catch (error) {
    log("Erro ao remover camera", { error: error.message });
  }
}

async function startCameraRecorder(cameraId) {
  try {
    log(`Iniciando monitoramento da camera ${cameraId}...`);
    const data = await request(`/recorders/${encodeURIComponent(cameraId)}/start`, {
      method: "POST",
    });
    log("Monitoramento iniciado", data);
    await loadRecorderStatus(true);
  } catch (error) {
    log("Erro ao iniciar monitoramento", { error: error.message });
  }
}

async function stopCameraRecorder(cameraId) {
  try {
    const data = await request(`/recorders/${encodeURIComponent(cameraId)}/stop`, {
      method: "POST",
    });
    log("Monitoramento parado", data);
    await loadRecorderStatus(true);
  } catch (error) {
    log("Erro ao parar monitoramento", { error: error.message });
  }
}

async function loadRecorderStatus(silent = false) {
  try {
    const data = await request("/recorders/status");
    const active = Object.entries(data)
      .filter(([, status]) => status.running)
      .map(([cameraId]) => cameraId);

    const statusText = active.length
      ? `Gravando: ${active.join(", ")}`
      : "Nenhuma camera gravando";

    const statusEl = document.getElementById("recorderStatus");
    if (statusEl) {
      statusEl.textContent = statusText;
    }

    if (!silent) {
      log("Status do monitoramento", data);
    }
  } catch (error) {
    const statusEl = document.getElementById("recorderStatus");
    if (statusEl) {
      statusEl.textContent = "Status indisponivel";
    }
    if (!silent) {
      log("Erro ao verificar monitoramento", { error: error.message });
    }
  }
}

async function createReplay(cameraId, seconds = 60) {
  try {
    log(`Gerando replay dos ultimos ${seconds}s da camera ${cameraId}...`);
    const data = await request("/replay", {
      method: "POST",
      body: JSON.stringify({
        camera_id: cameraId,
        seconds,
        label: "botao_replay",
      }),
    });
    log(data.ok ? "Replay pronto para salvar" : "Replay nao gerado", data);
    renderReplayResult(data);
    await loadReplays(true);
  } catch (error) {
    log("Erro ao gerar replay", { error: error.message });
  }
}

function renderReplayResult(data) {
  const root = document.getElementById("replayResult");
  if (!root) {
    return;
  }

  root.classList.remove("hidden");

  if (!data?.ok || !data.file_name) {
    root.innerHTML = `<strong>Replay indisponivel</strong><span>${escapeHtml(
      data?.message || "Inicie o monitoramento e aguarde alguns segundos.",
    )}</span>`;
    return;
  }

  const url = replayFileUrl(data.file_name);
  root.innerHTML = `
    <strong>Replay gerado</strong>
    <span>${escapeHtml(data.file_name)} - ${data.seconds}s</span>
    <a class="button" href="${url}" download>Salvar video no aparelho</a>
  `;
}

async function loadReplays(silent = false) {
  try {
    const replays = await request("/replays");
    const root = document.getElementById("adminReplays");

    if (!root) {
      return;
    }

    root.innerHTML = "";

    if (!replays.length) {
      root.innerHTML = '<p class="muted">Nenhum replay gerado ainda.</p>';
      return;
    }

    replays.slice(0, 6).forEach((replay) => {
      const item = document.createElement("div");
      item.className = "replay-item";
      item.innerHTML = `
        <strong>${escapeHtml(replay.name)}</strong>
        <small>${replay.size_mb} MB</small>
        <a href="${replayFileUrl(replay.name)}" download>Salvar video</a>
      `;
      root.appendChild(item);
    });

    if (!silent) {
      log("Replays carregados", replays);
    }
  } catch (error) {
    if (!silent) {
      log("Erro ao carregar replays", { error: error.message });
    }
  }
}

function startPreviewMonitor() {
  if (!currentPreviewCameraId) {
    log("Selecione uma camera para monitorar a visualizacao.");
    return;
  }

  stopPreviewMonitor(false);
  refreshCameraPreview();
  previewMonitorTimer = window.setInterval(refreshCameraPreview, 30000);
  document.getElementById("previewMonitorStatus").textContent = "Monitorando imagem a cada 30s";
  log("Monitoramento visual iniciado", { camera_id: currentPreviewCameraId });
}

function stopPreviewMonitor(shouldLog = true) {
  if (previewMonitorTimer) {
    window.clearInterval(previewMonitorTimer);
    previewMonitorTimer = null;
  }

  const status = document.getElementById("previewMonitorStatus");
  if (status) {
    status.textContent = "Atualizacao manual";
  }

  if (shouldLog) {
    log("Monitoramento visual parado");
  }
}

function initAdminPanel() {
  log("Painel admin carregado");
  initApiConfig();
  document.getElementById("cameraForm").addEventListener("submit", saveCamera);
  const previewImage = document.getElementById("cameraPreviewImage");
  previewImage.addEventListener("load", () => {
    document.getElementById("cameraPreviewPlaceholder").textContent = "";
    log("Imagem da camera carregada", { camera_id: currentPreviewCameraId });
  });
  previewImage.addEventListener("error", () => {
    document.getElementById("cameraPreviewPlaceholder").textContent =
      "Nao foi possivel carregar a imagem da camera.";
    log("Erro ao carregar imagem da camera", { camera_id: currentPreviewCameraId });
  });
  checkAdminHealth();
  loadAdminCameras();
  loadRecorderStatus(true);
  loadReplays(true);
  window.setInterval(() => loadRecorderStatus(true), 10000);
}

window.addEventListener("error", (event) => {
  log("Erro de JavaScript no painel admin", { error: event.message });
});

window.addEventListener("unhandledrejection", (event) => {
  log("Erro assíncrono no painel admin", { error: String(event.reason) });
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdminPanel);
} else {
  initAdminPanel();
}
