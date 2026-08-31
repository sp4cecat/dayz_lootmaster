import { useMemo } from 'react';
import { tileUrl, type MapMetadata, type MapTileLevel } from '@/consts/maps';
import type { MapPanZoom } from '@/hooks/useMapPanZoom';

/**
 * The map imagery, as a tile pyramid.
 *
 * Every map tool used to render one monolithic `<img>` of the whole map inside the
 * pan/zoom content box. On Deer Isle that was a 16384x16384 / 42 MiB JPEG — roughly a
 * gigabyte of decoded bitmap, downloaded in full, to show a viewport a thousand pixels
 * across. This renders the same content box, but fills it with only the tiles actually
 * under the viewport, at only the resolution the current zoom can show.
 *
 * ## The two layers
 *
 * 1. **base** — one small un-tiled image (~1024px, ~150 KB) covering the whole map,
 *    always mounted. It is what makes this simple: there is never a blank viewport while
 *    tiles stream in, a zoom step can never flash, and a failed tile degrades to a
 *    slightly soft patch rather than a hole. No blur-up or placeholder machinery needed.
 * 2. **tiles** — the visible window of the smallest level that can satisfy the current
 *    `contentSize`, drawn over the base.
 *
 * ## Why tiles are positioned in integer px
 *
 * Adjacent tiles must share an exact edge. Sizing them in percentages (or in fractional
 * px) lets the browser round neighbours independently, which shows up as a hairline grid
 * of background bleeding through at some zoom levels. Deriving each tile's left/right
 * from the same rounded division guarantees tile N's right edge IS tile N+1's left edge.
 *
 * ## What this does not change
 *
 * Zoom is still a real layout size on the content box, never a CSS `scale()` — see the
 * header of `useMapPanZoom` for why. This component only changes what fills that box.
 */

interface MapImageLayerProps {
  view: MapPanZoom;
  map: MapMetadata;
  /** Extra classes for the base image (the airdrop map dims its map slightly). */
  className?: string;
  /** Rendered inside the content box, above the imagery — e.g. history's TrackLayer. */
  children?: React.ReactNode;
}

/** Half a tile of slack, so a fast pan does not expose an unloaded edge. */
const OVERSCAN = 0.5;

/** The smallest level that can fill `contentSize` without upscaling, else the largest. */
function pickLevel(levels: MapTileLevel[], contentSize: number): MapTileLevel | null {
  if (!levels.length) return null;
  return levels.find(l => l.size >= contentSize) ?? levels[levels.length - 1];
}

/**
 * Inclusive tile index range covering the visible part of the content box.
 *
 * The content box spans `0..contentSize` in viewport px offset by `transform`, so the
 * visible slice in content space is `(0 - t) / scale .. (viewport - t) / scale`. Content
 * space here is the *fitted* square (`size`), which is why the divisions use `size`.
 *
 * `per` is derived from the tile size rather than from `size / count`, because the last
 * tile in a row is only a full tile when the level divides evenly by it — see `edgeAt`.
 */
function visibleRange(
  offset: number, viewportExtent: number, size: number, scale: number,
  perTile: number, count: number,
): [number, number] {
  if (size <= 0 || scale <= 0 || perTile <= 0) return [0, -1];
  const from = (0 - offset) / scale / perTile - OVERSCAN;
  const to = (viewportExtent - offset) / scale / perTile + OVERSCAN;
  return [
    Math.max(0, Math.floor(from)),
    Math.min(count - 1, Math.ceil(to)),
  ];
}

/**
 * Content-box px of tile boundary `i` along one axis.
 *
 * Clamped to `levelSize` because the last tile of a level is a partial one whenever the
 * level is not a whole number of tiles across — Sakhal's top level is 3713px, so its
 * eighth column is 129px of image, not 512. Laying that out as a full-width tile stretches
 * the map's east and south edges. Both neighbours of a boundary compute it with this same
 * rounding, which is what keeps tiles exactly edge to edge.
 */
function edgeAt(i: number, tileSize: number, levelSize: number, contentSize: number): number {
  return Math.round((Math.min(i * tileSize, levelSize) * contentSize) / levelSize);
}

export default function MapImageLayer({ view, map, className, children }: MapImageLayerProps) {
  const { tiles } = map;
  const { contentSize, size, transform, viewportBox } = view;

  const level = tiles ? pickLevel(tiles.levels, contentSize) : null;

  const grid = useMemo(() => {
    if (!level || !size || !tiles) return null;
    // Content px covered by one whole tile, at the fitted scale.
    const perTile = (size * tiles.tileSize) / level.size;
    const [c0, c1] = visibleRange(transform.x, viewportBox.w, size, transform.scale, perTile, level.cols);
    const [r0, r1] = visibleRange(transform.y, viewportBox.h, size, transform.scale, perTile, level.rows);
    if (c1 < c0 || r1 < r0) return null;

    const edge = (i: number) => edgeAt(i, tiles.tileSize, level.size, contentSize);

    const out: { key: string; src: string; style: React.CSSProperties }[] = [];
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const left = edge(col);
        const top = edge(row);
        out.push({
          key: `${level.size}/${col}/${row}`,
          src: tileUrl(map.id, level.size, col, row),
          style: {
            position: 'absolute',
            left,
            top,
            width: edge(col + 1) - left,
            height: edge(row + 1) - top,
          },
        });
      }
    }
    return out;
  }, [level, tiles, size, contentSize, transform.x, transform.y, transform.scale,
      viewportBox.w, viewportBox.h, map.id]);

  return (
    <div style={view.contentStyle}>
      <img
        src={map.imagePath}
        alt={`${map.displayName} map`}
        // The base is what stops the viewport being blank, so it outranks the tiles that
        // will be requested alongside it.
        fetchPriority="high"
        {...view.imageProps}
        // Stretched, not object-contain: the overlay maths assume the image spans exactly
        // 0..worldSize across the square. The tile pyramid is built square for the same
        // reason, so a non-square source was already squared at generation time.
        className={`block h-full w-full pointer-events-none ${className ?? ''}`}
      />
      {grid?.map(({ key, src, style }) => (
        <img
          key={key}
          src={src}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
          style={style}
          className="block pointer-events-none"
        />
      ))}
      {children}
    </div>
  );
}
