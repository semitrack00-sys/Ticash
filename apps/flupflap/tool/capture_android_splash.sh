#!/usr/bin/env bash
set -euo pipefail
# A fresh, offline emulator. Launch only: never log in or call an API.
apk=$(find android-builds -name app-debug.apk -print -quit)
test -n "$apk"
mkdir -p splash-capture/frames
adb install -r "$apk"
adb shell svc wifi disable || true
adb shell svc data disable || true
# Toggling radios can restart system services on a shared CI emulator and kill
# the adb shell command (exit 137); this is best-effort, so wait and continue.
adb shell cmd connectivity airplane-mode enable || true
adb wait-for-device
sleep 5
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard
adb shell am force-stop com.ticash.flupflap
api=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
# Android 12 can omit the native splash icon for adb/IDE launches. Tap the
# actual launcher entry, as a customer would, using its observed UI bounds.
if (( api >= 31 )); then
adb shell input keyevent KEYCODE_HOME
screen=$(adb shell wm size | tr -d '\r' | tail -1 | awk '{print $NF}')
width=${screen%x*}
height=${screen#*x}
dump_launcher() {
  local try
  for try in 1 2 3 4 5; do
    if adb shell uiautomator dump /sdcard/flupflap-launcher.xml &&
      adb pull /sdcard/flupflap-launcher.xml splash-capture/launcher.xml; then
      return 0
    fi
    echo "uiautomator dump attempt $try/5 failed" >&2
    adb wait-for-device
    sleep 3
  done
  return 1
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
  # Launcher layouts vary across Android emulator images. If the icon is not
  # exposed through UIAutomator, cold-launch the exported launcher activity.
  echo 'FlupFlap launcher entry not exposed; falling back to launcher activity' >&2
  x=''
  y=''
fi
fi
capture_startup() {
  rm -f splash-capture/frames/*.png
  adb shell screenrecord --time-limit 12 /sdcard/flupflap-startup.mp4 &
  record_pid=$!
  sleep 1
  if (( api >= 31 )) && [[ -n "${x:-}" && -n "${y:-}" ]]; then
    adb shell input tap "$x" "$y"
  else
    adb shell am start -W -n com.ticash.flupflap/.MainActivity
  fi
  wait "$record_pid"
  adb pull /sdcard/flupflap-startup.mp4 splash-capture/startup.mp4
  adb exec-out screencap -p > splash-capture/login-native.png
  ffmpeg -y -hide_banner -loglevel error -i splash-capture/startup.mp4 -vf fps=30 splash-capture/frames/%04d.png
  /usr/bin/python3 apps/flupflap/tool/select_splash_frame.py
}
# A cold start on a shared CI emulator can miss the splash window, so retry
# the pre-Android 12 shell launch from a clean process state.
attempts=1
if (( api < 31 )); then
  attempts=3
fi
for attempt in $(seq 1 "$attempts"); do
  if capture_startup; then
    exit 0
  fi
  echo "Splash capture attempt $attempt/$attempts failed" >&2
  adb shell am force-stop com.ticash.flupflap
  adb shell input keyevent KEYCODE_HOME
  sleep 3
done
exit 1
