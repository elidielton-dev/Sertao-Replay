from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
import ctypes
from pathlib import Path
from tkinter import StringVar, messagebox

import customtkinter as ctk
from PIL import Image
import requests


API_URL = os.environ.get("SERTAO_REPLAY_API_URL", "https://sertao-replay.onrender.com/api").rstrip("/")
INSTALL_DIR = Path(os.environ.get("SERTAO_REPLAY_HOME", r"C:\SertaoReplay"))
APP_EXE = INSTALL_DIR / "SertaoReplay.exe"
CAPTURE_DIR = INSTALL_DIR / "capture-server"
ENV_PATH = CAPTURE_DIR / ".env"
STATE_PATH = INSTALL_DIR / "install_state.json"
LOG_DIR = INSTALL_DIR / "logs"
TASK_NAME = os.environ.get("SERTAO_REPLAY_TASK_NAME", "Sertao Replay Capture")
STARTUP_NAME = os.environ.get("SERTAO_REPLAY_STARTUP_NAME", "SertaoReplayCapture")

BG = "#070b0d"
SURFACE = "#101413"
CARD = "#151b19"
CARD_DARK = "#0b100f"
NEON = "#a1fb00"
TEXT = "#f7fbf8"
MUTED = "#c0caad"
LINE = "#36580a"
DANGER = "#ffb4ab"


ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("green")


def is_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def relaunch_as_admin() -> bool:
    if is_admin() or os.environ.get("SERTAO_REPLAY_HOME"):
        return True
    if getattr(sys, "frozen", False):
        executable = sys.executable
        params = " ".join(f'"{arg}"' for arg in sys.argv[1:])
    else:
        executable = sys.executable
        params = " ".join([f'"{Path(__file__).resolve()}"', *[f'"{arg}"' for arg in sys.argv[1:]]])
    result = ctypes.windll.shell32.ShellExecuteW(None, "runas", executable, params, None, 1)
    return result > 32


