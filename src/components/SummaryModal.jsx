import React from 'react';

/**
 * Summary modal to display information about consumed configuration after initial load.
 *
 * @param {{
 *  summary: { typesTotal: number, definitions: { categories: number, usageflags: number, valueflags: number, tags: number }, groups?: { name: string, count: number, files?: string[] }[] },
 *  onClose: () => void
 * }} props
 */
export default function SummaryModal({ summary, onClose }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Configuration summary">
      <div className="modal">
        <div className="modal-header">
          <h2>Configuration loaded</h2>
        </div>
        <div className="modal-body">
          <p>
            Parsed XML data has been loaded successfully.
          </p>

          <div className="summary-section">
            <h3>Types</h3>
            <p>
              Total types loaded: <strong>{summary.typesTotal}</strong>
            </p>
          </div>

          <div className="summary-section">
            <h3>Definitions</h3>
            <ul className="bulleted">
              <li>Categories: <strong>{summary.definitions.categories}</strong></li>
              <li>Usage flags: <strong>{summary.definitions.usageflags}</strong></li>
              <li>Value flags: <strong>{summary.definitions.valueflags}</strong></li>
              <li>Tags: <strong>{summary.definitions.tags}</strong></li>
            </ul>
          </div>

          {Array.isArray(summary.groups) && summary.groups.length > 0 && (
            <div className="summary-section">
              <h3>Groups</h3>
              <ul className="bulleted">
                {summary.groups.map(g => (
                  <li key={g.name}>
                    <strong>{g.name}</strong>: {g.count} types
                    {Array.isArray(g.files) && g.files.length > 0 && (
                      <ul className="muted">
                        {g.files.map(f => <li key={f}>{f}</li>)}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
