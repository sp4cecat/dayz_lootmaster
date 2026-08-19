/**
 * Which file names may be read/written through the spawnabletypes API.
 *
 * The path resolver happily joins any file name onto the group's folder, so without this
 * guard a spawnabletypes PUT naming e.g. "types.xml" would overwrite the group's real
 * types.xml with a <spawnabletypes> document.
 */

/** Names a spawnabletypes file may have when cfgeconomycore.xml doesn't declare one yet. */
export const CANONICAL_SPAWNABLE_FILE_RE = /^(cfg)?spawnabletypes?\.xml$/i;

/** Groups whose spawnabletypes live at the mission root (cfgspawnabletypes.xml). */
export const ROOT_SPAWNABLE_GROUPS = ['__root', 'vanilla', 'vanilla_overrides'];

/**
 * @param {object} args
 * @param {string} args.group group key ('__root'/'vanilla'/'vanilla_overrides' for mission root)
 * @param {string} args.fileName file name as requested (no path separators)
 * @param {string[]} [args.declaredSpawnable] names cfgeconomycore declares as type="spawnabletypes"
 * @param {string[]} [args.declaredTypes] names cfgeconomycore declares as type="types"
 * @returns {boolean}
 */
export function isAllowedSpawnableFileName({group, fileName, declaredSpawnable = [], declaredTypes = []}) {
    if (typeof fileName !== 'string' || !/^[A-Za-z0-9._-]+$/.test(fileName) || fileName === '..') return false;
    if (ROOT_SPAWNABLE_GROUPS.includes(group)) return CANONICAL_SPAWNABLE_FILE_RE.test(fileName);

    const lower = fileName.toLowerCase();
    if (declaredSpawnable.some(n => String(n).toLowerCase() === lower)) return true;
    if (declaredTypes.some(n => String(n).toLowerCase() === lower)) return false;
    // Declared neither way: allow only the canonical name, which is what the editor creates
    // for a group that has no spawnabletypes file yet (the server declares it on first save).
    return CANONICAL_SPAWNABLE_FILE_RE.test(fileName);
}
