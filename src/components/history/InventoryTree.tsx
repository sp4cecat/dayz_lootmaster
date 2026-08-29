import { useState } from 'react';
import { ChevronRight, ChevronDown, Package } from 'lucide-react';
import { cx } from '@/utils/cx';
import type { InventoryNode } from '@/types/history';

/** Pristine → ruined, as the game names them. */
const HEALTH_LABELS = ['Pristine', 'Worn', 'Damaged', 'Badly damaged', 'Ruined'];

function healthLabel(node: InventoryNode): string | null {
  if (node.healthLevel === null) return null;
  return HEALTH_LABELS[node.healthLevel] ?? null;
}

/** Colour by condition, so a bag of ruined gear is visible without reading it. */
function healthClass(level: number | null): string {
  switch (level) {
    case 0: return 'text-success-600 dark:text-success-400';
    case 1: return 'text-gray-500 dark:text-gray-400';
    case 2: return 'text-warning-600 dark:text-warning-400';
    case 3: return 'text-warning-700 dark:text-warning-300';
    case 4: return 'text-error-600 dark:text-error-400';
    default: return 'text-gray-400';
  }
}

function NodeRow({ node, depth }: { node: InventoryNode; depth: number }) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  // Open by default: the whole point of capturing a tree rather than a list is the
  // nesting, and a collapsed root shows one line for an eleven-item loadout.
  const [open, setOpen] = useState(true);
  const condition = healthLabel(node);

  return (
    <div>
      <div
        className="flex items-start gap-1 py-0.5 hover:bg-gray-50 dark:hover:bg-gray-800/40 rounded"
        style={{ paddingLeft: depth * 12 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label={open ? 'Collapse' : 'Expand'}
            className="mt-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0"
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[11px] text-gray-800 dark:text-gray-200 truncate">
              {node.displayName || node.cls}
            </span>
            {/* Ammo count reads as "24/30", a plain quantity as a bare number. */}
            {node.quantity !== null && node.quantity > 0 && (
              <span className="text-[10px] text-gray-500 dark:text-gray-400 tabular-nums shrink-0">
                {node.quantityMax !== null && node.quantityMax > 0
                  ? `${Math.round(node.quantity)}/${Math.round(node.quantityMax)}`
                  : Math.round(node.quantity)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-400 dark:text-gray-500">
            {/* The slot is the only thing that says WHERE this sat, and it is what a
                restore uses — so it is shown even though it is not pretty. */}
            {node.slot && <span>{node.slot}</span>}
            {!node.slot && node.where === 'hands' && <span>In hands</span>}
            {condition && <span className={healthClass(node.healthLevel)}>{condition}</span>}
          </div>
        </div>
      </div>

      {hasChildren && open && (
        <div>
          {node.children.map((child, i) => (
            <NodeRow key={`${child.cls}-${i}`} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

interface InventoryTreeProps {
  tree: InventoryNode[];
  /** The capture hit a cap, so this is not the whole loadout. Say so. */
  truncated?: boolean;
}

/**
 * A captured loadout, rendered as the hierarchy it is.
 *
 * Nesting is the point: "M4A1 → STANAG magazine" and "M4A1, STANAG magazine" are
 * different claims, and only the first says the rifle was loaded. Flattening this
 * to a list would throw away the one thing a rollback needs to rebuild.
 */
export default function InventoryTree({ tree, truncated }: InventoryTreeProps) {
  if (!tree.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <Package size={24} className="text-gray-300 dark:text-gray-600" />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          This snapshot recorded no items.
        </p>
      </div>
    );
  }

  return (
    <div>
      {truncated && (
        <div className={cx(
          'mb-2 px-2 py-1.5 rounded-md text-[10px]',
          'bg-warning-50 text-warning-700 border border-warning-200',
          'dark:bg-warning-900/20 dark:text-warning-300 dark:border-warning-800',
        )}>
          This capture hit its size limit, so items are missing from it. It cannot be
          rolled back without an explicit override.
        </div>
      )}
      {tree.map((node, i) => (
        <NodeRow key={`${node.cls}-${i}`} node={node} depth={0} />
      ))}
    </div>
  );
}
