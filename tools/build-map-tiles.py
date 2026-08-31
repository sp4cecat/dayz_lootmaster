#!/usr/bin/env python3
"""
Build the multi-resolution tile pyramid the map tools render.

Every map tool used to render one monolithic <img> of the whole map. On Deer Isle that
is a 16384x16384 / 42 MiB JPEG, which the browser turns into roughly a gigabyte of
decoded bitmap the moment it rasterises it — for a viewport that is showing maybe a
thousand pixels across. This script turns each source image into:

    public/maps/<mapId>/base.webp        a single small image, always rendered
    public/maps/<mapId>/<size>/<c>_<r>.webp   512px tiles, one directory per zoom level
    public/maps/<mapId>/tiles.json       the manifest MapImageLayer reads

so the client fetches and decodes only the tiles actually under the viewport.

## Why the output is committed

It would be tidier to generate this at build time, but `launch.bat` does
git pull -> npm ci -> npm run build on machines that have no image toolchain. Committing
the output keeps the build a pure npm build. Sources live in tools/map-sources/ and are
deliberately NOT under src/, because anything imported from src/ gets bundled — that is
how 45.7 MB of the old 46 MB dist/ came to be map JPEGs.

## Levels

Sizes are powers of two up to CAP_SIZE, plus the source's own size when it is smaller or
not a power of two, so no source detail is wasted and nothing is ever upscaled:

    Deer Isle  16384 -> base 1024, tiled 2048 / 4096 / 8192   (capped)
    Livonia     3072 -> base 1024, tiled 2048 / 3072
    Chernarus    554 -> base 554,  no tiled levels            (nothing to zoom into)

The smallest level is emitted as a single un-tiled `base.webp`. MapImageLayer renders it
underneath every tiled level, so the map is never blank while tiles stream in and a zoom
step never flashes.

## Squareness

Non-square sources are resized to a square rather than letterboxed. That is not a bug:
the overlay maths in every map tool assume the image spans exactly 0..worldSize on both
axes (see the comments at AirdropDropLocationMap.tsx and ItemScanModal.tsx), and the app
has always stretched. Matching that here keeps every marker where it already was.

Usage:
    python tools/build-map-tiles.py             # all sources
    python tools/build-map-tiles.py --map empty.deerisle
    python tools/build-map-tiles.py --force     # rebuild even if up to date
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from PIL import Image

# Deer Isle's source is 268 megapixels, well past Pillow's decompression-bomb guard.
# These are our own files, not untrusted input.
Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = ROOT / "tools" / "map-sources"
OUTPUT_DIR = ROOT / "public" / "maps"
#: Every per-map manifest, merged. The client imports this one file rather than fetching
#: four manifests before it can decide which tiles to ask for.
CLIENT_MANIFEST = ROOT / "src" / "consts" / "mapTiles.json"

TILE_SIZE = 512
#: Zoom ceiling, in px of the square map. 8192 over a 16384 m world is ~2 m/px, which at
#: a 1000px viewport is a ~2 km field of view fully zoomed in — plenty for placing
#: airdrops and reading tracks, at a quarter of the bytes of full native resolution.
CAP_SIZE = 8192
#: Candidate levels below the cap. The source's own size is appended as the top level.
LADDER = (1024, 2048, 4096)

WEBP_QUALITY = 80
SOURCE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp")


def level_sizes(native: int) -> list[int]:
    """Level sizes for a source whose longest edge is `native`, smallest first."""
    top = min(native, CAP_SIZE)
    return [s for s in LADDER if s < top] + [top]


def grid(size: int) -> tuple[int, int]:
    """Tile columns/rows covering `size` px. The last tile in each axis may be partial."""
    n = -(-size // TILE_SIZE)  # ceil
    return n, n


def load_square(path: Path, size: int) -> Image.Image:
    """
    Decode `path` as an RGB square of exactly `size` px.

    For JPEG this uses draft mode, which lets libjpeg decode directly at 1/2, 1/4 or 1/8
    scale. Without it, producing Deer Isle's 8192 level would first materialise the full
    16384x16384 bitmap (~800 MB) and then throw seven eighths of it away.
    """
    img = Image.open(path)
    img.draft("RGB", (size, size))  # no-op for non-JPEG
    img = img.convert("RGB")
    if img.size != (size, size):
        img = img.resize((size, size), Image.LANCZOS)
    return img


def emit_tiles(img: Image.Image, out_dir: Path) -> int:
    """Slice `img` into TILE_SIZE tiles under `out_dir`. Returns the tile count."""
    out_dir.mkdir(parents=True, exist_ok=True)
    cols, rows = grid(img.width)
    for row in range(rows):
        for col in range(cols):
            box = (
                col * TILE_SIZE,
                row * TILE_SIZE,
                min((col + 1) * TILE_SIZE, img.width),
                min((row + 1) * TILE_SIZE, img.height),
            )
            tile = img.crop(box)
            tile.save(out_dir / f"{col}_{row}.webp", "WEBP", quality=WEBP_QUALITY, method=4)
    return cols * rows


def build_map(map_id: str, source: Path, force: bool) -> dict:
    out = OUTPUT_DIR / map_id
    manifest_path = out / "tiles.json"

    with Image.open(source) as probe:
        native = max(probe.size)
        source_size = probe.size

    sizes = level_sizes(native)
    base_size, tiled_sizes = sizes[0], sizes[1:]

    manifest = {
        "id": map_id,
        "sourceSize": list(source_size),
        "nativeSize": min(native, CAP_SIZE),
        "tileSize": TILE_SIZE,
        "baseSize": base_size,
        "levels": [
            {"size": s, "cols": grid(s)[0], "rows": grid(s)[1]} for s in tiled_sizes
        ],
    }

    if not force and manifest_path.exists():
        try:
            if json.loads(manifest_path.read_text()) == manifest:
                print(f"  {map_id}: up to date ({native}px source), skipping")
                return manifest
        except (ValueError, OSError):
            pass  # unreadable manifest: fall through and rebuild

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    print(f"  {map_id}: {source_size[0]}x{source_size[1]} source -> levels {sizes}")

    # Decode once at the largest level, then halve down. Successive downscales from an
    # already-resampled image are both faster and cleaner than re-decoding the source
    # for each level.
    img = load_square(source, sizes[-1])
    total = 0
    for size in reversed(sizes):
        if img.width != size:
            img = img.resize((size, size), Image.LANCZOS)
        if size == base_size:
            img.save(out / "base.webp", "WEBP", quality=WEBP_QUALITY, method=4)
            print(f"    base {size}px")
        else:
            n = emit_tiles(img, out / str(size))
            total += n
            print(f"    {size}px -> {n} tiles")

    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    written = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"    {total} tiles + base, {written / 1048576:.1f} MB total")
    return manifest


def discover() -> dict[str, Path]:
    found: dict[str, Path] = {}
    for path in sorted(SOURCE_DIR.iterdir()):
        if path.is_file() and path.suffix.lower() in SOURCE_SUFFIXES:
            found[path.stem] = path
    return found


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--map", help="build only this map id (source file stem)")
    ap.add_argument("--force", action="store_true", help="rebuild even if up to date")
    args = ap.parse_args()

    if not SOURCE_DIR.is_dir():
        print(f"No source directory at {SOURCE_DIR}", file=sys.stderr)
        return 1

    sources = discover()
    if args.map:
        if args.map not in sources:
            print(
                f"No source for '{args.map}'. Available: {', '.join(sources) or '(none)'}",
                file=sys.stderr,
            )
            return 1
        sources = {args.map: sources[args.map]}

    if not sources:
        print(f"No map sources in {SOURCE_DIR}", file=sys.stderr)
        return 1

    print(f"Building {len(sources)} map(s) into {OUTPUT_DIR}")
    for map_id, source in sources.items():
        build_map(map_id, source, args.force)

    # Merge every manifest on disk, not just the ones built this run, so `--map <id>`
    # refreshes one pyramid without dropping the others from the client manifest.
    merged = {}
    for manifest_path in sorted(OUTPUT_DIR.glob("*/tiles.json")):
        merged[manifest_path.parent.name] = json.loads(manifest_path.read_text())
    CLIENT_MANIFEST.write_text(json.dumps(merged, indent=2) + "\n")
    print(f"Wrote {CLIENT_MANIFEST.relative_to(ROOT)} ({len(merged)} maps)")

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
