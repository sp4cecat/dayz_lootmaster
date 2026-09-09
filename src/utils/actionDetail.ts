/**
 * Reading the `detail` field of a combat action.
 *
 * The mod writes `hit`, `kill` and `damaged` details as a `key=value;` list with a
 * STABLE key set — an empty value is written as `zone=;` rather than omitted — so
 * that the string is parseable without a version number. The ADM backfill writes
 * the same shape. Everything else in `detail` is still free text (`killer=<id>`,
 * a container class, a name), so the parser here refuses anything that does not
 * look like a complete list: a caller that gets `null` shows the text verbatim,
 * which is the right answer for a format nobody anticipated.
 *
 * Pure, and kept out of the components so the feed and the live ticker cannot
 * drift into two different readings of one row.
 */

/**
 * `a=1;b=;c=x` → `{ a: '1', b: '', c: 'x' }`.
 *
 * Null unless EVERY non-empty segment carries an `=`: a value with a stray `;`
 * in it would otherwise be half-read as a key set and rendered as a confident
 * sentence with a piece missing. Empty segments (a trailing `;`) are tolerated
 * since they carry no information either way.
 */
export function parseKv(detail: string | null | undefined): Record<string, string> | null {
  if (!detail) return null;
  const out: Record<string, string> = {};
  let any = false;
  for (const raw of detail.split(';')) {
    const seg = raw.trim();
    if (!seg) continue;
    const eq = seg.indexOf('=');
    if (eq < 0) return null;
    const key = seg.slice(0, eq).trim();
    if (!key) return null;
    // Only the first `=` splits; `at=1,2,3` and a weapon name with `=` in it both
    // keep their value whole.
    out[key] = seg.slice(eq + 1).trim();
    any = true;
  }
  return any ? out : null;
}

/** What a `victim=<type>[:<pid>]` token says. */
export interface CombatVictim {
  /** player | infected | animal | ai — or whatever a newer mod writes. */
  type: string;
  /** Steam64 when the victim is a player; null for creatures and bots. */
  pid: string | null;
}

export function parseVictim(kv: Record<string, string>): CombatVictim | null {
  const raw = kv.victim;
  if (!raw) return null;
  const colon = raw.indexOf(':');
  if (colon < 0) return { type: raw, pid: null };
  const pid = raw.slice(colon + 1);
  return { type: raw.slice(0, colon), pid: pid || null };
}

/**
 * How a victim or damage-source token reads in a sentence. `ai` is the only one
 * that is an initialism; the rest are plain words the mod already lower-cased.
 */
export function actorTypeLabel(type: string): string {
  return type === 'ai' ? 'AI' : type;
}

/** The `by=` vocabulary of a `damaged` row, with its article where English wants one. */
const SOURCE_LABELS: Record<string, string> = {
  fall: 'a fall',
  fire: 'fire',
  vehicle: 'a vehicle',
  explosion: 'an explosion',
  area: 'area damage',
  ai: 'AI',
};

/** `LeftArm` → `Left arm`, `Head` → `Head`. The engine's zone names are CamelCase. */
export function humaniseZone(zone: string): string {
  const words = zone.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
  if (!words) return '';
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** A 1-decimal string from the mod → a rounded integer, or null when it is not a number. */
function roundedNumber(s: string | undefined): number | null {
  if (s === undefined || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * The weapon part of a sentence. `with=` is the item in hands; when it is empty
 * the ammo string still says whether it was a punch (`MeleeFist`, `MeleeFist_Heavy`),
 * which is worth a word because "hit infected · Head · 6 dmg" with no weapon
 * reads as if the weapon were unknown rather than absent.
 */
function weaponLabel(kv: Record<string, string>): string | null {
  if (kv.with) return kv.with;
  if (kv.ammo && kv.ammo.startsWith('MeleeFist')) return 'fists';
  return null;
}

/**
 * A combat detail as one line: `Hit infected · Head · 102 dmg · M4A1 · 19 m`,
 * `Killed player 7656…`, `By a fall · 12 dmg`, `By AI Mirek · Torso · 20 dmg · AUG A1`.
 *
 * Empty parts are dropped rather than shown as blanks. Null when the kind is not a
 * combat kind or the key set has no subject to speak of — the caller then falls
 * back to the raw text, which is what an operator would want to see anyway.
 */
export function describeCombat(kind: string, kv: Record<string, string>): string | null {
  let lead: string;
  if (kind === 'hit' || kind === 'kill') {
    const victim = parseVictim(kv);
    if (!victim) return null;
    const who = victim.pid ? `${actorTypeLabel(victim.type)} ${victim.pid}` : actorTypeLabel(victim.type);
    lead = `${kind === 'hit' ? 'Hit' : 'Killed'} ${who}`;
  } else if (kind === 'damaged') {
    const by = kv.by;
    if (!by) return null;
    lead = `By ${SOURCE_LABELS[by] ?? by}`;
    // The mod names the bot on an AI attack. Appended to whatever the source is so
    // a future `src=` on another kind is not silently lost.
    if (kv.src) lead += ` ${kv.src}`;
  } else {
    return null;
  }

  const parts: string[] = [lead];
  const zone = kv.zone ? humaniseZone(kv.zone) : '';
  if (zone) parts.push(zone);
  const dmg = roundedNumber(kv.dmg);
  if (dmg !== null) parts.push(`${dmg} dmg`);
  const weapon = weaponLabel(kv);
  if (weapon) parts.push(weapon);
  const dist = roundedNumber(kv.dist);
  if (dist !== null) parts.push(`${dist} m`);
  // The victim-side row says so when the blow was the last one; the attacker side
  // has `kill` for that and never carries the flag.
  if (kind === 'damaged' && kv.lethal === '1') parts.push('lethal');
  return parts.join(' · ');
}
