import React from 'react';
import { 
  Database, 
  Store, 
  Map as MapIcon, 
  Search, 
  LogOut, 
  User, 
  ChevronRight,
  LayoutGrid,
  FileCode,
  Settings,
  Moon,
  Sun
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { Button } from '../ui/Button';
import ThemeToggle from '../ThemeToggle';

export const Sidebar = ({ 
  className, 
  activeTab, 
  onTabChange, 
  editorID, 
  onSignOut,
  selectedProfile,
  onProfileClick
}) => {
  const navItems = [
    { id: 'cle', label: 'CLE Editor', icon: Database },
    { id: 'marketplace', label: 'Marketplace', icon: Store, subItems: [
      { id: 'traders', label: 'Traders' },
      { id: 'market-categories', label: 'Categories' }
    ]},
    { id: 'map-tools', label: 'Map Tools', icon: MapIcon, subItems: [
      { id: 'heatmap', label: 'Heat map' }
    ]},
    { id: 'mission-files', label: 'Mission Files', icon: FileCode, subItems: [
      { id: 'random-presets', label: 'Random Presets' }
    ]},
    { id: 'tools', label: 'Tools', icon: Settings, subItems: [
      { id: 'adm', label: 'ADM records' },
      { id: 'expansion-log', label: 'Expansion Log' },
      { id: 'stash-report', label: 'Stash report' },
      { id: 'lint', label: 'Lint files' }
    ]},
  ];

  return (
    <aside className={cn("flex flex-col h-full bg-white border-r border-gray-200 w-72 dark:bg-gray-900 dark:border-gray-800", className)}>,search:
      <div className="p-6 flex items-center gap-3">
        <div className="size-8 bg-primary-600 rounded-lg flex items-center justify-center text-white">
          <Database size={20} />
        </div>
        <span className="text-xl font-bold text-gray-900 tracking-tight dark:text-white">Lootmaster</span>
      </div>

      <div className="px-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text" 
            placeholder="Search..." 
            className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-100 focus:border-primary-300 transition-all dark:bg-gray-800 dark:border-gray-700 dark:text-white dark:focus:ring-primary-900/30"
          />
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <div key={item.id}>
            <button
              onClick={() => onTabChange(item.id)}
              className={cn(
                "flex items-center w-full px-3 py-2 text-sm font-semibold rounded-lg transition-colors group",
                activeTab === item.id 
                  ? "bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300" 
                  : "text-gray-700 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
              )}
            >
              <item.icon className={cn("mr-3", activeTab === item.id ? "text-primary-600" : "text-gray-400 group-hover:text-gray-500")} size={20} />
              <span className="flex-1 text-left">{item.label}</span>
              {item.subItems && <ChevronRight size={16} className={cn("transition-transform", activeTab === item.id && "rotate-90")} />}
            </button>
            
            {item.subItems && activeTab === item.id && (
              <div className="mt-1 ml-9 space-y-1">
                {item.subItems.map(sub => (
                  <button
                    key={sub.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTabChange(`${item.id}:${sub.id}`);
                    }}
                    className="flex items-center w-full px-3 py-2 text-sm font-medium text-gray-600 rounded-lg hover:bg-gray-50 hover:text-gray-900 transition-colors dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                  >
                    {sub.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-200 space-y-4 dark:border-gray-800">
        <button 
          onClick={onProfileClick}
          className="flex items-center w-full px-3 py-2 text-sm font-semibold text-gray-700 rounded-lg hover:bg-gray-50 transition-colors dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <LayoutGrid className="mr-3 text-gray-400" size={20} />
          <span className="flex-1 text-left truncate">{selectedProfile?.name || 'Select Server'}</span>
        </button>

        <div className="flex items-center gap-3 px-3 py-2">
          <div className="size-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            <User size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate dark:text-gray-100">{editorID}</p>
            <p className="text-xs text-gray-500 truncate dark:text-gray-400">Editor Session</p>
          </div>
          <ThemeToggle />
          <button 
            onClick={onSignOut}
            className="text-gray-400 hover:text-gray-600 transition-colors dark:hover:text-gray-300"
            title="Sign out"
          >
            <LogOut size={20} />
          </button>
        </div>
      </div>
    </aside>
  );
};
