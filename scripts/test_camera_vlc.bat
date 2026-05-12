@echo off
echo Cole o link RTSP da camera:
set /p RTSP_URL=
vlc %RTSP_URL%
