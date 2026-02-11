import React, { useState } from 'react';
import DateTimePicker from 'react-datetime-picker';
import 'react-datetime-picker/dist/DateTimePicker.css';
import 'react-calendar/dist/Calendar.css';
import 'react-clock/dist/Clock.css';

export default function StashReportModal({ onClose, selectedProfileId }) {
  const [start, setStart] = useState(/** @type {Date|null} */(null));
  const [end, setEnd] = useState(/** @type {Date|null} */(null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(/** @type {{id:string, aliases:string[], count:number}[]|null} */(null));

  const onGenerate = async () => {
    try {
      setBusy(true);
      setError(null);
      setReport(null);

      // Build payload (start/end optional)
      const payload = {};
      if (start instanceof Date) payload.start = start.toISOString();
      if (end instanceof Date) payload.end = end.toISOString();

      const savedBase = localStorage.getItem('dayz-editor:apiBase');
      const defaultBase = `${window.location.protocol}//${window.location.hostname}:4317`;
      const API_BASE = (savedBase && savedBase.trim()) ? savedBase.trim().replace(/\/+$/, '') : defaultBase;

      const res = await fetch(`${API_BASE}/api/logs/stash-report`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Profile-ID': selectedProfileId
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Report failed (${res.status}) ${msg}`);
      }
      const json = await res.json();
      setReport(Array.isArray(json.players) ? json.players : []);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Stash report">
      <div className="modal fullscreen-modal">
        <div className="modal-header">
          <h3>Stash report</h3>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">
          <div className="adm-controls-row">
            <label className="control adm-control">
              <span>From</span>
              <div className="dtp-wrap">
                <DateTimePicker
                  onChange={setStart}
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

          {error && <div className="banner warn" style={{ marginTop: 8 }}>{error}</div>}

          <div style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={onGenerate} disabled={busy}>
              {busy ? 'Generating…' : 'Generate Report'}
            </button>
          </div>

          {Array.isArray(report) && (
            <div style={{ marginTop: 16 }}>
              <h4>Underground stashes by player</h4>
              {(() => {
                const rows = (report || []).filter(r => ((r.dugIn || 0) + (r.dugUpOwn || 0) + (r.dugUpOthers || 0)) > 0);
                if (rows.length === 0) {
                  return <div className="muted">No entries found for the selected time range.</div>;
                }
                return (
                  <div style={{ overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                    <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '8px' }}>Player ID</th>
                          <th style={{ textAlign: 'left', padding: '8px' }}>Aliases</th>
                          <th style={{ textAlign: 'right', padding: '8px' }}>Dug In</th>
                          <th style={{ textAlign: 'right', padding: '8px' }}>Dug Up (Own)</th>
                          <th style={{ textAlign: 'right', padding: '8px' }}>Dug Up (Others)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.id}>
                            <td style={{ padding: '8px', fontFamily: 'monospace' }}>{row.id}</td>
                            <td style={{ padding: '8px' }}>{(row.aliases || []).join(' / ')}</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>{row.dugIn || 0}</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>{row.dugUpOwn || 0}</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>{row.dugUpOthers || 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
