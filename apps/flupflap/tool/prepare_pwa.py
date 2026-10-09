"""Prepare a bounded, public-asset-only PWA cache after flutter build web."""
import hashlib
import json
import re
from pathlib import Path
from PIL import Image, ImageChops, ImageStat
from generate_launcher_icons import square_icon
ROOT = Path(__file__).resolve().parents[1]

def icons():
    target = ROOT / 'web/icons'
    target.mkdir(exist_ok=True)
    source = Image.open(ROOT / 'assets/flupflap-logo.png').convert('RGBA')
    # This wordmark has an opaque white background. Find visible ink, not alpha.
    rgb = Image.new('RGBA', source.size, 'white'); rgb.alpha_composite(source)
    mask = ImageChops.difference(rgb.convert('RGB'), Image.new('RGB', source.size, 'white')).convert('L').point(lambda value: 255 if value > 18 else 0)
    box = mask.getbbox()
    if not box: raise SystemExit('Empty official logo')
    left, top, right, bottom = box
    for x in range(left + (right-left)//8, left + (right-left)//2):
        if ImageStat.Stat(mask.crop((x,top,x+4,bottom))).sum[0] == 0:
            right = x; break
    mark = source.crop((left,top,right,bottom))
    for size in (192, 512):
        square_icon(mark, size).save(target / f'icon-{size}.png', optimize=True)
        masked = Image.new('RGB', (size, size), 'white')
        safe = mark.copy(); safe.thumbnail((round(size*.56), round(size*.56)), Image.Resampling.LANCZOS)
        masked.paste(safe, ((size-safe.width)//2, (size-safe.height)//2), safe)
        masked.save(target / f'icon-maskable-{size}.png', optimize=True)

def prepare():
    output = ROOT / 'build/web'
    assets = sorted(path.relative_to(output).as_posix() for path in output.rglob('*')
        if path.is_file() and (path.name in ('index.html', 'manifest.json', 'pwa.css', 'pwa.js', 'flutter_bootstrap.js', 'main.dart.js')
            or path.relative_to(output).parts[0] in ('assets', 'icons')
            or re.fullmatch(r'canvaskit/(?:chromium/)?canvaskit\.(?:js|wasm)', path.relative_to(output).as_posix()))
        and path.suffix not in ('.map', '.md'))
    if not all(name in assets for name in ('index.html', 'main.dart.js', 'flutter_bootstrap.js')):
        raise SystemExit('Incomplete Flutter web build')
    digest = hashlib.sha256()
    for asset in assets:
        digest.update(asset.encode()); digest.update((output / asset).read_bytes())
    source = (ROOT / 'web/pwa-worker.js').read_text()
    (output / 'pwa-worker.js').write_text(source.replace('__PWA_CACHE__', 'flupflap-pwa-' + digest.hexdigest()[:20]).replace('__PWA_ASSETS__', json.dumps(assets)))
    for path in output.rglob('*.map'): path.unlink()
    # Flutter legacy workers must not compete with the explicit /app/ worker.
    (output / 'flutter_service_worker.js').unlink(missing_ok=True)
    print(f'Prepared PWA: {len(assets)} public assets; auth, API and payment responses are never cached')

if __name__ == '__main__':
    import sys
    icons() if '--icons' in sys.argv else prepare()
