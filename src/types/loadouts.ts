export interface LoadoutNode {
  id: string; // Internal unique ID for the UI/state
  type: 'item' | 'template';
  name: string; // Item classname or Template ID
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
}

export interface Loadout {
  id: string;
  label: string;
  items: LoadoutNode[];
  updatedAt: number;
}
