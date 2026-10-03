"""Select an unmodified emulator frame, never synthesize a splash screenshot."""
from pathlib import Path
import shutil
from PIL import Image

selected = None
for path in sorted(Path('splash-capture/frames').glob('*.png')):
    with Image.open(path) as source:
        image = source.convert('RGB')
        w, h = image.size
        colored = []
        for y in range(h // 8, h * 7 // 8, 4):
            for x in range(0, w, 4):
                r, g, b = image.getpixel((x, y))
                if max(r, g, b) - min(r, g, b) > 100:
                    colored.append((x, y))
        if not colored:
            continue
        left = min(x for x, y in colored)
        right = max(x for x, y in colored)
        top = min(y for x, y in colored)
        bottom = max(y for x, y in colored)
        # A single small, centered F. Login controls/wordmark cannot satisfy this.
        if not (.25 < (right - left) / w < .42 and
                .07 < (bottom - top) / h < .25 and
                abs((left + right) / 2 - w / 2) < w * .06 and
                abs((top + bottom) / 2 - h / 2) < h * .08):
            continue
        outside = [image.getpixel((x, y))
                   for y in range(h // 8, h * 7 // 8, 12)
                   for x in range(0, w, 12)
                   if not (left - 12 <= x <= right + 12 and top - 12 <= y <= bottom + 12)]
        if sum(min(rgb) > 245 for rgb in outside) / len(outside) < .99:
            continue
        selected = path
        print(f'Native splash frame: {path.name}; F bounds {(left, top, right, bottom)}; screen {w}x{h}')
        break

if selected is None:
    raise SystemExit('No F-only white native splash frame found; inspect startup.mp4.')
shutil.copyfile(selected, 'splash-capture/splash-native.png')
