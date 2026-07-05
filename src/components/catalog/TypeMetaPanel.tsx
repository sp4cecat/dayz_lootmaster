import { useEffect, useState } from 'react';
import { Badge } from '@/components/base/badges/badges';
import { Info, Puzzle, PackageOpen } from 'lucide-react';
import { useCatalog, type TypeDetail, type AttachmentGraph } from '@/contexts/CatalogContext';

/**
 * Read-only info panel for a single class: displayName, description, and both
 * directions of the attachment graph. Sourced from the companion-mod catalog;
 * shows a "not connected" hint when the mod isn't live or the class is unknown.
 */
export function TypeMetaPanel({ name, className }: { name?: string; className?: string }) {
  const { connected, getTypeDetail } = useCatalog();
  const [detail, setDetail] = useState<TypeDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!name) { setDetail(null); return; }
    setLoading(true);
    getTypeDetail(name).then(d => {
      if (!cancelled) { setDetail(d); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [name, getTypeDetail]);

  if (!name) return null;

  const hasGraph = (g: AttachmentGraph | null | undefined) =>
    !!g && !!g.bySlot && Object.keys(g.bySlot).length > 0;

  const empty = !detail || (!detail.displayName && !detail.description && !hasGraph(detail.accepts) && !hasGraph(detail.fitsInto));

  return (
    <section className={className}>
      <div className="flex items-center gap-2 mb-3">
        <Badge color="gray" size="sm" type="modern">Catalog Detail</Badge>
        {!connected && (
          <span className="text-[11px] text-gray-400">mod not connected</span>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40 p-4 space-y-4">
        {loading && !detail ? (
          <p className="text-xs text-gray-400">Loading…</p>
        ) : empty ? (
          <p className="text-xs text-gray-400 flex items-center gap-1.5">
            <Info size={13} />
            {connected ? 'No catalog metadata for this class.' : 'Companion mod not connected.'}
          </p>
        ) : (
          <>
            {detail!.displayName && (
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{detail!.displayName}</p>
                <p className="text-[11px] font-mono text-gray-400">{detail!.name}</p>
              </div>
            )}
            {detail!.description && (
              <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">{detail!.description}</p>
            )}
            {hasGraph(detail!.accepts) && (
              <AttachmentList
                icon={<Puzzle size={13} />}
                label="Accepts (attaches onto this)"
                graph={detail!.accepts!}
              />
            )}
            {hasGraph(detail!.fitsInto) && (
              <AttachmentList
                icon={<PackageOpen size={13} />}
                label="Fits into (this attaches onto)"
                graph={detail!.fitsInto!}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}

function AttachmentList({ icon, label, graph }: { icon: React.ReactNode; label: string; graph: AttachmentGraph }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
        {icon} {label}
      </p>
      <div className="space-y-2">
        {Object.entries(graph.bySlot).map(([slot, refs]) => (
          <div key={slot}>
            <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">{slot}</p>
            <div className="flex flex-wrap gap-1">
              {refs.map(ref => (
                <span
                  key={ref.name}
                  title={ref.displayName || ref.name}
                  className="inline-flex items-center rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-1.5 py-0.5 text-[11px] text-gray-700 dark:text-gray-200"
                >
                  {ref.displayName || ref.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
