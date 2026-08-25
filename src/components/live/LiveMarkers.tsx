import React, { useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faCar, faVanShuttle, faHelicopter, faHelicopterSymbol, faShip,
  faCarBurst, faBiohazard, faFlag, faLocationDot,
  faTrain, faCreditCard, faStaffSnake, faCampground, faBomb, faTruckFieldUn,
  faGavel, faWandMagic, faStar, faParachuteBox, faTicket, faBriefcase,
} from '@fortawesome/free-solid-svg-icons';
import { cx } from '@/utils/cx';
import type { LiveEvent, LivePlayer, LiveVehicle } from '@/types/cftools';

/**
 * Live-map overlay markers. All of them live on the untransformed overlay layer
 * (ItemScanModal pattern): positioned via `project()`, constant on-screen size
 * across zoom. Marker handles are pointer-events-auto and stop propagation so a
 * press doesn't arm the viewport's pan/click gesture.
 *
 * Rendered as bare Font Awesome glyphs (no badge discs) with a dark drop-shadow
 * for contrast against the map tiles.
 */

export interface MarkerSelection {
  kind: 'player' | 'vehicle' | 'event' | 'territory';
  id: string;
}

export const selectionKey = (s: MarkerSelection | null) => (s ? `${s.kind}:${s.id}` : null);

/** Vehicle-class icon mapping — shared by vehicles and vehicle-spawn events. */
export function iconForClassName(className: string | null | undefined): IconDefinition | null {
  if (!className) return null;
  const cn = className.toLowerCase();
  if (cn.includes('veedub')) return faVanShuttle;
  if (cn.includes('mosquito')) return faHelicopterSymbol;
  if (cn.includes('boat')) return faShip;
  return null;
}

/**
 * Covered vehicles: Expansion swaps the vehicle for a cover entity —
 * Expansion_Generic_Vehicle_Cover or per-model ones like ExpansionMerlin_Cover
 * (classnames verified from the vehicles_scripts PBO).
 */
export const isCoveredVehicle = (className: string | null | undefined) =>
  !!className && /expansion\w*_?cover/i.test(className);

const COVERED_TINT = 'text-slate-300';

const EVENT_ICONS: Record<string, { icon: IconDefinition; tint: string }> = {
  helicrash: { icon: faHelicopter, tint: 'text-orange-400' },
  wreck: { icon: faCarBurst, tint: 'text-amber-400' },
  contaminated_area: { icon: faBiohazard, tint: 'text-yellow-400' },
};

/**
 * Per-server event classnames (Deer Isle mods report display-ish names like
 * "KMUC Keycard", "Camp Event"). Checked in order, first match wins — keep
 * "mjolnir head"/"handle" ahead of any broader pattern. `staff` and `wand`
 * are Pro-only in Font Awesome; staff-snake and wand-magic are the free kin.
 */
const EVENT_CLASS_ICONS: Array<[RegExp, IconDefinition, string]> = [
  [/mjolnir.*head/i, faGavel, 'text-amber-300'],
  [/mjolnir.*handle/i, faWandMagic, 'text-fuchsia-400'],
  [/train/i, faTrain, 'text-amber-400'],
  [/keycard/i, faCreditCard, 'text-violet-400'],
  [/staff/i, faStaffSnake, 'text-purple-400'],
  [/camp/i, faCampground, 'text-lime-400'],
  [/grenade/i, faBomb, 'text-stone-300'],
  [/convoy/i, faTruckFieldUn, 'text-teal-400'],
  [/submarine/i, faStar, 'text-yellow-300'],
  [/airdrop/i, faParachuteBox, 'text-cyan-400'],
  [/punch.?card/i, faTicket, 'text-pink-400'],
  [/briefcase/i, faBriefcase, 'text-red-500'],
];

const GLYPH_SHADOW = '[filter:drop-shadow(0_1px_1.5px_rgba(0,0,0,0.85))]';

function Glyph({ icon, tint, selected, size = 14 }: {
  icon: IconDefinition; tint: string; selected: boolean; size?: number;
}) {
  return (
    <FontAwesomeIcon
      icon={icon}
      fixedWidth
      style={{ fontSize: size }}
      className={cx(GLYPH_SHADOW, selected ? 'text-primary-400' : tint)}
    />
  );
}

