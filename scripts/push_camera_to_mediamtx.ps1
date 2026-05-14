param(
    [string]$LocalCameraUrl = "",
    [string]$ServerRtspUrl = "rtsp://54.207.185.74:8554/camera1"
)

if ([string]::IsNullOrWhiteSpace($LocalCameraUrl)) {
    $LocalCameraUrl = Read-Host "Cole a URL RTSP da camera local"
}

Write-Host "Enviando camera local para MediaMTX..."
Write-Host "Origem:  $LocalCameraUrl"
Write-Host "Destino: $ServerRtspUrl"

ffmpeg `
    -hide_banner `
    -loglevel info `
    -rtsp_transport udp `
    -fflags +genpts+discardcorrupt `
    -err_detect ignore_err `
    -use_wallclock_as_timestamps 1 `
    -i $LocalCameraUrl `
    -an `
    -vf "scale=1280:-2,fps=15" `
    -c:v libx264 `
    -preset ultrafast `
    -tune zerolatency `
    -pix_fmt yuv420p `
    -g 30 `
    -b:v 2500k `
    -maxrate 2500k `
    -bufsize 5000k `
    -f rtsp `
    -rtsp_transport tcp `
    $ServerRtspUrl
