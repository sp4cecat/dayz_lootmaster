import React from 'react';
import { cx } from '@/utils/cx';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: React.ElementType;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ 
  className, 
  type = 'text', 
  label, 
  error, 
  hint,
  icon: Icon,
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
        {Icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <Icon size={18} />
          </div>
        )}
        <input
          type={type}
          className={cx(
            'flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-500 focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-300 disabled:cursor-not-allowed disabled:opacity-50 transition-all dark:bg-gray-950 dark:border-gray-700 dark:text-gray-100 dark:placeholder:text-gray-400 dark:focus:ring-primary-900/30 dark:focus:border-primary-500',
            Icon && 'pl-10',
            error && 'border-error-300 focus:ring-error-100 focus:border-error-300 dark:border-error-800 dark:focus:ring-error-900/30',
            className
          )}
          ref={ref}
          {...props}
        />
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

Input.displayName = 'Input';