interface BaseMarkerProps {
  px: number;
  py: number;
  selected: boolean;
  dimmed?: boolean;
  title: string;
  onSelect: () => void;
  children: React.ReactNode;
}

function MarkerButton({ px, py, selected, dimmed, title, onSelect, children }: BaseMarkerProps) {
  return (
    <button
      type="button"
      title={title}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      className={cx(
        'absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto transition-transform hover:scale-125',
        selected && 'scale-125 z-10',
        dimmed && 'opacity-50',
      )}
      style={{ left: px, top: py }}
    >
      {children}
    </button>
  );
}

/** Pointer travel (px) beyond which a press on a player dot becomes a drag. */
const DRAG_SLOP = 4;

/**
 * Players render as a translucent orange dot. Hover shows a tooltip with the
 * in-game name, HP and item in hands (HP/hands read "n/a" until CF Tools
 * exposes them on the Data API — the GameLabs mod reports both, but there is
 * no player entities route). When `onDragTeleport` is provided the dot can be
 * dragged: a ghost dot with live world coordinates follows the pointer, and
 * releasing asks the caller to teleport the player there. A press that never
 * travels past the slop stays a click and selects the player as before.
 */
export function PlayerMarker({ player, px, py, selected, dimmed, onSelect, onDragTeleport, toWorld }: {
  player: LivePlayer; px: number; py: number; selected: boolean; dimmed?: boolean; onSelect: () => void;
  /** Present when drag-to-teleport is available (GameLabs connected + steam64 known). */
  onDragTeleport?: (player: LivePlayer, dest: { x: number; z: number }) => void;
  /** Client (mouse) position -> world metres, from the map view. */
  toWorld?: (clientX: number, clientY: number) => { x: number; z: number } | null;
}) {
  const [hover, setHover] = useState(false);
  const [drag, setDrag] = useState<{ dx: number; dy: number; x: number; z: number } | null>(null);
  const gesture = useRef({ pointerId: -1, startX: 0, startY: 0, dragging: false });
  const suppressClick = useRef(false);

  const draggable = !!(onDragTeleport && toWorld);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    gesture.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, dragging: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (g.pointerId !== e.pointerId || !draggable) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.dragging && Math.hypot(dx, dy) <= DRAG_SLOP) return;
    g.dragging = true;
    const hit = toWorld!(e.clientX, e.clientY);
    setDrag({ dx, dy, x: Math.round(hit?.x ?? 0), z: Math.round(hit?.z ?? 0) });
  };

  const endGesture = (e: React.PointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const g = gesture.current;
    if (g.pointerId !== e.pointerId) return;
    gesture.current = { pointerId: -1, startX: 0, startY: 0, dragging: false };
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDrag(null);
    if (g.dragging) {
      // The click event that follows a drag-release must not select.
      suppressClick.current = true;
      if (!cancelled) {
        const hit = toWorld?.(e.clientX, e.clientY);
        if (hit && onDragTeleport) onDragTeleport(player, { x: Math.round(hit.x), z: Math.round(hit.z) });
      }
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label={player.name}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endGesture(e, false)}
        onPointerCancel={(e) => endGesture(e, true)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={(e) => {
          e.stopPropagation();
          if (suppressClick.current) { suppressClick.current = false; return; }
          onSelect();
        }}
        className={cx(
          'absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto p-1',
          draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
          selected && 'z-10',
          dimmed && 'opacity-50',
        )}
        style={{ left: px, top: py }}
      >
        <span
          data-testid="player-dot"
          className={cx(
            'block h-3.5 w-3.5 rounded-full border shadow-md transition-transform',
            selected
              ? 'bg-primary-400/70 border-primary-100 scale-125'
              : 'bg-orange-500/60 border-orange-200/80',
            drag && 'opacity-30',
            !drag && 'hover:scale-125',
          )}
        />
        {hover && !drag && (
          <span
            role="tooltip"
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md bg-gray-900/95 text-left whitespace-nowrap pointer-events-none z-20 shadow-lg"
          >
            <span className="block text-[10px] font-semibold text-white leading-tight">{player.name}</span>
            <span className="block text-[9px] text-gray-300 leading-tight">
              HP: {player.health != null ? Math.round(player.health) : 'n/a'}
            </span>
            <span className="block text-[9px] text-gray-300 leading-tight">
              Hands: {player.handItemLabel || player.handItem || 'n/a'}
            </span>
          </span>
        )}
      </button>
      {/* Ghost dot under the pointer while dragging, with the live destination. */}
      {drag && (
        <span
          data-testid="player-drag-ghost"
          className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20 flex flex-col items-center"
          style={{ left: px + drag.dx, top: py + drag.dy }}
        >
          <span className="block h-3.5 w-3.5 rounded-full border shadow-md bg-orange-500/60 border-orange-200/80" />
          <span className="mt-0.5 px-1 rounded bg-black/70 text-[9px] font-medium text-white whitespace-nowrap leading-tight">
            {drag.x}, {drag.z}
          </span>
        </span>
      )}
    </>
  );
}

