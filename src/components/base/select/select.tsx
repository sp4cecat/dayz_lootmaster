import React from 'react';
import { cx } from '@/utils/cx';
import { ChevronDown } from 'lucide-react';

export type SelectSize = 'sm' | 'md';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options: { label: string; value: string }[];
  size?: SelectSize;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ 
  className, 
  label, 
  error, 
  hint,
  options,
  size = 'md',
  ...props 
}, ref) => {
  return (
    <div className="w-full space-y-1.5">
      {label && (
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          className={cx(
            'flex w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-300 disabled:cursor-not-allowed disabled:opacity-50 transition-all dark:bg-gray-950 dark:border-gray-700 dark:text-gray-100 dark:focus:ring-primary-900/30 dark:focus:border-primary-500 pr-10',
            size === 'md' ? 'h-10 py-2' : 'h-8 py-1 text-xs',
            error && 'border-error-300 focus:ring-error-100 focus:border-error-300 dark:border-error-800 dark:focus:ring-error-900/30',
            className
          )}
          ref={ref}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          <ChevronDown size={size === 'md' ? 16 : 14} />
        </div>
      </div>
      {hint && !error && (
        <p className="text-sm text-gray-500 dark:text-gray-400">{hint}</p>
      )}
      {error && (
        <p className="text-sm text-error-600 dark:text-error-400">{error}</p>
      )}
    </div>
  );
});

Select.displayName = 'Select';
