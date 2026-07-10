export interface LoadoutNode {
  id: string; // Internal unique ID for the UI/state
  // 'item'     -> a concrete classname.
  // 'template' -> a live link to a saved loadout / random preset / airdrop / spawnable type.
  // 'group'    -> an inline attachments/cargo group (one DayZ <attachments>/<cargo> block).
  //               A group carries its own `chance` (probability the block is rolled) and holds
  //               its member nodes in `attachments`; one member is selected by weighted chance.
  //               Its kind (attachments vs cargo) is implied by which parent list it sits in.
  type: 'item' | 'template' | 'group';
  templateSource?: 'loadout' | 'preset' | 'airdrop' | 'spawnable';
  name: string; // Item classname or Template ID/Name (groups have no name)
  slot?: string; // group nodes only: the exposed attachment-slot name (from the catalog
                 // attachments[] feed) this group targets, e.g. "WeaponHandguardAK". Design-time
                 // metadata; persists in native loadout JSON, not emitted to vanilla XML.
  chance: number; // 0.0 to 1.0
  quantity?: {
    min: number;
    max: number;
    percent: number;
  };
  damage?: {
    min: number;
    max: number;
  };
  attachments: LoadoutNode[];
  cargo: LoadoutNode[];
  variants?: string[]; // Expansion support
  attributes?: Record<string, string>; // XML attribute compatibility
  isExpanded?: boolean;
}

export interface Loadout {
  id: string;
  label: string;
  items: LoadoutNode[];
  updatedAt: number;
  config?: {
  };
}
