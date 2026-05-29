import React, { useState } from 'react';
import { Modal } from './base/modal/modal';
import { Button } from './base/button/button';
import { FileSearch01, CheckCircle, AlertTriangle, XClose } from '@untitledui/icons';
import { cx } from '@/utils/cx';

interface Totals {
  files: number;
  ok: number;
  failed: number;
}

interface Failure {
  path: string;
  type: 'xml' | 'json';
  error: string;
  line?: number;
  column?: number;
}

interface Report {
  ok: boolean;
  dataDir: string;
  totals: Totals;
  failures: Failure[];
}

interface LintFilesModalProps {
  onClose: () => void;
  selectedProfileId: string;
}

export default function LintFilesModal({ onClose, selectedProfileId }: LintFilesModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  const onRun = async () => {
    try {
      setBusy(true);
      setError(null);
      setReport(null);

      const savedBase = localStorage.getItem('dayz-editor:apiBase');
      const defaultBase = `${window.location.protocol}//${window.location.hostname}:4317`;
      const API_BASE = (savedBase && savedBase.trim()) ? savedBase.trim().replace(/\/+$/, '') : defaultBase;

      const res = await fetch(`${API_BASE}/api/lint`, { 
        method: 'GET',
        headers: { 'X-Profile-ID': selectedProfileId }
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Lint failed (${res.status}) ${msg}`);
      }
      const json = await res.json();
      setReport(json);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const failures = report?.failures || [];

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Lint Configuration Files"
      description="Check all XML and JSON mission files for syntax errors and structural integrity."
      icon={FileSearch01}
      maxWidth="max-w-5xl"
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div className="space-y-6">
        {error && (
          <div className="p-3 bg-error-50 border border-error-200 rounded-lg text-sm text-error-700 flex items-center gap-2 dark:bg-error-900/20 dark:border-error-800 dark:text-error-400">
            <XClose size={18} />
            {error}
          </div>
        )}

        <div className="bg-gray-50 dark:bg-gray-900/50 p-6 rounded-xl border border-gray-200 dark:border-gray-800 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Run Full Integrity Check</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">This will scan all files in the current mission profile.</p>
          </div>
          <Button variant="primary" onClick={onRun} disabled={busy} icon={FileSearch01}>
            {busy ? 'Scanning...' : 'Run Lint Check'}
          </Button>
        </div>

        {report && (
          <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm">
                <div className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Total Files</div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">{report.totals?.files ?? 0}</div>
              </div>
              <div className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm">
                <div className="text-xs text-success-600 uppercase font-bold tracking-wider mb-1">Passed</div>
                <div className="text-2xl font-bold text-success-700">{report.totals?.ok ?? 0}</div>
              </div>
              <div className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm">
                <div className="text-xs text-error-600 uppercase font-bold tracking-wider mb-1">Failed</div>
                <div className="text-2xl font-bold text-error-700">{report.totals?.failed ?? 0}</div>
              </div>
              <div className="bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm">
                <div className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Status</div>
                <div className={cx(
                    "text-sm font-bold flex items-center gap-1.5 mt-2 px-2 py-1 rounded-full w-fit",
                    report.totals?.failed === 0 
                      ? "bg-success-50 text-success-700 dark:bg-success-900/20" 
                      : "bg-error-50 text-error-700 dark:bg-error-900/20"
                )}>
                  {report.totals?.failed === 0 ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                  {report.totals?.failed === 0 ? 'All Healthy' : 'Issues Found'}
                </div>
              </div>
            </div>

            <div className="text-xs text-gray-400 px-1">
              Mission Path: <code className="text-gray-600 dark:text-gray-300">{report.dataDir}</code>
            </div>

            {failures.length === 0 ? (
              <div className="bg-success-50 dark:bg-success-900/10 border border-success-200 dark:border-success-800/30 p-8 rounded-xl text-center">
                <div className="flex justify-center mb-3">
                  <div className="size-12 bg-success-100 dark:bg-success-900/30 rounded-full flex items-center justify-center text-success-600">
                    <CheckCircle size={24} />
                  </div>
                </div>
                <h5 className="text-lg font-bold text-success-900 dark:text-success-400">All Good!</h5>
                <p className="text-sm text-success-700 dark:text-success-500">No syntax errors or structural issues were found in your configuration files.</p>
              </div>
            ) : (
              <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-gray-50 dark:bg-gray-900/80 border-b border-gray-200 dark:border-gray-800">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">File Path</th>
                      <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 w-24">Type</th>
                      <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Error Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-950">
                    {failures.map((f, i) => {
                      const hasLoc = typeof f.line === 'number' && typeof f.column === 'number';
                      const msg = hasLoc ? `${f.error} (line ${f.line}, col ${f.column})` : f.error;
                      return (
                        <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-gray-900 dark:text-gray-100">{f.path}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200 uppercase">
                              {f.type}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-error-700 dark:text-error-400 font-medium">{msg}</td>
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
    </Modal>
  );
}
