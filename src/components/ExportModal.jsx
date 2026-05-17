import React, { useEffect, useMemo, useState } from 'react';
import { generateLimitsXml, generateTypesXml, generateTypesXmlFromFilesWithComments } from '../utils/xml.js';
import { createZip } from '../utils/zip.js';
import { getChangeLogsForGroup } from '../utils/idb.js';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Badge } from './base/badges/badges';
import { cx } from '../utils/cx';
import { Download, Copy, FileText, Check } from 'lucide-react';

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
  const [downloadAll, setDownloadAll] = useState(false);
  const [copied, setCopied] = useState(false);

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

  // Helper: for vanilla_overrides/types, rehydrate _present from baseline vanilla
  const rehydrateOverrides = (types) => {
    const baseVanilla = Array.isArray(getBaselineFileTypes?.('vanilla', 'types'))
      ? getBaselineFileTypes('vanilla', 'types')
      : [];
    const baseByName = new Map(baseVanilla.map(t => [t.name, t]));
    return types.map(t => {
      const base = baseByName.get(t.name);
      if (!base || !base._present) return t;
      return { ...t, _present: { ...base._present } };
    });
  };

  const xml = useMemo(() => {
    if (mode === 'limits') {
      return generateLimitsXml(definitions);
    }
    if (hasMultipleFiles && typesFormat === 'single' && mode === 'types') {
      const prepared = group === 'vanilla_overrides'
        ? filesForGroup.map(({ file, types }) => ({ file, types: file === 'types' ? rehydrateOverrides(types) : types }))
        : filesForGroup;
      return generateTypesXmlFromFilesWithComments(prepared);
    }
    if (mode === 'types') {
      let arr = getGroupTypes(group) || [];
      if (group === 'vanilla_overrides') arr = rehydrateOverrides(arr);
      return generateTypesXml(arr);
    }
    return '';
  }, [mode, group, getGroupTypes, definitions, hasMultipleFiles, typesFormat, filesForGroup]);

  const exportPath = useMemo(() => {
    if (mode === 'limits') return 'cfglimitsdefinition.xml';
    if (mode === 'all') return `db/types/<non-vanilla groups>/*.xml (${downloadAll ? 'all' : 'changed'})`;
    if (typesFormat === 'zip') {
      return `db/types/${group}/*.xml (${downloadAll ? 'all' : 'changed'})`;
    }
    if (group === 'vanilla') return 'db/types.xml';
    return `db/types/${group}/types.xml`;
  }, [mode, group, typesFormat, downloadAll]);

  const onCopy = async () => {
    await navigator.clipboard.writeText(xml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatChangeValue = (v) => {
    if (Array.isArray(v)) return `[${v.join(', ')}]`;
    if (v && typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

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
        } catch {
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
      if (!anyAllChanged && !downloadAll) return;
      const encoder = new TextEncoder();
      const files = [];
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yy = String(now.getFullYear()).slice(-2);
      const hh = String(now.getHours());
      const mi = String(now.getMinutes());
      const ss = String(now.getSeconds());
      const changesFileName = `changes_${dd}-${mm}-${yy}_${hh}-${mi}-${ss}.txt`;

      const groupKeys = (downloadAll ? groups.filter(g => g !== 'vanilla') : Object.keys(allChangedMap)).sort((a, b) => a.localeCompare(b));

      for (const g of groupKeys) {
        const perFiles = getGroupFiles(g);
        const changedSet = downloadAll ? null : new Set(allChangedMap[g]);

        for (const { file, types } of perFiles) {
          if (changedSet && !changedSet.has(file)) continue;
          const name = `${g}/${file}.xml`;
          const content = (g === 'vanilla_overrides' && file === 'types')
            ? generateTypesXml(rehydrateOverrides(types))
            : generateTypesXml(types);
          files.push({ name, data: encoder.encode(content) });
        }

        try {
          const logs = await getChangeLogsForGroup(g, changedSet || undefined);
          const lines = [];
          lines.push(`Change log for group "${g}"`);
          lines.push(`Generated at ${now.toISOString()}`);
          lines.push('');
          if (logs.length === 0) {
            lines.push(downloadAll ? 'No changes recorded; full group exported.' : 'No changes recorded for the selected files.');
          } else {
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
              lines.push('');
            }
          }
          files.push({ name: `${g}/${changesFileName}`, data: encoder.encode(lines.join('\n')) });
        } catch {
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

    if (typesFormat !== 'zip') return;
    const encoder = new TextEncoder();
    const files = (downloadAll ? filesForGroup : filesForGroup.filter(({ file }) => changedFilesSet.has(file)))
      .map(({ file, types }) => {
        const name = `${file}.xml`;
        const content = (group === 'vanilla_overrides' && file === 'types')
          ? generateTypesXml(rehydrateOverrides(types))
          : generateTypesXml(types);
        return { name, data: encoder.encode(content) };
      });

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
          lines.push('');
        }
      }

      files.push({ name: changesFileName, data: encoder.encode(lines.join('\n')) });
    } catch {
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

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      {(mode === 'types' && typesFormat === 'zip') || (mode === 'all' && (anyAllChanged || downloadAll)) ? (
        <Button onClick={onDownloadZip} disabled={mode === 'all' && !anyAllChanged && !downloadAll}>
          <Download size={18} className="mr-2" /> Download ZIP
        </Button>
      ) : (
        <Button onClick={onCopy}>
          {copied ? <Check size={18} className="mr-2" /> : <Copy size={18} className="mr-2" />}
          {copied ? 'Copied!' : 'Copy to Clipboard'}
        </Button>
      )}
    </>
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Export XML"
      description="Select the group and format you'd like to export."
      maxWidth="max-w-5xl"
      footer={footer}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-6 p-4 bg-gray-50 rounded-lg border border-gray-100">
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="radio"
              name="export-mode"
              checked={mode === 'types'}
              onChange={() => setMode('types')}
              className="accent-primary-600 size-4"
            />
            <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900 transition-colors">Types for group</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="radio"
              name="export-mode"
              checked={mode === 'limits'}
              onChange={() => setMode('limits')}
              className="accent-primary-600 size-4"
            />
            <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900 transition-colors">Limits definitions</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="radio"
              name="export-mode"
              checked={mode === 'all'}
              onChange={() => setMode('all')}
              className="accent-primary-600 size-4"
            />
            <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900 transition-colors">All changed groups (ZIP)</span>
          </label>
          
          <div className="flex-1" />
          
          {mode === 'types' && (
            <div className="flex items-center gap-4">
              <select 
                value={group} 
                onChange={e => setGroup(e.target.value)}
                className="h-9 px-3 py-1 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-300 transition-all"
              >
                {changedGroups.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              
              {hasMultipleFiles && (
                <div className="flex bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
                  <button
                    onClick={() => setTypesFormat('single')}
                    className={cn(
                      "px-3 py-1 text-xs font-semibold rounded-md transition-all",
                      typesFormat === 'single' ? "bg-primary-50 text-primary-700 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    )}
                  >
                    Single XML
                  </button>
                  <button
                    onClick={() => setTypesFormat('zip')}
                    className={cn(
                      "px-3 py-1 text-xs font-semibold rounded-md transition-all",
                      typesFormat === 'zip' ? "bg-primary-50 text-primary-700 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    )}
                  >
                    ZIP of files
                  </button>
                </div>
              )}
            </div>
          )}
          
          {((mode === 'types' && typesFormat === 'zip') || mode === 'all') && (
            <label className="flex items-center gap-2 cursor-pointer group ml-4">
              <input
                type="checkbox"
                checked={downloadAll}
                onChange={e => setDownloadAll(e.target.checked)}
                className="accent-primary-600 size-4 rounded"
              />
              <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900">Download all</span>
            </label>
          )}
        </div>

        <div className="flex items-center gap-2 text-sm text-gray-500 font-mono bg-gray-50 px-3 py-2 rounded border border-gray-100">
          <FileText size={16} />
          <span>{exportPath}</span>
        </div>

        {!(mode === 'types' && hasMultipleFiles && typesFormat === 'zip') && (
          <div className="relative group">
            <pre className="p-4 bg-gray-900 text-gray-100 rounded-xl overflow-auto max-h-[400px] text-xs font-mono scrollbar-thin scrollbar-thumb-gray-700">
              {xml}
            </pre>
            <Button 
                variant="secondary" 
                size="sm" 
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={onCopy}
            >
                {copied ? <Check size={14} className="mr-1" /> : <Copy size={14} className="mr-1" />}
                {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        )}

        {mode === 'types' && typesFormat === 'zip' && (
          <div className="p-4 bg-primary-50 rounded-xl border border-primary-100">
            <p className="text-sm font-semibold text-primary-900 mb-2">ZIP Package Contents:</p>
            {(downloadAll || zipAvailable) ? (
              <ul className="grid grid-cols-2 gap-2">
                {(downloadAll ? filesForGroup : filesForGroup.filter(({ file }) => changedFilesSet.has(file))).map(({ file }) => (
                  <li key={file} className="flex items-center gap-2 text-xs text-primary-700">
                    <div className="size-1 bg-primary-400 rounded-full" />
                    <code className="font-semibold">{file}.xml</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-primary-600 italic">No changed files to export for this group.</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
