from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
from tkinter import BooleanVar, StringVar, messagebox

import customtkinter as ctk
import requests


API_URL = "https://sertao-replay.onrender.com/api"
INSTALL_DIR = Path(os.environ.get("SERTAO_REPLAY_HOME", r"C:\SertaoReplay"))
APP_EXE = INSTALL_DIR / "SertaoReplay.exe"
CAPTURE_DIR = INSTALL_DIR / "capture-server"
ENV_PATH = CAPTURE_DIR / ".env"
STATE_PATH = INSTALL_DIR / "install_state.json"
LOG_DIR = INSTALL_DIR / "logs"
TASK_NAME = "Sertao Replay Capture"

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


def resource_path(relative: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    candidates = [
        base / relative,
        Path(__file__).resolve().parent / relative,
        Path(__file__).resolve().parents[2] / relative,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


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


def copy_self_and_assets() -> None:
    INSTALL_DIR.mkdir(parents=True, exist_ok=True)
    CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    current = Path(sys.executable if getattr(sys, "frozen", False) else __file__).resolve()
    if getattr(sys, "frozen", False) and current != APP_EXE:
        shutil.copy2(current, APP_EXE)
    elif not APP_EXE.exists():
        launcher = INSTALL_DIR / "SertaoReplay-dev.bat"
        launcher.write_text(f'@echo off\npython "{Path(__file__).resolve()}" %*\n', encoding="ascii")


def create_task() -> None:
    executable = APP_EXE if APP_EXE.exists() else INSTALL_DIR / "SertaoReplay-dev.bat"
    command = f'"{executable}" --capture'
    subprocess.run(
        ["schtasks", "/Create", "/TN", TASK_NAME, "/TR", command, "/SC", "ONLOGON", "/RL", "HIGHEST", "/F"],
        check=True,
        capture_output=True,
        text=True,
    )


def delete_task() -> None:
    subprocess.run(["schtasks", "/Delete", "/TN", TASK_NAME, "/F"], capture_output=True, text=True)


def start_capture() -> None:
    executable = APP_EXE if APP_EXE.exists() else Path(sys.executable)
    args = [str(executable), "--capture"] if APP_EXE.exists() else [str(executable), str(Path(__file__).resolve()), "--capture"]
    subprocess.Popen(args, cwd=str(INSTALL_DIR), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


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


class App(ctk.CTk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Sertao Replay - Instalador")
        self.geometry("1040x720")
        self.minsize(940, 660)
        self.configure(fg_color=BG)

        self.resolved: dict | None = None
        self.selected_camera: dict | None = None
        self.camera_vars: list[tuple[BooleanVar, dict]] = []

        self.key_var = StringVar()
        self.status_var = StringVar(value="Informe a chave da empresa para comecar.")
        self.install_status_var = StringVar(value="Aguardando instalacao.")

        self.build_ui()
        self.load_existing_state()

    def build_ui(self) -> None:
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        top = ctk.CTkFrame(self, fg_color=SURFACE, corner_radius=0, border_color=LINE, border_width=1, height=76)
        top.grid(row=0, column=0, sticky="ew")
        top.grid_columnconfigure(1, weight=1)

        logo = ctk.CTkLabel(top, text="S", width=46, height=46, fg_color=NEON, text_color="#102000", corner_radius=23, font=ctk.CTkFont(size=24, weight="bold"))
        logo.grid(row=0, column=0, padx=(28, 14), pady=14)
        ctk.CTkLabel(top, text="Sertao Replay Setup", text_color=NEON, font=ctk.CTkFont(size=25, weight="bold", slant="italic")).grid(row=0, column=1, sticky="w")
        self.small_button(top, "Abrir logs", lambda: open_path(LOG_DIR)).grid(row=0, column=2, padx=24)

        body = ctk.CTkFrame(self, fg_color=BG, corner_radius=0)
        body.grid(row=1, column=0, sticky="nsew", padx=28, pady=24)
        body.grid_columnconfigure((0, 1), weight=1, uniform="cols")
        body.grid_rowconfigure(1, weight=1)

        self.key_card = self.card(body, "1. Chave da empresa")
        self.key_card.grid(row=0, column=0, sticky="nsew", padx=(0, 12), pady=(0, 16))
        ctk.CTkLabel(self.key_card, text="Cole a chave gerada no Super Admin.", text_color=MUTED, anchor="w").pack(fill="x", padx=22)
        ctk.CTkEntry(self.key_card, textvariable=self.key_var, height=48, fg_color="#070b0d", border_color=LINE, text_color=TEXT, placeholder_text="SR-XXXXXXXXXXXXXXXXXXXX", font=ctk.CTkFont(family="Consolas", size=15)).pack(fill="x", padx=22, pady=14)
        self.primary_button(self.key_card, "Validar chave", self.on_validate).pack(anchor="e", padx=22, pady=(0, 18))

        self.company_card = self.card(body, "2. Empresa e camera")
        self.company_card.grid(row=0, column=1, sticky="nsew", padx=(12, 0), pady=(0, 16))
        self.company_content = ctk.CTkFrame(self.company_card, fg_color="transparent")
        self.company_content.pack(fill="both", expand=True, padx=22, pady=(0, 18))
        self.render_company_empty()

        self.install_card = self.card(body, "3. Instalacao local")
        self.install_card.grid(row=1, column=0, sticky="nsew", padx=(0, 12))
        ctk.CTkLabel(self.install_card, textvariable=self.install_status_var, text_color=MUTED, anchor="w", justify="left", wraplength=410).pack(fill="x", padx=22)
        self.primary_button(self.install_card, "Instalar em C:\\SertaoReplay", self.on_install).pack(fill="x", padx=22, pady=12)
        self.secondary_button(self.install_card, "Criar/atualizar inicio automatico", self.on_create_task).pack(fill="x", padx=22, pady=6)
        self.secondary_button(self.install_card, "Remover inicio automatico", self.on_delete_task).pack(fill="x", padx=22, pady=(6, 18))

        self.control_card = self.card(body, "4. Controle do servidor")
        self.control_card.grid(row=1, column=1, sticky="nsew", padx=(12, 0))
        ctk.CTkLabel(self.control_card, textvariable=self.status_var, text_color=MUTED, anchor="w", justify="left", wraplength=410).pack(fill="x", padx=22)
        row = ctk.CTkFrame(self.control_card, fg_color="transparent")
        row.pack(fill="x", padx=22, pady=12)
        row.grid_columnconfigure((0, 1), weight=1)
        self.primary_button(row, "Iniciar", self.on_start).grid(row=0, column=0, sticky="ew", padx=(0, 6))
        self.danger_button(row, "Parar", self.on_stop).grid(row=0, column=1, sticky="ew", padx=(6, 0))
        self.secondary_button(self.control_card, "Atualizar status", self.refresh_status).pack(fill="x", padx=22, pady=6)
        self.secondary_button(self.control_card, "Abrir site publico", self.open_public).pack(fill="x", padx=22, pady=6)
        self.secondary_button(self.control_card, "Abrir admin", self.open_admin).pack(fill="x", padx=22, pady=6)
        self.secondary_button(self.control_card, "Abrir pasta C:\\SertaoReplay", lambda: open_path(INSTALL_DIR)).pack(fill="x", padx=22, pady=(6, 18))

    def card(self, parent: ctk.CTkFrame, title: str) -> ctk.CTkFrame:
        frame = ctk.CTkFrame(parent, fg_color=CARD, corner_radius=8, border_color=LINE, border_width=1)
        ctk.CTkLabel(frame, text=title, text_color=TEXT, font=ctk.CTkFont(size=18, weight="bold"), anchor="w").pack(fill="x", padx=22, pady=(20, 8))
        return frame

    def primary_button(self, parent, text: str, command) -> ctk.CTkButton:
        return ctk.CTkButton(parent, text=text, command=command, fg_color=NEON, hover_color="#8ddc00", text_color="#102000", height=42, corner_radius=999, font=ctk.CTkFont(size=13, weight="bold"))

    def secondary_button(self, parent, text: str, command) -> ctk.CTkButton:
        return ctk.CTkButton(parent, text=text, command=command, fg_color=CARD_DARK, hover_color="#1c2b00", text_color=NEON, border_color=LINE, border_width=1, height=42, corner_radius=999, font=ctk.CTkFont(size=13, weight="bold"))

    def small_button(self, parent, text: str, command) -> ctk.CTkButton:
        return ctk.CTkButton(parent, text=text, command=command, fg_color=CARD_DARK, hover_color="#1c2b00", text_color=NEON, border_color=LINE, border_width=1, height=38, width=120, corner_radius=999)

    def danger_button(self, parent, text: str, command) -> ctk.CTkButton:
        return ctk.CTkButton(parent, text=text, command=command, fg_color="#2b1d1d", hover_color="#452525", text_color=DANGER, border_color="#6d3b36", border_width=1, height=42, corner_radius=999, font=ctk.CTkFont(size=13, weight="bold"))

    def render_company_empty(self) -> None:
        for child in self.company_content.winfo_children():
            child.destroy()
        ctk.CTkLabel(self.company_content, text="Nenhuma empresa carregada.", text_color=MUTED, anchor="w").pack(fill="x")

    def render_company(self) -> None:
        assert self.resolved
        for child in self.company_content.winfo_children():
            child.destroy()
        client = self.resolved["client"]
        ctk.CTkLabel(self.company_content, text=client["name"], text_color=TEXT, font=ctk.CTkFont(size=17, weight="bold"), anchor="w").pack(fill="x")
        ctk.CTkLabel(self.company_content, text=f"Admin: {client.get('admin_email') or 'nao informado'}", text_color=MUTED, anchor="w").pack(fill="x", pady=(4, 10))
        cameras = self.resolved.get("cameras") or []
        if not cameras:
            ctk.CTkLabel(self.company_content, text="Nenhuma camera ativa com RTSP cadastrada no admin.", text_color=DANGER, anchor="w", justify="left", wraplength=410).pack(fill="x")
            return
        self.camera_vars.clear()
        for index, camera in enumerate(cameras):
            var = BooleanVar(value=index == 0)
            self.camera_vars.append((var, camera))
            label = f"{camera['name']} | {camera['id']} | {'RTSP OK' if camera.get('has_rtsp') else 'sem RTSP'}"
            checkbox = ctk.CTkCheckBox(self.company_content, text=label, variable=var, command=lambda selected=camera: self.select_camera(selected), fg_color=NEON, hover_color="#8ddc00", text_color=TEXT, checkbox_width=20, checkbox_height=20)
            checkbox.pack(fill="x", pady=5)
        self.selected_camera = cameras[0]

    def select_camera(self, selected: dict) -> None:
        self.selected_camera = selected
        for var, camera in self.camera_vars:
            var.set(camera["id"] == selected["id"])

    def on_validate(self) -> None:
        key = self.key_var.get().strip()
        if not key:
            messagebox.showwarning("Chave obrigatoria", "Informe a chave da empresa.")
            return

        def work():
            try:
                self.set_status("Validando chave no Render...")
                resolved = resolve_key(key)
                cameras = [camera for camera in resolved.get("cameras", []) if camera.get("has_rtsp")]
                resolved["cameras"] = cameras
                self.resolved = resolved
                self.selected_camera = cameras[0] if cameras else None
                self.after(0, self.render_company)
                self.set_status("Chave validada. Confirme a camera e instale.")
            except Exception as exc:
                self.set_status(f"Erro ao validar chave: {exc}")
                messagebox.showerror("Erro", str(exc))

        threading.Thread(target=work, daemon=True).start()

    def on_install(self) -> None:
        if not self.resolved or not self.selected_camera:
            messagebox.showwarning("Camera obrigatoria", "Valide a chave e confirme uma camera com RTSP OK.")
            return
        if not messagebox.askyesno("Confirmar instalacao", f"Instalar em C:\\SertaoReplay para a camera {self.selected_camera['name']}?"):
            return

        def work():
            try:
                self.set_install_status("Criando arquivos locais...")
                copy_self_and_assets()
                write_env(self.resolved, self.selected_camera)
                write_state(
                    {
                        "install_key": self.key_var.get().strip().upper(),
                        "client": self.resolved["client"],
                        "camera": self.selected_camera,
                        "installed_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                    }
                )
                self.set_install_status("Instalacao local concluida.")
                self.on_create_task(silent=True)
                self.refresh_status()
            except Exception as exc:
                self.set_install_status(f"Erro na instalacao: {exc}")
                messagebox.showerror("Erro", str(exc))

        threading.Thread(target=work, daemon=True).start()

    def on_create_task(self, silent: bool = False) -> None:
        try:
            create_task()
            self.set_install_status("Tarefa de inicio automatico criada/atualizada.")
            if not silent:
                messagebox.showinfo("Tarefa criada", "O servidor local iniciara automaticamente no login do Windows.")
        except Exception as exc:
            self.set_install_status(f"Nao foi possivel criar tarefa: {exc}")
            if not silent:
                messagebox.showerror("Erro", str(exc))

    def on_delete_task(self) -> None:
        delete_task()
        self.set_install_status("Tarefa de inicio automatico removida.")

    def on_start(self) -> None:
        try:
            start_capture()
            self.set_status("Servidor local iniciado. Aguarde alguns segundos e atualize o status.")
        except Exception as exc:
            messagebox.showerror("Erro", str(exc))

    def on_stop(self) -> None:
        stop_capture_processes()
        self.set_status("Servidor local parado.")

    def refresh_status(self) -> None:
        state = read_state()
        client = state.get("client") or (self.resolved or {}).get("client")
        camera = state.get("camera") or self.selected_camera
        if not client or not camera:
            self.set_status("Instalacao ainda nao configurada.")
            return

        def work():
            try:
                headers = {"X-Operator-Token": self.get_operator_token(), "X-Client-Id": client["id"]}
                data = request_json("GET", f"/cameras/{camera['id']}/config", headers=headers)
                self.set_status(f"Cliente: {client['name']}\nCamera: {data['name']}\nStatus: {data.get('status')}\nRTSP cadastrado: {'sim' if data.get('rtsp_url') else 'nao'}")
            except Exception as exc:
                self.set_status(f"Nao foi possivel consultar status: {exc}")

        threading.Thread(target=work, daemon=True).start()

    def get_operator_token(self) -> str:
        if ENV_PATH.exists():
            for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
                if line.startswith("OPERATOR_TOKEN="):
                    return line.split("=", 1)[1]
        return (self.resolved or {}).get("capture", {}).get("operator_token", "")

    def open_public(self) -> None:
        state = read_state()
        url = (state.get("client") or {}).get("public_url") or ((self.resolved or {}).get("client") or {}).get("public_url")
        if url:
            webbrowser.open(url)

    def open_admin(self) -> None:
        state = read_state()
        url = (state.get("client") or {}).get("admin_url") or ((self.resolved or {}).get("client") or {}).get("admin_url")
        if url:
            webbrowser.open(url)

    def set_status(self, value: str) -> None:
        self.after(0, lambda: self.status_var.set(value))

    def set_install_status(self, value: str) -> None:
        self.after(0, lambda: self.install_status_var.set(value))

    def load_existing_state(self) -> None:
        state = read_state()
        if not state:
            return
        self.key_var.set(state.get("install_key", ""))
        self.selected_camera = state.get("camera")
        self.resolved = {"client": state.get("client"), "cameras": [state.get("camera")] if state.get("camera") else [], "capture": {}}
        self.render_company()
        self.refresh_status()


def main() -> None:
    if "--capture" in sys.argv:
        run_capture_mode()
        return
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
