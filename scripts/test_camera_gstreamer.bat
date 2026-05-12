@echo off
echo Cole o link RTSP da camera:
set /p RTSP_URL=
gst-launch-1.0 rtspsrc location="%RTSP_URL%" latency=100 ! decodebin ! autovideosink
