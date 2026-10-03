from PIL import Image, ImageFilter
import os, math, sys

# Geometry is part of the measurement. The reference capture is 70x200 and the
# candidates are 355x123; comparing min(len) pixels of two differently-shaped
# images compares the top-left of one against the top-left of the other and
# reports a low correlation for a perfectly good filter. Everything is resized
# to one frame first, so correlation compares like with like.
W, H = 128, 64

def load(p):
    return Image.open(p).convert("L").resize((W, H), Image.LANCZOS)

def blur(im, r=2):
    return im.filter(ImageFilter.GaussianBlur(r))

def corr(a, b):
    pa, pb = list(a.getdata()), list(b.getdata())
    ma, mb = sum(pa) / len(pa), sum(pb) / len(pb)
    num = sum((pa[i] - ma) * (pb[i] - mb) for i in range(len(pa)))
    da = math.sqrt(sum((v - ma) ** 2 for v in pa))
    db = math.sqrt(sum((v - mb) ** 2 for v in pb))
    return num / (da * db) if da and db else 0.0

REF = "/tmp/s_s0_plain.png"
base = blur(load(REF))

rows = []
for f in sorted(os.listdir("/tmp")):
    if f.startswith("hf_") or f.startswith("t_t") or f == "t_t0_gray.png":
        p = "/tmp/" + f
        if not os.path.exists(p):
            continue
        im = load(p)
        px = list(im.getdata())
        rows.append((f[:-4], corr(blur(im), base), len(set(px)), os.path.getsize(p)))

print(f"reference {REF} -> resized {W}x{H}")
print(f"{'candidate':22} {'corr':>7} {'uniq':>5} {'bytes':>7}")
for n, c, u, b in sorted(rows, key=lambda r: -r[1]):
    flag = "" if c > 0.5 else "   <-- not a photograph"
    print(f"{n:22} {c:+7.3f} {u:5d} {b:7d}{flag}")
