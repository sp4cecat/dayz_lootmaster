import React, { useState } from 'react';

export default function LintFilesModal({ onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(/** @type {null|{ ok:boolean, dataDir:string, totals:{files:number,ok:number,failed:number}, failures:{path:string,type:'xml'|'json',error:string}[] }} */(null));

  const onRun = async () => {
    try {
      setBusy(true);
      setError(null);
      setReport(null);

      const savedBase = localStorage.getItem('dayz-editor:apiBase');
      const defaultBase = `${window.location.protocol}//${window.location.hostname}:4317`;
      const API_BASE = (savedBase && savedBase.trim()) ? savedBase.trim().replace(/\/+$/, '') : defaultBase;

      const res = await fetch(`${API_BASE}/api/lint`, { method: 'GET' });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Lint failed (${res.status}) ${msg}`);
      }
      const json = await res.json();
      setReport(json);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const failures = (report && Array.isArray(report.failures)) ? report.failures : [];

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Lint files">
      <div className="modal fullscreen-modal">
        <div className="modal-header">
          <h3>Lint files</h3>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">
          {error && <div className="banner warn" style={{ marginTop: 8 }}>{error}</div>}

          <div style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={onRun} disabled={busy}>
              {busy ? 'Linting…' : 'Run Lint'}
            </button>
          </div>

          {report && (
            <div style={{ marginTop: 16 }}>
              <div className="muted" style={{ marginBottom: 8 }}>
                Data dir: <code>{report.dataDir}</code> — Files: {report.totals?.files ?? 0}, OK: {report.totals?.ok ?? 0}, Failed: {report.totals?.failed ?? 0}
              </div>
              {failures.length === 0 ? (
                <div className="banner" role="status" style={{ marginTop: 8 }}>All good. No lint errors found.</div>
              ) : (
                <div style={{ overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '8px' }}>File</th>
                        <th style={{ textAlign: 'left', padding: '8px' }}>Type</th>
                        <th style={{ textAlign: 'left', padding: '8px' }}>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failures.map((f, i) => {
                        const hasLoc = typeof f.line === 'number' && typeof f.column === 'number';
                        const msg = hasLoc ? `${f.error} (line ${f.line}, col ${f.column})` : f.error;
                        return (
                          <tr key={i}>
                            <td style={{ padding: '8px', fontFamily: 'monospace' }}>{f.path}</td>
                            <td style={{ padding: '8px' }}>{f.type}</td>
                            <td style={{ padding: '8px' }}>{msg}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
