#!/usr/bin/env bash
set -euo pipefail

# Run this on the MediaMTX server, not on the Windows capture machine.
# It opens the OS firewall ports used by WHEP/WebRTC and restarts MediaMTX.

WEBRTC_HTTP_PORT="${WEBRTC_HTTP_PORT:-8889}"
WEBRTC_ICE_PORT="${WEBRTC_ICE_PORT:-8189}"
RTSP_PATH="${1:-camera1}"

echo "Opening MediaMTX WebRTC ports..."
echo "  WHEP/HTTP: tcp/${WEBRTC_HTTP_PORT}"
echo "  ICE media: udp/${WEBRTC_ICE_PORT}"

if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow "${WEBRTC_HTTP_PORT}/tcp"
  sudo ufw allow "${WEBRTC_ICE_PORT}/udp"
fi

if command -v firewall-cmd >/dev/null 2>&1; then
  sudo firewall-cmd --permanent --add-port="${WEBRTC_HTTP_PORT}/tcp"
  sudo firewall-cmd --permanent --add-port="${WEBRTC_ICE_PORT}/udp"
  sudo firewall-cmd --reload
fi

if command -v iptables >/dev/null 2>&1; then
  sudo iptables -C INPUT -p tcp --dport "${WEBRTC_HTTP_PORT}" -j ACCEPT 2>/dev/null || \
    sudo iptables -I INPUT -p tcp --dport "${WEBRTC_HTTP_PORT}" -j ACCEPT
  sudo iptables -C INPUT -p udp --dport "${WEBRTC_ICE_PORT}" -j ACCEPT 2>/dev/null || \
    sudo iptables -I INPUT -p udp --dport "${WEBRTC_ICE_PORT}" -j ACCEPT
fi

if systemctl list-unit-files | grep -q '^mediamtx\.service'; then
  sudo systemctl restart mediamtx
  sudo systemctl --no-pager --full status mediamtx || true
else
  echo "MediaMTX service was not found in systemd. Start/restart MediaMTX manually."
fi

echo
echo "Local WHEP check:"
curl -i --max-time 5 "http://127.0.0.1:${WEBRTC_HTTP_PORT}/${RTSP_PATH}/whep" || true

echo
echo "If this server is on AWS/Oracle/DigitalOcean/etc, also open inbound:"
echo "  tcp/${WEBRTC_HTTP_PORT}"
echo "  udp/${WEBRTC_ICE_PORT}"
echo "in the cloud firewall/security group."