def resource_path(relative: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    candidates = [
        base / relative,
        base / "assets" / relative,
        Path(__file__).resolve().parent / relative,
        Path(__file__).resolve().parents[1] / "assets" / relative,
        Path(__file__).resolve().parents[2] / relative,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def logo_path() -> Path:
    return resource_path("logo-sertao-replay-nav.png")


def icon_path() -> Path:
    return resource_path("sertao-replay.ico")


def run_capture_mode() -> None:
    CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
    os.chdir(CAPTURE_DIR)
    capture_source = resource_path("capture_server.py")
    if not capture_source.exists():
        capture_source = Path(__file__).resolve().parents[2] / "capture-server" / "capture_server.py"
    if not capture_source.exists():
        raise RuntimeError("capture_server.py nao encontrado no pacote.")
    sys.path.insert(0, str(capture_source.parent))
    namespace = {"__name__": "__main__", "__file__": str(capture_source)}
    code = compile(capture_source.read_text(encoding="utf-8"), str(capture_source), "exec")
    exec(code, namespace)


def read_state() -> dict:
    if not STATE_PATH.exists():
        return {}
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_state(data: dict) -> None:
    INSTALL_DIR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def request_json(method: str, path: str, **kwargs) -> dict | list:
    response = requests.request(method, f"{API_URL}{path}", timeout=30, **kwargs)
    response.raise_for_status()
    return response.json()


def resolve_key(install_key: str) -> dict:
    return request_json("POST", "/install/resolve", json={"install_key": install_key.strip().upper()})


def write_env(resolved: dict, camera: dict) -> None:
    capture = resolved["capture"]
    client = resolved["client"]
    CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
    (INSTALL_DIR / "storage").mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    lines = [
        f"BACKEND_API_URL={API_URL}",
        f"OPERATOR_TOKEN={capture.get('operator_token') or ''}",
        f"CLIENT_ID={capture.get('client_id') or client['id']}",
        f"CLIENT_SLUG={capture.get('client_slug') or client['slug']}",
        f"CAMERA_ID={camera['id']}",
        f"CAMERA_NAME={camera['name']}",
        "LOCAL_RTSP_URL=",
        f"OPERATOR_URL={capture.get('operator_url') or client['public_url']}",
        "RTSP_TRANSPORT=auto",
        "BUFFER_VIDEO_CODEC=libx264",
        "BUFFER_FPS=30",
        "DEFAULT_REPLAY_SECONDS=15",
        "REPLAY_VIDEO_CODEC=libx264",
        "FAST_REPLAY_COPY=true",
        "SEGMENT_TIME_SECONDS=1",
        "SEGMENT_WRAP_COUNT=120",
        "POLL_INTERVAL_SECONDS=1",
        "SNAPSHOT_INTERVAL_SECONDS=2",
        f"STORAGE_ROOT={INSTALL_DIR / 'storage'}",
    ]
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def copy_self() -> None:
    try:
        INSTALL_DIR.mkdir(parents=True, exist_ok=True)
        CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
        LOG_DIR.mkdir(parents=True, exist_ok=True)
    except PermissionError as exc:
        raise RuntimeError("Acesso negado ao criar C:\\SertaoReplay. Abra o instalador como administrador.") from exc
    current = Path(sys.executable if getattr(sys, "frozen", False) else __file__).resolve()
    try:
        if getattr(sys, "frozen", False) and current != APP_EXE:
            shutil.copy2(current, APP_EXE)
        elif not APP_EXE.exists():
            launcher = INSTALL_DIR / "SertaoReplay-dev.bat"
            launcher.write_text(f'@echo off\npython "{Path(__file__).resolve()}" %*\n', encoding="ascii")
    except PermissionError as exc:
        raise RuntimeError("Acesso negado ao copiar o servidor para C:\\SertaoReplay. Abra o instalador como administrador.") from exc


def create_task() -> None:
    executable = APP_EXE if APP_EXE.exists() else INSTALL_DIR / "SertaoReplay-dev.bat"
    command = f'"{executable}" --capture'
    base = ["schtasks", "/Create", "/TN", TASK_NAME, "/TR", command, "/SC", "ONLOGON", "/F"]
    elevated = subprocess.run(base[:-1] + ["/RL", "HIGHEST", "/F"], capture_output=True, text=True)
    if elevated.returncode == 0:
        return
    fallback = subprocess.run(base, capture_output=True, text=True)
    if fallback.returncode != 0:
        create_startup_launcher(command)


def startup_launcher_path() -> Path:
    startup_dir = Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
    return startup_dir / f"{STARTUP_NAME}.bat"


def create_startup_launcher(command: str) -> None:
    path = startup_launcher_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"@echo off\nstart \"\" {command}\n", encoding="ascii")


def delete_task() -> None:
    subprocess.run(["schtasks", "/Delete", "/TN", TASK_NAME, "/F"], capture_output=True, text=True)
    startup_launcher_path().unlink(missing_ok=True)


def start_capture() -> None:
    executable = APP_EXE if APP_EXE.exists() else Path(sys.executable)
    args = [str(executable), "--capture"] if APP_EXE.exists() else [str(executable), str(Path(__file__).resolve()), "--capture"]
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_file = (LOG_DIR / "capture-launch.log").open("ab")
    subprocess.Popen(args, cwd=str(INSTALL_DIR), stdout=log_file, stderr=log_file)


def stop_capture_processes() -> None:
    ps = (
        "Get-CimInstance Win32_Process | "
        "Where-Object { $_.CommandLine -like '*SertaoReplay*--capture*' -or $_.CommandLine -like '*main.py*--capture*' } | "
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True)


def open_path(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    os.startfile(str(path))  # type: ignore[attr-defined]


class StepWindow(ctk.CTk):
    def __init__(self, title: str) -> None:
        super().__init__()
        self.title(title)
        self.geometry("860x560")
        self.minsize(780, 520)
        self.configure(fg_color=BG)
        icon = icon_path()
        if icon.exists():
            try:
                self.iconbitmap(str(icon))
            except Exception:
                pass
        self.logo_image = self.load_logo()
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)
        self.header()

    def load_logo(self):
        path = logo_path()
        if not path.exists():
            return None
        image = Image.open(path)
        return ctk.CTkImage(light_image=image, dark_image=image, size=(226, 48))

    def header(self) -> None:
        top = ctk.CTkFrame(self, fg_color=SURFACE, corner_radius=0, border_color=LINE, border_width=1, height=78)
        top.grid(row=0, column=0, sticky="ew")
        top.grid_columnconfigure(0, weight=1)
        if self.logo_image:
            ctk.CTkLabel(top, image=self.logo_image, text="").grid(row=0, column=0, padx=26, pady=14, sticky="w")
        else:
            ctk.CTkLabel(top, text="Sertao Replay", text_color=NEON, font=ctk.CTkFont(size=25, weight="bold", slant="italic")).grid(row=0, column=0, padx=26, pady=18, sticky="w")

    def card(self, title: str) -> ctk.CTkFrame:
        frame = ctk.CTkFrame(self, fg_color=CARD, corner_radius=10, border_color=LINE, border_width=1)
        frame.grid(row=1, column=0, sticky="nsew", padx=34, pady=28)
        frame.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(frame, text=title, text_color=TEXT, font=ctk.CTkFont(size=24, weight="bold"), anchor="w").grid(row=0, column=0, sticky="ew", padx=28, pady=(26, 8))
        return frame

    def primary(self, parent, text: str, command) -> ctk.CTkButton:
        return ctk.CTkButton(parent, text=text, command=command, fg_color=NEON, hover_color="#8ddc00", text_color="#102000", height=46, corner_radius=999, font=ctk.CTkFont(size=14, weight="bold"))

    def secondary(self, parent, text: str, command) -> ctk.CTkButton:
        return ctk.CTkButton(parent, text=text, command=command, fg_color=CARD_DARK, hover_color="#1c2b00", text_color=NEON, border_color=LINE, border_width=1, height=44, corner_radius=999, font=ctk.CTkFont(size=13, weight="bold"))

    def danger(self, parent, text: str, command) -> ctk.CTkButton:
        return ctk.CTkButton(parent, text=text, command=command, fg_color="#2b1d1d", hover_color="#452525", text_color=DANGER, border_color="#6d3b36", border_width=1, height=44, corner_radius=999, font=ctk.CTkFont(size=13, weight="bold"))


class KeyWindow(StepWindow):
    def __init__(self) -> None:
        super().__init__("Sertao Replay - Chave da empresa")
        self.key_var = StringVar()
        self.status_var = StringVar(value="Cole a chave gerada no Super Admin.")
        box = self.card("1. Chave da empresa")
        ctk.CTkLabel(box, textvariable=self.status_var, text_color=MUTED, anchor="w").grid(row=1, column=0, sticky="ew", padx=28, pady=(0, 14))
        ctk.CTkEntry(box, textvariable=self.key_var, height=52, fg_color="#070b0d", border_color=LINE, text_color=TEXT, placeholder_text="SR-XXXXXXXXXXXXXXXXXXXX", font=ctk.CTkFont(family="Consolas", size=16)).grid(row=2, column=0, sticky="ew", padx=28, pady=(0, 18))
        self.primary(box, "Validar chave", self.validate_key).grid(row=3, column=0, sticky="e", padx=28, pady=(0, 28))

    def validate_key(self) -> None:
        key = self.key_var.get().strip()
        if not key:
            messagebox.showwarning("Chave obrigatoria", "Informe a chave da empresa.")
            return

        def work():
            try:
                self.after(0, lambda: self.status_var.set("Validando chave no Render..."))
                resolved = resolve_key(key)
                cameras = [camera for camera in resolved.get("cameras", []) if camera.get("has_rtsp")]
                resolved["cameras"] = cameras
                if not cameras:
                    raise RuntimeError("Nenhuma camera ativa com RTSP OK cadastrada no admin deste cliente.")
                self.after(0, lambda: self.next_window(resolved, key))
            except Exception as exc:
                self.after(0, lambda: self.status_var.set(f"Erro: {exc}"))
                self.after(0, lambda: messagebox.showerror("Erro", str(exc)))

        threading.Thread(target=work, daemon=True).start()

    def next_window(self, resolved: dict, key: str) -> None:
        self.destroy()
        CameraWindow(resolved, key).mainloop()


class CameraWindow(StepWindow):
    def __init__(self, resolved: dict, key: str) -> None:
        super().__init__("Sertao Replay - Camera")
        self.resolved = resolved
        self.key = key
        self.selected = resolved["cameras"][0]
        box = self.card("2. Confirmar camera")
        client = resolved["client"]
        ctk.CTkLabel(box, text=client["name"], text_color=TEXT, font=ctk.CTkFont(size=20, weight="bold"), anchor="w").grid(row=1, column=0, sticky="ew", padx=28)
        ctk.CTkLabel(box, text=f"Admin: {client.get('admin_email') or 'nao informado'}\nSite: {client['public_url']}", text_color=MUTED, anchor="w", justify="left").grid(row=2, column=0, sticky="ew", padx=28, pady=(6, 18))
        self.camera_menu = ctk.CTkOptionMenu(
            box,
            values=[f"{camera['name']} | {camera['id']}" for camera in resolved["cameras"]],
            command=self.select_camera,
            fg_color="#070b0d",
            button_color=NEON,
            button_hover_color="#8ddc00",
            text_color=TEXT,
            height=48,
        )
        self.camera_menu.grid(row=3, column=0, sticky="ew", padx=28, pady=(0, 14))
        ctk.CTkLabel(box, text="A camera e o RTSP foram puxados do admin. O instalador nao pede dados tecnicos.", text_color=MUTED, anchor="w", justify="left").grid(row=4, column=0, sticky="ew", padx=28, pady=(0, 18))
        self.primary(box, "Confirmar camera", self.next_window).grid(row=5, column=0, sticky="e", padx=28, pady=(0, 28))

    def select_camera(self, label: str) -> None:
        index = [f"{camera['name']} | {camera['id']}" for camera in self.resolved["cameras"]].index(label)
        self.selected = self.resolved["cameras"][index]

    def next_window(self) -> None:
        self.destroy()
        InstallWindow(self.resolved, self.key, self.selected).mainloop()


class InstallWindow(StepWindow):
    def __init__(self, resolved: dict, key: str, camera: dict) -> None:
        super().__init__("Sertao Replay - Instalando")
        self.resolved = resolved
        self.key = key
        self.camera = camera
        self.status_var = StringVar(value="Pronto para instalar em C:\\SertaoReplay.")
        box = self.card("3. Instalar servidor local")
        ctk.CTkLabel(box, text=f"Cliente: {resolved['client']['name']}\nCamera: {camera['name']}\nDestino: C:\\SertaoReplay", text_color=MUTED, anchor="w", justify="left").grid(row=1, column=0, sticky="ew", padx=28, pady=(0, 18))
        ctk.CTkLabel(box, textvariable=self.status_var, text_color=TEXT, anchor="w", justify="left").grid(row=2, column=0, sticky="ew", padx=28, pady=(0, 18))
        self.primary(box, "Instalar agora", self.install).grid(row=3, column=0, sticky="e", padx=28, pady=(0, 28))

    def install(self) -> None:
        def work():
            try:
                self.set_status("Criando pasta C:\\SertaoReplay...")
                copy_self()
                self.set_status("Gerando configuracao local...")
                write_env(self.resolved, self.camera)
                write_state(
                    {
                        "install_key": self.key.strip().upper(),
                        "client": self.resolved["client"],
                        "camera": self.camera,
                        "installed_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                    }
                )
                self.set_status("Criando tarefa agendada do Windows...")
                create_task()
                self.set_status("Iniciando servidor local...")
                start_capture()
                self.set_status("Instalacao concluida.")
                time.sleep(0.5)
                self.after(0, self.next_window)
            except Exception as exc:
                self.set_status(f"Erro: {exc}")
                self.after(0, lambda: messagebox.showerror("Erro", str(exc)))

        threading.Thread(target=work, daemon=True).start()

    def set_status(self, value: str) -> None:
        self.after(0, lambda: self.status_var.set(value))

    def next_window(self) -> None:
        self.destroy()
        FinalWindow().mainloop()


class FinalWindow(StepWindow):
    def __init__(self) -> None:
        super().__init__("Sertao Replay - Controle local")
        self.status_var = StringVar(value="Instalacao concluida. Use os controles abaixo.")
        box = self.card("4. Controle local")
        state = read_state()
        client = state.get("client", {})
        camera = state.get("camera", {})
        ctk.CTkLabel(box, text=f"Cliente: {client.get('name', '-')}\nCamera: {camera.get('name', '-')}\nPasta: C:\\SertaoReplay", text_color=MUTED, anchor="w", justify="left").grid(row=1, column=0, sticky="ew", padx=28, pady=(0, 16))
        ctk.CTkLabel(box, textvariable=self.status_var, text_color=TEXT, anchor="w", justify="left").grid(row=2, column=0, sticky="ew", padx=28, pady=(0, 18))
        actions = ctk.CTkFrame(box, fg_color="transparent")
        actions.grid(row=3, column=0, sticky="ew", padx=28, pady=(0, 16))
        actions.grid_columnconfigure((0, 1), weight=1)
        self.primary(actions, "Iniciar servidor", self.start).grid(row=0, column=0, sticky="ew", padx=(0, 8), pady=6)
        self.danger(actions, "Parar servidor", self.stop).grid(row=0, column=1, sticky="ew", padx=(8, 0), pady=6)
        self.secondary(actions, "Atualizar status", self.refresh_status).grid(row=1, column=0, sticky="ew", padx=(0, 8), pady=6)
        self.secondary(actions, "Abrir logs", lambda: open_path(LOG_DIR)).grid(row=1, column=1, sticky="ew", padx=(8, 0), pady=6)
        self.secondary(actions, "Abrir site publico", self.open_public).grid(row=2, column=0, sticky="ew", padx=(0, 8), pady=6)
        self.secondary(actions, "Abrir admin", self.open_admin).grid(row=2, column=1, sticky="ew", padx=(8, 0), pady=6)

    def start(self) -> None:
        start_capture()
        self.status_var.set("Servidor iniciado. Aguarde alguns segundos e atualize o status.")

    def stop(self) -> None:
        stop_capture_processes()
        self.status_var.set("Servidor parado.")

    def refresh_status(self) -> None:
        state = read_state()
        client = state.get("client")
        camera = state.get("camera")
        if not client or not camera:
            self.status_var.set("Instalacao nao encontrada.")
            return

        def work():
            try:
                token = ""
                if ENV_PATH.exists():
                    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
                        if line.startswith("OPERATOR_TOKEN="):
                            token = line.split("=", 1)[1]
                data = request_json("GET", f"/cameras/{camera['id']}/config", headers={"X-Operator-Token": token, "X-Client-Id": client["id"]})
                self.after(0, lambda: self.status_var.set(f"Status: {data.get('status')}\nRTSP cadastrado: {'sim' if data.get('rtsp_url') else 'nao'}"))
            except Exception as exc:
                self.after(0, lambda: self.status_var.set(f"Erro ao consultar status: {exc}"))

        threading.Thread(target=work, daemon=True).start()

    def open_public(self) -> None:
        url = (read_state().get("client") or {}).get("public_url")
        if url:
            webbrowser.open(url)

    def open_admin(self) -> None:
        url = (read_state().get("client") or {}).get("admin_url")
        if url:
            webbrowser.open(url)


def main() -> None:
    if "--capture" in sys.argv:
        run_capture_mode()
        return
    if not relaunch_as_admin():
        messagebox.showerror("Permissao necessaria", "Para instalar em C:\\SertaoReplay, confirme a permissao de administrador do Windows.")
        return
    if not is_admin() and not os.environ.get("SERTAO_REPLAY_HOME"):
        return
    if read_state():
        FinalWindow().mainloop()
    else:
        KeyWindow().mainloop()


if __name__ == "__main__":
    main()
