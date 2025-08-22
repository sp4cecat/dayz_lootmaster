import React, { useEffect, useMemo, useState } from 'react';
import { generateLimitsXml, generateTypesXml, generateTypesXmlFromFilesWithComments } from '../utils/xml.js';
import { createZip } from '../utils/zip.js';
import { getChangeLogsForGroup } from '../utils/idb.js';

/**
 * Export modal allowing the user to export:
 * - types.xml for a specific group
 * - cfglimitsdefinition.xml built from current definitions
 * - all changed non-vanilla groups as a ZIP (only changed files)
 *
 * @param {{
 *  groups: string[],
 *  defaultGroup?: string,
 *  getGroupTypes: (group: string) => import('../utils/xml.js').Type[],
 *  getGroupFiles: (group: string) => {file: string, types: import('../utils/xml.js').Type[]}[],
 *  definitions: { categories: string[], usageflags: string[], valueflags: string[], tags: string[] },
 *  storageDiff?: { files: Record<string, Record<string, { changed: boolean }>> },
 *  onClose: () => void
 * }} props
 */
export default function ExportModal({ groups, defaultGroup, getGroupTypes, getGroupFiles, getBaselineFileTypes, definitions, storageDiff, onClose }) {
  const [mode, setMode] = useState(/** @type {'types'|'limits'|'all'} */('types'));
  const [group, setGroup] = useState(defaultGroup || groups[0] || '');
  const filesForGroup = useMemo(() => (mode === 'types' && group ? getGroupFiles(group) : []), [mode, group, getGroupFiles]);
  const hasMultipleFiles = filesForGroup.length > 1;
  const [typesFormat, setTypesFormat] = useState(/** @type {'single'|'zip'} */('single'));

  // Which groups have at least one changed file (exclude 'vanilla')
  const changedGroups = useMemo(() => {
    if (!storageDiff || !storageDiff.files) return [];
    return groups.filter(g => g !== 'vanilla').filter(g => {
      const per = storageDiff.files[g];
      return per && Object.values(per).some(info => info.changed);
    });
  }, [storageDiff, groups]);

  // Ensure selected group is valid when exporting types
  useEffect(() => {
    if (mode !== 'types') return;
    if (changedGroups.length === 0) return;
    if (!changedGroups.includes(group)) {
      setGroup(changedGroups[0]);
    }
  }, [mode, changedGroups, group]);

  // Determine which files in the selected group have changed
  const changedFiles = useMemo(() => {
    if (mode !== 'types' || !group || !storageDiff || !storageDiff.files || !storageDiff.files[group]) return [];
    return Object.entries(storageDiff.files[group])
      .filter(([, info]) => info.changed)
      .map(([file]) => file);
  }, [mode, group, storageDiff]);

  const changedFilesSet = useMemo(() => new Set(changedFiles), [changedFiles]);
  const zipAvailable = changedFiles.length > 0;

  // For "all" mode: build a list of groups->changed files (non-vanilla only)
  const allChangedMap = useMemo(() => {
    /** @type {Record<string, string[]>} */
    const out = {};
    if (!storageDiff || !storageDiff.files) return out;
    for (const g of groups) {
      if (g === 'vanilla') continue;
      const per = storageDiff.files[g];
      if (!per) continue;
      const files = Object.entries(per).filter(([, info]) => info.changed).map(([f]) => f);
      if (files.length) out[g] = files.sort((a, b) => a.localeCompare(b));
    }
    return out;
  }, [storageDiff, groups]);

  const anyAllChanged = useMemo(() => Object.keys(allChangedMap).length > 0, [allChangedMap]);

  const xml = useMemo(() => {
    if (mode === 'limits') {
      return generateLimitsXml(definitions);
    }
    if (hasMultipleFiles && typesFormat === 'single' && mode === 'types') {
      return generateTypesXmlFromFilesWithComments(filesForGroup);
    }
    if (mode === 'types') {
      const arr = getGroupTypes(group) || [];
      return generateTypesXml(arr);
    }
    return ''; // no single-XML preview for "all" zip mode
  }, [mode, group, getGroupTypes, definitions, hasMultipleFiles, typesFormat, filesForGroup]);

  const exportPath = useMemo(() => {
    if (mode === 'limits') return 'cfglimitsdefinition.xml';
    if (mode === 'all') return 'db/types/<non-vanilla groups>/*.xml (changed)';
    if (typesFormat === 'zip' && zipAvailable) {
      return `db/types/${group}/*.xml (changed)`;
    }
    if (group === 'vanilla') return 'db/types.xml';
    return `db/types/${group}/types.xml`;
  }, [mode, group, zipAvailable, typesFormat]);

  const onCopy = async () => {
    await navigator.clipboard.writeText(xml);
  };

  const formatChangeValue = (v) => {
    if (Array.isArray(v)) return `[${v.join(', ')}]`;
    if (v && typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  // Normalization compatible with diff logic in the hook
  const normalizeType = (t) => ({
    name: t?.name,
    category: t?.category || null,
    nominal: t?.nominal,
    min: t?.min,
    lifetime: t?.lifetime,
    restock: t?.restock,
    quantmin: t?.quantmin,
    quantmax: t?.quantmax,
    flags: t?.flags || {},
    usage: [...(t?.usage || [])].sort(),
    value: [...(t?.value || [])].sort(),
    tag: [...(t?.tag || [])].sort(),
  });

  // Build inlined fields spec; if old/new not present on entry, derive from baseline vs current
  const buildFieldsSpec = (entry, group) => {
    let specs = [];
    const flagDiffList = (ov = {}, nv = {}) => {
      const keys = Array.from(new Set([...Object.keys(ov || {}), ...Object.keys(nv || {})])).sort((a, b) => a.localeCompare(b));
      const to01 = (v) => (v ? 1 : 0);
      const diffs = [];
      for (const k of keys) {
        const a = to01(ov?.[k]);
        const b = to01(nv?.[k]);
        if (a !== b) diffs.push(`${k}: ${a} > ${b}`);
      }
      return diffs;
    };

    if (entry.action === 'modified') {
      if (entry.oldValues && entry.newValues && Array.isArray(entry.fields) && entry.fields.length) {
        specs = entry.fields.flatMap(fkey => {
          const ov = entry.oldValues[fkey];
          const nv = entry.newValues[fkey];
          if (fkey === 'Flags') {
            const diffs = flagDiffList(ov, nv);
            return diffs.length ? [`Flags(${diffs.join(', ')})`] : [];
          }
          return [`${fkey}(${formatChangeValue(ov)} > ${formatChangeValue(nv)})`];
        });
      } else if (entry.file && entry.typeName) {
        // Fallback: compute old/new from baseline and current types
        try {
          const baseArr = getBaselineFileTypes(group, entry.file) || [];
          const currArr = (getGroupFiles(group) || []).find(f => f.file === entry.file)?.types || [];
          const a = normalizeType(baseArr.find(t => t.name === entry.typeName) || {});
          const b = normalizeType(currArr.find(t => t.name === entry.typeName) || {});
          const localSpecs = [];

          const pushIf = (label, key) => { if (a[key] !== b[key]) localSpecs.push(`${label}(${formatChangeValue(a[key])} > ${formatChangeValue(b[key])})`); };
          pushIf('Category', 'category');
          pushIf('Nominal', 'nominal');
          pushIf('Min', 'min');
          pushIf('Lifetime', 'lifetime');
          pushIf('Restock', 'restock');
          pushIf('Quantmin', 'quantmin');
          pushIf('Quantmax', 'quantmax');
          if (JSON.stringify(a.flags) !== JSON.stringify(b.flags)) {
            const diffs = flagDiffList(a.flags, b.flags);
            if (diffs.length) localSpecs.push(`Flags(${diffs.join(', ')})`);
          }
          if (JSON.stringify(a.usage) !== JSON.stringify(b.usage)) localSpecs.push(`Usage(${formatChangeValue(a.usage)} > ${formatChangeValue(b.usage)})`);
          if (JSON.stringify(a.value) !== JSON.stringify(b.value)) localSpecs.push(`Value(${formatChangeValue(a.value)} > ${formatChangeValue(b.value)})`);
          if (JSON.stringify(a.tag) !== JSON.stringify(b.tag)) localSpecs.push(`Tag(${formatChangeValue(a.tag)} > ${formatChangeValue(b.tag)})`);

          specs = localSpecs;
        } catch (_e) {
          // ignore; fallback to field names only
          specs = Array.isArray(entry.fields) ? entry.fields : [];
        }
      }
    } else {
      specs = Array.isArray(entry.fields) ? entry.fields : [];
    }
    return specs.length ? ` [fields: ${specs.join(', ')}]` : '';
  };

  const onDownloadZip = async () => {
    if (mode === 'all') {
      // Build a zip with all changed files across non-vanilla groups
      if (!anyAllChanged) return;
      const encoder = new TextEncoder();
      const files = [];

      // Shared timestamp used for all changelog filenames to keep them consistent in the zip
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yy = String(now.getFullYear()).slice(-2);
      const hh = String(now.getHours());
      const mi = String(now.getMinutes());
      const ss = String(now.getSeconds());
      const changesFileName = `changes_${dd}-${mm}-${yy}_${hh}-${mi}-${ss}.txt`;

      for (const g of Object.keys(allChangedMap).sort((a, b) => a.localeCompare(b))) {
        const changedSet = new Set(allChangedMap[g]);
        const perFiles = getGroupFiles(g);

        // Add changed XML files for this group
        for (const { file, types } of perFiles) {
          if (!changedSet.has(file)) continue;
          const name = `${g}/${file}.xml`;
          const content = generateTypesXml(types);
          files.push({ name, data: encoder.encode(content) });
        }

        // Build and add per-group changelog (only for changed files)
        try {
          const logs = await getChangeLogsForGroup(g, changedSet);
          const lines = [];
          lines.push(`Change log for group "${g}"`);
          lines.push(`Generated at ${now.toISOString()}`);
          lines.push('');
          if (logs.length === 0) {
            lines.push('No changes recorded for the selected files.');
          } else {
            // Group by file
            const byFile = new Map();
            for (const e of logs) {
              if (!byFile.has(e.file)) byFile.set(e.file, []);
              byFile.get(e.file).push(e);
            }
            const sortedFiles = Array.from(byFile.keys()).sort((a, b) => a.localeCompare(b));
            for (const f of sortedFiles) {
              lines.push(`File: ${f}.xml`);
              const arr = byFile.get(f);
              for (const e of arr) {
                const ts = new Date(e.ts);
                const tdd = String(ts.getDate()).padStart(2, '0');
                const tmm = String(ts.getMonth() + 1).padStart(2, '0');
                const tyy = String(ts.getFullYear()).slice(-2);
                const th = String(ts.getHours());
                const tm = String(ts.getMinutes()).padStart(2, '0');
                const ts2 = String(ts.getSeconds()).padStart(2, '0');

                const fieldsSpec = buildFieldsSpec(e, g);
                lines.push(`${tdd}-${tmm}-${tyy} ${th}:${tm}:${ts2} - [${e.editorID || 'unknown'}] ${e.typeName} ${e.action}${fieldsSpec}`);
              }
              lines.push(''); // spacer
            }
          }
          files.push({ name: `${g}/${changesFileName}`, data: encoder.encode(lines.join('\n')) });
        } catch (_e) {
          const note = `Failed to load change logs for group "${g}". Exported at ${now.toISOString()}.`;
          files.push({ name: `${g}/${changesFileName}`, data: encoder.encode(note) });
        }
      }

      if (!files.length) return;
      const zip = createZip(files);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zip);
      a.download = `changed-groups-types.zip`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 0);
      return;
    }

    if (!zipAvailable || typesFormat !== 'zip') return;
    // Build per-file XMLs with original filenames, only for changed files (single group)
    const encoder = new TextEncoder();
    const files = filesForGroup
      .filter(({ file }) => changedFilesSet.has(file))
      .map(({ file, types }) => {
        const name = `${file}.xml`;
        const content = generateTypesXml(types);
        return { name, data: encoder.encode(content) };
      });

    // Build changes text file for only the changed files
    try {
      const logs = await getChangeLogsForGroup(group, changedFilesSet);
      const lines = [];
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yy = String(now.getFullYear()).slice(-2);
      const hh = String(now.getHours());
      const mi = String(now.getMinutes());
      const ss = String(now.getSeconds());
      const changesFileName = `changes_${dd}-${mm}-${yy}_${hh}-${mi}-${ss}.txt`;

      lines.push(`Change log for group "${group}"`);
      lines.push(`Generated at ${now.toISOString()}`);
      lines.push('');
      if (logs.length === 0) {
        lines.push('No changes recorded for the selected files.');
      } else {
        // Group by file
        const byFile = new Map();
        for (const e of logs) {
          if (!byFile.has(e.file)) byFile.set(e.file, []);
          byFile.get(e.file).push(e);
        }
        const sortedFiles = Array.from(byFile.keys()).sort((a, b) => a.localeCompare(b));
        for (const f of sortedFiles) {
          lines.push(`File: ${f}.xml`);
          const arr = byFile.get(f);
          for (const e of arr) {
            const ts = new Date(e.ts);
            const tdd = String(ts.getDate()).padStart(2, '0');
            const tmm = String(ts.getMonth() + 1).padStart(2, '0');
            const tyy = String(ts.getFullYear()).slice(-2);
            const th = String(ts.getHours());
            const tm = String(ts.getMinutes()).padStart(2, '0');
            const ts2 = String(ts.getSeconds()).padStart(2, '0');

            const fieldsSpec = buildFieldsSpec(e, group);
            lines.push(`${tdd}-${tmm}-${tyy} ${th}:${tm}:${ts2} - [${e.editorID || 'unknown'}] ${e.typeName} ${e.action}${fieldsSpec}`);
          }
          lines.push(''); // spacer between files
        }
      }

      files.push({ name: changesFileName, data: encoder.encode(lines.join('\n')) });
    } catch (_e) {
      // If logs fail, include a minimal note
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yy = String(now.getFullYear()).slice(-2);
      const hh = String(now.getHours());
      const mi = String(now.getMinutes());
      const ss = String(now.getSeconds());
      const changesFileName = `changes_${dd}-${mm}-${yy}_${hh}-${mi}-${ss}.txt`;
      const note = `Failed to load change logs. Exported at ${now.toISOString()}.`;
      files.push({ name: changesFileName, data: new TextEncoder().encode(note) });
    }

    if (!files.length) return;
    const zip = createZip(files);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zip);
    a.download = `${group || 'types'}-types-changed.zip`;
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
          <h3>Export Changed Types</h3>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Close</button>
          {(mode === 'types' && typesFormat === 'zip' && zipAvailable) || (mode === 'all' && anyAllChanged) ? (
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
            <label className="checkbox" title={anyAllChanged ? 'Export changed files across all non-vanilla groups' : 'No changed files across non-vanilla groups'}>
              <input
                type="radio"
                name="export-mode"
                checked={mode === 'all'}
                onChange={() => setMode('all')}
              />
              <span>All changed groups (zip)</span>
            </label>
            {mode === 'types' && (
              <>
                <label className="control" style={{ marginLeft: 'auto', minWidth: 180 }}>
                  <span>Group</span>
                  <select value={group} onChange={e => setGroup(e.target.value)}>
                    {changedGroups.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
                {hasMultipleFiles && zipAvailable && (
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
                      <span>Zip of changed files</span>
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
          {mode === 'types' && typesFormat === 'zip' && (
            <div className="muted" style={{ marginTop: 8 }}>
              {zipAvailable ? (
                <>
                  This ZIP will include:
                  <ul>
                    {filesForGroup.filter(({ file }) => changedFilesSet.has(file)).map(({ file }) => (
                      <li key={file}><code>{file}.xml</code></li>
                    ))}
                  </ul>
                </>
              ) : (
                <span>No changed files to export for this group.</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
