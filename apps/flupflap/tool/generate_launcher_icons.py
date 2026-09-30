from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "flupflap-logo.png"
RES = ROOT / "android" / "app" / "src" / "main" / "res"
SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

def content_mask(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    delta = ImageChops.difference(rgba, white).convert("L")
    delta = delta.point(lambda p: 255 if p > 18 else 0)
    return ImageChops.lighter(alpha.point(lambda p: 255 if p > 18 else 0), delta)

def first_logo_cluster(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    mask = content_mask(rgba)
    bbox = mask.getbbox()
    if not bbox:
        return rgba
    left, top, right, bottom = bbox
    mask_crop = mask.crop((left, top, right, bottom))
    width, height = mask_crop.size
    active = []
    for x in range(width):
        col = mask_crop.crop((x, 0, x + 1, height))
        active.append(ImageStat.Stat(col).sum[0] > 255 * max(2, height * 0.015))
    # The source is a wordmark. Find the first meaningful gap after the icon cluster.
    gap_start = None
    run = 0
    min_gap = max(8, width // 120)
    search_after = max(1, int(width * 0.08))
    for x in range(search_after, width):
        if active[x]:
            run = 0
            gap_start = None
        else:
            if run == 0:
                gap_start = x
            run += 1
            if run >= min_gap and gap_start is not None:
                cut = max(gap_start, int(width * 0.12))
                if cut < int(width * 0.65):
                    right = left + cut
                    break
    crop = rgba.crop((left, top, right, bottom))
    crop_mask = content_mask(crop)
    tight = crop_mask.getbbox()
    return crop.crop(tight) if tight else crop

def square_icon(mark: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    padding = max(4, round(size * 0.12))
    target = size - padding * 2
    mark = mark.copy()
    mark.thumbnail((target, target), Image.Resampling.LANCZOS)
    x = (size - mark.width) // 2
    y = (size - mark.height) // 2
    canvas.alpha_composite(mark, (x, y))
    return canvas.convert("RGB")

def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Missing FlupFlap logo: {SOURCE}")
    image = Image.open(SOURCE)
    mark = first_logo_cluster(image)
    for folder, size in SIZES.items():
        out_dir = RES / folder
        out_dir.mkdir(parents=True, exist_ok=True)
        square_icon(mark, size).save(out_dir / "flupflap_launcher.png", optimize=True)
    play = ROOT / "build" / "branding"
    play.mkdir(parents=True, exist_ok=True)
    square_icon(mark, 512).save(play / "flupflap-play-icon-512.png", optimize=True)
    print("Generated FlupFlap launcher icons from assets/flupflap-logo.png")

if __name__ == "__main__":
    main()
