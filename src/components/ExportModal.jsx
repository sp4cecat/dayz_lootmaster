import React, { useMemo, useState } from 'react';
import { generateLimitsXml, generateTypesXml } from '../utils/xml.js';

/**
 * Export modal allowing the user to export:
 * - types.xml for a specific group
 * - cfglimitsdefinition.xml built from current definitions
 *
 * @param {{
 *  groups: string[],
 *  defaultGroup?: string,
 *  getGroupTypes: (group: string) => import('../utils/xml.js').Type[],
 *  definitions: { categories: string[], usageflags: string[], valueflags: string[], tags: string[] },
 *  onClose: () => void
 * }} props
 */
export default function ExportModal({ groups, defaultGroup, getGroupTypes, definitions, onClose }) {
  const [mode, setMode] = useState(/** @type {'types'|'limits'} */('types'));
  const [group, setGroup] = useState(defaultGroup || groups[0] || '');

  const xml = useMemo(() => {
    if (mode === 'limits') {
      return generateLimitsXml(definitions);
    }
    const arr = getGroupTypes(group) || [];
    return generateTypesXml(arr);
  }, [mode, group, getGroupTypes, definitions]);

  const exportPath = useMemo(() => {
    if (mode === 'limits') return 'cfglimitsdefinition.xml';
    if (group === 'vanilla') return 'db/types.xml';
    return `db/types/${group}/types.xml`;
  }, [mode, group]);

  const onCopy = async () => {
    await navigator.clipboard.writeText(xml);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal full">
        <div className="modal-header">
          <h3>Export</h3>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Close</button>
          <button
            className="btn primary"
            onClick={onCopy}
            title="Copy to clipboard"
            aria-label="Copy to clipboard"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              style={{ marginRight: 6 }}
            >
              <path d="M9 3h6a2 2 0 0 1 2 2v1h-2.5a1.5 1.5 0 0 0-3 0H9V5a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <rect x="6" y="6" width="12" height="14" rx="2" ry="2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            </svg>
            <span>Copy to Clipboard</span>
          </button>
        </div>
        <div className="modal-body">
          <div className="filters-row" style={{ alignItems: 'center' }}>
            <label className="checkbox">
              <input
                type="radio"
                name="export-mode"
                checked={mode === 'types'}
                onChange={() => setMode('types')}
              />
              <span>Types for group</span>
            </label>
            <label className="checkbox">
              <input
                type="radio"
                name="export-mode"
                checked={mode === 'limits'}
                onChange={() => setMode('limits')}
              />
              <span>Limits definitions</span>
            </label>
            {mode === 'types' && (
              <label className="control" style={{ marginLeft: 'auto', minWidth: 180 }}>
                <span>Group</span>
                <select value={group} onChange={e => setGroup(e.target.value)}>
                  {groups.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="filters-row" aria-live="polite">
            <span className="muted">File: <code>{exportPath}</code></span>
          </div>
          <div className="code-block" aria-label="Export XML" role="region">
            {xml}
          </div>
        </div>
      </div>
    </div>
  );
}
