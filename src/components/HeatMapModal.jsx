import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import DateTimePicker from 'react-datetime-picker';
import 'react-datetime-picker/dist/DateTimePicker.css';
import 'react-calendar/dist/Calendar.css';
import 'react-clock/dist/Clock.css';
import moment from 'moment';
import deerIsleMap from '../assets/maps/deerisle/DeerIsle.jpg';

const WORLD_SIZE = 16384;

export default function HeatMapModal({ onClose, selectedProfileId, getApiBase }) {
    const [start, setStart] = useState(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    });
    const [end, setEnd] = useState(() => {
        const d = new Date();
        d.setHours(23, 59, 59, 999);
        return d;
    });
    const [loading, setLoading] = useState(false);
    const [isRendering, setIsRendering] = useState(false);
    const [error, setError] = useState(null);
    const [coords, setCoords] = useState([]);
    const [breakpoints, setBreakpoints] = useState([]);
    const [activeBreakpointIndex, setActiveBreakpointIndex] = useState(0);
    const [naturalWidth, setNaturalWidth] = useState(2048);
    
    const mapPoints = useMemo(() => {
        return coords.map(pos => ({
            x: (pos.x / WORLD_SIZE) * 2048,
            y: (1 - (pos.z / WORLD_SIZE)) * 2048
        }));
    }, [coords]);
    const [pointRadius, setPointRadius] = useState(20);
    const [opacity, setOpacity] = useState(0.5);
    
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const [mapLoaded, setMapLoaded] = useState(false);

    const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
    const transformRef = useRef(transform);
    transformRef.current = transform;

    const [isPanning, setIsPanning] = useState(false);
    const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });

    const API_BASE = getApiBase();

    const fetchData = async () => {
        if (!start || !end) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/api/logs/heatmap-data`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Profile-ID': selectedProfileId
                },
                body: JSON.stringify({
                    start: moment(start).format('YYYY-MM-DD HH:mm:ss'),
                    end: moment(end).format('YYYY-MM-DD HH:mm:ss')
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
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (mapPoints.length === 0) return;

        // Draw points
        ctx.globalCompositeOperation = 'screen';
        
        const drawRadius = pointRadius * resScale;

        mapPoints.forEach(pos => {
            // Map space coordinates (0-2048) scaled by resolution
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
        
        // Geometric progression for 4 breakpoints
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
            // Initial fit using B1
            const { width, height } = containerRef.current.getBoundingClientRect();
            const s = b[0]; 
            setTransform({
                x: (width - 2048 * s) / 2,
                y: (height - 2048 * s) / 2,
                scale: s
            });
        }
    }, [mapLoaded, updateBreakpoints]);

    useEffect(() => {
        if (breakpoints.length === 0) return;
        const currentScale = transform.scale;
        
        // Choose the smallest breakpoint that is >= current scale
        let idx = breakpoints.findIndex(b => b >= currentScale);
        if (idx === -1) idx = breakpoints.length - 1;
        
        if (idx !== activeBreakpointIndex) {
            setActiveBreakpointIndex(idx);
        }
    }, [transform.scale, breakpoints, activeBreakpointIndex]);

    const handleWheel = useCallback((e) => {
        if (!containerRef.current) return;
        const zoomSpeed = 0.001;
        const delta = -e.deltaY * zoomSpeed;
        const maxScale = Math.max(8, breakpoints[3] || 8);
        const newScale = Math.min(Math.max(transformRef.current.scale + delta, 0.05), maxScale);
        
        if (newScale === transformRef.current.scale) return;

        const rect = containerRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const contentMouseX = (mouseX - transformRef.current.x) / transformRef.current.scale;
        const contentMouseY = (mouseY - transformRef.current.y) / transformRef.current.scale;

        setTransform({
            x: mouseX - contentMouseX * newScale,
            y: mouseY - contentMouseY * newScale,
            scale: newScale
        });
    }, [breakpoints]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleWheelEvent = (e) => {
            e.preventDefault();
            handleWheel(e);
        };

        container.addEventListener('wheel', handleWheelEvent, { passive: false });
        return () => container.removeEventListener('wheel', handleWheelEvent);
    }, [handleWheel]);

    const handleMouseDown = (e) => {
        if (e.button !== 0) return;
        setIsPanning(true);
        setLastMousePos({ x: e.clientX, y: e.clientY });
    };

    const handleMouseMove = (e) => {
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

    const adjustZoom = (factor) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        const contentCenterX = (centerX - transform.x) / transform.scale;
        const contentCenterY = (centerY - transform.y) / transform.scale;
        
        const maxScale = Math.max(8, breakpoints[3] || 8);
        const newScale = Math.min(Math.max(transform.scale * factor, 0.05), maxScale);
        
        setTransform({
            x: centerX - contentCenterX * newScale,
            y: centerY - contentCenterY * newScale,
            scale: newScale
        });
    };

    const handleZoomSliderChange = (e) => {
        const newScale = parseFloat(e.target.value);
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        const contentCenterX = (centerX - transform.x) / transform.scale;
        const contentCenterY = (centerY - transform.y) / transform.scale;
        
        setTransform({
            x: centerX - contentCenterX * newScale,
            y: centerY - contentCenterY * newScale,
            scale: newScale
        });
    };

    const handleImageLoad = (e) => {
        setNaturalWidth(e.target.naturalWidth || 2048);
        setMapLoaded(true);
    };

    return (
        <div className="modal-backdrop" onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onClick={onClose}>
            <div className="modal full" style={{ width: '90vw', height: '90vh', maxWidth: 'none', padding: 0 }} onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>Deer Isle Heat Map</h3>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginLeft: '20px' }}>
                        <label>Start:</label>
                        <div className="dtp-wrap">
                            <DateTimePicker value={start} onChange={setStart} format="y-MM-dd HH:mm:ss" />
                        </div>
                        <label>End:</label>
                        <div className="dtp-wrap">
                            <DateTimePicker value={end} onChange={setEnd} format="y-MM-dd HH:mm:ss" />
                        </div>
                        <button className="btn-primary" onClick={fetchData} disabled={loading}>
                            {loading ? 'Loading...' : 'Fetch Data'}
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginLeft: 'auto', marginRight: '20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <label>Zoom:</label>
                            <button className="btn-secondary" style={{ padding: '2px 8px' }} onClick={() => adjustZoom(0.8)}>-</button>
                            <input 
                                type="range" 
                                min="0.05" 
                                max={Math.max(8, breakpoints[3] || 8)} 
                                step="0.01" 
                                value={transform.scale} 
                                onChange={handleZoomSliderChange} 
                                style={{ width: '100px' }}
                            />
                            <button className="btn-secondary" style={{ padding: '2px 8px' }} onClick={() => adjustZoom(1.2)}>+</button>
                            <span style={{ minWidth: '45px', textAlign: 'right' }}>{Math.round(transform.scale * 100)}%</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <label>Radius:</label>
                            <input type="range" min="5" max="100" value={pointRadius} onChange={e => setPointRadius(parseInt(e.target.value))} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <label>Opacity:</label>
                            <input type="range" min="0.1" max="1" step="0.1" value={opacity} onChange={e => setOpacity(parseFloat(e.target.value))} />
                        </div>
                        <span>Points: {coords.length}</span>
                    </div>
                    <button className="close-button" onClick={onClose}>&times;</button>
                </div>
                <div 
                    className="modal-body" 
                    style={{ flex: 1, overflow: 'hidden', position: 'relative', background: '#000', padding: 0, cursor: isPanning ? 'grabbing' : 'grab' }}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                >
                    {error && <div className="error-message" style={{ position: 'absolute', top: 10, left: 10, zIndex: 100, background: 'rgba(255,0,0,0.8)', color: 'white', padding: '5px 10px', borderRadius: '4px' }}>{error}</div>}
                    {isRendering && (
                        <div style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            background: 'rgba(0,0,0,0.8)',
                            color: 'white',
                            padding: '15px 30px',
                            borderRadius: '8px',
                            zIndex: 1000,
                            pointerEvents: 'none',
                            fontSize: '1.2em',
                            fontWeight: 'bold',
                            boxShadow: '0 4px 15px rgba(0,0,0,0.5)',
                            border: '1px solid rgba(255,255,255,0.2)'
                        }}>
                            Rendering Heatmap...
                        </div>
                    )}
                    <div 
                        ref={containerRef}
                        style={{ 
                            width: '100%', 
                            height: '100%', 
                            position: 'relative',
                            userSelect: 'none'
                        }}
                    >
                        <div style={{ 
                            position: 'absolute', 
                            width: '2048px', 
                            height: '2048px',
                            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                            transformOrigin: '0 0'
                        }}>
                            <img 
                                src={deerIsleMap} 
                                alt="Deer Isle Map" 
                                onLoad={handleImageLoad}
                                style={{ width: '100%', height: '100%', display: 'block' }}
                            />
                            <canvas 
                                ref={canvasRef}
                                style={{ 
                                    position: 'absolute', 
                                    top: 0, 
                                    left: 0, 
                                    width: '100%', 
                                    height: '100%',
                                    pointerEvents: 'none'
                                }}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
