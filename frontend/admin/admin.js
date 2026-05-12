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
    throw new Error(data?.detail || "Erro na requisicao");
  }

  return data;
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
      return;
    }

    cameras.forEach((camera) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "camera-admin-item";
      item.onclick = () => fillCameraForm(camera);
      item.innerHTML = `
        <strong>${camera.name}</strong>
        <small>${camera.id} - ${camera.enabled ? "ativa" : "inativa"}</small>
        <code>${camera.rtsp_url}</code>
      `;
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
    log("Camera salva", data);
    await loadAdminCameras();
  } catch (error) {
    log("Erro ao salvar camera", { error: error.message });
  }
}

document.getElementById("cameraForm").addEventListener("submit", saveCamera);
checkAdminHealth();
loadAdminCameras();
