#!/usr/bin/env bash
set -euo pipefail
# A fresh, offline emulator. Launch only: never log in or call an API.
apk=$(find android-builds -name app-debug.apk -print -quit)
test -n "$apk"
mkdir -p splash-capture/frames
adb install -r "$apk"
adb shell svc wifi disable
adb shell svc data disable
adb shell cmd connectivity airplane-mode enable
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard
adb shell am force-stop com.ticash.flupflap
adb shell screenrecord --time-limit 12 /sdcard/flupflap-startup.mp4 &
record_pid=$!
sleep 1
adb shell am start -W -n com.ticash.flupflap/.MainActivity
wait "$record_pid"
adb pull /sdcard/flupflap-startup.mp4 splash-capture/startup.mp4
adb exec-out screencap -p > splash-capture/login-native.png
ffmpeg -hide_banner -loglevel error -i splash-capture/startup.mp4 -vf fps=20 splash-capture/frames/%04d.png
/usr/bin/python3 apps/flupflap/tool/select_splash_frame.py
