const api = "/api";

function log(message, data = null) {
  const logEl = document.getElementById("log");
  const time = new Date().toLocaleTimeString();
  const payload = data ? `\n${JSON.stringify(data, null, 2)}` : "";
  logEl.textContent = `[${time}] ${message}${payload}\n\n` + logEl.textContent;
}

async function request(path, options = {}) {
  const response = await fetch(`${api}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.detail || "Erro na requisição");
  }

  return data;
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
    await loadReplays();
  } catch (error) {
    log("Erro ao gerar replay", { error: error.message });
  }
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
        <a href="/api/replays/file/${replay.name}" target="_blank">Abrir replay</a>
      `;
      root.appendChild(item);
    });

    log("Replays carregados", replays);
  } catch (error) {
    log("Erro ao carregar replays", { error: error.message });
  }
}

checkHealth();
loadCameras();
loadReplays();
