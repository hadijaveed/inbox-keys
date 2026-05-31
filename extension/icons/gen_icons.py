#!/usr/bin/env python3
"""Generate simple rounded-square PNG icons for the extension (no deps)."""
import struct, zlib, os

BG = (79, 70, 229)      # indigo-600
FG = (255, 255, 255)    # white glyph

# A tiny 7x7 bitmap of the letter "K" (1 = foreground)
K = [
    "1000010",
    "1000100",
    "1001000",
    "1110000",
    "1001000",
    "1000100",
    "1000010",
]


def rounded(size):
    r = max(2, size // 6)
    px = bytearray()
    glyph_scale = size // 12
    gw, gh = 7 * glyph_scale, 7 * glyph_scale
    gx0, gy0 = (size - gw) // 2, (size - gh) // 2
    for y in range(size):
        px.append(0)  # PNG filter byte per scanline
        for x in range(size):
            # rounded-corner alpha mask
            inside = True
            for cx, cy in ((r, r), (size - r, r), (r, size - r), (size - r, size - r)):
                if (x < r or x >= size - r) and (y < r or y >= size - r):
                    if (x - cx) ** 2 + (y - cy) ** 2 > r ** 2:
                        inside = False
            if not inside:
                px += bytes((0, 0, 0, 0))
                continue
            # glyph
            color = BG
            if gx0 <= x < gx0 + gw and gy0 <= y < gy0 + gh:
                row = K[(y - gy0) // glyph_scale]
                if row[(x - gx0) // glyph_scale] == "1":
                    color = FG
            px += bytes((*color, 255))
    return bytes(px)


def write_png(path, size):
    raw = rounded(size)
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(raw, 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


here = os.path.dirname(os.path.abspath(__file__))
for s in (16, 32, 48, 128):
    write_png(os.path.join(here, f"icon{s}.png"), s)
    print("wrote", f"icon{s}.png")
