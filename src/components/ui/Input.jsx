import React from 'react';
import { cn } from '../../utils/cn';

export const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        'flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-500 focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-300 disabled:cursor-not-allowed disabled:opacity-50 transition-all dark:bg-gray-950 dark:border-gray-700 dark:text-gray-100 dark:placeholder:text-gray-400 dark:focus:ring-primary-900/30 dark:focus:border-primary-500',
        className
      )}
      ref={ref}
      {...props}
    />
  );
});

Input.displayName = 'Input';
