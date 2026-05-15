import React from 'react';
import { cn } from '../../utils/cn';
import { X } from 'lucide-react';
import { Button } from './Button';

export const Modal = ({ 
  isOpen, 
  onClose, 
  title, 
  description, 
  children, 
  footer,
  maxWidth = 'max-w-2xl',
  className
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className={cn(
          "bg-white rounded-xl shadow-xl w-full overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 dark:bg-gray-900 dark:border dark:border-gray-800",
          maxWidth,
          className
        )}
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between shrink-0 dark:border-gray-800">
          <div>
            <h3 className="text-xl font-bold text-gray-900 tracking-tight dark:text-white">{title}</h3>
            {description && <p className="text-sm text-gray-500 mt-1 dark:text-gray-400">{description}</p>}
          </div>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-2 dark:hover:text-gray-300"
          >
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          {children}
        </div>

        {footer && (
          <div className="p-6 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3 shrink-0 dark:border-gray-800 dark:bg-gray-900">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
