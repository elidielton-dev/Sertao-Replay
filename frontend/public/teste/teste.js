const apiStorageKey = "sertao_api_base_url";
const tokenStorageKey = "sertao_operator_token";
const params = new URLSearchParams(window.location.search);
const api = normalizeApiBase(
  params.get("api") ||
    localStorage.getItem(apiStorageKey) ||
    "/api",
);
localStorage.setItem(apiStorageKey, api);
const operatorToken = params.get("token") || localStorage.getItem(tokenStorageKey) || "";
if (operatorToken) {
  localStorage.setItem(tokenStorageKey, operatorToken);
}
const replaySeconds = 15;

const elements = {
  apiStatus: document.getElementById("apiStatus"),
  cameraSelect: document.getElementById("cameraSelect"),
  cameraStatus: document.getElementById("cameraStatus"),
  recorderStatus: document.getElementById("recorderStatus"),
  replayLabel: document.getElementById("replayLabel"),
  replayResult: document.getElementById("replayResult"),
  replays: document.getElementById("replays"),
  log: document.getElementById("log"),
  snapshotPanel: document.getElementById("snapshotPanel"),
  snapshotImage: document.getElementById("snapshotImage"),
  reloadCamerasBtn: document.getElementById("reloadCamerasBtn"),
  testCameraBtn: document.getElementById("testCameraBtn"),
  startRecorderBtn: document.getElementById("startRecorderBtn"),
  stopRecorderBtn: document.getElementById("stopRecorderBtn"),
  replay15Btn: document.getElementById("replay15Btn"),
};

function normalizeApiBase(value) {
  const cleaned = String(value || "/api").trim() || "/api";
  return cleaned.endsWith("/") ? cleaned.slice(0, -1) : cleaned;
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
  const time = new Date().toLocaleTimeString();
  const payload = data ? `\n${JSON.stringify(redactForLog(data), null, 2)}` : "";
  elements.log.textContent = `[${time}] ${message}${payload}\n\n${elements.log.textContent}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(operatorToken ? { "X-Operator-Token": operatorToken } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${api}${path}`, {
    ...options,
    headers,
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.detail?.message || data?.detail || "Erro na requisicao");
  }

  return data;
}

