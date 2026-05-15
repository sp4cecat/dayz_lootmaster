import React from 'react';
import { cn } from '../../utils/cn';

export const Badge = ({ className, variant = 'gray', children, ...props }) => {
  const variants = {
    gray: 'bg-gray-100 text-gray-700 border-gray-200',
    primary: 'bg-primary-50 text-primary-700 border-primary-200',
    success: 'bg-success-50 text-success-700 border-success-200',
    error: 'bg-error-50 text-error-700 border-error-200',
    warning: 'bg-warning-50 text-warning-700 border-warning-200',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border',
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};
