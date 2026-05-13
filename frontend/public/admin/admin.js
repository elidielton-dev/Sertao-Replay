const api = "/api";

function log(message, data = null) {
  const logEl = document.getElementById("log");
  const time = new Date().toLocaleTimeString();
  const payload = data ? `\n${JSON.stringify(data, null, 2)}` : "";
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
      const item = document.createElement("div");
      item.className = "camera-admin-item";
      item.innerHTML = `
        <strong>${escapeHtml(camera.name)}</strong>
        <small>${escapeHtml(camera.id)} - ${camera.enabled ? "ativa" : "inativa"}</small>
        <code>${escapeHtml(camera.rtsp_url)}</code>
        <div class="camera-admin-actions">
          <button type="button" data-action="edit">Editar</button>
          <button type="button" class="danger" data-action="delete">Remover</button>
        </div>
      `;

      item.querySelector('[data-action="edit"]').addEventListener("click", () => fillCameraForm(camera));
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

document.getElementById("cameraForm").addEventListener("submit", saveCamera);
checkAdminHealth();
loadAdminCameras();
