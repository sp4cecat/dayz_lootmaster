import React from 'react';
import { cn } from '../../utils/cn';

export const Button = React.forwardRef(({ className, variant = 'primary', size = 'md', ...props }, ref) => {
  const variants = {
    primary: 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm border border-primary-600 dark:bg-primary-500 dark:hover:bg-primary-600 dark:border-primary-500',
    secondary: 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 shadow-sm dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700',
    tertiary: 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200',
    error: 'bg-error-600 text-white hover:bg-error-700 shadow-sm border border-error-600 dark:bg-error-500 dark:hover:bg-error-600 dark:border-error-500',
    link: 'text-primary-700 hover:text-primary-800 p-0 h-auto dark:text-primary-400 dark:hover:text-primary-300',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-4.5 py-2.5 text-base',
  };

  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-semibold transition-all focus:outline-none focus:ring-4 focus:ring-primary-100 disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        variant !== 'link' && sizes[size],
        className
      )}
      {...props}
    />
  );
});

Button.displayName = 'Button';
