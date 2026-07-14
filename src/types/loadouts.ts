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
  // Expansion loot variants. Each is an ExpansionLootVariant object ({ Name, Chance,
  // Attachments }); legacy data may still hold bare classname strings, so consumers
  // must tolerate both shapes.
  variants?: (string | ExpansionLootVariant)[];
  attributes?: Record<string, string>; // XML attribute compatibility
  isExpanded?: boolean;
  // When set, this node is a live, read-only mirror of the sibling node with this id (its
  // source). Display and DayZ export resolve content from the source; the node's own stored
  // attachments/cargo/etc. are a stale fallback used only if the source is gone. Cleared by
  // the "Unlink" action, which bakes the resolved content in as an independent editable copy.
  linkedTo?: string;
}

// Mirrors Expansion's ExpansionLootVariant (ExpansionLoot.c): an alternate version of
// the parent item with its own chance and attachments. The editor only surfaces `Name`,
// but the full object is preserved on round-trip so Chance/Attachments aren't lost.
// `Attachments` is polymorphic across Expansion schema versions: bare classname strings
// when the config's m_Version < 5, full objects when >= 5. Consumers must tolerate both
// (see normalizeExpansionVariant in utils/loadouts.ts).
export interface ExpansionLootVariant {
  Name: string;
  Chance?: number;
  Attachments?: (string | ExpansionLootVariant)[];
}

export interface Loadout {
  id: string;
  label: string;
  items: LoadoutNode[];
  updatedAt: number;
  config?: Record<string, unknown>;
}
