import { useEffect, useState } from 'react';
import { DatePicker } from './base/datepicker/datepicker';
import { Input } from './base/input/input';
import { Button } from './base/button/button';
import { Checkbox } from './base/checkbox/checkbox';
import { Modal } from './base/modal/modal';
import { cx } from '../utils/cx';
import { apiFetch } from '../utils/api';
import { FileText, MapPin, Users, Download, AlertTriangle, CheckCircle2 } from 'lucide-react';
import moment from 'moment';
import { 
  CalendarDateTime, 
  fromDate, 
  toCalendarDateTime, 
  getLocalTimeZone 
} from '@internationalized/date';

interface AdmRecordsModalProps {
  onClose: () => void;
  selectedProfileId: string;
  isPanel?: boolean;
}

interface Player {
  id: string;
  aliases: string[];
}

export default function AdmRecordsModal({ onClose, selectedProfileId, isPanel = false }: AdmRecordsModalProps) {
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
  const [notice, setNotice] = useState<{ tone: 'warning' | 'success'; text: string } | null>(null);

  // Optional spatial filter. Axes follow the engine convention: X easting, Z northing,
  // Y elevation. The log's pos=<> writes them as <x, z, y>, so the northing the user
  // filters on is the 2nd value in the log line -- see tryParseLinePos in server/index.js.
  const [x, setX] = useState('');
  const [z, setZ] = useState('');
  const [radius, setRadius] = useState('');
  const [playersInRadiusOnly, setPlayersInRadiusOnly] = useState(false);

  // Refine records further (players) UI
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastText, setLastText] = useState('');

  // The spatial filter is active only when all three fields are non-blank and numeric.
  // Blankness is tested on the string, not on Number(v) !== 0 -- otherwise a legitimate
  // coordinate of 0 silently disables the filter and the whole log comes back.
  const spatial = (() => {
    if (![x, z, radius].every(v => String(v).trim() !== '')) return null;
    const xn = Number(x), zn = Number(z), rn = Number(radius);
    if (!Number.isFinite(xn) || !Number.isFinite(zn) || !(rn > 0)) return null;
    return { xn, zn, rn };
  })();

  // Enable the checkbox only if the spatial filter would actually be applied
  const canRadiusFilter = !!spatial;

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

  // Mirrors the server's tryParseLineId so ids harvested here match the ones it filters on.
  // Must not be greedy past the closing paren: lines without a pos= (e.g. "is connecting")
  // end in "...=)" and a \S+ capture would swallow the ")".
  const parseLineId = (line: string): string | null => /\(id=([^)\s=]+=?)/i.exec(line)?.[1] ?? null;

  // Parse unique players and their aliases from content
  const parsePlayersFromText = (text: string): Player[] => {
    const map = new Map<string, Set<string>>();
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!/Player/i.test(line)) continue;
      const id = parseLineId(line);
      const aliasMatch = /Player "([^"]+)"/i.exec(line);
      if (!id) continue;
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
      if (lines.length > 0 && /^AdminLog started on\s+\d{4}-\d{2}-\d{2}\s+at\s+\d{1,2}:\d{2}:\d{2}/.test(lines[0])) {
        out.push(lines[0]);
      }
      // Filter lines by selected ids (keep order)
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const id = parseLineId(line);
        if (id && selectedIds.has(id)) {
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
      const filename = `${baseName}__players_${aliasesPart}.ADM`;
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

  const fetchAdminLog = async () => {
    setError(null);
    setNotice(null);
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

    // Spatial filter validation: require all of x, z, radius or none
    const hasX = String(x).trim() !== '';
    const hasZ = String(z).trim() !== '';
    const hasR = String(radius).trim() !== '';
    const anySet = hasX || hasZ || hasR;
    const allSet = hasX && hasZ && hasR;
    if (anySet && !allSet) {
      setError('You must set a value for EACH of x, z and radius or leave them blank');
      return;
    }

    setBusy(true);
    try {
      const payload: any = {
        start: sM.clone().utcOffset(600, true).format('YYYY-MM-DD HH:mm:ss'),
        end: eM.clone().utcOffset(600, true).format('YYYY-MM-DD HH:mm:ss')
      };

      if (spatial) {
        // Send `z` -- the server's primary key. Its `y` fallback is only for legacy clients.
        Object.assign(payload, {
          x: spatial.xn,
          z: spatial.zn,
          radius: spatial.rn,
          expandByIds: !!playersInRadiusOnly
        });
      }

      const res = await apiFetch(`/api/logs/adm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        profileId: selectedProfileId,
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Fetch failed (${res.status}) ${msg}`);
      }
      const text = await res.text();

      // Server-side diagnostics (see Access-Control-Expose-Headers on /api/logs/adm).
      // If these read back as null the headers are not being exposed by the API.
      const num = (name: string) => {
        const raw = res.headers.get(name);
        if (raw == null) return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      };
      const matchCount = num('X-Adm-Match-Count');
      const filesFound = num('X-Adm-Files-Found');
      const filesDated = num('X-Adm-Files-Dated');
      const linesInRange = num('X-Adm-Lines-In-Range');
      const nearest = num('X-Adm-Nearest-Distance');

      // Parse players for "Refine Records Further"
      setPlayers(parsePlayersFromText(text));
      setSelectedIds(new Set());
      setLastText(text);

      if (matchCount === 0) {
        // Nothing matched -- explain why instead of downloading a header-only file
        let msg: string;
        if (filesFound === 0) {
          msg = 'No .ADM files were found in this profile\'s log_storage folder. Check that the profile\'s server path is correct and that the server has written logs.';
        } else if (linesInRange === 0) {
          msg = `No ADM records at all fall in that date range (${filesFound} log file${filesFound === 1 ? '' : 's'} scanned). The logs may not cover those dates.`;
        } else if (spatial && nearest != null) {
          msg = `0 of ${linesInRange} records in range were within ${spatial.rn} m of (${spatial.xn}, ${spatial.zn}). The nearest player position was ${nearest.toFixed(1)} m away — try a radius of at least ${Math.ceil(nearest)} m.`;
        } else if (spatial) {
          msg = `0 of ${linesInRange} records in range were within ${spatial.rn} m of (${spatial.xn}, ${spatial.zn}), and none of them carried a position at all.`;
        } else {
          msg = '0 records matched.';
        }
        if (filesDated != null && filesFound != null && filesDated < filesFound) {
          msg += ` (${filesFound - filesDated} log file${filesFound - filesDated === 1 ? ' was' : 's were'} skipped — unrecognised filename date.)`;
        }
        setNotice({ tone: 'warning', text: msg });
        return;
      }

      if (matchCount != null) {
        setNotice({ tone: 'success', text: `${matchCount} record${matchCount === 1 ? '' : 's'} matched — downloading.` });
      }

      // Download the returned content as file
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });

      const filterPart = spatial
        ? `__pos_x${String(x).replace(/[^0-9.-]+/g, '')}_z${String(z).replace(/[^0-9.-]+/g, '')}_r${String(radius).replace(/[^0-9.-]+/g, '')}`
        : '';

      const filename = `${formatForFilename(start)}_to_${formatForFilename(end)}${filterPart}.ADM`;

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
      title="Admin Log Records"
      description="Fetch and filter Admin logs (ADM) by time and location."
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
              label="Z (northing)"
              placeholder="e.g. 7214"
              value={z}
              onChange={e => setZ(e.target.value)}
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
          <p className="text-xs text-gray-500 dark:text-gray-400">
            The log writes <code>pos=&lt;x, z, y&gt;</code>, so Z is the <strong>2nd</strong> value in a log line —
            the map northing. The 3rd value is Y (elevation) and is not used for the radius.
          </p>
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

        {notice && (
          <div className={cx(
            "flex items-start gap-2 p-3 border rounded-lg text-sm",
            notice.tone === 'warning'
              ? "bg-warning-50 border-warning-200 text-warning-700 dark:bg-warning-900/10 dark:border-warning-800 dark:text-warning-400"
              : "bg-success-50 border-success-200 text-success-700 dark:bg-success-900/10 dark:border-success-800 dark:text-success-400"
          )}>
            {notice.tone === 'warning'
              ? <AlertTriangle size={18} className="shrink-0 mt-px" />
              : <CheckCircle2 size={18} className="shrink-0 mt-px" />}
            <span>{notice.text}</span>
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
            onClick={fetchAdminLog} 
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
