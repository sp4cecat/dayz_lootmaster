import React from 'react';
import { ChevronRight, Home } from 'lucide-react';
import { cx } from '@/utils/cx';

import { NavItem } from '@/consts/navigation';

interface BreadcrumbsProps {
  activeTab: string;
  navItems: NavItem[];
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ activeTab, navItems }) => {
  const findPath = (items: NavItem[], targetId: string, currentPath: NavItem[] = []): NavItem[] | null => {
    for (const item of items) {
      const fullId = currentPath.length > 0 
        ? `${currentPath.map(p => p.id).join(':')}:${item.id}` 
        : item.id;
      
      if (fullId === targetId || targetId.startsWith(`${fullId}:`)) {
        const newPath = [...currentPath, item];
        if (fullId === targetId) {
          return newPath;
        }
        if (item.subItems) {
          const subPath = findPath(item.subItems, targetId, newPath);
          if (subPath) return subPath;
        }
      }
    }
    return null;
  };

  const path = findPath(navItems, activeTab);

  if (!path) return null;

  return (
    <nav className="flex items-center gap-2 px-6 py-4 bg-white border-b border-gray-200 dark:bg-gray-900 dark:border-gray-800 shrink-0">
      <div className="flex items-center gap-2 text-gray-400">
        <Home size={16} />
        <ChevronRight size={14} />
      </div>
      {path.map((item, index) => {
        const isLast = index === path.length - 1;
        return (
          <React.Fragment key={item.id}>
            <span className={cx(
              "text-sm font-medium",
              isLast ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400"
            )}>
              {item.label}
            </span>
            {!isLast && <ChevronRight size={14} className="text-gray-400" />}
          </React.Fragment>
        );
      })}
    </nav>
  );
};
