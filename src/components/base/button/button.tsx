import React from 'react';
import { cx } from '@/utils/cx';

export type ButtonVariant = 
  | 'primary' 
  | 'secondary' 
  | 'secondary-gray' 
  | 'secondary-color' 
  | 'tertiary' 
  | 'tertiary-color' 
  | 'error' 
  | 'error-secondary' 
  | 'link' 
  | 'link-gray';

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ElementType;
  iconPosition?: 'left' | 'right';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ 
  className, 
  variant = 'primary', 
  size = 'md', 
  icon: Icon,
  iconPosition = 'left',
  children,
  ...props 
}, ref) => {
  const variants: Record<string, string> = {
    primary: 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm border border-primary-600 dark:bg-primary-500 dark:hover:bg-primary-600 dark:border-primary-500',
    'secondary-gray': 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 shadow-sm dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700',
    'secondary-color': 'bg-primary-50 text-primary-700 hover:bg-primary-100 border border-primary-50 dark:bg-primary-900/20 dark:text-primary-300 dark:border-primary-900/30 dark:hover:bg-primary-900/40',
    tertiary: 'bg-transparent text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200',
    'tertiary-color': 'bg-transparent text-primary-700 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/20',
    error: 'bg-error-600 text-white hover:bg-error-700 shadow-sm border border-error-600 dark:bg-error-500 dark:hover:bg-error-600 dark:border-error-500',
    'error-secondary': 'bg-white text-error-700 hover:bg-error-50 border border-error-300 shadow-sm dark:bg-gray-800 dark:text-error-400 dark:border-error-800 dark:hover:bg-error-900/20',
    link: 'text-primary-700 hover:text-primary-800 p-0 h-auto font-semibold dark:text-primary-400 dark:hover:text-primary-300',
    'link-gray': 'text-gray-600 hover:text-gray-800 p-0 h-auto font-semibold dark:text-gray-400 dark:hover:text-gray-200',
  };

  const sizes: Record<ButtonSize, string> = {
    xs: 'px-2 py-1.5 text-xs gap-1.5',
    sm: 'px-3 py-2 text-sm gap-2',
    md: 'px-4 py-2.5 text-sm gap-2',
    lg: 'px-5 py-3 text-base gap-2',
    xl: 'px-6 py-3.5 text-base gap-2',
    '2xl': 'px-7 py-4 text-lg gap-3',
  };

  // Backwards compatibility for 'secondary' variant
  const actualVariant = variant === 'secondary' ? 'secondary-gray' : variant;

  return (
    <button
      ref={ref}
      className={cx(
        'inline-flex items-center justify-center rounded-lg font-semibold transition-all focus:outline-none focus:ring-4 focus:ring-primary-100 disabled:opacity-50 disabled:cursor-not-allowed',
        variants[actualVariant] || variants.primary,
        !actualVariant.startsWith('link') && sizes[size as ButtonSize],
        className
      )}
      {...props}
    >
      {Icon && iconPosition === 'left' && <Icon size={size === 'xs' ? 14 : size === 'sm' ? 18 : 20} className="shrink-0" />}
      {children}
      {Icon && iconPosition === 'right' && <Icon size={size === 'xs' ? 14 : size === 'sm' ? 18 : 20} className="shrink-0" />}
    </button>
  );
});

Button.displayName = 'Button';
