/**
 * Formats a mod or group name into a human-readable display name.
 * e.g. "vanilla_overrides" -> "Vanilla Overrides", "expansion" -> "Expansion"
 */
export const formatModName = (name: string) => {
  if (!name) return '';
  if (name === 'all') return 'All Spawnable Types';
  if (name === 'vanilla') return 'Vanilla';
  if (name === 'vanilla_overrides') return 'Vanilla Overrides';
  if (name === '__root') return 'Vanilla';
  
  const lowerCaseParticles = ['and', 'of', 'the', 'in', 'on', 'with', 'by', 'at'];
  
  return name
    .replace(/_/g, ' ')
    .split(' ')
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && lowerCaseParticles.includes(lower)) {
        return lower;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
};
