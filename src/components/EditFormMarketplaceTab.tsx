import React from 'react';
import { Badge } from '@/components/base/badges/badges';
import { Store } from 'lucide-react';
import type { Type } from '@/utils/xml';

interface EditFormMarketplaceTabProps {
  selectedTypes: Type[];
  typeOptions: string[];
  typeOptionsByCategory: Record<string, string[]>;
  activated: boolean;
  selectedProfileId: string;
}

export default function EditFormMarketplaceTab({ 
  selectedTypes: _selectedTypes, 
  typeOptions: _typeOptions, 
  typeOptionsByCategory: _typeOptionsByCategory,
  activated: _activated,
  selectedProfileId: _selectedProfileId
}: EditFormMarketplaceTabProps) {
  // Mocking marketplace integration for now as it needs a backend endpoint
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <section className="p-12 text-center bg-gray-50 dark:bg-gray-950/20 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800">
        <div className="size-16 bg-white dark:bg-gray-900 rounded-2xl flex items-center justify-center text-gray-400 mx-auto mb-4 shadow-sm border border-gray-100 dark:border-gray-800">
          <Store size={32} />
        </div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Marketplace Integration</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
          Connect your server's Expansion Market or Trader configs to manage prices and availability directly from the CLE editor.
        </p>
        <Badge color="warning" size="md" type="modern">Coming Soon</Badge>
      </section>
    </div>
  );
}
