#!/usr/bin/env python3
"""
Icon generator for WebShot Chrome Extension.
Generates master SVG and pixel-perfect, anti-aliased PNG icons at 16, 32, 48, and 128 px.
Uses only standard library modules (zlib, struct, math, os).
"""

import math
import os
import struct
import zlib

ICONS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")

def sample_icon(nx, ny):
    """
    Evaluates the RGBA color at normalized coordinate (nx, ny) in range [-1.0, 1.0].
    """
    # 1. Outer squircle boundary: (|nx|^4 + |ny|^4)^(1/4) <= R
    r_squircle = 0.86
    d4 = (nx**4 + ny**4) ** 0.25
    if d4 > r_squircle:
        return (0, 0, 0, 0)

    # 2. Base gradient: Royal blue #2563eb (37, 99, 235) to Indigo #1e3a8a (30, 58, 138)
    t = (nx + ny + 1.4) / 2.8
    t = max(0.0, min(1.0, t))
    bg_r = int(37 * (1.0 - t) + 30 * t)
    bg_g = int(99 * (1.0 - t) + 58 * t)
    bg_b = int(235 * (1.0 - t) + 160 * t)

    # Subtle rim highlight near edge
    if d4 >= r_squircle - 0.045:
        bg_r = min(255, bg_r + 45)
        bg_g = min(255, bg_g + 45)
        bg_b = min(255, bg_b + 45)

    # 3. Viewfinder crop corner brackets
    cx = abs(nx)
    cy = abs(ny)
    bracket_outer = 0.60
    bracket_len = 0.25
    bracket_thick = 0.075

    is_bracket = False
    # Horizontal bracket arm
    if (bracket_outer - bracket_len <= cx <= bracket_outer) and (bracket_outer - bracket_thick <= cy <= bracket_outer):
        is_bracket = True
    # Vertical bracket arm
    if (bracket_outer - bracket_thick <= cx <= bracket_outer) and (bracket_outer - bracket_len <= cy <= bracket_outer):
        is_bracket = True

    if is_bracket:
        return (255, 255, 255, 255)

    # 4. Center camera lens
    dist = math.sqrt(nx * nx + ny * ny)

    # Outer white aperture ring
    if 0.22 <= dist <= 0.29:
        return (255, 255, 255, 255)

    # Dark aperture chamber
    if 0.12 <= dist < 0.22:
        return (15, 23, 42, 255)  # #0f172a

    # Cyan inner optic
    if dist < 0.12:
        # Glass reflection glint
        glint_dist = math.sqrt((nx + 0.04) ** 2 + (ny + 0.04) ** 2)
        if glint_dist <= 0.035:
            return (255, 255, 255, 255)
        return (56, 189, 248, 255)  # #38bdf8

    # 5. Top-right camera flash dot
    flash_dist = math.sqrt((nx - 0.42) ** 2 + (ny + 0.42) ** 2)
    if flash_dist <= 0.065:
        return (245, 158, 11, 255)  # #f59e0b

    return (bg_r, bg_g, bg_b, 255)

def render_png(size):
    """
    Renders an anti-aliased icon at the given pixel dimensions using 2x2 supersampling.
    """
    samples = [(-0.25, -0.25), (-0.25, 0.25), (0.25, -0.25), (0.25, 0.25)]
    raw_data = b""
    half = size / 2.0

    for y in range(size):
        row = b"\x00"  # Filter byte: None
        for x in range(size):
            acc_r = acc_g = acc_b = acc_a = 0
            for sx, sy in samples:
                nx = ((x + 0.5 + sx) - half) / half
                ny = ((y + 0.5 + sy) - half) / half
                r, g, b, a = sample_icon(nx, ny)
                acc_r += r * (a / 255.0)
                acc_g += g * (a / 255.0)
                acc_b += b * (a / 255.0)
                acc_a += a

            avg_a = acc_a / 4.0
            if avg_a > 0:
                avg_r = (acc_r / 4.0) / (avg_a / 255.0)
                avg_g = (acc_g / 4.0) / (avg_a / 255.0)
                avg_b = (acc_b / 4.0) / (avg_a / 255.0)
            else:
                avg_r = avg_g = avg_b = 0

            row += bytes([
                int(round(avg_r)),
                int(round(avg_g)),
                int(round(avg_b)),
                int(round(avg_a))
            ])
        raw_data += row

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(raw_data, level=9))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend

def generate_svg():
    """
    Generates scalable SVG master icon with matching styling.
    """
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <linearGradient id="bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2563eb" />
      <stop offset="100%" stop-color="#1e3a8a" />
    </linearGradient>
    <radialGradient id="lens-optic" cx="35%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#7dd3fc" />
      <stop offset="50%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#0284c7" />
    </radialGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000000" flood-opacity="0.3" />
    </filter>
  </defs>

  <!-- Squircle Base -->
  <rect x="36" y="36" width="440" height="440" rx="104" ry="104" fill="url(#bg-grad)" filter="url(#shadow)" stroke="rgba(255,255,255,0.2)" stroke-width="6" />

  <!-- Flash Indicator Dot -->
  <circle cx="364" cy="148" r="18" fill="#f59e0b" />

  <!-- Viewfinder Crop Brackets -->
  <!-- Top-Left -->
  <path d="M 124 186 L 124 140 C 124 131 131 124 140 124 L 186 124" fill="none" stroke="#ffffff" stroke-width="20" stroke-linecap="round" stroke-linejoin="round" />
  <!-- Top-Right -->
  <path d="M 326 124 L 372 124 C 381 124 388 131 388 140 L 388 186" fill="none" stroke="#ffffff" stroke-width="20" stroke-linecap="round" stroke-linejoin="round" />
  <!-- Bottom-Left -->
  <path d="M 124 326 L 124 372 C 124 381 131 388 140 388 L 186 388" fill="none" stroke="#ffffff" stroke-width="20" stroke-linecap="round" stroke-linejoin="round" />
  <!-- Bottom-Right -->
  <path d="M 388 326 L 388 372 C 388 381 381 388 372 388 L 326 388" fill="none" stroke="#ffffff" stroke-width="20" stroke-linecap="round" stroke-linejoin="round" />

  <!-- Outer Aperture Ring -->
  <circle cx="256" cy="256" r="76" fill="none" stroke="#ffffff" stroke-width="18" />

  <!-- Dark Lens Chamber -->
  <circle cx="256" cy="256" r="58" fill="#0f172a" />

  <!-- Cyan Inner Optic -->
  <circle cx="256" cy="256" r="32" fill="url(#lens-optic)" />

  <!-- Specular Lens Glint -->
  <circle cx="244" cy="244" r="9" fill="#ffffff" opacity="0.9" />
</svg>
"""

def main():
    os.makedirs(ICONS_DIR, exist_ok=True)

    # 1. Generate SVG
    svg_path = os.path.join(ICONS_DIR, "icon.svg")
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(generate_svg())
    print(f"Generated {svg_path}")

    # 2. Generate PNGs for all standard extension resolutions
    sizes = [16, 32, 48, 128]
    for size in sizes:
        png_data = render_png(size)
        png_path = os.path.join(ICONS_DIR, f"icon{size}.png")
        with open(png_path, "wb") as f:
            f.write(png_data)
        print(f"Generated {png_path} ({size}x{size})")

if __name__ == "__main__":
    main()
