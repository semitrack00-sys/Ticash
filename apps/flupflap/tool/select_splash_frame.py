"""Select an unmodified emulator frame, never synthesize a splash screenshot."""
from pathlib import Path
import shutil
from PIL import Image

selected = None
diagnostics = []
seen = set()
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
        metrics = ((right - left) / w, (bottom - top) / h,
                   abs((left + right) / 2 - w / 2) / w,
                   abs((top + bottom) / 2 - h / 2) / h)
        line = (f'F width/height {metrics[0]:.2f}/{metrics[1]:.2f}, '
                f'center offset {metrics[2]:.2f}/{metrics[3]:.2f}, screen {w}x{h}')
        # Frames repeat while the screen is static; report each distinct state once.
        if line not in seen and len(diagnostics) < 10:
            seen.add(line)
            diagnostics.append(f'{path.name}: {line}')
        if not (.2 < metrics[0] < .5 and
                .05 < metrics[1] < .3 and
                metrics[2] < .08 and
                metrics[3] < .1):
            continue
        outside = [image.getpixel((x, y))
                   for y in range(h // 8, h * 7 // 8, 12)
                   for x in range(0, w, 12)
                   if not (left - 12 <= x <= right + 12 and top - 12 <= y <= bottom + 12)]
        white = sum(min(rgb) > 240 for rgb in outside) / len(outside)
        if white < .98:
            note = f'{path.name}: only {white:.2f} white outside the F'
            if len(diagnostics) < 10 and note not in seen:
                seen.add(note)
                diagnostics.append(note)
            continue
        selected = path
        print(f'Native splash frame: {path.name}; F bounds {(left, top, right, bottom)}; screen {w}x{h}')
        break

if selected is None:
    print('\n'.join(diagnostics) or 'No frame contained saturated colored pixels.')
    raise SystemExit('No F-only white native splash frame found; inspect startup.mp4.')
shutil.copyfile(selected, 'splash-capture/splash-native.png')
