import React, { useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Car, Van, Helicopter, Ship, CarFront, Flame, Biohazard, Flag, MapPin,
  TrainFront, CreditCard, Wand, Tent, Bomb, Truck,
  Gavel, WandSparkles, Anchor, Package, Ticket, Briefcase, Motorbike,
} from 'lucide-react';
import { cx } from '@/utils/cx';
import type { LiveAi, LiveEvent, LivePlayer, LiveVehicle } from '@/types/cftools';

/**
 * Live-map overlay markers. All of them live on the untransformed overlay layer
 * (ItemScanModal pattern): positioned via `project()`, constant on-screen size
 * across zoom. Marker handles are pointer-events-auto and stop propagation so a
 * press doesn't arm the viewport's pan/click gesture.
 *
 * Rendered as bare outline glyphs (no badge discs) with a dark drop-shadow for
 * contrast against the map tiles. lucide, like the rest of the app — Font
 * Awesome's free tier only outlines ~160 icons, none of these among them.
 */

export interface MarkerSelection {
  kind: 'player' | 'vehicle' | 'event' | 'territory' | 'ai';
  id: string;
}

export const selectionKey = (s: MarkerSelection | null) => (s ? `${s.kind}:${s.id}` : null);

/** Vehicle-class icon mapping — shared by vehicles and vehicle-spawn events. */
export function iconForClassName(className: string | null | undefined): LucideIcon | null {
  if (!className) return null;
  const cn = className.toLowerCase();
  if (cn.includes('veedub')) return Van;
  if (cn.includes('mosquito')) return Helicopter;
  if (cn.includes('boat')) return Ship;
  // jmc_atv_STAG_* and friends. Bounded so 'atv' can't match inside a longer word.
  if (/(?:^|[^a-z])atv(?:[^a-z]|$)/.test(cn)) return Motorbike;
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

/**
 * lucide has a single helicopter glyph, so the flyable one (mosquito) keeps it
 * and a crash site burns instead — otherwise the two would differ only by tint.
 */
const EVENT_ICONS: Record<string, { icon: LucideIcon; tint: string }> = {
  helicrash: { icon: Flame, tint: 'text-orange-400' },
  wreck: { icon: CarFront, tint: 'text-amber-400' },
  contaminated_area: { icon: Biohazard, tint: 'text-yellow-400' },
};

/**
 * Per-server event classnames (Deer Isle mods report display-ish names like
 * "KMUC Keycard", "Camp Event"). Checked in order, first match wins — keep
 * "mjolnir head"/"handle" ahead of any broader pattern. The staff gets the plain
 * wand and Mjolnir's handle the sparkling one, so the two stay distinguishable.
 */
const EVENT_CLASS_ICONS: Array<[RegExp, LucideIcon, string]> = [
  [/mjolnir.*head/i, Gavel, 'text-amber-300'],
  [/mjolnir.*handle/i, WandSparkles, 'text-fuchsia-400'],
  [/train/i, TrainFront, 'text-amber-400'],
  [/keycard/i, CreditCard, 'text-violet-400'],
  [/staff/i, Wand, 'text-purple-400'],
  // Land_jmc_ce_oven is the camp event's cooking oven — no 'camp' in the name.
  [/camp|jmc_ce_oven/i, Tent, 'text-lime-400'],
  [/grenade/i, Bomb, 'text-stone-300'],
  [/convoy/i, Truck, 'text-teal-400'],
  [/submarine/i, Anchor, 'text-yellow-300'],
  // lucide has no parachute — the crate the airdrop leaves behind reads as well.
  [/airdrop/i, Package, 'text-cyan-400'],
  // Matches both the display name ("Punch Card") and the classname (STAG_PunchedCard).
  [/punch(?:ed)?.?card/i, Ticket, 'text-pink-400'],
  [/briefcase/i, Briefcase, 'text-red-500'],
];

const GLYPH_SHADOW = '[filter:drop-shadow(0_1px_1.5px_rgba(0,0,0,0.85))]';

function Glyph({ icon: Icon, tint, selected, size = 15 }: {
  icon: LucideIcon; tint: string; selected: boolean; size?: number;
}) {
  return (
    <Icon
      size={size}
      // Stroke-only glyphs this small vanish into busy tiles at lucide's default 2.
      strokeWidth={2.25}
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

/**
 * The dot shared by the player and AI markers. Same geometry and same selected
 * treatment; only the resting tint differs, so the map reads as one system and an
 * admin can still tell a bot from a person at a glance. Extracted rather than
 * duplicated so the two can't drift apart.
 */
const PLAYER_TONE = 'bg-orange-500/60 border-orange-200/80';
const AI_TONE = 'bg-green-500/60 border-green-200/80';

function MarkerDot({ testId, tone, selected, className }: {
  testId: string; tone: string; selected: boolean; className?: string;
}) {
  return (
    <span
      data-testid={testId}
      className={cx(
        'block h-3.5 w-3.5 rounded-full border shadow-md transition-transform',
        selected ? 'bg-primary-400/70 border-primary-100 scale-125' : tone,
        className,
      )}
    />
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
        <MarkerDot
          testId="player-dot"
          tone={PLAYER_TONE}
          selected={selected}
          className={cx(drag && 'opacity-30', !drag && 'hover:scale-125')}
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
          <span className={cx('block h-3.5 w-3.5 rounded-full border shadow-md', PLAYER_TONE)} />
          <span className="mt-0.5 px-1 rounded bg-black/70 text-[9px] font-medium text-white whitespace-nowrap leading-tight">
            {drag.x}, {drag.z}
          </span>
        </span>
      )}
    </>
  );
}

/**
 * Expansion AI render as a translucent GREEN dot — the same shape as the orange
 * player dot, so the map reads as one system, with a different hue so a bot and a
 * person are distinguishable at a glance.
 *
 * Deliberately NOT draggable, unlike PlayerMarker. Drag-to-teleport resolves to a
 * GameLabs action with `actionContext: 'player'` keyed by steam64, and an AI has
 * neither a steam64 nor a CF Tools session — the call could only fail or, worse,
 * resolve against some other entity. There is no object-context teleport in
 * ACTION_PATTERNS either, so the gesture has no correct destination. Omitting it
 * beats rendering a grab cursor that silently does nothing.
 */
export function AiMarker({ ai, px, py, selected, dimmed, onSelect }: {
  ai: LiveAi; px: number; py: number; selected: boolean; dimmed?: boolean; onSelect: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      aria-label={ai.name}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cx(
        'absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto p-1 cursor-pointer',
        selected && 'z-10',
        dimmed && 'opacity-50',
      )}
      style={{ left: px, top: py }}
    >
      <MarkerDot testId="ai-dot" tone={AI_TONE} selected={selected} className="hover:scale-125" />
      {hover && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md bg-gray-900/95 text-left whitespace-nowrap pointer-events-none z-20 shadow-lg"
        >
          <span className="block text-[10px] font-semibold text-white leading-tight">{ai.name}</span>
          {ai.faction && (
            <span className="block text-[9px] text-gray-300 leading-tight">{ai.faction}</span>
          )}
          <span className="block text-[9px] text-gray-300 leading-tight">
            HP: {ai.health != null ? Math.round(ai.health) : 'n/a'}
          </span>
          <span className="block text-[9px] text-gray-300 leading-tight">
            Hands: {ai.handItemLabel || ai.handItem || 'n/a'}
          </span>
        </span>
      )}
    </button>
  );
}

export function VehicleMarker({ vehicle, px, py, selected, dimmed, onSelect }: {
  vehicle: LiveVehicle; px: number; py: number; selected: boolean; dimmed?: boolean; onSelect: () => void;
}) {
  const icon = iconForClassName(vehicle.className) ?? Car;
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

function eventVisual(event: LiveEvent): { icon: LucideIcon; tint: string } {
  const cn = event.className || '';
  if (isCoveredVehicle(cn)) return { icon: Car, tint: COVERED_TINT };
  for (const [pattern, icon, tint] of EVENT_CLASS_ICONS) {
    if (pattern.test(cn)) return { icon, tint };
  }
  // Vehicle spawn events carry the vehicle classname — match those next.
  const vehicleIcon = iconForClassName(cn);
  if (vehicleIcon) return { icon: vehicleIcon, tint: 'text-sky-400' };
  return EVENT_ICONS[event.type] ?? { icon: MapPin, tint: 'text-purple-400' };
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
        <Glyph icon={Flag} tint="text-rose-400" selected={selected} />
      </MarkerButton>
    </>
  );
}
