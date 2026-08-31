import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { DatePicker } from './base/datepicker/datepicker';
import { Select } from './base/select/select';
import { Button } from './base/button/button';
import { Slider } from './base/slider/slider';
import { Modal } from './base/modal/modal';
import { MapZoomControls } from './MapZoomControls';
import MapImageLayer from './map/MapImageLayer';
import { Map as MapIcon, Maximize2, Zap, AlertCircle } from 'lucide-react';
import moment from 'moment';
import { useMapMetadata } from '../hooks/useMapMetadata';
import { useMapPanZoom } from '@/hooks/useMapPanZoom';
import { cx } from '@/utils/cx';
import { apiFetch } from '@/utils/api';
import { buildPointGrid, countWithinRadius } from '@/utils/heatMapField';
import {
  CalendarDateTime,
  fromDate,
  toCalendarDateTime,
  getLocalTimeZone
} from '@internationalized/date';


interface HeatMapModalProps {
  onClose: () => void;
  selectedProfileId: string;
  missionName?: string;
  isPanel?: boolean;
}

/** Blob colour. Accumulated with `screen` compositing, so overlaps brighten towards pure orange. */
const HEAT_RGB = '255, 69, 0';
/** Retina backing store is worth it; beyond 2x it's a lot of fill rate for an out-of-focus blob. */
const MAX_DPR = 2;
/** How long the cursor must sit still before the density readout appears. */
const HOVER_DELAY_MS = 2000;
/** Cursor jitter (px) that doesn't count as movement, so a resting hand doesn't kill the dwell. */
const HOVER_SLOP = 3;
/** Gap between the cursor and the readout, on both axes. */
const TOOLTIP_OFFSET = 12;

