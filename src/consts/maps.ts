import deerIsleMap from '../assets/maps/empty.deerisle/topdown.jpg';
import chernarusMap from '../assets/maps/dayzoffline.chernarusplus/topdown.jpg';
import livoniaMap from '../assets/maps/dayzoffline.enoch/topdown.jpg';
import sakhalMap from '../assets/maps/dayzoffline.sakhal/topdown.jpg';
import deerIsleInfected from '../assets/maps/empty.deerisle/infected.json';

export interface MapMetadata {
  id: string;             // Primary Key (e.g., 'empty.deerisle')
  displayName: string;    // User-friendly name
  worldSize: number;      // Map size in meters (for coordinate scaling)
  imagePath: string;      // Background image for Heatmap/Map tools
  customInfected?: string[]; // Map-specific custom infected classnames (e.g. from db/events.xml)
}

export const MAP_REGISTRY: Record<string, MapMetadata> = {
  'empty.deerisle': {
    id: 'empty.deerisle',
    displayName: 'Deer Isle',
    worldSize: 16384,
    imagePath: deerIsleMap,
    customInfected: deerIsleInfected.customInfected
  },
  'dayzoffline.enoch': {
    id: 'dayzoffline.enoch',
    displayName: 'Livonia',
    worldSize: 12800,
    imagePath: livoniaMap
  },
  'dayzoffline.chernarusplus': {
    id: 'dayzoffline.chernarusplus',
    displayName: 'Chernarus+',
    worldSize: 15360,
    imagePath: chernarusMap
  },
  'dayzoffline.sakhal': {
    id: 'dayzoffline.sakhal',
    displayName: 'Sakhal',
    worldSize: 12800,
    imagePath: sakhalMap
  }
};

export const DEFAULT_MAP: MapMetadata = {
  id: 'unknown',
  displayName: 'Generic Map',
  worldSize: 15360,
  imagePath: ''
};

export function getMapMetadata(missionName?: string): MapMetadata {
  if (!missionName) return DEFAULT_MAP;
  const key = missionName.toLowerCase();
  return MAP_REGISTRY[key] || { ...DEFAULT_MAP, id: key, displayName: missionName };
}
