const api = "/api";
let currentPreviewCameraId = null;

function log(message, data = null) {
  const logEl = document.getElementById("log");
  if (!logEl) {
    console.log(message, data);
    return;
  }

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
      log("Nenhuma camera cadastrada");
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
          <button type="button" data-action="test">Testar câmera</button>
          <button type="button" data-action="preview">Visualizar</button>
          <button type="button" class="danger" data-action="delete">Remover</button>
        </div>
      `;

      item.querySelector('[data-action="edit"]').addEventListener("click", () => fillCameraForm(camera));
      item.querySelector('[data-action="test"]').addEventListener("click", () => testCamera(camera.id));
      item.querySelector('[data-action="preview"]').addEventListener("click", () => openCameraPreview(camera));
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
    log(data.ok ? "Camera testada com sucesso" : "Camera nao respondeu", data);
    return data;
  } catch (error) {
    const data = { ok: false, error: error.message };
    log("Erro ao testar camera", data);
    return data;
  }
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
    placeholder.textContent = result.message || result.error || "Nao foi possivel visualizar a camera.";
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
  image.src = `/api/cameras/${encodeURIComponent(currentPreviewCameraId)}/snapshot?ts=${Date.now()}`;
  log("Snapshot da camera solicitado", { camera_id: currentPreviewCameraId });
}

function closeCameraPreview() {
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

function initAdminPanel() {
  log("Painel admin carregado");
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
