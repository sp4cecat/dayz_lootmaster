import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { DatePicker } from './base/datepicker/datepicker';
import { Select } from './base/select/select';
import { Button } from './base/button/button';
import { Slider } from './base/slider/slider';
import { Modal } from './base/modal/modal';
import { Map as MapIcon, Maximize2, Zap, AlertCircle } from 'lucide-react';
import moment from 'moment';
import { useMapMetadata } from '../hooks/useMapMetadata';
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
    const [breakpoints, setBreakpoints] = useState<number[]>([]);
    const [activeBreakpointIndex, setActiveBreakpointIndex] = useState(0);
    const [naturalWidth, setNaturalWidth] = useState(2048);
    
    const mapPoints = useMemo(() => {
        return coords.map(pos => ({
            x: (pos.x / mapMetadata.worldSize) * 2048,
            y: (1 - (pos.z / mapMetadata.worldSize)) * 2048
        }));
    }, [coords, mapMetadata.worldSize]);
    const [pointRadius, setPointRadius] = useState(20);
    const [opacity, setOpacity] = useState(0.5);
    
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [mapLoaded, setMapLoaded] = useState(false);

    const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });

    const [isPanning, setIsPanning] = useState(false);
    const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });

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
        if (!canvas || !mapLoaded || breakpoints.length === 0) return;
        
        const resScale = breakpoints[activeBreakpointIndex];
        const canvasRes = Math.floor(2048 * resScale);
        
        if (canvas.width !== canvasRes || canvas.height !== canvasRes) {
            canvas.width = canvasRes;
            canvas.height = canvasRes;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (mapPoints.length === 0) return;

        // Draw points
        ctx.globalCompositeOperation = 'screen';
        
        const drawRadius = pointRadius * resScale;

        mapPoints.forEach(pos => {
            const drawX = pos.x * resScale;
            const drawY = pos.y * resScale;

            const grad = ctx.createRadialGradient(drawX, drawY, 0, drawX, drawY, drawRadius);
            grad.addColorStop(0, `rgba(255, 69, 0, ${opacity})`);
            grad.addColorStop(1, 'rgba(255, 69, 0, 0)');
            
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(drawX, drawY, drawRadius, 0, Math.PI * 2);
            ctx.fill();
        });
    }, [mapPoints, mapLoaded, pointRadius, opacity, activeBreakpointIndex, breakpoints]);

    const updateBreakpoints = useCallback(() => {
        if (!containerRef.current || !mapLoaded) return;
        const { width, height } = containerRef.current.getBoundingClientRect();
        const minScale = Math.min(width / 2048, height / 2048);
        const maxScale = Math.max(naturalWidth / 2048, 1);
        
        const r = Math.pow(maxScale / minScale, 1/3);
        const b = [
            minScale,
            minScale * r,
            minScale * r * r,
            maxScale
        ];
        setBreakpoints(b);
        return b;
    }, [mapLoaded, naturalWidth]);

    useEffect(() => {
        setIsRendering(true);
        const timer = setTimeout(() => {
            drawHeatMap();
            setIsRendering(false);
        }, 50);
        return () => clearTimeout(timer);
    }, [drawHeatMap]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        
        const resizeObserver = new ResizeObserver(() => {
            updateBreakpoints();
        });
        resizeObserver.observe(container);
        
        return () => resizeObserver.disconnect();
    }, [updateBreakpoints]);

    useEffect(() => {
        if (mapLoaded && containerRef.current) {
            const b = updateBreakpoints();
            if (b) {
                const { width, height } = containerRef.current.getBoundingClientRect();
                const s = b[0]; 
                setTransform({
                    x: (width - 2048 * s) / 2,
                    y: (height - 2048 * s) / 2,
                    scale: s
                });
                setActiveBreakpointIndex(0);
            }
        }
    }, [mapLoaded, updateBreakpoints]);

    useEffect(() => {
        if (breakpoints.length > 0 && mapLoaded) {
            const newScale = breakpoints[activeBreakpointIndex];
            if (Math.abs(newScale - transform.scale) > 0.001) {
                setTransform(prev => {
                    if (!containerRef.current) return prev;
                    const rect = containerRef.current.getBoundingClientRect();
                    const centerX = rect.width / 2;
                    const centerY = rect.height / 2;
                    
                    const contentCenterX = (centerX - prev.x) / prev.scale;
                    const contentCenterY = (centerY - prev.y) / prev.scale;
                    
                    return {
                        x: centerX - contentCenterX * newScale,
                        y: centerY - contentCenterY * newScale,
                        scale: newScale
                    };
                });
            }
        }
    }, [breakpoints, activeBreakpointIndex, mapLoaded]);

    const setZoomIndex = useCallback((newIdx: number, focusX: number | null = null, focusY: number | null = null) => {
        if (!containerRef.current || breakpoints.length === 0) return;
        const clampedIdx = Math.max(0, Math.min(newIdx, breakpoints.length - 1));
        
        const newScale = breakpoints[clampedIdx];
        
        setTransform(prev => {
            if (!containerRef.current) return prev;
            const rect = containerRef.current.getBoundingClientRect();
            const targetX = focusX !== null ? focusX : rect.width / 2;
            const targetY = focusY !== null ? focusY : rect.height / 2;
            
            const contentFocusX = (targetX - prev.x) / prev.scale;
            const contentFocusY = (targetY - prev.y) / prev.scale;
            
            return {
                x: targetX - contentFocusX * newScale,
                y: targetY - contentFocusY * newScale,
                scale: newScale
            };
        });
        setActiveBreakpointIndex(clampedIdx);
    }, [breakpoints]);

    const handleWheel = useCallback((e: WheelEvent) => {
        if (!containerRef.current || breakpoints.length === 0) return;
        
        const rect = containerRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        if (e.deltaY < 0) {
            setZoomIndex(activeBreakpointIndex + 1, mouseX, mouseY);
        } else if (e.deltaY > 0) {
            setZoomIndex(activeBreakpointIndex - 1, mouseX, mouseY);
        }
    }, [breakpoints, activeBreakpointIndex, setZoomIndex]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleWheelEvent = (e: WheelEvent) => {
            e.preventDefault();
            handleWheel(e);
        };

        container.addEventListener('wheel', handleWheelEvent, { passive: false });
        return () => container.removeEventListener('wheel', handleWheelEvent);
    }, [handleWheel]);

    const adjustZoom = useCallback((deltaIndex: number) => {
        setZoomIndex(activeBreakpointIndex + deltaIndex);
    }, [activeBreakpointIndex, setZoomIndex]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
            if (e.key === '+' || e.key === '=') {
                e.preventDefault();
                adjustZoom(1);
            } else if (e.key === '-') {
                e.preventDefault();
                adjustZoom(-1);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [adjustZoom]);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        setIsPanning(true);
        setLastMousePos({ x: e.clientX, y: e.clientY });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isPanning) return;
        const dx = e.clientX - lastMousePos.x;
        const dy = e.clientY - lastMousePos.y;
        setTransform(prev => ({
            ...prev,
            x: prev.x + dx,
            y: prev.y + dy
        }));
        setLastMousePos({ x: e.clientX, y: e.clientY });
    };

    const handleMouseUp = () => {
        setIsPanning(false);
    };

    const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        setNaturalWidth(e.currentTarget.naturalWidth || 2048);
        setMapLoaded(true);
    };

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
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 flex-1">
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
                        <div className="flex items-end gap-4 h-10">
                            <div className="flex-1">
                                <Slider 
                                    label="Zoom" 
                                    minValue={0} 
                                    maxValue={3} 
                                    step={1} 
                                    value={activeBreakpointIndex} 
                                    onChange={val => setZoomIndex(val as number)}
                                    labelPosition="hidden"
                                />
                            </div>
                            <span className="text-xs font-mono w-10 text-right">
                                {breakpoints[3] ? Math.round((transform.scale / breakpoints[3]) * 100) : Math.round(transform.scale * 100)}%
                            </span>
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
                    className="relative flex-1 bg-black rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
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

                    <div 
                        ref={containerRef}
                        className="w-full h-full relative select-none"
                    >
                        <div 
                            style={{ 
                                position: 'absolute', 
                                width: '2048px', 
                                height: '2048px',
                                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                                transformOrigin: '0 0'
                            }}
                        >
                            <img 
                                src={mapMetadata.imagePath} 
                                alt={`${mapMetadata.displayName} Map`} 
                                onLoad={handleImageLoad}
                                className="w-full h-full block"
                            />
                            <canvas 
                                ref={canvasRef}
                                className="absolute top-0 left-0 w-full h-full pointer-events-none"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
