import React, { useEffect, useState } from 'react';
import DateTimePicker from 'react-datetime-picker';
import 'react-datetime-picker/dist/DateTimePicker.css';
import 'react-calendar/dist/Calendar.css';
import 'react-clock/dist/Clock.css';
import moment from 'moment';

export default function AdmRecordsModal({ onClose, selectedProfileId }) {
  const [start, setStart] = useState(/** @type {Date|null} */(null));
  const [end, setEnd] = useState(/** @type {Date|null} */(null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Optional spatial filter
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [radius, setRadius] = useState('');
  const [playersInRadiusOnly, setPlayersInRadiusOnly] = useState(false);

  // Refine records further (players) UI
  const [players, setPlayers] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [lastText, setLastText] = useState('');

  // Enable the checkbox only if all three numeric values are set and > 0
  const canRadiusFilter = (() => {
    const xn = Number(x), yn = Number(y), rn = Number(radius);
    return Number.isFinite(xn) && Number.isFinite(yn) && Number.isFinite(rn) && xn !== 0 && yn !== 0 && rn > 0;
  })();

  // Auto-uncheck if inputs become invalid
  useEffect(() => {
    if (!canRadiusFilter && playersInRadiusOnly) {
      setPlayersInRadiusOnly(false);
    }
  }, [canRadiusFilter, playersInRadiusOnly]);

  const formatForFilename = (d) => {
    const m = moment(d);
    return m.isValid() ? m.format('YYYY-MM-DD_HH-mm-ss') : 'invalid-date';
  };

  // Parse unique players and their aliases from content
  const parsePlayersFromText = (text) => {
    /** @type {Map<string, Set<string>>} */
    const map = new Map();
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      // Only consider lines that look like player events
      if (!/Player/i.test(line)) continue;
      const idMatch = /\(id=([^=]+=)/i.exec(line);
      const aliasMatch = /Player "([^"]+)"/i.exec(line);
      if (!idMatch) continue;
      const id = idMatch[1];
      const alias = aliasMatch ? aliasMatch[1] : undefined;
      if (!map.has(id)) map.set(id, new Set());
      if (alias) map.get(id).add(alias);
    }
    // Convert to array of {id, aliases[]}
    return Array.from(map.entries()).map(([id, set]) => ({
      id,
      aliases: Array.from(set.values())
    }));
  };

  const toggleSelectId = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sanitizeForFilename = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '-');

  const refineAndDownload = () => {
    try {
      if (!lastText || selectedIds.size === 0) return;
      const lines = lastText.split(/\r?\n/);
      const out = [];
      // Keep header if present
      if (lines.length > 0 && /^AdminLog started on\s+\d{4}-\d{2}-\d{2}\s+at\s+\d{1,2}:\d{2}:\d{2}/.test(lines[0])) {
        out.push(lines[0]);
      }
      // Filter lines by selected ids (keep order)
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const m = /\(id=(\S+)\s/i.exec(line);
        if (m && selectedIds.has(m[1])) {
          out.push(line);
        }
      }

      // Filename includes aliases of selected ids (deduped)
      const idToAliases = new Map(players.map(p => [p.id, p.aliases || []]));
      const aliasSet = new Set();
      selectedIds.forEach(id => {
        const arr = idToAliases.get(id) || [];
        if (arr.length === 0) aliasSet.add(id); // fallback to id if no alias
        else arr.forEach(a => aliasSet.add(a));
      });
      const aliasesPart = Array.from(aliasSet).map(sanitizeForFilename).join('+') || 'selected';

      const blob = new Blob([out.join('\n')], { type: 'text/plain;charset=utf-8' });
      // Try to include original time range if available
      let baseName = 'refined';
      const header = lines[0] || '';
      const hdrMatch = /^AdminLog started on\s+(\d{4}-\d{2}-\d{2})\s+at\s+(\d{1,2}:\d{2}:\d{2})/.exec(header);
      if (hdrMatch && start && end) {
        const nameStart = formatForFilename(start instanceof Date ? start : new Date(start));
        const nameEnd = formatForFilename(end instanceof Date ? end : new Date(end));
        baseName = `${nameStart}_to_${nameEnd}`;
      }
      const filename = `${baseName}__players_${aliasesPart}.ADM`;
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
    }
  };

  // When start changes, ensure end is after start; if not, set end to same date at 23:59
  const onStartChange = (val) => {
    setStart(val);
    if (!val) return;
    try {
      const startDate = val instanceof Date ? new Date(val) : new Date(val);
      const endDate = end ? (end instanceof Date ? new Date(end) : new Date(end)) : null;

      const needAdjust =
        !endDate ||
        isNaN(endDate.getTime()) ||
        endDate <= startDate;

      if (needAdjust) {
        const d = new Date(startDate);
        d.setHours(23, 59, 0, 0);
        setEnd(d);
      }
    } catch {
      // ignore invalid values
    }
  };

  const fetchAdm = async () => {
    setError(null);
    if (!start || !end) {
      setError('Please choose both start and end.');
      return;
    }

    const sM = moment(start);
    const eM = moment(end);
    if (!sM.isValid() || !eM.isValid() || !eM.isSameOrAfter(sM)) {
      setError('Invalid date/time range.');
      return;
    }

    // Spatial filter validation: require all of x, y, radius or none
    const hasX = String(x).trim() !== '';
    const hasY = String(y).trim() !== '';
    const hasR = String(radius).trim() !== '';
    const anySet = hasX || hasY || hasR;
    const allSet = hasX && hasY && hasR;
    if (anySet && !allSet) {
      setError('You must set a value for EACH of x, y and radius or leave them blank');
      return;
    }

    // Normalize default times if user left them blank:
    // - Start defaults to 00:00
    // - End defaults to 23:59
    const sNorm = sM.clone();
    if (sNorm.hour() === 0 && sNorm.minute() === 0) {
      sNorm.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
    }
    const eNorm = eM.clone();
    if (eNorm.hour() === 0 && eNorm.minute() === 0) {
      eNorm.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });
    }

    setBusy(true);
    try {
      const savedBase = localStorage.getItem('dayz-editor:apiBase');
      const defaultBase = `${window.location.protocol}//${window.location.hostname}:4317`;
      const API_BASE = (savedBase && savedBase.trim()) ? savedBase.trim().replace(/\/+$/, '') : defaultBase;

      // Build payload: send as UTC+10 local strings (no timezone), matching server expectations
      const payload = {
        start: sNorm.clone().utcOffset(600, true).format('YYYY-MM-DD HH:mm:ss'),
        end: eNorm.clone().utcOffset(600, true).format('YYYY-MM-DD HH:mm:ss')
      };

      const xn = Number(x), yn = Number(y), rn = Number(radius);
      const hasSpatial = Number.isFinite(xn) && Number.isFinite(yn) && Number.isFinite(rn) && xn !== 0 && yn !== 0 && rn > 0;
      if (hasSpatial) {
        Object.assign(payload, { x: xn, y: yn, radius: rn, expandByIds: !!playersInRadiusOnly });
      }

      const res = await fetch(`${API_BASE}/api/logs/adm`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Profile-ID': selectedProfileId
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Fetch failed (${res.status}) ${msg}`);
      }
      const text = await res.text();

      // Parse players for "Refine Records Further"
      setPlayers(parsePlayersFromText(text));
      setSelectedIds(new Set()); // reset selection
      setLastText(text);

      // Download the returned content as file
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });

      // If spatial parameters are set and valid, always include them in the filename
      const filterPart = hasSpatial
        ? `__pos_x${String(x).replace(/[^0-9.-]+/g, '')}_y${String(y).replace(/[^0-9.-]+/g, '')}_r${String(radius).replace(/[^0-9.-]+/g, '')}`
        : '';

      const filename = `${formatForFilename(sNorm.toDate())}_to_${formatForFilename(eNorm.toDate())}${filterPart}.ADM`;

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

            <label className="checkbox" style={{ marginLeft: 'auto', alignSelf: 'center' }}>
              <input
                type="checkbox"
                checked={playersInRadiusOnly}
                onChange={e => setPlayersInRadiusOnly(e.target.checked)}
                disabled={!canRadiusFilter}
              />
              <span>Return ALL position data for players appearing in this target radius</span>
            </label>
          </div>

          {players.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h4 style={{ margin: '8px 0' }}>Refine Records Further</h4>
              <div className="chips selectable">
                {players.map(p => {
                  const caption = p.aliases && p.aliases.length ? p.aliases.join(' / ') : p.id;
                  const selected = selectedIds.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`chip ${selected ? 'selected' : ''}`}
                      title={`ID: ${p.id}`}
                      onClick={() => toggleSelectId(p.id)}
                    >
                      {caption}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  className="btn"
                  onClick={refineAndDownload}
                  disabled={selectedIds.size === 0 || !lastText}
                  title={selectedIds.size === 0 ? 'Select one or more players to refine' : 'Download refined records for selected players'}
                >
                  Refine and Download
                </button>
              </div>

              <p className="muted" style={{ marginTop: 6 }}>
                Tip: Click aliases to select players for further filtering (download above already completed).
              </p>
            </div>
          )}

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
