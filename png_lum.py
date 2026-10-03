#!/usr/bin/env python3
"""Luminance stats for a PNG: is this a photo, or a flat blank?

A blank card is one flat value (spread ~0). A photo of a pale subject still has
a real spread. Byte size alone conflates the two, so this reads the pixels.

Usage: png-lum.py FILE [FILE...]
"""
import sys, zlib, struct


def read_png(path):
    """Minimal PNG decoder for 8-bit RGB/RGBA/gray, non-interlaced."""
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a png")
    pos, idat, w, h, depth, ctype = 8, b"", 0, 0, 0, 0
    while pos < len(data):
        ln, typ = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", body)
            if interlace:
                raise ValueError("interlaced png unsupported")
        elif typ == b"IDAT":
            idat += body
        elif typ == b"IEND":
            break
        pos += 12 + ln
    if depth != 8:
        raise ValueError(f"bit depth {depth} unsupported")
    ch = {0: 1, 2: 3, 4: 2, 6: 4}[ctype]
    raw = zlib.decompress(idat)
    stride = w * ch
    out, prev = [], bytearray(stride)
    i = 0
    for _ in range(h):
        f = raw[i]; i += 1
        line = bytearray(raw[i:i + stride]); i += stride
        # Undo the per-scanline filter.
        for x in range(stride):
            a = line[x - ch] if x >= ch else 0
            b = prev[x]
            c = prev[x - ch] if x >= ch else 0
            if f == 1:   line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out.append(bytes(line))
        prev = line
    return w, h, ch, out


def stats(path):
    w, h, ch, rows = read_png(path)
    lo, hi, tot, n = 255, 0, 0, 0
    bands = set()
    for line in rows:
        for x in range(0, len(line), ch):
            r, g, b = line[x], line[x + 1], line[x + 2] if ch >= 3 else line[x]
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            if lum < lo: lo = lum
            if lum > hi: hi = lum
            tot += lum; n += 1
            bands.add(int(lum // 8))
    return {
        "file": path.rsplit("/", 1)[-1],
        "size": f"{w}x{h}",
        "lumMin": int(lo), "lumMax": int(hi),
        "lumMean": round(tot / n),
        "spread": int(hi - lo),
        "bands": len(bands),
        "verdict": "BLANK (flat)" if (hi - lo) < 6 else ("flat-ish" if len(bands) < 3 else "photo"),
    }


if __name__ == "__main__":
    for p in sys.argv[1:]:
        print(stats(p))
