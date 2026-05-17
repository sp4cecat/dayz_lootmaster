import React from 'react';
import { Modal } from '@/components/base/modal/modal';
import { Button } from '@/components/base/button/button';
import { Badge } from '@/components/base/badges/badges';
import { Database, FileCode, Tags, Layers } from 'lucide-react';

interface SummaryModalProps {
  summary: {
    typeCount: number;
    groupCount: number;
    fileCount: number;
    definitionCounts: {
      categories: number;
      usageflags: number;
      valueflags: number;
      tags: number;
    };
  };
  onClose: () => void;
}

export default function SummaryModal({ summary, onClose }: SummaryModalProps) {
  const footer = (
    <Button onClick={onClose}>Get Started</Button>
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Mission Loaded Successfully"
      description="Your mission configuration has been parsed and is ready for editing."
      footer={footer}
      icon={Database}
      iconVariant="success"
    >
      <div className="grid grid-cols-2 gap-4">
        <StatCard 
          icon={Layers} 
          label="Total Types" 
          value={summary.typeCount.toLocaleString()} 
          color="primary"
        />
        <StatCard 
          icon={FileCode} 
          label="XML Files" 
          value={summary.fileCount.toString()} 
          color="gray"
        />
        
        <div className="col-span-2 p-6 bg-gray-50 dark:bg-gray-950/20 rounded-2xl border border-gray-100 dark:border-gray-800 mt-2">
          <div className="flex items-center gap-2 mb-6">
            <Tags size={18} className="text-primary-600" />
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Definition Statistics</h4>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{summary.definitionCounts.categories}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Categories</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{summary.definitionCounts.usageflags}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Usage Flags</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{summary.definitionCounts.valueflags}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Value Flags</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{summary.definitionCounts.tags}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Custom Tags</p>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any, label: string, value: string, color: string }) {
  return (
    <div className="p-5 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4">
      <div className={`size-12 rounded-xl flex items-center justify-center shrink-0 ${
        color === 'primary' ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/30' : 'bg-gray-50 text-gray-600 dark:bg-gray-800'
      }`}>
        <Icon size={24} />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
        <p className="text-xl font-bold text-gray-900 dark:text-white">{value}</p>
      </div>
    </div>
  );
}
