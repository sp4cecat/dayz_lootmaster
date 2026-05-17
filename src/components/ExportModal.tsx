import React, { useEffect, useMemo, useState } from 'react';
import { generateTypesXml, generateTypesXmlFromFilesWithComments } from '../utils/xml.js';
import { createZip } from '../utils/zip.js';
import { Modal } from '@/components/base/modal/modal';
import { Button } from '@/components/base/button/button';
import { Badge } from '@/components/base/badges/badges';
import { cx } from '@/utils/cx';
import { Download, Copy, FileText, Check } from 'lucide-react';

interface ExportModalProps {
  onClose: () => void;
  groups: string[];
  getGroupTypes: (group: string) => any[];
  getGroupFiles: (group: string) => Record<string, string>;
}

export default function ExportModal({ onClose, groups, getGroupTypes, getGroupFiles }: ExportModalProps) {
  const [selectedGroup, setSelectedGroup] = useState(groups[0] || 'vanilla');
  const [typesFormat, setTypesFormat] = useState<'single' | 'zip'>('single');
  const [includeComments, setIncludeComments] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [copied, setCopied] = useState(false);

  const groupFiles = useMemo(() => getGroupFiles(selectedGroup), [selectedGroup, getGroupFiles]);
  const hasMultipleFiles = useMemo(() => Object.keys(groupFiles).length > 1, [groupFiles]);

  useEffect(() => {
    if (copied) {
      const t = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(t);
    }
  }, [copied]);

  const handleExportTypes = async () => {
    setIsExporting(true);
    try {
      const types = getGroupTypes(selectedGroup);
      
      if (typesFormat === 'zip' && hasMultipleFiles) {
        const files = getGroupFiles(selectedGroup);
        const xmlFiles: Record<string, string> = {};
        
        for (const [name, content] of Object.entries(files)) {
          const fileTypes = types.filter(t => t.file === name);
          xmlFiles[`${name}.xml`] = includeComments 
            ? generateTypesXmlFromFilesWithComments(fileTypes, { [name]: content })
            : generateTypesXml(fileTypes);
        }
        
        const zip = await createZip(xmlFiles);
        const blob = new Blob([zip], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${selectedGroup}_types.zip`;
        a.click();
      } else {
        const xml = includeComments 
          ? generateTypesXmlFromFilesWithComments(types, groupFiles)
          : generateTypesXml(types);
        
        const blob = new Blob([xml], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${selectedGroup}_types.xml`;
        a.click();
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopyTypes = () => {
    const types = getGroupTypes(selectedGroup);
    const xml = generateTypesXml(types);
    navigator.clipboard.writeText(xml);
    setCopied(true);
  };

  const footer = (
    <>
      <Button variant="secondary-gray" onClick={onClose}>Cancel</Button>
      <Button variant="secondary-gray" onClick={handleCopyTypes} icon={copied ? Check : Copy}>
        {copied ? 'Copied' : 'Copy XML'}
      </Button>
      <Button onClick={handleExportTypes} icon={Download} disabled={isExporting}>
        {isExporting ? 'Exporting...' : 'Download Files'}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Export Configuration"
      description="Download your changes as XML files or copy them to your clipboard."
      footer={footer}
      icon={FileText}
    >
      <div className="space-y-8">
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-bold text-gray-700 dark:text-gray-300">Select Group</label>
            <Badge color="gray" size="sm">{groups.length} groups available</Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {groups.map(g => (
              <button
                key={g}
                onClick={() => setSelectedGroup(g)}
                className={cx(
                  "px-4 py-3 text-sm font-semibold rounded-xl border transition-all text-left flex items-center justify-between group",
                  selectedGroup === g 
                    ? "bg-primary-50 border-primary-200 text-primary-700 ring-1 ring-primary-200 dark:bg-primary-900/20 dark:border-primary-800 dark:text-primary-300"
                    : "bg-white border-gray-200 text-gray-600 hover:border-primary-200 hover:bg-gray-50 dark:bg-gray-900 dark:border-gray-800 dark:text-gray-400"
                )}
              >
                <span className="truncate">{g}</span>
                {selectedGroup === g && <div className="size-1.5 rounded-full bg-primary-600 dark:bg-primary-400 shrink-0 ml-2" />}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-4 p-6 bg-gray-50 dark:bg-gray-950/20 rounded-2xl border border-gray-100 dark:border-gray-800">
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Export Options</h4>
          
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">Output Format</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Choose how multiple files should be exported.</p>
              </div>
              
              {hasMultipleFiles && (
                <div className="flex bg-white border border-gray-200 rounded-lg p-1 shadow-sm dark:bg-gray-900 dark:border-gray-800">
                  <button
                    onClick={() => setTypesFormat('single')}
                    className={cx(
                      "px-3 py-1 text-xs font-semibold rounded-md transition-all",
                      typesFormat === 'single' ? "bg-primary-50 text-primary-700 shadow-sm dark:bg-primary-900/40 dark:text-primary-300" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    )}
                  >
                    Single XML
                  </button>
                  <button
                    onClick={() => setTypesFormat('zip')}
                    className={cx(
                      "px-3 py-1 text-xs font-semibold rounded-md transition-all",
                      typesFormat === 'zip' ? "bg-primary-50 text-primary-700 shadow-sm dark:bg-primary-900/40 dark:text-primary-300" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    )}
                  >
                    ZIP of files
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">Preserve Comments</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Maintain original XML comments and structure where possible.</p>
              </div>
              <div 
                className={cx(
                  "w-12 h-6 rounded-full p-1 cursor-pointer transition-colors relative",
                  includeComments ? "bg-primary-600" : "bg-gray-200 dark:bg-gray-800"
                )}
                onClick={() => setIncludeComments(!includeComments)}
              >
                <div className={cx(
                  "size-4 bg-white rounded-full transition-transform shadow-sm",
                  includeComments ? "translate-x-6" : "translate-x-0"
                )} />
              </div>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}
