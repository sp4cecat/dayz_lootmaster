import React, { useEffect, useState, useRef } from 'react';
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
    const [error, setError] = useState(null);
    const [coords, setCoords] = useState([]);
    const [pointRadius, setPointRadius] = useState(20);
    const [opacity, setOpacity] = useState(0.5);
    
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const [mapLoaded, setMapLoaded] = useState(false);

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

    const drawHeatMap = () => {
        const canvas = canvasRef.current;
        if (!canvas || !mapLoaded) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (coords.length === 0) return;

        // Draw points
        ctx.globalCompositeOperation = 'screen';
        
        coords.forEach(pos => {
            // DayZ X -> Canvas X
            // DayZ Z -> Canvas Y (Inverted)
            const x = (pos.x / WORLD_SIZE) * canvas.width;
            const y = (1 - (pos.z / WORLD_SIZE)) * canvas.height;

            const grad = ctx.createRadialGradient(x, y, 0, x, y, pointRadius);
            grad.addColorStop(0, `rgba(255, 69, 0, ${opacity})`);
            grad.addColorStop(1, 'rgba(255, 69, 0, 0)');
            
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, pointRadius, 0, Math.PI * 2);
            ctx.fill();
        });
    };

    useEffect(() => {
        drawHeatMap();
    }, [coords, mapLoaded, pointRadius, opacity]);

    const handleImageLoad = () => {
        setMapLoaded(true);
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ width: '95vw', height: '95vh', maxWidth: 'none', display: 'flex', flexDirection: 'column' }}>
                <div className="modal-header">
                    <h3>Deer Isle Heat Map</h3>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginLeft: '20px' }}>
                        <label>Start:</label>
                        <DateTimePicker value={start} onChange={setStart} format="y-MM-dd HH:mm:ss" />
                        <label>End:</label>
                        <DateTimePicker value={end} onChange={setEnd} format="y-MM-dd HH:mm:ss" />
                        <button className="btn-primary" onClick={fetchData} disabled={loading}>
                            {loading ? 'Loading...' : 'Fetch Data'}
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginLeft: 'auto', marginRight: '20px' }}>
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
                <div className="modal-body" style={{ flex: 1, overflow: 'hidden', position: 'relative', background: '#000', padding: 0 }}>
                    {error && <div className="error-message" style={{ position: 'absolute', top: 10, left: 10, zIndex: 100, background: 'rgba(255,0,0,0.8)', color: 'white', padding: '5px 10px', borderRadius: '4px' }}>{error}</div>}
                    <div 
                        ref={containerRef}
                        style={{ 
                            width: '100%', 
                            height: '100%', 
                            overflow: 'auto', 
                            display: 'flex', 
                            justifyContent: 'center', 
                            alignItems: 'center' 
                        }}
                    >
                        <div style={{ position: 'relative', width: '2048px', height: '2048px' }}>
                            <img 
                                src={deerIsleMap} 
                                alt="Deer Isle Map" 
                                onLoad={handleImageLoad}
                                style={{ width: '100%', height: '100%', display: 'block' }}
                            />
                            <canvas 
                                ref={canvasRef}
                                width={2048}
                                height={2048}
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
