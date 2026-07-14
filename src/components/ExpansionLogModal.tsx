import { useEffect, useState } from 'react';
import { DatePicker } from './base/datepicker/datepicker';
import { Input } from './base/input/input';
import { Button } from './base/button/button';
import { Checkbox } from './base/checkbox/checkbox';
import { Modal } from './base/modal/modal';
import { cx } from '../utils/cx';
import { FileText, MapPin, Users, Download, AlertTriangle } from 'lucide-react';
import moment from 'moment';
import {
  CalendarDateTime,
  fromDate, 
  toCalendarDateTime, 
  getLocalTimeZone 
} from '@internationalized/date';

interface ExpansionLogModalProps {
  onClose: () => void;
  selectedProfileId: string;
  getApiBase: () => string;
  isPanel?: boolean;
}

interface Player {
  id: string;
  aliases: string[];
}

export default function ExpansionLogModal({ onClose, selectedProfileId, getApiBase, isPanel = false }: ExpansionLogModalProps) {
  const [start, setStart] = useState<CalendarDateTime | null>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return toCalendarDateTime(fromDate(d, getLocalTimeZone()));
  });
  const [end, setEnd] = useState<CalendarDateTime | null>(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return toCalendarDateTime(fromDate(d, getLocalTimeZone()));
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Optional spatial filter
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [radius, setRadius] = useState('');
  const [playersInRadiusOnly, setPlayersInRadiusOnly] = useState(false);

  // Refine records further (players) UI
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastText, setLastText] = useState('');

  // Enable the checkbox only if all three numeric values are set and > 0
  const canRadiusFilter = (() => {
    const xn = Number(x), yn = Number(y), rn = Number(radius);
    return Number.isFinite(xn) && Number.isFinite(yn) && Number.isFinite(rn) && xn !== 0 && yn !== 0 && rn > 0;
  })();

  // Auto-uncheck if inputs become invalid
  useEffect(() => {
    if (!canRadiusFilter && playersInRadiusOnly) {
      setPlayersInRadiusOnly(false);
    }
  }, [canRadiusFilter, playersInRadiusOnly]);

  const formatForFilename = (date: CalendarDateTime) => {
    const d = date.toDate(getLocalTimeZone());
    return moment(d).format('YYYY-MM-DD_HH-mm-ss');
  };

  // Parse unique players and their aliases from content
  const parsePlayersFromText = (text: string): Player[] => {
    const map = new Map<string, Set<string>>();
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!/Player/i.test(line)) continue;
      const idMatch = /\(id=([^=]+=)/i.exec(line);
      const aliasMatch = /Player "([^"]+)"/i.exec(line);
      if (!idMatch) continue;
      const id = idMatch[1];
      const alias = aliasMatch ? aliasMatch[1] : undefined;
      if (!map.has(id)) map.set(id, new Set());
      if (alias) map.get(id)!.add(alias);
    }
    return Array.from(map.entries()).map(([id, set]) => ({
      id,
      aliases: Array.from(set.values())
    }));
  };

  const toggleSelectId = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sanitizeForFilename = (s: string) => String(s).replace(/[^A-Za-z0-9._-]+/g, '-');

  const refineAndDownload = () => {
    try {
      if (!lastText || selectedIds.size === 0) return;
      const lines = lastText.split(/\r?\n/);
      const out = [];
      // Keep header if present
      if (lines.length > 0 && /^ExpansionLog started on\s+\d{4}-\d{2}-\d{2}\s+at\s+\d{1,2}:\d{2}:\d{2}/.test(lines[0])) {
        out.push(lines[0]);
      }
      // Filter lines by selected ids (keep order)
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const m = /\(id=(\S+)\s/i.exec(line);
        if (m && selectedIds.has(m[1])) {
          out.push(line);
        }
      }

      // Filename includes aliases of selected ids (deduped)
      const idToAliases = new Map(players.map(p => [p.id, p.aliases || []]));
      const aliasSet = new Set<string>();
      selectedIds.forEach(id => {
        const arr = idToAliases.get(id) || [];
        if (arr.length === 0) aliasSet.add(id);
        else arr.forEach(a => aliasSet.add(a));
      });
      const aliasesPart = Array.from(aliasSet).map(sanitizeForFilename).join('+') || 'selected';

      const blob = new Blob([out.join('\n')], { type: 'text/plain;charset=utf-8' });
      let baseName = 'refined';
      if (start && end) {
        baseName = `${formatForFilename(start)}_to_${formatForFilename(end)}`;
      }
      const filename = `${baseName}__players_${aliasesPart}.log`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 0);
    } catch (e) {
      setError(String(e));
    }
  };

  const fetchExpansionLog = async () => {
    setError(null);
    if (!start || !end) {
      setError('Please choose both start and end.');
      return;
    }

    const sM = moment(start.toDate(getLocalTimeZone()));
    const eM = moment(end.toDate(getLocalTimeZone()));
    
    if (eM.isBefore(sM)) {
      setError('End date must be after start date.');
      return;
    }

    // Spatial filter validation: require all of x, y, radius or none
    const hasX = String(x).trim() !== '';
    const hasY = String(y).trim() !== '';
    const hasR = String(radius).trim() !== '';
    const anySet = hasX || hasY || hasR;
    const allSet = hasX && hasY && hasR;
    if (anySet && !allSet) {
      setError('You must set a value for EACH of x, y and radius or leave them blank');
      return;
    }

    setBusy(true);
    try {
      const API_BASE = getApiBase();

      const payload: any = {
        start: sM.clone().utcOffset(600, true).format('YYYY-MM-DD HH:mm:ss'),
        end: eM.clone().utcOffset(600, true).format('YYYY-MM-DD HH:mm:ss')
      };

      const xn = Number(x), yn = Number(y), rn = Number(radius);
      const hasSpatial = Number.isFinite(xn) && Number.isFinite(yn) && Number.isFinite(rn) && xn !== 0 && yn !== 0 && rn > 0;
      if (hasSpatial) {
        Object.assign(payload, { x: xn, y: yn, radius: rn, expandByIds: !!playersInRadiusOnly });
      }

      const res = await fetch(`${API_BASE}/api/logs/expansion`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Profile-ID': selectedProfileId
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Fetch failed (${res.status}) ${msg}`);
      }
      const text = await res.text();

      // Parse players for "Refine Records Further"
      setPlayers(parsePlayersFromText(text));
      setSelectedIds(new Set());
      setLastText(text);

      // Download the returned content as file
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });

      const filterPart = hasSpatial
        ? `__pos_x${String(x).replace(/[^0-9.-]+/g, '')}_y${String(y).replace(/[^0-9.-]+/g, '')}_r${String(radius).replace(/[^0-9.-]+/g, '')}`
        : '';

      const filename = `${formatForFilename(start)}_to_${formatForFilename(end)}${filterPart}.log`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 0);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Expansion Log Records"
      description="Fetch and filter Expansion Mod logs by time and location."
      icon={FileText}
      maxWidth="max-w-4xl"
      inline={isPanel}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DatePicker 
            label="From" 
            value={start} 
            onChange={setStart} 
            granularity="minute"
          />
          <DatePicker 
            label="To" 
            value={end} 
            onChange={setEnd} 
            granularity="minute"
          />
        </div>

        <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-200 dark:border-gray-800 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <MapPin size={18} className="text-primary-600" />
            Spatial Filter (Optional)
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input 
              label="X Coordinate" 
              placeholder="e.g. 12081.5" 
              value={x} 
              onChange={e => setX(e.target.value)} 
              type="number"
              step="any"
            />
            <Input 
              label="Y Coordinate" 
              placeholder="e.g. 7214" 
              value={y} 
              onChange={e => setY(e.target.value)} 
              type="number"
              step="any"
            />
            <Input 
              label="Radius" 
              placeholder="e.g. 250" 
              value={radius} 
              onChange={e => setRadius(e.target.value)} 
              type="number"
              step="any"
              min="0"
            />
          </div>
          <Checkbox
            label="Return ALL position data for players appearing in this target radius"
            isSelected={playersInRadiusOnly}
            onChange={setPlayersInRadiusOnly}
            isDisabled={!canRadiusFilter}
          />
        </div>

        {players.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <Users size={18} className="text-primary-600" />
              Refine Records Further
            </div>
            <div className="flex flex-wrap gap-2">
              {players.map(p => {
                const caption = p.aliases && p.aliases.length ? p.aliases.join(' / ') : p.id;
                const selected = selectedIds.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleSelectId(p.id)}
                    className={cx(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                      selected 
                        ? "bg-primary-50 border-primary-200 text-primary-700 dark:bg-primary-900/30 dark:border-primary-800 dark:text-primary-300" 
                        : "bg-white border-gray-200 text-gray-700 hover:border-gray-300 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300"
                    )}
                    title={`ID: ${p.id}`}
                  >
                    {caption}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3">
              <Button 
                variant="secondary" 
                onClick={refineAndDownload} 
                disabled={selectedIds.size === 0 || !lastText}
                icon={Download}
                type="button"
              >
                Refine and Download
              </Button>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Tip: Select players above to refine the already downloaded log file.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 bg-error-50 border border-error-200 rounded-lg text-sm text-error-700 dark:bg-error-900/20 dark:border-error-800 dark:text-error-400">
            <AlertTriangle size={18} />
            {error}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button 
            variant="primary" 
            onClick={fetchExpansionLog} 
            disabled={busy}
            className="w-full md:w-auto"
            type="button"
          >
            {busy ? 'Fetching...' : 'Fetch Logs'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
