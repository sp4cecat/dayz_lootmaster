/**
 * Pure helpers for the companion-mod catalog. Shared by the client hook
 * (useTypeCatalog) and the server proxy (server/index.js) so the normalization
 * logic lives in exactly one place.
 */

/**
 * Merge the two upstream views into one normalized shape:
 *  - detail:      GET /types/{name}             (vanilla only; description + graphs; null for modded)
 *  - attachments: GET /types/{name}/attachments (vanilla AND modded; accepts/fitsInto + displayName)
 * Prefer the /attachments graph (broader coverage); pull description from the vanilla detail.
 * @returns {{name:string, displayName:string|null, description:string|null, accepts:object|null, fitsInto:object|null, exposesSlots:string[]|null, occupiesSlots:string[]|null, cargoSize:number[]|null}}
 */
export function normalizeTypeDetail(name, detail, attachments) {
  const config = detail && detail.config;
  return {
    name,
    displayName: (attachments && attachments.displayName) || (config && config.displayName) || null,
    description: (config && config.description) || null,
    accepts: (attachments && attachments.accepts) || (detail && detail.compatibleAttachments) || null,
    fitsInto: (attachments && attachments.fitsInto) || (detail && detail.fitsInto) || null,
    exposesSlots: (attachments && attachments.exposesSlots) || null,
    occupiesSlots: (attachments && attachments.occupiesSlots) || null,
    cargoSize: (attachments && attachments.cargoSize) || (detail && detail.cargoSize) || null,
  };
}

/**
 * De-duped list of class names that can attach ONTO a type (flattened accepts.bySlot).
 * Returns null when there's no attachment data, so callers can fall back to
 * "no restriction" (i.e. the full type list).
 * @param {{accepts?: {bySlot?: Record<string, {name:string}[]>}}|null|undefined} detail
 * @returns {string[]|null}
 */
export function flattenCompatibleAttachments(detail) {
  const bySlot = detail && detail.accepts && detail.accepts.bySlot;
  if (!bySlot) return null;
  const set = new Set();
  for (const slot of Object.keys(bySlot)) {
    for (const ref of (bySlot[slot] || [])) {
      if (ref && ref.name) set.add(ref.name);
    }
  }
  return Array.from(set);
}
