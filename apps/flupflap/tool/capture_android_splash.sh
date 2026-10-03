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
# Android 12 can omit the native splash icon for adb/IDE launches. Tap the
# actual launcher entry, as a customer would, using its observed UI bounds.
adb shell input keyevent KEYCODE_HOME
screen=$(adb shell wm size | tr -d '\r' | tail -1 | awk '{print $NF}')
width=${screen%x*}
height=${screen#*x}
dump_launcher() {
  adb shell uiautomator dump /sdcard/flupflap-launcher.xml
  adb pull /sdcard/flupflap-launcher.xml splash-capture/launcher.xml
}
launcher_point() {
  /usr/bin/python3 - "$1" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET
root = ET.parse('splash-capture/launcher.xml')
for node in root.iter('node'):
    if node.get('text') == sys.argv[1] or node.get('content-desc') == sys.argv[1]:
        left, top, right, bottom = map(int, re.findall(r'\d+', node.attrib['bounds']))
        print((left + right) // 2, (top + bottom) // 2)
        break
else:
    raise SystemExit(1)
PY
}
dump_launcher
if read -r x y < <(launcher_point 'Apps list'); then
  adb shell input tap "$x" "$y"
else
  # Start above the dock/search bar so it cannot consume the upward gesture.
  adb shell input swipe "$((width / 2))" "$((height * 7 / 10))" "$((width / 2))" "$((height / 4))" 500
fi
dump_launcher
adb exec-out screencap -p > splash-capture/launcher.png
if ! read -r x y < <(launcher_point FlupFlap); then
  echo 'FlupFlap launcher entry not found; inspect launcher.xml/png' >&2
  exit 1
fi
adb shell screenrecord --time-limit 12 /sdcard/flupflap-startup.mp4 &
record_pid=$!
sleep 1
adb shell input tap "$x" "$y"
wait "$record_pid"
adb pull /sdcard/flupflap-startup.mp4 splash-capture/startup.mp4
adb exec-out screencap -p > splash-capture/login-native.png
ffmpeg -hide_banner -loglevel error -i splash-capture/startup.mp4 -vf fps=20 splash-capture/frames/%04d.png
/usr/bin/python3 apps/flupflap/tool/select_splash_frame.py
