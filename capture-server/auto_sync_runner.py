import json
import os
import signal
import subprocess
import time
from pathlib import Path

import requests


ENV_PATH = Path(".env")
CAPTURE_SCRIPT = Path("capture_server.py")
SYNC_INTERVAL_SECONDS = int(os.getenv("AUTO_SYNC_INTERVAL_SECONDS", "8"))


def load_env(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    if not path.exists():
        return data
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip().strip('"').strip("'")
    return data


def save_env(path: Path, values: dict[str, str]) -> None:
    lines = [f"{key}={values[key]}" for key in sorted(values.keys())]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def resolve_install(api_url: str, install_key: str) -> dict | None:
    url = f"{api_url.rstrip('/')}/install/resolve"
    payload = {"install_key": install_key.strip().upper()}
    response = requests.post(url, json=payload, timeout=20)
    if response.status_code >= 400:
        return None
    data = response.json()
    if not data.get("ok"):
        return None
    return data


def choose_camera(resolve_data: dict, preferred_camera_id: str) -> dict | None:
    cameras = resolve_data.get("cameras") or []
    if not cameras:
        return None
    if preferred_camera_id:
        match = next((camera for camera in cameras if camera.get("id") == preferred_camera_id), None)
        if match:
            return match
    ready = next((camera for camera in cameras if camera.get("has_rtsp")), None)
    return ready or cameras[0]


def build_synced_env(current: dict[str, str], resolve_data: dict, camera: dict) -> dict[str, str]:
    next_env = dict(current)
    capture = resolve_data.get("capture") or {}
    client = resolve_data.get("client") or {}

    next_env["BACKEND_API_URL"] = current.get("BACKEND_API_URL") or "https://sertao-replay.onrender.com/api"
    next_env["OPERATOR_TOKEN"] = capture.get("operator_token") or current.get("OPERATOR_TOKEN", "")
    next_env["CLIENT_ID"] = capture.get("client_id") or client.get("id") or current.get("CLIENT_ID", "")
    next_env["CLIENT_SLUG"] = capture.get("client_slug") or client.get("slug") or current.get("CLIENT_SLUG", "")
    next_env["CAMERA_ID"] = camera.get("id") or current.get("CAMERA_ID", "")
    next_env["CAMERA_NAME"] = camera.get("name") or current.get("CAMERA_NAME", "")
    if "LOCAL_RTSP_URL" not in next_env:
        next_env["LOCAL_RTSP_URL"] = ""
    if "RTSP_TRANSPORT" not in next_env:
        next_env["RTSP_TRANSPORT"] = "tcp"
    if "BUFFER_VIDEO_CODEC" not in next_env:
        next_env["BUFFER_VIDEO_CODEC"] = "libx264"
    if "BUFFER_FPS" not in next_env:
        next_env["BUFFER_FPS"] = "30"
    if "REPLAY_VIDEO_CODEC" not in next_env:
        next_env["REPLAY_VIDEO_CODEC"] = "libx264"
    if "REPLAY_AUDIO_CODEC" not in next_env:
        next_env["REPLAY_AUDIO_CODEC"] = "aac"
    if "ENABLE_REPLAY_AUDIO" not in next_env:
        next_env["ENABLE_REPLAY_AUDIO"] = "true"
    if "FAST_REPLAY_COPY" not in next_env:
        next_env["FAST_REPLAY_COPY"] = "false"
    if "SEGMENT_TIME_SECONDS" not in next_env:
        next_env["SEGMENT_TIME_SECONDS"] = "2"
    if "SEGMENT_WRAP_COUNT" not in next_env:
        next_env["SEGMENT_WRAP_COUNT"] = "120"
    if "POLL_INTERVAL_SECONDS" not in next_env:
        next_env["POLL_INTERVAL_SECONDS"] = "1"
    if "SNAPSHOT_INTERVAL_SECONDS" not in next_env:
        next_env["SNAPSHOT_INTERVAL_SECONDS"] = "2"
    return next_env


def env_fingerprint(values: dict[str, str]) -> str:
    tracked = {
        key: values.get(key, "")
        for key in (
            "BACKEND_API_URL",
            "OPERATOR_TOKEN",
            "CLIENT_ID",
            "CLIENT_SLUG",
            "CAMERA_ID",
            "CAMERA_NAME",
            "LOCAL_RTSP_URL",
            "RTSP_TRANSPORT",
        )
    }
    return json.dumps(tracked, sort_keys=True)


def terminate_process(process: subprocess.Popen | None) -> None:
    if not process:
        return
    if process.poll() is not None:
        return
    try:
        process.send_signal(signal.SIGTERM)
        process.wait(timeout=8)
    except Exception:
        process.kill()


def start_capture() -> subprocess.Popen:
    return subprocess.Popen(["python", str(CAPTURE_SCRIPT)], cwd=str(Path.cwd()))


def main() -> None:
    process: subprocess.Popen | None = None
    last_fingerprint = ""

    while True:
        env_values = load_env(ENV_PATH)
        api_url = env_values.get("BACKEND_API_URL", "https://sertao-replay.onrender.com/api")
        install_key = env_values.get("INSTALL_KEY", "").strip()
        preferred_camera_id = env_values.get("AUTO_SYNC_CAMERA_ID", "").strip()

        if install_key:
            try:
                resolved = resolve_install(api_url, install_key)
            except requests.RequestException:
                resolved = None
            if resolved:
                camera = choose_camera(resolved, preferred_camera_id)
                if camera:
                    synced = build_synced_env(env_values, resolved, camera)
                    fingerprint = env_fingerprint(synced)
                    if fingerprint != env_fingerprint(env_values):
                        save_env(ENV_PATH, synced)
                        env_values = synced
                    if fingerprint != last_fingerprint:
                        terminate_process(process)
                        process = None
                        last_fingerprint = fingerprint

        if not env_values.get("CAMERA_ID") or not env_values.get("CLIENT_SLUG"):
            terminate_process(process)
            process = None
            time.sleep(SYNC_INTERVAL_SECONDS)
            continue

        if process is None or process.poll() is not None:
            process = start_capture()

        time.sleep(SYNC_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
