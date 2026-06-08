import { useMemo } from 'react';
import { getMapMetadata, MapMetadata } from '../consts/maps';

export function useMapMetadata(missionName?: string): MapMetadata {
  return useMemo(() => getMapMetadata(missionName), [missionName]);
}
