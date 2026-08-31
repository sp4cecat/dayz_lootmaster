import { Fragment, type FC, useMemo, useRef } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { Dropdown } from '../base/dropdown/dropdown';

/**
 * One entry in the map context menu. Items are plain data rather than JSX so the caller can
 * assemble the list conditionally — and so a later pass can append server-side actions
 * derived from the live GameLabs action list — without this component knowing about any of
 * them.
 */
export interface MapMenuItem {
  /** Unique within the whole menu; this is what `Menu.onAction` dispatches on. */
  key: string;
  label: string;
  /** lucide icons satisfy this: they accept a `className`. */
  icon?: FC<{ className?: string }>;
  onSelect: () => void;
  isDisabled?: boolean;
}

interface MapContextMenuProps {
  open: boolean;
  /** Anchor position in *viewport* px — relative to the map box, not the page. */
  x: number;
  y: number;
  /** What was right-clicked, e.g. "Player — Bob". Rendered above the items. */
  header?: string;
  /** Item groups, rendered with a separator between them. Empty groups are dropped. */
  groups: MapMenuItem[][];
  onClose: () => void;
}

/**
 * Right-click menu for the live map, anchored at the cursor.
 *
 * ## Why there is an invisible button
 *
 * react-aria positions a popover against a trigger element; it has no "open at these
 * coordinates" API. So the menu renders a zero-size, invisible `AriaButton` at the click
 * point and lets `MenuTrigger` anchor to it — the same Root/AriaButton/Popover/Menu shape
 * the export menu in LoadoutDesigner uses, just with a trigger the user never sees.
 *
 * An absolutely positioned div inside the map would have been simpler, but the map viewport
 * is `overflow-hidden`: a menu opened near the bottom edge would be clipped with nowhere to
 * go. The popover portals out of it, and react-aria flips it against the window for free.
 *
 * ## The anchor is in viewport space
 *
 * `x`/`y` are offsets within the map box (`clientX/Y - viewportRect.left/top`). They must NOT
 * come from `view.project()`: that returns overlay space, whose translate folds in
 * `clampTransform`'s letterbox centring as well as the pan, so an anchor placed with it
 * drifts away from the cursor on a non-square viewport. Same trap as the history area circle
 * (see `components/history/AreaSelectLayer.tsx`).
 */
export default function MapContextMenu({
  open, x, y, header, groups, onClose,
}: MapContextMenuProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);

  const visible = useMemo(() => groups.filter(g => g.length > 0), [groups]);
  // One flat lookup, because Menu dispatches by key rather than per item.
  const byKey = useMemo(
    () => new Map(visible.flat().map(item => [item.key, item])),
    [visible],
  );

  if (!open || visible.length === 0) return null;

  return (
    <Dropdown.Root isOpen onOpenChange={(next) => { if (!next) onClose(); }}>
      {/* The anchor, not a control: never focused, never clicked, no tab stop. */}
      <AriaButton
        ref={anchorRef}
        aria-hidden="true"
        excludeFromTabOrder
        className="pointer-events-none absolute size-px opacity-0"
        style={{ left: x, top: y }}
      />
      <Dropdown.Popover placement="bottom start" triggerRef={anchorRef}>
        {header && (
          <div className="truncate border-b border-gray-100 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:border-gray-800/50 dark:text-gray-500">
            {header}
          </div>
        )}
        <Dropdown.Menu
          aria-label="Map actions"
          onAction={(key) => byKey.get(String(key))?.onSelect()}
        >
          {visible.map((group, i) => (
            <Fragment key={group[0].key}>
              {i > 0 ? <Dropdown.Separator /> : null}
              {group.map(item => (
                <Dropdown.Item
                  key={item.key}
                  id={item.key}
                  label={item.label}
                  icon={item.icon}
                  isDisabled={item.isDisabled}
                />
              ))}
            </Fragment>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown.Root>
  );
}
