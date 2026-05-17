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
  className,
  icon: Icon,
  iconVariant = 'primary'
}) => {
  if (!isOpen) return null;

  const iconVariants = {
    primary: 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400',
    error: 'bg-error-100 text-error-600 dark:bg-error-900/30 dark:text-error-400',
    warning: 'bg-warning-100 text-warning-600 dark:bg-warning-900/30 dark:text-warning-400',
    success: 'bg-success-100 text-success-600 dark:bg-success-900/30 dark:text-success-400',
    gray: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className={cn(
          "bg-white rounded-xl shadow-xl w-full overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 dark:bg-gray-900 border border-gray-200 dark:border-gray-800",
          maxWidth,
          className
        )}
      >
        <div className="p-6 flex items-start justify-between shrink-0">
          <div className="flex gap-4">
            {Icon && (
              <div className={cn("size-12 rounded-lg flex items-center justify-center shrink-0 shadow-sm", iconVariants[iconVariant])}>
                <Icon size={24} />
              </div>
            )}
            <div className="pt-1">
              <h3 className="text-lg font-bold text-gray-900 tracking-tight dark:text-white leading-6">{title}</h3>
              {description && <p className="text-sm text-gray-500 mt-1 dark:text-gray-400">{description}</p>}
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-2 dark:hover:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6 scrollbar-thin">
          {children}
        </div>

        {footer && (
          <div className="p-6 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3 shrink-0 dark:border-gray-800 dark:bg-gray-950">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
