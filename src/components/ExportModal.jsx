import React, { useMemo, useState } from 'react';
import { generateLimitsXml, generateTypesXml, generateTypesXmlFromFilesWithComments } from '../utils/xml.js';
import { createZip } from '../utils/zip.js';

/**
 * Export modal allowing the user to export:
 * - types.xml for a specific group
 * - cfglimitsdefinition.xml built from current definitions
 *
 * @param {{
 *  groups: string[],
 *  defaultGroup?: string,
 *  getGroupTypes: (group: string) => import('../utils/xml.js').Type[],
 *  getGroupFiles: (group: string) => {file: string, types: import('../utils/xml.js').Type[]}[],
 *  definitions: { categories: string[], usageflags: string[], valueflags: string[], tags: string[] },
 *  onClose: () => void
 * }} props
 */
export default function ExportModal({ groups, defaultGroup, getGroupTypes, getGroupFiles, definitions, onClose }) {
  const [mode, setMode] = useState(/** @type {'types'|'limits'} */('types'));
  const [group, setGroup] = useState(defaultGroup || groups[0] || '');
  const filesForGroup = useMemo(() => (mode === 'types' && group ? getGroupFiles(group) : []), [mode, group, getGroupFiles]);
  const hasMultipleFiles = filesForGroup.length > 1;
  const [typesFormat, setTypesFormat] = useState(/** @type {'single'|'zip'} */('single'));

  const xml = useMemo(() => {
    if (mode === 'limits') {
      return generateLimitsXml(definitions);
    }
    if (hasMultipleFiles && typesFormat === 'single') {
      return generateTypesXmlFromFilesWithComments(filesForGroup);
    }
    const arr = getGroupTypes(group) || [];
    return generateTypesXml(arr);
  }, [mode, group, getGroupTypes, definitions, hasMultipleFiles, typesFormat, filesForGroup]);

  const exportPath = useMemo(() => {
    if (mode === 'limits') return 'cfglimitsdefinition.xml';
    if (typesFormat === 'zip' && hasMultipleFiles) {
      return `db/types/${group}/*.xml`;
    }
    if (group === 'vanilla') return 'db/types.xml';
    return `db/types/${group}/types.xml`;
  }, [mode, group, hasMultipleFiles, typesFormat]);

  const onCopy = async () => {
    await navigator.clipboard.writeText(xml);
  };

  const onDownloadZip = () => {
    if (!hasMultipleFiles || typesFormat !== 'zip') return;
    // Build per-file XMLs with original filenames
    const encoder = new TextEncoder();
    const files = filesForGroup.map(({ file, types }) => {
      const name = `${file}.xml`;
      const content = generateTypesXml(types);
      return { name, data: encoder.encode(content) };
    });
    const zip = createZip(files);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zip);
    a.download = `${group || 'types'}-types.zip`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal full">
        <div className="modal-header">
          <h3>Export</h3>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Close</button>
          {mode === 'types' && hasMultipleFiles && typesFormat === 'zip' ? (
            <button
              className="btn primary"
              onClick={onDownloadZip}
              title="Download ZIP"
              aria-label="Download ZIP"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                style={{ marginRight: 6 }}
              >
                <path d="M12 3v10m0 0l-3-3m3 3l3-3M5 17h14v3H5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>Download ZIP</span>
            </button>
          ) : (
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
          )}
        </div>
        <div className="modal-body">
          <div className="filters-row" style={{ alignItems: 'center', gap: 16 }}>
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
              <>
                <label className="control" style={{ marginLeft: 'auto', minWidth: 180 }}>
                  <span>Group</span>
                  <select value={group} onChange={e => setGroup(e.target.value)}>
                    {groups.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
                {hasMultipleFiles && (
                  <div className="checkbox" style={{ marginLeft: 8 }}>
                    <label className="checkbox" style={{ gap: 6 }}>
                      <input
                        type="radio"
                        name="types-format"
                        checked={typesFormat === 'single'}
                        onChange={() => setTypesFormat('single')}
                      />
                      <span>Single types.xml</span>
                    </label>
                    <label className="checkbox" style={{ gap: 6 }}>
                      <input
                        type="radio"
                        name="types-format"
                        checked={typesFormat === 'zip'}
                        onChange={() => setTypesFormat('zip')}
                      />
                      <span>Zip of files</span>
                    </label>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="filters-row" aria-live="polite">
            <span className="muted">File: <code>{exportPath}</code></span>
          </div>
          {!(mode === 'types' && hasMultipleFiles && typesFormat === 'zip') && (
            <div className="code-block" aria-label="Export XML" role="region">
              {xml}
            </div>
          )}
          {mode === 'types' && hasMultipleFiles && typesFormat === 'zip' && (
            <div className="muted" style={{ marginTop: 8 }}>
              This ZIP will include:
              <ul>
                {filesForGroup.map(({ file }) => (<li key={file}><code>{file}.xml</code></li>))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
