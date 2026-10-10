#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 tool/prepare_pwa.py --icons
flutter pub get
flutter build web --release --base-href=/app/ --no-web-resources-cdn --pwa-strategy=none --dart-define=FLUPFLAP_API_BASE_URL=https://ticash-api.onrender.com/api
python3 tool/prepare_pwa.py
