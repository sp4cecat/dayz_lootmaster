import React, { useState } from 'react';
import { 
  Database, 
  Store, 
  Map as MapIcon, 
  LogOut, 
  User, 
  ChevronRight,
  LayoutGrid,
  FileCode,
  Settings,
  ChevronDown,
  Bell,
  Search as SearchIcon
} from 'lucide-react';
import { cx } from '@/utils/cx';
import { ThemeToggle } from '../ThemeToggle';

interface SidebarProps {
  className?: string;
  activeTab?: string;
  onTabChange: (tabId: string) => void;
  editorID: string;
  onSignOut: () => void;
  selectedProfile?: { id: string; name: string };
  onProfileClick: () => void;
  storageDirty: boolean;
  onStorageClick: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  className, 
  activeTab, 
  onTabChange, 
  editorID, 
  onSignOut,
  selectedProfile,
  onProfileClick,
  storageDirty,
  onStorageClick
}) => {
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({
    marketplace: !!activeTab?.startsWith('marketplace'),
    'map-tools': !!activeTab?.startsWith('map-tools'),
    'mission-files': !!activeTab?.startsWith('mission-files'),
    tools: !!activeTab?.startsWith('tools')
  });

  const toggleExpand = (id: string) => {
    setExpandedItems(prev => ({ ...prev, [id]: !prev[id] }));
  };

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

  const handleItemClick = (item: any) => {
    if (item.subItems) {
      toggleExpand(item.id);
      onTabChange(item.id);
    } else {
      onTabChange(item.id);
    }
  };

  return (
    <aside className={cx("flex flex-col h-full bg-white border-r border-gray-200 w-72 dark:bg-gray-900 dark:border-gray-800", className)}>
      {/* Header */}
      <div className="p-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-8 bg-primary-600 rounded-lg flex items-center justify-center text-white shadow-sm shadow-primary-200 dark:shadow-none">
            <Database size={20} />
          </div>
          <span className="text-xl font-bold text-gray-900 tracking-tight dark:text-white">Lootmaster</span>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 mb-6">
        <div className="relative group">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary-500 transition-colors" size={18} />
          <input 
            type="text" 
            placeholder="Search..." 
            className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-sm shadow-sm focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-300 transition-all dark:bg-gray-950 dark:border-gray-700 dark:text-white dark:focus:ring-primary-900/30 dark:focus:border-primary-500"
          />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 space-y-1 overflow-y-auto scrollbar-thin">
        {navItems.map((item) => {
          const isActive = activeTab === item.id || activeTab?.startsWith(`${item.id}:`);
          const isExpanded = expandedItems[item.id];
          
          return (
            <div key={item.id} className="space-y-1">
              <button
                onClick={() => handleItemClick(item)}
                className={cx(
                  "flex items-center w-full px-3 py-2 text-sm font-semibold rounded-lg transition-all group",
                  isActive 
                    ? "bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300" 
                    : "text-gray-700 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
                )}
              >
                <item.icon className={cx("mr-3 shrink-0 transition-colors", isActive ? "text-primary-600 dark:text-primary-400" : "text-gray-400 group-hover:text-gray-500")} size={20} />
                <span className="flex-1 text-left">{item.label}</span>
                {item.subItems && (
                  <ChevronDown 
                    size={16} 
                    className={cx("transition-transform text-gray-400", isExpanded && "rotate-180")} 
                  />
                )}
              </button>
              
              {item.subItems && isExpanded && (
                <div className="ml-9 space-y-1">
                  {item.subItems.map(sub => {
                    const subId = `${item.id}:${sub.id}`;
                    const isSubActive = activeTab === subId;
                    
                    return (
                      <button
                        key={sub.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onTabChange(subId);
                        }}
                        className={cx(
                          "flex items-center w-full px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                          isSubActive
                            ? "text-primary-700 dark:text-primary-300"
                            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                        )}
                      >
                        {sub.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200 space-y-4 dark:border-gray-800">
        <button 
          onClick={onProfileClick}
          className="flex items-center w-full p-2 text-sm font-semibold text-gray-700 rounded-lg hover:bg-gray-50 transition-all group dark:text-gray-300 dark:hover:bg-gray-800 border border-transparent hover:border-gray-200 dark:hover:border-gray-700"
        >
          <div className="size-10 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600 mr-3 dark:bg-primary-900/30 dark:text-primary-400">
            <LayoutGrid size={20} />
          </div>
          <div className="flex-1 text-left min-w-0">
            <p className="text-sm font-bold text-gray-900 truncate dark:text-white">{selectedProfile?.name || 'Select Server'}</p>
            <p className="text-xs text-gray-500 truncate dark:text-gray-400">Mission Profile</p>
          </div>
          <ChevronRight size={16} className="text-gray-400 group-hover:translate-x-0.5 transition-transform" />
        </button>

        <div className="flex items-center gap-3 px-2">
          <div className="size-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 shrink-0 dark:bg-gray-800 dark:text-gray-400 border-2 border-white dark:border-gray-900 shadow-sm">
            <User size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 truncate dark:text-gray-100">{editorID}</p>
            <p className="text-xs text-gray-500 truncate dark:text-gray-400">Editor</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {storageDirty && (
              <button 
                onClick={onStorageClick}
                className="size-8 flex items-center justify-center text-warning-500 hover:bg-warning-50 rounded-lg transition-all dark:hover:bg-warning-900/20 animate-pulse"
                title="Pending changes"
              >
                <Bell size={18} />
              </button>
            )}
            <ThemeToggle />
            <button 
              onClick={onSignOut}
              className="size-8 flex items-center justify-center text-gray-400 hover:text-error-600 hover:bg-error-50 rounded-lg transition-all dark:hover:text-error-400 dark:hover:bg-error-900/20"
              title="Sign out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};
