export interface AddonMetadata {
  id: string;
  name: string;
}

export const ADDONS: Record<string, AddonMetadata> = {
  expansion: {
    id: 'expansion',
    name: 'Expansion',
  },
  deerisle: {
    id: 'deerisle',
    name: 'Deer Isle',
  },
};
