import React from 'react';
import { User, Car, Flame, Biohazard, Flag, MapPin } from 'lucide-react';
import { cx } from '@/utils/cx';
import type { LiveEvent, LivePlayer, LiveVehicle } from '@/types/cftools';

/**
 * Live-map overlay markers. All of them live on the untransformed overlay layer
 * (ItemScanModal pattern): positioned via `project()`, constant on-screen size
 * across zoom. Marker handles are pointer-events-auto and stop propagation so a
 * press doesn't arm the viewport's pan/click gesture.
 */

export interface MarkerSelection {
  kind: 'player' | 'vehicle' | 'event' | 'territory';
  id: string;
}

export const selectionKey = (s: MarkerSelection | null) => (s ? `${s.kind}:${s.id}` : null);

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
        <span
          className={cx(
            'flex items-center justify-center size-5 rounded-full border-2 border-white/80 shadow-md',
            selected ? 'bg-primary-500 ring-2 ring-white' : 'bg-emerald-500',
          )}
        >
          <User size={11} className="text-white" />
        </span>
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
  return (
    <MarkerButton
      px={px} py={py} selected={selected} dimmed={dimmed}
      title={vehicle.displayName || vehicle.className || 'Vehicle'}
      onSelect={onSelect}
    >
      <span
        className={cx(
          'flex items-center justify-center size-5 rounded-md border-2 border-white/80 shadow-md',
          selected ? 'bg-primary-500 ring-2 ring-white' : 'bg-sky-500',
        )}
      >
        <Car size={11} className="text-white" />
      </span>
    </MarkerButton>
  );
}

function eventVisual(type: string): { icon: React.ElementType; bg: string } {
  if (type === 'helicrash') return { icon: Flame, bg: 'bg-orange-500' };
  if (type === 'contaminated_area') return { icon: Biohazard, bg: 'bg-yellow-500' };
  return { icon: MapPin, bg: 'bg-purple-500' };
}

export function EventMarker({ event, px, py, selected, dimmed, onSelect }: {
  event: LiveEvent; px: number; py: number; selected: boolean; dimmed?: boolean; onSelect: () => void;
}) {
  const { icon: Icon, bg } = eventVisual(event.type);
  return (
    <MarkerButton
      px={px} py={py} selected={selected} dimmed={dimmed}
      title={event.displayName || event.className || event.type}
      onSelect={onSelect}
    >
      <span
        className={cx(
          'flex items-center justify-center size-5 rounded-full border-2 border-white/80 shadow-md',
          selected ? 'bg-primary-500 ring-2 ring-white' : bg,
        )}
      >
        <Icon size={11} className="text-white" />
      </span>
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
        <span
          className={cx(
            'flex items-center justify-center size-5 rounded-full border-2 border-white/80 shadow-md',
            selected ? 'bg-primary-500 ring-2 ring-white' : 'bg-rose-500',
          )}
        >
          <Flag size={11} className="text-white" />
        </span>
      </MarkerButton>
    </>
  );
}