function withOperatorToken(url) {
  if (!operatorToken) {
    return url;
  }

  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(operatorToken)}`;
}

function setBusy(button, busy) {
  if (!button) {
    return;
  }

  button.disabled = busy;
}

function selectedCameraId() {
  return elements.cameraSelect.value;
}

function setApiStatus(status, message) {
  elements.apiStatus.className = `status-pill status-${status}`;
  elements.apiStatus.textContent = message;
}

function setCameraStatus(status, message) {
  elements.cameraStatus.innerHTML = `
    <strong>Status da camera</strong>
    <span class="status-${escapeHtml(status)}">${escapeHtml(message)}</span>
  `;
}

function setRecorderStatus(status, message) {
  elements.recorderStatus.innerHTML = `
    <strong>Status do buffer</strong>
    <span class="status-${escapeHtml(status)}">${escapeHtml(message)}</span>
  `;
}

async function checkHealth() {
  try {
    const data = await request("/health");
    setApiStatus("online", "API online");
    log("API online", data);
  } catch (error) {
    setApiStatus("offline", "API offline");
    log("Erro ao conectar na API", { error: error.message });
  }
}

async function loadCameras() {
  setBusy(elements.reloadCamerasBtn, true);
  try {
    const cameras = await request("/cameras");
    elements.cameraSelect.innerHTML = "";

    if (!cameras.length) {
      elements.cameraSelect.innerHTML = '<option value="">Nenhuma camera cadastrada</option>';
      setCameraStatus("offline", "Cadastre uma camera no painel Cameras.");
      return;
    }

    cameras.forEach((camera) => {
      const option = document.createElement("option");
      option.value = camera.id;
      option.textContent = `${camera.name} (${camera.status || "unknown"})`;
      elements.cameraSelect.appendChild(option);
    });

    setCameraStatus(cameras[0].status || "unknown", `Camera selecionada: ${cameras[0].name}`);
    log("Cameras carregadas", cameras);
    await pollRecorderStatus();
  } catch (error) {
    setCameraStatus("error", "Nao foi possivel carregar as cameras.");
    log("Erro ao carregar cameras", { error: error.message });
  } finally {
    setBusy(elements.reloadCamerasBtn, false);
  }
}

async function testCamera() {
  const cameraId = selectedCameraId();
  if (!cameraId) {
    setCameraStatus("offline", "Selecione uma camera cadastrada.");
    return;
  }

  setBusy(elements.testCameraBtn, true);
  setCameraStatus("connecting", "Conectando na camera...");
  elements.snapshotPanel.classList.add("hidden");

  try {
    const data = await request(`/cameras/${encodeURIComponent(cameraId)}/test`, {
      method: "POST",
    });
    const status = data.ok ? "online" : data.status || "offline";
    setCameraStatus(status, data.message || "Teste finalizado.");

    if (data.snapshot_url) {
      elements.snapshotImage.src = withOperatorToken(`${data.snapshot_url}&view=${Date.now()}`);
      elements.snapshotPanel.classList.remove("hidden");
    }

    log(data.ok ? "Camera online" : "Camera offline", data);
  } catch (error) {
    setCameraStatus("error", "Erro ao testar a camera.");
    log("Erro ao testar camera", { error: error.message });
  } finally {
    setBusy(elements.testCameraBtn, false);
  }
}

async function startRecorder() {
  const cameraId = selectedCameraId();
  if (!cameraId) {
    setRecorderStatus("offline", "Selecione uma camera.");
    return;
  }

  setBusy(elements.startRecorderBtn, true);
  setRecorderStatus("connecting", "Iniciando buffer...");

  try {
    const data = await request(`/recorders/${encodeURIComponent(cameraId)}/start`, {
      method: "POST",
    });
    renderRecorderState(data);
    log("Buffer iniciado", data);
  } catch (error) {
    setRecorderStatus("error", "Erro ao iniciar buffer.");
    log("Erro ao iniciar buffer", { error: error.message });
  } finally {
    setBusy(elements.startRecorderBtn, false);
  }
}

async function stopRecorder() {
  const cameraId = selectedCameraId();
  if (!cameraId) {
    return;
  }

  setBusy(elements.stopRecorderBtn, true);
  try {
    const data = await request(`/recorders/${encodeURIComponent(cameraId)}/stop`, {
      method: "POST",
    });
    renderRecorderState(data);
    log("Buffer parado", data);
  } catch (error) {
    setRecorderStatus("error", "Erro ao parar buffer.");
    log("Erro ao parar buffer", { error: error.message });
  } finally {
    setBusy(elements.stopRecorderBtn, false);
  }
}

function renderRecorderState(data) {
  const status = data?.status || (data?.running ? "recording" : "offline");
  const message = data?.last_message || data?.message || "Status atualizado.";
  setRecorderStatus(status, message);
}

async function pollRecorderStatus() {
  const cameraId = selectedCameraId();
  if (!cameraId) {
    return;
  }

  try {
    const statuses = await request("/recorders/status");
    const status = statuses[cameraId];
    if (status) {
      renderRecorderState(status);
    } else {
      setRecorderStatus("offline", "Nenhum buffer ativo para esta camera.");
    }
  } catch (error) {
    setRecorderStatus("error", "Status do buffer indisponivel.");
  }
}

async function createReplay15() {
  const cameraId = selectedCameraId();
  if (!cameraId) {
    return;
  }

  setBusy(elements.replay15Btn, true);
  elements.replayResult.classList.remove("hidden");
  elements.replayResult.innerHTML = "<strong>Gerando replay...</strong><span>Aguarde o MP4 ser processado.</span>";

  try {
    const label = elements.replayLabel.value.trim() || null;
    const data = await request("/replay", {
      method: "POST",
      body: JSON.stringify({
        camera_id: cameraId,
        seconds: replaySeconds,
        label,
      }),
    });

    renderReplayResult(data);
    log(data.ok ? "Replay enviado para a home" : "Replay nao gerado", data);
    await loadReplays();
  } catch (error) {
    elements.replayResult.innerHTML = `<strong>Replay nao gerado</strong><span>${escapeHtml(
      error.message,
    )}</span>`;
    log("Erro ao gerar replay", { error: error.message });
  } finally {
    setBusy(elements.replay15Btn, false);
  }
}

function renderReplayResult(data) {
  if (!data?.ok || !data.file_name) {
    elements.replayResult.innerHTML = `<strong>Replay nao gerado</strong><span>${escapeHtml(
      data?.message || "Inicie o buffer e tente novamente.",
    )}</span>`;
    return;
  }

  const url = data.video_url || data.download_url;
  elements.replayResult.innerHTML = `
    <strong>Replay publicado na home</strong>
    <span>${escapeHtml(data.file_name)}</span>
    <a href="/" class="button-link secondary">Abrir home</a>
    <a href="${escapeHtml(url)}" class="button-link" target="_blank" rel="noreferrer">Visualizar MP4</a>
  `;
}

async function loadReplays() {
  try {
    const replays = await request("/replays");
    const readyReplays = replays.filter((replay) => replay.status === "ready" && replay.video_url);

    if (!readyReplays.length) {
      elements.replays.innerHTML = '<p class="muted">Nenhum replay pronto ainda.</p>';
      return;
    }

    elements.replays.innerHTML = readyReplays
      .slice(0, 5)
      .map((replay) => {
        const createdAt = new Date(replay.created_at).toLocaleString("pt-BR");
        const url = replay.video_url || replay.download_url;
        return `
          <div class="replay-item">
            <strong>${escapeHtml(replay.title)}</strong>
            <small>${escapeHtml(replay.camera_name)} - ${replay.duration}s - ${createdAt}</small>
            <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Visualizar</a>
          </div>
        `;
      })
      .join("");
  } catch (error) {
    elements.replays.innerHTML = '<p class="muted">Nao foi possivel carregar replays.</p>';
  }
}

function bindEvents() {
  elements.reloadCamerasBtn.addEventListener("click", loadCameras);
  elements.testCameraBtn.addEventListener("click", testCamera);
  elements.startRecorderBtn.addEventListener("click", startRecorder);
  elements.stopRecorderBtn.addEventListener("click", stopRecorder);
  elements.replay15Btn.addEventListener("click", createReplay15);
  elements.cameraSelect.addEventListener("change", pollRecorderStatus);
}

async function init() {
  bindEvents();
  if (operatorToken) {
    log("Token de operador configurado no navegador");
  }
  await checkHealth();
  await loadCameras();
  await loadReplays();
  window.setInterval(pollRecorderStatus, 8000);
  window.setInterval(loadReplays, 15000);
}

window.addEventListener("error", (event) => {
  log("Erro de JavaScript", { error: event.message });
});

window.addEventListener("unhandledrejection", (event) => {
  log("Erro assincrono", { error: String(event.reason) });
});

init();
