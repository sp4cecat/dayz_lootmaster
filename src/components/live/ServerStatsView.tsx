import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../base/modal/modal';
import { Badge } from '../base/badges/badges';
import { Button } from '../base/button/button';
import { BarChart3, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/utils/api';
import { useCfToolsStatus } from '@/hooks/useCfToolsStatus';

interface ServerStatsViewProps {
  onClose: () => void;
  selectedProfileId?: string;
  isPanel?: boolean;
}

const label = (key: string) =>
  key.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const fmt = (v: number) =>
  Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);

/**
 * Server statistics from CF Tools (/v1/server/{id}/statistics), rendered
 * defensively: the payload shape varies by plan/version, so numeric leaves are
 * flattened into stat tiles grouped by their top-level section instead of
 * binding to a fixed schema.
 */
export default function ServerStatsView({ onClose, selectedProfileId, isPanel = false }: ServerStatsViewProps) {
  const { status } = useCfToolsStatus(selectedProfileId);
  const [sections, setSections] = useState<{ title: string; stats: { key: string; value: number }[] }[]>([]);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/cftools/stats', { profileId: selectedProfileId });
      const body = res.ok ? await res.json() : null;
      if (body?.connected && body.statistics) {
        const stats = body.statistics.statistics ?? body.statistics;
        const out: { title: string; stats: { key: string; value: number }[] }[] = [];
        const rootStats: { key: string; value: number }[] = [];
        for (const [key, value] of Object.entries(stats as Record<string, unknown>)) {
          if (typeof value === 'number') {
            rootStats.push({ key, value });
          } else if (value && typeof value === 'object') {
            const nested = Object.entries(value as Record<string, unknown>)
              .filter((e): e is [string, number] => typeof e[1] === 'number')
              .map(([k, v]) => ({ key: k, value: v }));
            if (nested.length) out.push({ title: label(key), stats: nested });
          }
        }
        if (rootStats.length) out.unshift({ title: 'General', stats: rootStats });
        setSections(out);
        setStale(!!body.stale);
        setReason(out.length ? null : 'empty');
      } else {
        setSections([]);
        setReason(body?.reason || 'unreachable');
      }
    } catch {
      setSections([]);
      setReason('unreachable');
    } finally {
      setLoading(false);
    }
  }, [selectedProfileId]);

  useEffect(() => { load(); }, [load]);

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Server Statistics"
      description="Aggregated server metrics via the CF Tools Cloud Data API."
      icon={BarChart3}
      inline={isPanel}
    >
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          {status.connected
            ? <Badge color="success" size="sm">Connected{status.nickname ? ` — ${status.nickname}` : ''}</Badge>
            : <Badge color="gray" size="sm">Not connected</Badge>}
          {stale && <Badge color="warning" size="sm">stale</Badge>}
          <Button size="sm" variant="secondary-gray" icon={RefreshCw} onClick={load} disabled={loading} className="ml-auto">
            Refresh
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400">Loading statistics…</p>
        ) : sections.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {reason === 'empty'
              ? 'CF Tools returned no statistics for this server yet.'
              : 'Statistics unavailable — check the CF Tools connection on the Profiles screen.'}
          </p>
        ) : (
          sections.map(section => (
            <div key={section.title}>
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">{section.title}</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {section.stats.map(({ key, value }) => (
                  <div
                    key={key}
                    className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40"
                  >
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate" title={label(key)}>{label(key)}</p>
                    <p className="text-lg font-bold text-gray-900 dark:text-white">{fmt(value)}</p>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
