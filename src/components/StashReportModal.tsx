import { useState } from 'react';
import { Modal } from './base/modal/modal';
import { Button } from './base/button/button';
import { DatePicker } from './base/datepicker/datepicker';
import { Archive, BarChart01, XClose } from '@untitledui/icons';
import {
  CalendarDateTime,
  getLocalTimeZone
} from '@internationalized/date';
import { apiFetch } from '@/utils/api';

interface PlayerReport {
  id: string;
  aliases: string[];
  dugIn?: number;
  dugUpOwn?: number;
  dugUpOthers?: number;
}

interface StashReportModalProps {
  onClose: () => void;
  selectedProfileId: string;
  isPanel?: boolean;
}

export default function StashReportModal({ onClose, selectedProfileId, isPanel = false }: StashReportModalProps) {
  const [start, setStart] = useState<CalendarDateTime | null>(null);
  const [end, setEnd] = useState<CalendarDateTime | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PlayerReport[] | null>(null);

  const onGenerate = async () => {
    try {
      setBusy(true);
      setError(null);
      setReport(null);

      const payload: any = {};
      if (start) payload.start = start.toDate(getLocalTimeZone()).toISOString();
      if (end) payload.end = end.toDate(getLocalTimeZone()).toISOString();

      const res = await apiFetch(`/api/logs/stash-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        profileId: selectedProfileId,
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Report failed (${res.status}) ${msg}`);
      }
      const json = await res.json();
      setReport(Array.isArray(json.players) ? json.players : []);
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const filteredRows = (report || []).filter(r => ((r.dugIn || 0) + (r.dugUpOwn || 0) + (r.dugUpOthers || 0)) > 0);

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Underground Stash Report"
      description="Analyze player stash activity including digging in and digging up stashes."
      icon={Archive}
      maxWidth="max-w-5xl"
      inline={isPanel}
      footer={<Button variant="secondary" onClick={onClose} type="button">Close</Button>}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-200 dark:border-gray-800">
          <DatePicker 
            label="From (Optional)" 
            value={start} 
            onChange={setStart} 
            granularity="minute"
          />
          <DatePicker 
            label="To (Optional)" 
            value={end} 
            onChange={setEnd} 
            granularity="minute"
          />
          <div className="md:col-span-2 flex justify-end pt-2">
            <Button variant="primary" onClick={onGenerate} disabled={busy} icon={BarChart01} type="button">
              {busy ? 'Generating...' : 'Generate Report'}
            </Button>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-error-50 border border-error-200 rounded-lg text-sm text-error-700 flex items-center gap-2 dark:bg-error-900/20 dark:border-error-800 dark:text-error-400">
            <XClose size={18} />
            {error}
          </div>
        )}

        {report && (
          <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <h4 className="text-md font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Archive size={18} className="text-primary-600" />
              Activity by Player
            </h4>
            
            {filteredRows.length === 0 ? (
              <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 p-8 rounded-xl text-center text-sm text-gray-500 italic">
                No underground stash activity found for the selected time range.
              </div>
            ) : (
              <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-gray-50 dark:bg-gray-900/80 border-b border-gray-200 dark:border-gray-800">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Player ID</th>
                      <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Aliases</th>
                      <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 text-right">Dug In</th>
                      <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 text-right">Dug Up (Own)</th>
                      <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 text-right">Dug Up (Others)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-950">
                    {filteredRows.map((row) => (
                      <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-gray-900 dark:text-gray-100">{row.id}</td>
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{(row.aliases || []).join(' / ')}</td>
                        <td className="px-4 py-3 text-right font-medium">{row.dugIn || 0}</td>
                        <td className="px-4 py-3 text-right font-medium text-success-600">{row.dugUpOwn || 0}</td>
                        <td className="px-4 py-3 text-right font-medium text-error-600">{row.dugUpOthers || 0}</td>
                      </tr>
                    ))}
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