export default function HeatMapModal({ onClose, selectedProfileId, missionName, isPanel = false }: HeatMapModalProps) {
    const mapMetadata = useMapMetadata(missionName);
    const [start, setStart] = useState<CalendarDateTime | null>(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return toCalendarDateTime(fromDate(d, getLocalTimeZone()));
    });
    const [end, setEnd] = useState<CalendarDateTime | null>(() => {
        const d = new Date();
        d.setHours(23, 59, 59, 999);
        return toCalendarDateTime(fromDate(d, getLocalTimeZone()));
    });
    const [loading, setLoading] = useState(false);
    const [isRendering, setIsRendering] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [coords, setCoords] = useState<any[]>([]);
    const [dataType, setDataType] = useState('all'); // all, connect, disconnect, kill
    const [pointRadius, setPointRadius] = useState(10);
    const [opacity, setOpacity] = useState(0.5);
    /** Cursor readout: null while the dwell hasn't completed or there's no heat under the pointer. */
    const [hover, setHover] = useState<{ px: number; py: number; count: number } | null>(null);

    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Shared with the Airdrop, Zones and Item Scan maps. Keyboard zoom is on because the
    // map is this modal's primary content and only one instance is ever mounted.
    const view = useMapPanZoom({
        worldSize: mapMetadata.worldSize,
        nativeSize: mapMetadata.tiles?.nativeSize,
        keyboardZoom: true,
    });
    const { viewportBox, contentSize, transform, isPanning } = view;

    /** Points in a unit square, so they can be rasterised at whatever tier is current. */
    const mapPoints = useMemo(() => coords.map(pos => ({
        x: pos.x / mapMetadata.worldSize,
        // Z is inverted relative to screen Y, matching the other map tools.
        y: 1 - (pos.z / mapMetadata.worldSize),
    })), [coords, mapMetadata.worldSize]);

    /** Bucketed points, so the hover readout doesn't walk the whole array on every dwell. */
    const pointGrid = useMemo(() => buildPointGrid(mapPoints), [mapPoints]);

    const fetchData = async () => {
        if (!start || !end) return;
        setLoading(true);
        setError(null);
        try {
            const res = await apiFetch(`/api/logs/heatmap-data`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                profileId: selectedProfileId,
                body: JSON.stringify({
                    start: moment(start.toDate(getLocalTimeZone())).format('YYYY-MM-DD HH:mm:ss'),
                    end: moment(end.toDate(getLocalTimeZone())).format('YYYY-MM-DD HH:mm:ss'),
                    dataType
                })
            });
            if (res.ok) {
                const data = await res.json();
                setCoords(data.coords || []);
            } else {
                const data = await res.json();
                setError(data.error || 'Failed to fetch heatmap data.');
            }
        } catch (e) {
            setError('Error connecting to server.');
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    /**
     * The blob, rasterised once per radius/opacity and then stamped per point. Building a fresh
     * radial gradient for every point is affordable when the canvas only redraws on a data
     * change; it isn't now that the canvas is in viewport space and has to redraw on every pan
     * frame. Rebuilt off-DOM, so it costs nothing until it's drawn.
     */
    const blobSprite = useMemo(() => {
        if (typeof document === 'undefined') return null;
        const size = Math.ceil(pointRadius * 2) + 2;
        const sprite = document.createElement('canvas');
        sprite.width = size;
        sprite.height = size;
        const sctx = sprite.getContext('2d');
        if (!sctx) return null;
        const c = size / 2;
        const grad = sctx.createRadialGradient(c, c, 0, c, c, pointRadius);
        grad.addColorStop(0, `rgba(${HEAT_RGB}, ${opacity})`);
        grad.addColorStop(1, `rgba(${HEAT_RGB}, 0)`);
        sctx.fillStyle = grad;
        sctx.fillRect(0, 0, size, size);
        return sprite;
    }, [pointRadius, opacity]);

    /**
     * The heat canvas lives in **viewport** space, not in the pan/zoom content box, so a blob is
     * exactly `pointRadius` CSS px wherever the map is zoomed to. A content-space canvas can't do
     * that: it would have to be as big as the zoomed map (16384² ≈ 1 GB on Deer Isle), and any
     * cap on that resolution collapses points that are metres apart into one texel — which is
     * precisely the detail zooming in is meant to reveal.
     */
    const drawHeatMap = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const { w, h } = viewportBox;
        const dpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, MAX_DPR);
        const bw = Math.max(1, Math.round(w * dpr));
        const bh = Math.max(1, Math.round(h * dpr));
        if (canvas.width !== bw || canvas.height !== bh) {
            canvas.width = bw;
            canvas.height = bh;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Draw in CSS px; the backing store carries the DPR.
        ctx.clearRect(0, 0, w, h);

        if (mapPoints.length === 0 || !blobSprite || !contentSize) return;

        ctx.globalCompositeOperation = 'screen';

        const r = pointRadius;
        const spriteSize = blobSprite.width;
        const offset = spriteSize / 2;

        for (const p of mapPoints) {
            // worldToViewport (@/utils/mapTransform), specialised for unit coords and inlined —
            // this runs once per point per frame while panning.
            const px = transform.x + p.x * contentSize;
            const py = transform.y + p.y * contentSize;
            if (px < -r || py < -r || px > w + r || py > h + r) continue;
            ctx.drawImage(blobSprite, px - offset, py - offset);
        }
    }, [mapPoints, pointRadius, blobSprite, viewportBox, contentSize, transform]);

    // Coalesced to one draw per frame: pan and wheel-zoom both change the transform many times
    // between paints, and the old 50ms timeout would have shown a stale raster all through a drag.
    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            drawHeatMap();
            setIsRendering(false);
        });
        return () => cancelAnimationFrame(frame);
    }, [drawHeatMap]);

    // Only a new dataset earns the blocking overlay. Showing it for transform-driven redraws
    // would strobe it over every pan frame and wheel notch.
    useEffect(() => {
        if (mapPoints.length > 0) setIsRendering(true);
    }, [mapPoints]);

    // --- Hover readout -------------------------------------------------------

    // NaN anchor = nothing hovered yet, so the first move can never be inside the slop radius.
    const hoverRef = useRef<{ timer: number | null; x: number; y: number }>({ timer: null, x: NaN, y: NaN });

    const cancelHover = useCallback(() => {
        if (hoverRef.current.timer !== null) clearTimeout(hoverRef.current.timer);
        hoverRef.current = { timer: null, x: NaN, y: NaN };
        setHover(null);
    }, []);

    /** Resolve a client position to how many events sit under the blob there, or null for cold map. */
    const sampleAt = useCallback((clientX: number, clientY: number) => {
        const el = view.viewportEl;
        if (!el || !contentSize) return null;
        const rect = el.getBoundingClientRect();
        const px = clientX - rect.left;
        const py = clientY - rect.top;
        // Deliberately not view.toWorld(): that clamps into the map square, so hovering the
        // letterbox either side of it would read as a hit on the very edge of the map.
        const ux = (px - transform.x) / contentSize;
        const uy = (py - transform.y) / contentSize;
        if (ux < 0 || ux > 1 || uy < 0 || uy > 1) return null;
        // A blob covers this pixel exactly when its centre is within pointRadius of it, so the
        // query radius is the on-screen radius expressed back in unit-square units.
        const count = countWithinRadius(pointGrid, ux, uy, pointRadius / contentSize);
        return count > 0 ? { px, py, count } : null;
    }, [view.viewportEl, contentSize, transform, pointGrid, pointRadius]);

    const handleHoverMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        // Not while panning, not on touch (there's no hover), and not over the zoom cluster —
        // a readout floating on top of the controls is just in the way.
        if (isPanning || e.pointerType === 'touch' || (e.target as HTMLElement).closest?.('button')) {
            cancelHover();
            return;
        }
        const h = hoverRef.current;
        // Below the slop the pointer counts as still, whether we're mid-dwell or already showing
        // a readout — otherwise a resting hand's jitter would restart the two seconds forever.
        if (Math.hypot(e.clientX - h.x, e.clientY - h.y) <= HOVER_SLOP) return;
        const { clientX, clientY } = e;
        if (h.timer !== null) clearTimeout(h.timer);
        setHover(null);
        h.x = clientX;
        h.y = clientY;
        h.timer = window.setTimeout(() => {
            hoverRef.current.timer = null;
            setHover(sampleAt(clientX, clientY));
        }, HOVER_DELAY_MS);
    }, [isPanning, cancelHover, sampleAt]);

    // Drop the readout whenever what it describes moves out from under it — a pan or zoom
    // leaves the count pointing at different ground, and a re-render of the heat invalidates it.
    useEffect(() => { cancelHover(); }, [cancelHover, transform, mapPoints, pointRadius]);
    useEffect(() => () => cancelHover(), [cancelHover]);

    const showImage = !!mapMetadata.imagePath && !view.imageFailed;

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={`${mapMetadata.displayName} Heat Map`}
            description={`Visualize player activity logs on the ${mapMetadata.displayName} map.`}
            icon={MapIcon}
            inline={isPanel}
            className={cx(!isPanel && "h-[90vh] max-w-none w-[90vw]")}
        >
            <div className="flex flex-col h-full space-y-4">
                {/* Toolbar */}
                <div className="flex flex-wrap items-end gap-4 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-200 dark:border-gray-800 shrink-0">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 flex-1">
                        <DatePicker
                            label="Start"
                            value={start}
                            onChange={setStart}
                            granularity="second"
                            className="w-full"
                        />
                        <DatePicker
                            label="End"
                            value={end}
                            onChange={setEnd}
                            granularity="second"
                            className="w-full"
                        />
                        <Select
                            label="Filter"
                            value={dataType}
                            onChange={e => setDataType(e.target.value)}
                            options={[
                                { label: 'All Positions', value: 'all' },
                                { label: 'Logins', value: 'connect' },
                                { label: 'Logouts', value: 'disconnect' },
                                { label: 'Deaths', value: 'kill' }
                            ]}
                        />
                        <div className="flex items-end h-10">
                            <Button variant="primary" onClick={fetchData} disabled={loading} className="w-full" icon={Zap}>
                                {loading ? 'Loading...' : 'Fetch Data'}
                            </Button>
                        </div>
                    </div>

                    <div className="flex items-center gap-6 pt-2 lg:pt-0">
                        <div className="w-32">
                            <Slider
                                label="Radius"
                                minValue={5}
                                maxValue={25}
                                value={pointRadius}
                                onChange={val => setPointRadius(val as number)}
                                labelPosition="default"
                                suffix="px"
                            />
                        </div>
                        <div className="w-32">
                            <Slider
                                label="Opacity"
                                minValue={10}
                                maxValue={100}
                                value={opacity * 100}
                                onChange={val => setOpacity((val as number) / 100)}
                                labelPosition="default"
                                suffix="%"
                            />
                        </div>
                        <div className="text-xs font-medium text-gray-500 bg-white dark:bg-gray-900 px-2 py-1 rounded border border-gray-200 dark:border-gray-800">
                            Points: {coords.length}
                        </div>
                    </div>
                </div>

                {/* Map Viewport */}
                <div
                    ref={view.viewportRef}
                    {...view.viewportHandlers}
                    onPointerMove={e => {
                        view.viewportHandlers.onPointerMove(e);
                        handleHoverMove(e);
                    }}
                    onPointerLeave={cancelHover}
                    className={cx(
                        'relative flex-1 bg-black rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 select-none touch-none',
                        view.isPanning ? 'cursor-grabbing' : view.canZoom && !view.atMin ? 'cursor-grab' : undefined
                    )}
                >
                    {error && (
                        <div className="absolute top-4 left-4 z-50 flex items-center gap-2 p-3 bg-error-600 text-white rounded-lg shadow-lg">
                            <AlertCircle size={18} />
                            {error}
                        </div>
                    )}

                    {isRendering && (
                        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
                            <div className="bg-gray-900 text-white px-6 py-3 rounded-xl border border-white/20 shadow-2xl font-bold flex items-center gap-3 animate-pulse">
                                <Maximize2 className="animate-spin" size={20} />
                                Rendering Heatmap...
                            </div>
                        </div>
                    )}

                    {!showImage && (
                        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 pointer-events-none">
                            No map preview for "{mapMetadata.displayName}"
                        </div>
                    )}

                    {/* Content layer: just the map imagery, carrying the pan/zoom. */}
                    {showImage && <MapImageLayer view={view} map={mapMetadata} />}

                    {/* The heat canvas stays in viewport space and applies the transform
                        itself (see drawHeatMap), so it is deliberately NOT inside
                        view.overlayStyle — a blob must be a constant number of CSS px at
                        every zoom, and a content-space canvas would have to be as big as
                        the zoomed map. */}
                    <canvas
                        ref={canvasRef}
                        className="absolute inset-0 w-full h-full pointer-events-none"
                    />

                    {hover && (
                        <div
                            className="absolute z-40 rounded-lg bg-primary-solid px-2 py-1 text-xs font-semibold text-white shadow-lg whitespace-nowrap pointer-events-none"
                            style={{
                                // Flip back across the cursor near the far edges so the readout
                                // never gets clipped by the viewport.
                                left: hover.px + TOOLTIP_OFFSET,
                                top: hover.py + TOOLTIP_OFFSET,
                                transform: [
                                    hover.px > viewportBox.w - 120 ? `translateX(calc(-100% - ${TOOLTIP_OFFSET * 2}px))` : '',
                                    hover.py > viewportBox.h - 48 ? `translateY(calc(-100% - ${TOOLTIP_OFFSET * 2}px))` : '',
                                ].join(' ').trim() || undefined,
                            }}
                        >
                            {hover.count} {hover.count === 1 ? 'event' : 'events'}
                        </div>
                    )}

                    {view.canZoom && <MapZoomControls map={view} />}
                </div>
            </div>
        </Modal>
    );
}
