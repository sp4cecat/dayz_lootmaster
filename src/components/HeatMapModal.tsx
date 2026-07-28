import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { DatePicker } from './base/datepicker/datepicker';
import { Select } from './base/select/select';
import { Button } from './base/button/button';
import { Slider } from './base/slider/slider';
import { Modal } from './base/modal/modal';
import { MapZoomControls } from './MapZoomControls';
import { Map as MapIcon, Maximize2, Zap, AlertCircle } from 'lucide-react';
import moment from 'moment';
import { useMapMetadata } from '../hooks/useMapMetadata';
import { useMapPanZoom } from '@/hooks/useMapPanZoom';
import { cx } from '@/utils/cx';
import { apiFetch } from '@/utils/api';
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

/**
 * Backing-store sizes the heat canvas may use, in px. The canvas covers the whole map
 * square, so it can't simply track the zoomed display size — at full zoom on Deer Isle that
 * would be a 16384² canvas (~1 GB). Instead it snaps to the smallest tier that covers the
 * current display size and the browser upscales beyond that, which is invisible here because
 * the blobs are soft radial gradients.
 */
const CANVAS_TIERS = [1024, 2048, 4096];
/** Reference resolution that `pointRadius` is expressed against, so the slider keeps its feel. */
const RADIUS_REFERENCE_RES = 2048;

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
    const [pointRadius, setPointRadius] = useState(20);
    const [opacity, setOpacity] = useState(0.5);

    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Shared with the Airdrop, Zones and Item Scan maps. Keyboard zoom is on because the
    // map is this modal's primary content and only one instance is ever mounted.
    const view = useMapPanZoom({ worldSize: mapMetadata.worldSize, keyboardZoom: true });

    /** Points in a unit square, so they can be rasterised at whatever tier is current. */
    const mapPoints = useMemo(() => coords.map(pos => ({
        x: pos.x / mapMetadata.worldSize,
        // Z is inverted relative to screen Y, matching the other map tools.
        y: 1 - (pos.z / mapMetadata.worldSize),
    })), [coords, mapMetadata.worldSize]);

    const canvasRes = useMemo(() => {
        const want = view.contentSize || CANVAS_TIERS[0];
        return CANVAS_TIERS.find(t => t >= want) ?? CANVAS_TIERS[CANVAS_TIERS.length - 1];
    }, [view.contentSize]);

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

    const drawHeatMap = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        if (canvas.width !== canvasRes || canvas.height !== canvasRes) {
            canvas.width = canvasRes;
            canvas.height = canvasRes;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (mapPoints.length === 0) return;

        ctx.globalCompositeOperation = 'screen';

        // Scaled with the tier, so a blob covers the same fraction of the map — and hence the
        // same on-screen size at a given zoom — whichever tier is active.
        const drawRadius = pointRadius * (canvasRes / RADIUS_REFERENCE_RES);

        mapPoints.forEach(pos => {
            const drawX = pos.x * canvasRes;
            const drawY = pos.y * canvasRes;

            const grad = ctx.createRadialGradient(drawX, drawY, 0, drawX, drawY, drawRadius);
            grad.addColorStop(0, `rgba(255, 69, 0, ${opacity})`);
            grad.addColorStop(1, 'rgba(255, 69, 0, 0)');

            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(drawX, drawY, drawRadius, 0, Math.PI * 2);
            ctx.fill();
        });
    }, [mapPoints, pointRadius, opacity, canvasRes]);

    useEffect(() => {
        setIsRendering(true);
        const timer = setTimeout(() => {
            drawHeatMap();
            setIsRendering(false);
        }, 50);
        return () => clearTimeout(timer);
    }, [drawHeatMap]);

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

                    {/* Content layer: image + heat canvas, carrying the pan/zoom. */}
                    <div style={view.contentStyle}>
                        {showImage && (
                            <img
                                src={mapMetadata.imagePath}
                                alt={`${mapMetadata.displayName} Map`}
                                {...view.imageProps}
                                className="w-full h-full block pointer-events-none"
                            />
                        )}
                        <canvas
                            ref={canvasRef}
                            className="absolute top-0 left-0 w-full h-full pointer-events-none"
                        />
                    </div>

                    {view.canZoom && <MapZoomControls map={view} />}
                </div>
            </div>
        </Modal>
    );
}