export function VehicleMarker({ vehicle, px, py, selected, dimmed, onSelect }: {
  vehicle: LiveVehicle; px: number; py: number; selected: boolean; dimmed?: boolean; onSelect: () => void;
}) {
  const icon = iconForClassName(vehicle.className) ?? faCar;
  const tint = isCoveredVehicle(vehicle.className) ? COVERED_TINT : 'text-sky-400';
  return (
    <MarkerButton
      px={px} py={py} selected={selected} dimmed={dimmed}
      title={vehicle.displayName || vehicle.className || 'Vehicle'}
      onSelect={onSelect}
    >
      <Glyph icon={icon} tint={tint} selected={selected} />
    </MarkerButton>
  );
}

function eventVisual(event: LiveEvent): { icon: IconDefinition; tint: string } {
  const cn = event.className || '';
  if (isCoveredVehicle(cn)) return { icon: faCar, tint: COVERED_TINT };
  for (const [pattern, icon, tint] of EVENT_CLASS_ICONS) {
    if (pattern.test(cn)) return { icon, tint };
  }
  // Vehicle spawn events carry the vehicle classname — match those next.
  const vehicleIcon = iconForClassName(cn);
  if (vehicleIcon) return { icon: vehicleIcon, tint: 'text-sky-400' };
  return EVENT_ICONS[event.type] ?? { icon: faLocationDot, tint: 'text-purple-400' };
}

/**
 * `stored` greys the glyph. Its only source now is the spawn ledger's `moved`
 * flag: spacecat_gamelabs decides containment in Enforce and simply publishes no
 * marker for an item on a player or in cargo, so anything that reaches this
 * component is world-placed — grey just means "not where it spawned".
 */
export function EventMarker({ event, px, py, selected, dimmed, stored, onSelect }: {
  event: LiveEvent; px: number; py: number; selected: boolean; dimmed?: boolean; stored?: boolean; onSelect: () => void;
}) {
  const { icon, tint } = eventVisual(event);
  return (
    <MarkerButton
      px={px} py={py} selected={selected} dimmed={dimmed}
      title={event.displayName || event.className || event.type}
      onSelect={onSelect}
    >
      <Glyph icon={icon} tint={stored ? COVERED_TINT : tint} selected={selected} />
    </MarkerButton>
  );
}

export function TerritoryMarker({ territory, px, py, radiusPx, selected, dimmed, onSelect }: {
  territory: LiveEvent; px: number; py: number; radiusPx: number; selected: boolean; dimmed?: boolean; onSelect: () => void;
}) {
  return (
    <>
      {/* World-sized territory radius: scales with zoom via projectLen. */}
      {radiusPx > 0 && (
        <div
          className={cx(
            'absolute rounded-full border -translate-x-1/2 -translate-y-1/2 pointer-events-none',
            selected ? 'border-primary-400/90 bg-primary-400/15' : 'border-rose-400/60 bg-rose-400/10',
            dimmed && 'opacity-50',
          )}
          style={{ left: px, top: py, width: radiusPx * 2, height: radiusPx * 2 }}
        />
      )}
      <MarkerButton
        px={px} py={py} selected={selected} dimmed={dimmed}
        title={territory.displayName || 'Territory flag'}
        onSelect={onSelect}
      >
        <Glyph icon={faFlag} tint="text-rose-400" selected={selected} />
      </MarkerButton>
    </>
  );
}
