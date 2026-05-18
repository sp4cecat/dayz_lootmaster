import React from 'react';
import { cx, hasLayoutClass } from '@/utils/cx';
import { X } from 'lucide-react';

export type InputSize = 'sm' | 'md';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: React.ElementType;
  suffix?: string | React.ReactNode;
  onClear?: () => void;
  size?: InputSize;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ 
  className, 
  type = 'text', 
  label, 
  error, 
  hint,
  icon: Icon,
  onClear,
  suffix,
  size = 'md',
  ...props 
}, ref) => {
  return (
    <div className={cx(!hasLayoutClass(className) && "w-full", "space-y-1.5", className)}>
      {label && (
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <Icon size={size === 'md' ? 18 : 16} />
          </div>
        )}
        <input
          type={type}
          className={cx(
            'flex w-full rounded-lg border border-gray-300 bg-white px-3 text-sm placeholder:text-gray-500 focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-300 disabled:cursor-not-allowed disabled:opacity-50 transition-all dark:bg-gray-950 dark:border-gray-700 dark:text-gray-100 dark:placeholder:text-gray-400 dark:focus:ring-primary-900/30 dark:focus:border-primary-500',
            size === 'md' ? 'h-10 py-2' : 'h-8 py-1 text-xs',
            Icon && 'pl-10',
            (suffix || (onClear && props.value)) && 'pr-8',
            error && 'border-error-300 focus:ring-error-100 focus:border-error-300 dark:border-error-800 dark:focus:ring-error-900/30'
          )}
          ref={ref}
          {...props}
        />
        {suffix && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none text-sm font-medium">
            {suffix}
          </div>
        )}
        {onClear && props.value && (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            aria-label="Clear input"
          >
            <X size={16} />
          </button>
        )}
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
