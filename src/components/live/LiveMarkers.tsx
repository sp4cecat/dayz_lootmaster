import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faPerson, faCar, faVanShuttle, faHelicopter, faHelicopterSymbol, faShip,
  faCarBurst, faBiohazard, faFlag, faLocationDot,
  faTrain, faCreditCard, faStaffSnake, faCampground, faBomb, faTruckFieldUn,
  faGavel, faWandMagic, faStar, faParachuteBox, faTicket,
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

export function PlayerMarker({ player, px, py, selected, dimmed, onSelect }: {
  player: LivePlayer; px: number; py: number; selected: boolean; dimmed?: boolean; onSelect: () => void;
}) {
  return (
    <MarkerButton px={px} py={py} selected={selected} dimmed={dimmed} title={player.name} onSelect={onSelect}>
      <span className="flex flex-col items-center">
        <Glyph icon={faPerson} tint="text-emerald-400" selected={selected} size={16} />
        <span className="mt-0.5 px-1 rounded bg-black/60 text-[9px] font-medium text-white whitespace-nowrap leading-tight">
          {player.name}
        </span>
      </span>
    </MarkerButton>
  );
}

export function VehicleMarker({ vehicle, px, py, selected, dimmed, onSelect }: {
  vehicle: LiveVehicle; px: number; py: number; selected: boolean; dimmed?: boolean; onSelect: () => void;
}) {
  const icon = iconForClassName(vehicle.className) ?? faCar;
  return (
    <MarkerButton
      px={px} py={py} selected={selected} dimmed={dimmed}
      title={vehicle.displayName || vehicle.className || 'Vehicle'}
      onSelect={onSelect}
    >
      <Glyph icon={icon} tint="text-sky-400" selected={selected} />
    </MarkerButton>
  );
}

function eventVisual(event: LiveEvent): { icon: IconDefinition; tint: string } {
  const cn = event.className || '';
  for (const [pattern, icon, tint] of EVENT_CLASS_ICONS) {
    if (pattern.test(cn)) return { icon, tint };
  }
  // Vehicle spawn events carry the vehicle classname — match those next.
  const vehicleIcon = iconForClassName(cn);
  if (vehicleIcon) return { icon: vehicleIcon, tint: 'text-sky-400' };
  return EVENT_ICONS[event.type] ?? { icon: faLocationDot, tint: 'text-purple-400' };
}

export function EventMarker({ event, px, py, selected, dimmed, onSelect }: {
  event: LiveEvent; px: number; py: number; selected: boolean; dimmed?: boolean; onSelect: () => void;
}) {
  const { icon, tint } = eventVisual(event);
  return (
    <MarkerButton
      px={px} py={py} selected={selected} dimmed={dimmed}
      title={event.displayName || event.className || event.type}
      onSelect={onSelect}
    >
      <Glyph icon={icon} tint={tint} selected={selected} />
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
