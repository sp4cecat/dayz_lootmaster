import React, { useState } from 'react';
import DateTimePicker from 'react-datetime-picker';
import 'react-datetime-picker/dist/DateTimePicker.css';
import 'react-calendar/dist/Calendar.css';
import 'react-clock/dist/Clock.css';

export default function AdmRecordsModal({ onClose }) {
  const [start, setStart] = useState(/** @type {Date|null} */(null));
  const [end, setEnd] = useState(/** @type {Date|null} */(null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Optional spatial filter
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [radius, setRadius] = useState('');

  const formatForFilename = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  };

  // If user selects a start date and end is empty, default end to the same date/time
  const onStartChange = (val) => {
    setStart(val);
    if (val && (end === null || end === undefined)) {
      try {
        setEnd(new Date(val));
      } catch {
        // ignore invalid values
      }
    }
  };

  const fetchAdm = async () => {
    setError(null);
    if (!start || !end) {
      setError('Please choose both start and end.');
      return;
    }
    const s = start instanceof Date ? start : new Date(start);
    const e = end instanceof Date ? end : new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || s > e) {
      setError('Invalid date/time range.');
      return;
    }

    // Normalize default times if user left them blank:
    // - Start defaults to 00:00
    // - End defaults to 23:59
    const sNorm = new Date(s);
    if (sNorm.getHours() === 0 && sNorm.getMinutes() === 0) {
      sNorm.setHours(0, 0, 0, 0);
    }
    const eNorm = new Date(e);
    if (eNorm.getHours() === 0 && eNorm.getMinutes() === 0) {
      eNorm.setHours(23, 59, 59, 999);
    }

    setBusy(true);
    try {
      const savedBase = localStorage.getItem('dayz-editor:apiBase');
      const defaultBase = `${window.location.protocol}//${window.location.hostname}:4317`;
      const API_BASE = (savedBase && savedBase.trim()) ? savedBase.trim().replace(/\/+$/, '') : defaultBase;

      // Build payload; include spatial filter only if all three are valid numbers
      const payload = { start: sNorm.toISOString(), end: eNorm.toISOString() };
      const xn = Number(x), yn = Number(y), rn = Number(radius);
      if (Number.isFinite(xn) && Number.isFinite(yn) && Number.isFinite(rn) && radius !== '') {
        Object.assign(payload, { x: xn, y: yn, radius: rn });
      }

      const res = await fetch(`${API_BASE}/api/logs/adm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Fetch failed (${res.status}) ${msg}`);
      }
      const blob = await res.blob();
      const filename = `${formatForFilename(s)}_to_${formatForFilename(e)}.ADM`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 0);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="ADM records">
      <div className="modal adm-modal">
        <div className="modal-header">
          <h3>ADM records</h3>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">
          <div className="adm-controls-row">
            <label className="control adm-control">
              <span>From</span>
              <div className="dtp-wrap">
                <DateTimePicker
                  onChange={onStartChange}
                  value={start}
                  disableClock
                  clearIcon={null}
                  calendarIcon={null}
                  format="y-MM-dd HH:mm"
                  hourPlaceholder="H"
                  minutePlaceholder="M"
                />
              </div>
            </label>
            <label className="control adm-control">
              <span>To</span>
              <div className="dtp-wrap">
                <DateTimePicker
                  onChange={setEnd}
                  value={end}
                  disableClock
                  clearIcon={null}
                  calendarIcon={null}
                  format="y-MM-dd HH:mm"
                  hourPlaceholder="H"
                  minutePlaceholder="M"
                />
              </div>
            </label>
          </div>

          {/* Spatial filter row */}
          <div className="adm-xy-row">
            <label className="control">
              <span>X</span>
              <input
                type="number"
                value={x}
                onChange={e => setX(e.target.value)}
                placeholder="e.g. 12081.5"
                step="any"
                inputMode="decimal"
              />
            </label>
            <label className="control">
              <span>Y</span>
              <input
                type="number"
                value={y}
                onChange={e => setY(e.target.value)}
                placeholder="e.g. 7214"
                step="any"
                inputMode="decimal"
              />
            </label>
            <label className="control">
              <span>Radius</span>
              <input
                type="number"
                value={radius}
                onChange={e => setRadius(e.target.value)}
                placeholder="e.g. 250"
                step="any"
                inputMode="decimal"
                min="0"
              />
            </label>
          </div>

          {error && <div className="banner warn" style={{ marginTop: 8 }}>{error}</div>}
          <div style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={fetchAdm} disabled={busy}>
              {busy ? 'Fetching…' : 'Fetch'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
