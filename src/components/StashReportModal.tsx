import { useMemo, useState } from 'react';
import { Modal } from './base/modal/modal';
import { Button } from './base/button/button';
import { Badge } from './base/badges/badges';
import { DatePicker } from './base/datepicker/datepicker';
import { MapZoomControls } from './MapZoomControls';
import MapImageLayer from './map/MapImageLayer';
import { Archive, BarChart01, XClose, AlertTriangle, Route, SearchLg } from '@untitledui/icons';
import { CalendarDateTime, fromDate, getLocalTimeZone, toCalendarDateTime } from '@internationalized/date';
import { apiFetch } from '@/utils/api';
import { cx } from '@/utils/cx';
import { useMapMetadata } from '../hooks/useMapMetadata';
import { useMapPanZoom } from '@/hooks/useMapPanZoom';
import {
  SEVERITY_COLOR, OWNER_COLOR, OWNER_LABEL,
  type StashReport, type StashPlayer, type StashLedgerEntry, type StashApproach,
} from '@/types/stash';

interface StashReportModalProps {
  onClose: () => void;
  selectedProfileId: string;
  missionName?: string;
  isPanel?: boolean;
  /** Deep-link into Player History for one player over the report's window. */
  onOpenPlayerHistory?: (pid: string, from: number, to: number) => void;
}

/** Quick ranges, in hours back from the end of the data. */
const QUICK_RANGES = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 24 * 7 },
  { label: '30d', hours: 24 * 30 },
];

type SortKey = 'score' | 'foreign' | 'unknown' | 'buried' | 'digs';

/**
 * Format an instant as the SERVER's wall clock.
 *
 * The operator reads times off the logs, so a range has to mean what the log
 * printed. Sending a browser-local ISO string — which is what this tool used to
 * do — silently shifts the window by the difference between the two zones, and
 * the sibling ADM tool over the same files disagreed with it as a result.
 */
function toServerWall(ms: number, timeZone: string | null): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || undefined,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  // en-CA gives 24h with a possible '24' for midnight; normalise it.
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}:${p.second}`;
}

/** A picked calendar value, as wall clock. No zone conversion: what you typed is what is searched. */
function calendarToWall(v: CalendarDateTime): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${v.year}-${p2(v.month)}-${p2(v.day)} ${p2(v.hour)}:${p2(v.minute)}:${p2(v.second)}`;
}

function msToCalendar(ms: number): CalendarDateTime {
  return toCalendarDateTime(fromDate(new Date(ms), getLocalTimeZone()));
}

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172800) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

const fmtTime = (ms: number, tz: string | null) =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: tz || undefined,
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ms));

/**
 * Underground Stash Report.
 *
 * Ranks players by how much their digging looks like a stash radar, and shows the
 * working: every score breaks down into named factors, every factor into the
 * individual digs behind it, and every dig into a map position and a log line.
 * That matters because the output of this tool is an accusation — an admin should
 * be able to check it rather than take it on faith.
 */
