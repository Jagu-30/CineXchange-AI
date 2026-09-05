"""Render a terminal-playback video of a real CineXchange demo run.

This records TEXT, not the browser. It takes the actual stdout of a demo script
run against the deployed stack, types it out frame by frame, and encodes an MP4.
Every character on screen came from the live system - there is no scripted or
re-enacted content, which matters for a demo whose whole claim is that nothing
is staged.

  python deploy/make-demo-video.py --input run.txt --output demo.mp4

Options worth knowing:
  --cps     characters per second (default 220). Lower reads slower.
  --hold    seconds to hold the final frame (default 4)
  --title   banner drawn on the first frame
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Terminal-ish palette. Kept deliberately plain: the point is legibility in a
# submission video that may be watched at half size, not decoration.
BG = (13, 15, 18)
FG = (222, 226, 230)
DIM = (128, 138, 148)
ACCENT = (240, 178, 74)
GREEN = (90, 200, 130)
RED = (232, 106, 106)

W, H = 1600, 900
MARGIN = 28
LINE_H = 22
FONT_SIZE = 16
MAX_LINES = (H - 2 * MARGIN) // LINE_H


def find_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    for candidate in Path("D:/tools").glob("ffmpeg*/bin/ffmpeg.exe"):
        return str(candidate)
    sys.exit("ffmpeg not found: put it on PATH or under D:/tools/ffmpeg*/bin/")


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in (r"C:\Windows\Fonts\consola.ttf", r"C:\Windows\Fonts\cour.ttf"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def colour_for(line: str) -> tuple[int, int, int]:
    """Colour by meaning, not syntax - a viewer should be able to skim for the
    beats (a step heading, a failure, a settled negotiation) without reading."""
    stripped = line.strip()
    if stripped.startswith("===") or stripped.startswith("---"):
        return ACCENT
    low = stripped.lower()
    if any(w in low for w in ("failed", "error", "503", "403", "reject")):
        return RED
    if any(w in low for w in ("booked", "confirmed", "accept", "reachable", "resolved", "pass")):
        return GREEN
    if stripped.startswith(("|", "+", " ")) or "---" in stripped:
        return DIM
    return FG


def wrap(lines: list[str], width: int) -> list[str]:
    out: list[str] = []
    for raw in lines:
        raw = raw.rstrip("\n").replace("\t", "    ")
        if not raw:
            out.append("")
            continue
        while len(raw) > width:
            out.append(raw[:width])
            raw = raw[width:]
        out.append(raw)
    return out


def render(lines: list[str], font, title: str | None, subtitle: str | None) -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    y = MARGIN
    if title:
        d.text((MARGIN, y), title, font=font, fill=ACCENT)
        y += LINE_H
        if subtitle:
            d.text((MARGIN, y), subtitle, font=font, fill=DIM)
            y += LINE_H
        y += LINE_H // 2
    for line in lines:
        d.text((MARGIN, y), line, font=font, fill=colour_for(line))
        y += LINE_H
    return img


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="captured stdout of a demo run")
    ap.add_argument("--output", default="demo.mp4")
    ap.add_argument("--cps", type=float, default=220.0, help="characters per second")
    ap.add_argument("--fps", type=int, default=24)
    ap.add_argument("--hold", type=float, default=4.0, help="seconds on the final frame")
    ap.add_argument("--title", default="CineXchange AI - live run")
    ap.add_argument("--subtitle", default="")
    args = ap.parse_args()

    raw = Path(args.input).read_text(encoding="utf-8", errors="replace").split("\n")
    font = load_font(FONT_SIZE)
    char_w = font.getbbox("M")[2] or 10
    cols = (W - 2 * MARGIN) // char_w
    lines = wrap(raw, cols)

    header_lines = 3 if args.title else 0
    body = MAX_LINES - header_lines

    # One frame per fps tick; reveal characters at --cps so the pacing reads like
    # a terminal rather than a slideshow.
    per_frame = max(1, int(args.cps / args.fps))
    total_chars = sum(len(l) + 1 for l in lines)

    tmp = Path(tempfile.mkdtemp(prefix="cinex-frames-"))
    frame = 0
    revealed = 0
    try:
        while revealed < total_chars:
            revealed = min(total_chars, revealed + per_frame)
            shown: list[str] = []
            budget = revealed
            for line in lines:
                if budget <= 0:
                    break
                if budget >= len(line) + 1:
                    shown.append(line)
                    budget -= len(line) + 1
                else:
                    shown.append(line[:budget])
                    budget = 0
            window = shown[-body:] if len(shown) > body else shown
            render(window, font, args.title, args.subtitle).save(tmp / f"f{frame:06d}.png")
            frame += 1

        last = render(lines[-body:], font, args.title, args.subtitle)
        for _ in range(int(args.hold * args.fps)):
            last.save(tmp / f"f{frame:06d}.png")
            frame += 1

        print(f"rendered {frame} frames ({frame / args.fps:.1f}s) in {tmp}")
        cmd = [
            find_ffmpeg(), "-y", "-hide_banner", "-loglevel", "error",
            "-framerate", str(args.fps),
            "-i", str(tmp / "f%06d.png"),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
            args.output,
        ]
        subprocess.run(cmd, check=True)
        size_mb = Path(args.output).stat().st_size / 1e6
        print(f"wrote {args.output}  ({size_mb:.1f} MB, {frame / args.fps:.1f}s)")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
