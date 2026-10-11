# The emblem, our logo (tools/icons/concepts/ai-close-noguard.png), cut out of its dark background:
# cropped square around the art, 4x by 4xNomos8kDAT, then matted at 2048 and saved at 1024 as
# tools/icons/emblem.png, the source make-icons.ts draws every icon from. Run with meridian-unreal's
# build/texai venv (torch, spandrel, scipy), which has the upscaler (tools/textures/setup_ai.ps1):
#
#   ..\meridian-unreal\build\texai\.venv\Scripts\python.exe tools\icons\cutout-emblem.py
#
# Then check .cutout/<name>-check.png (on light, dark and a checkerboard) and run `npm run icons`.
# Another painting: cutout-emblem.py <painting.png> <out.png> (relative to tools/icons).
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ICONS = Path(__file__).resolve().parent
UNREAL = ICONS.parents[2] / "meridian-unreal"  # beside this repository
sys.path.insert(0, str(UNREAL / "tools" / "textures"))
SCRATCH = Path(__file__).resolve().parent / ".cutout"  # the upscale and the check sheet (git-ignored)
SCRATCH.mkdir(exist_ok=True)

SOURCE = ICONS / (sys.argv[1] if len(sys.argv) > 1 else "concepts/ai-close-noguard.png")
OUTPUT = ICONS / (sys.argv[2] if len(sys.argv) > 2 else "emblem.png")
src = Image.open(SOURCE).convert("RGB")
a = np.asarray(src).astype(np.float32)
BG = np.median(np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3), a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3)]), axis=0)
print("background", BG)

# Square crop around everything brighter than the background (the glow included), 3% margin
d = np.abs(a - BG).max(axis=2)
ys, xs = np.nonzero(d > 10)
cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
side = int(max(xs.max() - xs.min(), ys.max() - ys.min()) * 1.03)
box = (int(cx - side / 2), int(cy - side / 2), int(cx - side / 2) + side, int(cy - side / 2) + side)
print("crop", box)
crop = src.crop(box)

# 4x with the cleanest of the upscalers we compared, back down to 2048 for matting
up_path = SCRATCH / (SOURCE.stem + "-up.png")
if not up_path.exists():
    import spandrel
    import torch
    import upscale as up

    model = spandrel.ModelLoader().load_from_file(str(UNREAL / "build/texai/models/4xNomos8kDAT.safetensors")).cuda().eval()
    big = up.upscale(model, crop, model.supports_half)
    del model
    torch.cuda.empty_cache()
    big.save(up_path)
big = Image.open(up_path).convert("RGB").resize((2048, 2048), Image.Resampling.LANCZOS)
c = np.asarray(big).astype(np.float32)

# The art's silhouette: clearly brighter than the background, with small gaps closed and enclosed
# holes filled, so the dark folds between petals stay solid. Outside it (the background, the glow,
# the anti-aliased edge) alpha follows how far the colour is from the background.
d = np.abs(c - BG).max(axis=2)
LO, HI = 8.0, 110.0
disk = lambda r: np.hypot(*np.mgrid[-r:r + 1, -r:r + 1]) <= r
# The shard's glow (dim yellow over the background) isn't part of the silhouette: it becomes the
# glow's own yellow, fading out, so it glows on light backgrounds too instead of leaving a dark halo.
R, G, B = c[..., 0], c[..., 1], c[..., 2]
# Yellow, not yellow-green (the leaves' tips), and within 64 px (at 2048) of the bright shard
shard = (R > 220) & (G > 180) & (B < 140)
near_shard = ndimage.distance_transform_edt(~shard) < 64
glowish = (R - B > 0.45 * R) & (G > 0.55 * R) & (R > 0.95 * G) & (c.max(axis=2) < 200) & near_shard
solid = ndimage.binary_fill_holes(ndimage.binary_closing((d > 45) & ~glowish, structure=disk(10), iterations=1))
alpha = np.where(solid, 1.0, np.clip((d - LO) / (HI - LO), 0, 1))
# The colour without the background mixed in: c = a * f + (1 - a) * bg
safe = np.maximum(alpha, 1e-3)[..., None]
fg = np.clip((c - (1 - alpha[..., None]) * BG) / safe, 0, 255)
GLOW = np.array([255.0, 226.0, 40.0])
glow = ~solid & glowish
ga = np.clip(((c - BG) @ (GLOW - BG)) / ((GLOW - BG) @ (GLOW - BG)), 0, 1)
alpha = np.where(glow, ga, alpha)
fg = np.where(glow[..., None], GLOW, fg)
alpha = ndimage.gaussian_filter(alpha, 0.8)
fg = np.where(alpha[..., None] > 1e-3, fg, 0)
rgba = np.dstack([fg, alpha * 255]).round().astype(np.uint8)
out = Image.fromarray(rgba, "RGBA").resize((1024, 1024), Image.Resampling.LANCZOS)
out.save(OUTPUT, optimize=True)
print("wrote", OUTPUT)

# Checks on light, dark and a checkerboard
sheet = Image.new("RGBA", (3 * 520, 520), (0, 0, 0, 255))
small = out.resize((512, 512), Image.Resampling.LANCZOS)
for i, bg in enumerate([(245, 242, 235, 255), (30, 27, 24, 255), None]):
    tile = Image.new("RGBA", (512, 512), bg or (0, 0, 0, 255))
    if bg is None:
        for y in range(0, 512, 32):
            for x in range(0, 512, 32):
                tile.paste((200, 200, 200, 255) if (x + y) // 32 % 2 else (255, 255, 255, 255), (x, y, x + 32, y + 32))
    tile.alpha_composite(small)
    sheet.paste(tile, (i * 520 + 4, 4))
sheet.save(SCRATCH / (OUTPUT.stem + "-check.png"))