export default function StashReportModal({
  onClose, selectedProfileId, missionName, isPanel = false, onOpenPlayerHistory,
}: StashReportModalProps) {
  const [start, setStart] = useState<CalendarDateTime | null>(null);
  const [end, setEnd] = useState<CalendarDateTime | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<StashReport | null>(null);
  const [sort, setSort] = useState<SortKey>('score');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const map = useMapMetadata(missionName);
  const view = useMapPanZoom({
    worldSize: map.worldSize,
    nativeSize: map.tiles?.nativeSize,
    keyboardZoom: true,
  });

  const tz = report?.window.timeZone ?? null;

  const runReport = async (from?: string, to?: string) => {
    try {
      setBusy(true);
      setError(null);

      const payload: Record<string, string> = {};
      if (from) payload.start = from;
      if (to) payload.end = to;

      const res = await apiFetch('/api/logs/stash-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        profileId: selectedProfileId,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Report failed (${res.status}) ${msg}`);
      }
      setReport(await res.json());
      setSelectedId(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setReport(null);
    } finally {
      setBusy(false);
    }
  };

  const onGenerate = () =>
    runReport(start ? calendarToWall(start) : undefined, end ? calendarToWall(end) : undefined);

  /**
   * Quick ranges are anchored to the end of the DATA, not to now. Imported admin
   * logs routinely predate every relative preset by weeks, which would otherwise
   * leave the report empty with no clue why.
   */
  const applyQuick = (hours: number | null) => {
    const anchor = report?.meta.ledger.to ?? Date.now();
    if (hours == null) {
      setStart(null);
      setEnd(null);
      void runReport();
      return;
    }
    const from = anchor - hours * 3_600_000;
    setStart(msToCalendar(from));
    setEnd(msToCalendar(anchor));
    void runReport(toServerWall(from, tz), toServerWall(anchor, tz));
  };

  const players = useMemo(() => {
    const rows = [...(report?.players ?? [])];
    const by: Record<SortKey, (a: StashPlayer, b: StashPlayer) => number> = {
      score: (a, b) => b.score - a.score,
      foreign: (a, b) => b.counts.dugForeign - a.counts.dugForeign,
      unknown: (a, b) => b.counts.dugUnknown - a.counts.dugUnknown,
      buried: (a, b) => b.counts.buriedAllTime - a.counts.buriedAllTime,
      digs: (a, b) => b.counts.dugTotal - a.counts.dugTotal,
    };
    // Keep the server's tie-break so the order is stable between sorts.
    return rows.sort((a, b) => by[sort](a, b) || b.score - a.score || a.id.localeCompare(b.id));
  }, [report, sort]);

  const selected = players.find(p => p.id === selectedId) ?? null;
  const selectedDigs: StashLedgerEntry[] = useMemo(() => {
    if (!selected || !report) return [];
    return selected.events
      .map(i => report.ledger[i])
      .filter(Boolean)
      .sort((a, b) => a.ts - b.ts);
  }, [selected, report]);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Underground Stash Report"
      description="Ranks players by how much their stash digging looks like a radar hack."
      icon={Archive}
      maxWidth="max-w-5xl"
      inline={isPanel}
      footer={isPanel ? undefined : <Button variant="secondary" onClick={onClose} type="button">Close</Button>}
    >
      <div className="flex flex-col gap-4 h-full min-h-0">
        {/* Controls */}
        <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-200 dark:border-gray-800 shrink-0">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Range</span>
            {QUICK_RANGES.map(r => (
              <button
                key={r.label}
                type="button"
                disabled={busy}
                onClick={() => applyQuick(r.hours)}
                className="px-2.5 py-1 text-xs font-medium rounded-full border border-gray-300 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-50"
              >
                {r.label}
              </button>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={() => applyQuick(null)}
              title="Every dig in the archive"
              className="px-2.5 py-1 text-xs font-medium rounded-full border border-gray-300 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-50"
            >
              All
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <DatePicker label="From (optional)" value={start} onChange={setStart} granularity="minute" />
            <DatePicker label="To (optional)" value={end} onChange={setEnd} granularity="minute" />
            <Button variant="primary" onClick={onGenerate} disabled={busy} icon={BarChart01} type="button">
              {busy ? 'Generating…' : 'Generate report'}
            </Button>
          </div>
          {tz && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Times are the game server's local clock ({tz}).
            </p>
          )}
        </div>

        {error && (
          <div className="p-3 bg-error-50 border border-error-200 rounded-lg text-sm text-error-700 flex items-center gap-2 dark:bg-error-900/20 dark:border-error-800 dark:text-error-400 shrink-0">
            <XClose className="size-[18px]" />
            {error}
          </div>
        )}

        {report && <SummaryTiles report={report} />}

        {/* Keyed off the digs, not the player rows: every player who ever buried
            anything gets a row so a name search finds them, so an out-of-range
            window would otherwise show a table of zeroes instead of saying why. */}
        {report && report.meta.coverage.digsInWindow === 0 && <EmptyState report={report} />}

        {report && report.meta.coverage.digsInWindow > 0 && (
          <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0">
            {/* Ranked table */}
            <div className="flex-1 min-w-0 flex flex-col border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <div className="overflow-auto">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-gray-50 dark:bg-gray-900/80 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-10">
                    <tr>
                      <SortableTh label="Risk" active={sort === 'score'} onClick={() => setSort('score')} />
                      <th className="px-3 py-2 font-semibold text-gray-700 dark:text-gray-300">Player</th>
                      <SortableTh label="Buried" align="right" active={sort === 'buried'} onClick={() => setSort('buried')} />
                      <SortableTh label="Own" align="right" active={sort === 'digs'} onClick={() => setSort('digs')} />
                      <SortableTh label="Others'" align="right" active={sort === 'foreign'} onClick={() => setSort('foreign')} />
                      <SortableTh label="Unattr." align="right" active={sort === 'unknown'} onClick={() => setSort('unknown')} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-950">
                    {players.map(p => (
                      <tr
                        key={p.id}
                        onClick={() => setSelectedId(p.id === selectedId ? null : p.id)}
                        className={cx(
                          'cursor-pointer transition-colors',
                          p.id === selectedId
                            ? 'bg-primary-50 dark:bg-primary-900/20'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-900/30',
                        )}
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Badge size="sm" color={SEVERITY_COLOR[p.severity]}>{p.score}</Badge>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900 dark:text-gray-100 truncate max-w-[16rem]">
                            {p.aliases.join(' / ') || <span className="font-mono text-xs">{p.id}</span>}
                          </div>
                          {p.confidence < 0.5 && (
                            <div className="text-[11px] text-warning-600 dark:text-warning-400">
                              low confidence
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">{p.counts.buriedAllTime}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-success-600">{p.counts.dugOwn}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-error-600">{p.counts.dugForeign}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-warning-600">{p.counts.dugUnknown}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Drill-down */}
            <div className="w-full lg:w-[26rem] shrink-0 flex flex-col gap-3 min-h-0 overflow-auto">
              {!selected ? (
                <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-6 text-center text-sm text-gray-500">
                  Select a player to see why they scored, every stash they dug, and where.
                </div>
              ) : (
                <>
                  <PlayerDetail
                    player={selected}
                    digs={selectedDigs}
                    tz={tz}
                    trackMeta={report.meta.track}
                    onOpenHistory={onOpenPlayerHistory && selectedDigs.length
                      ? () => onOpenPlayerHistory(
                          selected.id,
                          Math.min(...selectedDigs.map(d => d.ts)) - 3_600_000,
                          Math.max(...selectedDigs.map(d => d.ts)) + 3_600_000,
                        )
                      : undefined}
                  />
                  <DigMap view={view} map={map} digs={selectedDigs} />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function SortableTh({ label, active, onClick, align = 'left' }: {
  label: string; active: boolean; onClick: () => void; align?: 'left' | 'right';
}) {
  return (
    <th className={cx('px-3 py-2 font-semibold', align === 'right' && 'text-right')}>
      <button
        type="button"
        onClick={onClick}
        className={cx(
          'hover:text-primary-600 transition-colors',
          active ? 'text-primary-600' : 'text-gray-700 dark:text-gray-300',
        )}
      >
        {label}{active ? ' ↓' : ''}
      </button>
    </th>
  );
}

function SummaryTiles({ report }: { report: StashReport }) {
  const s = report.summary;
  const tiles = [
    { label: 'Stashes buried', value: s.buries },
    { label: 'Dug up', value: s.digs },
    { label: "Others' stashes", value: s.foreign, tone: 'error' as const },
    { label: 'Flagged players', value: s.flagged, tone: s.flagged ? ('warning' as const) : undefined },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
      {tiles.map(t => (
        <div key={t.label} className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40">
          <div className="text-xs text-gray-500 dark:text-gray-400">{t.label}</div>
          <div className={cx(
            'text-lg font-bold',
            t.tone === 'error' ? 'text-error-600'
              : t.tone === 'warning' ? 'text-warning-600'
                : 'text-gray-900 dark:text-white',
          )}>
            {t.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Why nothing came back.
 *
 * "No activity found" is the least useful thing this screen could say — the cause
 * is almost always one of three fixable setup problems, and the report already
 * knows which.
 */
function EmptyState({ report }: { report: StashReport }) {
  const m = report.meta;
  let title = 'No stash activity in this range.';
  let detail = '';

  if (m.files.found === 0) {
    title = 'No admin logs found.';
    detail = 'Nothing was read from the server\'s log_storage folder. Check the server path on the profile.';
  } else if (m.lines.stash === 0) {
    title = 'Logs were read, but they contain no stash events.';
    detail = `Scanned ${m.lines.scanned.toLocaleString()} lines across ${m.files.found} files and found no "Dug in"/"Dug out" entries. `
      + 'That usually means admin logging is off — set adminLogPlacement = 1 in serverDZ.cfg.';
  } else if (m.coverage.digsInWindow === 0 && m.coverage.digsOutsideWindow > 0) {
    title = 'No digs in the selected range.';
    detail = `The archive holds ${m.coverage.digsOutsideWindow} dig-ups, but none inside this window`
      + (m.ledger.from ? `. Recorded activity runs ${new Date(m.ledger.from).toLocaleDateString()} to ${new Date(m.ledger.to!).toLocaleDateString()}.` : '.');
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 p-8 rounded-xl text-center">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</div>
      {detail && <div className="mt-1 text-xs text-gray-500 max-w-lg mx-auto">{detail}</div>}
    </div>
  );
}

function PlayerDetail({ player, digs, tz, trackMeta, onOpenHistory }: {
  player: StashPlayer;
  digs: StashLedgerEntry[];
  tz: string | null;
  trackMeta: StashMetaTrack;
  onOpenHistory?: () => void;
}) {
  const scoring = player.factors.filter(f => f.points > 0);

  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <div className="p-3 bg-gray-50 dark:bg-gray-900/60 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 dark:text-white truncate">
              {player.aliases.join(' / ') || player.id}
            </div>
            <div className="font-mono text-[10px] text-gray-500 truncate">{player.id}</div>
          </div>
          <Badge size="sm" color={SEVERITY_COLOR[player.severity]}>{player.severity} · {player.score}</Badge>
        </div>

        {player.confidenceNote && (
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-warning-700 dark:text-warning-400">
            <AlertTriangle className="size-3.5 shrink-0 mt-px" />
            <span>{player.confidenceNote}. Confidence {Math.round(player.confidence * 100)}%.</span>
          </div>
        )}

        {onOpenHistory && (
          <Button size="sm" variant="secondary-color" icon={Route} onClick={onOpenHistory} className="mt-2">
            Open in Player History
          </Button>
        )}
      </div>

      {/* Why they scored. Bars rather than a bare number, so the shape of the
          suspicion is visible: many small factors reads very differently from one
          large one. */}
      <div className="p-3 space-y-2 border-b border-gray-200 dark:border-gray-800">
        <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Why this score</div>
        {scoring.length === 0 ? (
          <p className="text-xs text-gray-500 italic">Nothing suspicious — this player only dug up their own stashes.</p>
        ) : scoring.map(f => (
          <div key={f.key}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-gray-700 dark:text-gray-300">{f.label}</span>
              <span className="tabular-nums text-gray-500 shrink-0">
                {f.value}{f.unit ? ` ${f.unit}` : ''}
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary-500"
                style={{ width: `${Math.round((f.points / f.max) * 100)}%` }}
              />
            </div>
            {f.detail && <div className="mt-0.5 text-[11px] text-gray-500">{f.detail}</div>}
          </div>
        ))}
      </div>

      {/* Every dig, with its provenance. */}
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            Digs ({digs.length})
          </div>
          {!trackMeta.available && (
            <span className="text-[10px] text-gray-400" title={`Approach analysis unavailable: ${trackMeta.reason}`}>
              no movement data
            </span>
          )}
        </div>
        <div className="space-y-2 max-h-80 overflow-auto">
          {digs.map(d => <DigRow key={d.i} dig={d} tz={tz} />)}
        </div>
      </div>
    </div>
  );
}

type StashMetaTrack = StashReport['meta']['track'];

function DigRow({ dig, tz }: { dig: StashLedgerEntry; tz: string | null }) {
  return (
    <div className="text-xs border border-gray-200 dark:border-gray-800 rounded-lg p-2">
      <div className="flex items-center gap-2">
        <span
          className="size-2 rounded-full shrink-0"
          style={{ backgroundColor: OWNER_COLOR[dig.owner] }}
          title={OWNER_LABEL[dig.owner]}
        />
        <span className="text-gray-700 dark:text-gray-300">{fmtTime(dig.ts, tz)}</span>
        <span className="text-gray-400">·</span>
        <span className="text-gray-600 dark:text-gray-400 truncate">
          {dig.bury?.cls ?? dig.stashClass}
        </span>
        <span className="ml-auto font-mono text-[10px] text-gray-400 shrink-0">
          {Math.round(dig.x)}, {Math.round(dig.z)}
        </span>
      </div>

      {dig.owner === 'foreign' && dig.bury && (
        <div className="mt-1 text-gray-600 dark:text-gray-400">
          buried by <span className="font-medium text-error-600">{dig.bury.alias ?? dig.bury.id}</span>
          {' · '}dug up {fmtDuration(dig.secondsSinceBury)} later
        </div>
      )}
      {dig.owner === 'unknown' && (
        <div className="mt-1 text-warning-600 dark:text-warning-500">
          No bury on record — the stash was probably buried before these logs begin.
        </div>
      )}

      {dig.approach && <ApproachLine approach={dig.approach} />}

      <div className="mt-1 font-mono text-[10px] text-gray-400 truncate" title={`${dig.file}:${dig.line}`}>
        {dig.file.split(/[\\/]/).pop()}:{dig.line}
      </div>
    </div>
  );
}

/**
 * The approach read-out. Phrased as observations rather than verdicts — "walked
 * 600 m in a straight line" is checkable, "was cheating" is not.
 */
function ApproachLine({ approach: a }: { approach: StashApproach }) {
  if (!a.available) return null;

  const bits: string[] = [];
  if (a.beeline) {
    bits.push(`straight ${Math.round(a.approachM ?? 0)} m approach`);
  } else if (a.straightness != null && a.turns != null) {
    bits.push(`${a.turns} turns on the way in`);
  }
  if (a.everBeforeBury === true) bits.push('had been here before it was buried');
  else if (a.everBeforeBury === false && a.priorMeaningful) bits.push('never been here before');

  if (!bits.length) return null;

  return (
    <div className={cx(
      'mt-1 flex items-start gap-1.5',
      a.beeline ? 'text-error-600 dark:text-error-400' : 'text-gray-500',
    )}>
      <SearchLg className="size-3 shrink-0 mt-0.5" />
      <span>
        {bits.join(' · ')}
        {a.resolution === 'coarse' && (
          <span className="text-gray-400" title="Reconstructed from 5-minute admin-log samples, which cannot see wandering between points."> (coarse)</span>
        )}
      </span>
    </div>
  );
}

/**
 * The selected player's digs on the map, joined in time order.
 *
 * The line is the point of this view: several foreign stashes found in one tight
 * cluster, or a straight run across the map, are both instantly readable as
 * shapes and nearly invisible as table rows.
 */
function DigMap({ view, map, digs }: {
  view: ReturnType<typeof useMapPanZoom>;
  map: ReturnType<typeof useMapMetadata>;
  digs: StashLedgerEntry[];
}) {
  const points = digs.map(d => ({ dig: d, p: view.project(d.x, d.z) }));

  return (
    <div
      ref={view.viewportRef}
      {...view.viewportHandlers}
      className={cx(
        'relative h-72 shrink-0 bg-black rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 select-none touch-none',
        view.isPanning ? 'cursor-grabbing' : 'cursor-grab',
      )}
    >
      {map.tiles ? (
        <MapImageLayer view={view} map={map} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 pointer-events-none">
          No map preview for "{map.displayName}"
        </div>
      )}

      {view.size > 0 && (
        <div style={view.overlayStyle} className="pointer-events-none">
          {points.length > 1 && (
            <svg className="absolute inset-0 overflow-visible" width="1" height="1">
              <polyline
                points={points.map(({ p }) => `${p.px},${p.py}`).join(' ')}
                fill="none"
                stroke="rgba(255,255,255,0.45)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            </svg>
          )}
          {points.map(({ dig, p }) => (
            <div
              key={dig.i}
              title={`${OWNER_LABEL[dig.owner]} — ${dig.bury?.cls ?? dig.stashClass} at ${Math.round(dig.x)}, ${Math.round(dig.z)}`}
              className="absolute size-2.5 rounded-full border border-white/70 -translate-x-1/2 -translate-y-1/2"
              style={{ left: p.px, top: p.py, backgroundColor: OWNER_COLOR[dig.owner] }}
            />
          ))}
        </div>
      )}

      {view.canZoom && <MapZoomControls map={view} />}
    </div>
  );
}
