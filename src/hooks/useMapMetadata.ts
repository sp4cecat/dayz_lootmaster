import { useEffect, useMemo } from 'react';
import { getMapMetadata, MapMetadata } from '../consts/maps';

/**
 * The map a mission is played on.
 *
 * Also warms the base image. Every map tool unmounts completely when you switch views
 * (see the `view` switch in App.tsx), so without this each visit re-fetches — and the
 * first paint of a map tool is a black box until the image lands. The sidebar calls this
 * hook for the profile's display name alone, which means the warm-up happens as soon as a
 * profile is selected, long before any map is opened.
 *
 * Cheap and idempotent: the base image is ~150 KB, and a second request for it is served
 * from the HTTP cache. Tiles are deliberately not preloaded — which ones matter depends
 * on where the user pans, and guessing wrong would cost more than it saves.
 */
export function useMapMetadata(missionName?: string): MapMetadata {
  const map = useMemo(() => getMapMetadata(missionName), [missionName]);

  useEffect(() => {
    if (!map.imagePath || typeof Image === 'undefined') return;
    const img = new Image();
    img.src = map.imagePath;
  }, [map.imagePath]);

  return map;
}
