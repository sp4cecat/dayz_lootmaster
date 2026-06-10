import { 
  Database, 
  Map as MapIcon, 
  LayoutGrid,
  FileCode,
  Settings,
  Package
} from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  icon?: any;
  subItems?: NavItem[];
  addonRequirement?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'cle', label: 'CLE Editor', icon: Database },
  { id: 'loadout-designer', label: 'Loadout Designer', icon: Package },
  { 
    id: 'addons', 
    label: 'Add-Ons', 
    icon: LayoutGrid, 
    subItems: [
      { 
        id: 'expansion', 
        label: 'Expansion', 
        addonRequirement: 'expansion',
        subItems: [
          { id: 'traders', label: 'Traders' },
          { id: 'market-categories', label: 'Categories' }
        ]
      }
    ] 
  },
  { id: 'map-tools', label: 'Map Tools', icon: MapIcon, subItems: [
    { id: 'heatmap', label: 'Heat map' }
  ]},
  { id: 'mission-files', label: 'Mission Files', icon: FileCode, subItems: [
    { id: 'random-presets', label: 'Random Presets' }
  ]},
  { id: 'tools', label: 'Tools', icon: Settings, subItems: [
    { id: 'snapshots', label: 'Snapshots' },
    { id: 'adm', label: 'ADM records' },
    { 
      id: 'expansion', 
      label: 'Expansion', 
      addonRequirement: 'expansion',
      subItems: [
        { id: 'expansion-log', label: 'Log Search' },
      ]
    },
    { id: 'stash-report', label: 'Stash report' },
    { id: 'lint', label: 'Lint files' }
  ]},
];
