import React from 'react';
import { 
    ComboBox as AriaComboBox, 
    Input as AriaInput, 
    Button as AriaButton, 
    Popover as AriaPopover, 
    ListBox as AriaListBox, 
    ListBoxItem as AriaListBoxItem,
    ComboBoxProps as AriaComboBoxProps,
    ListBoxItemProps as AriaListBoxItemProps,
    ValidationResult
} from 'react-aria-components';
import { cx } from '@/utils/cx';
import { ChevronDown } from 'lucide-react';

export interface ComboBoxProps<T extends object> extends Omit<AriaComboBoxProps<T>, 'children'> {
    label?: string;
    description?: string;
    errorMessage?: string | ((validation: ValidationResult) => string);
    placeholder?: string;
    items: T[];
    children: React.ReactNode | ((item: T) => React.ReactNode);
    /** Forwarded to the inner text input so callers can focus()/select() it. */
    inputRef?: React.Ref<HTMLInputElement>;
}

export function ComboBox<T extends object>({
    label,
    description,
    errorMessage,
    placeholder,
    items,
    children,
    className,
    inputRef,
    ...props
}: ComboBoxProps<T>) {
    return (
        <AriaComboBox 
            {...props} 
            className={cx("group flex flex-col gap-1.5 w-full", className)}
        >
            {label && <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>}
            <div className="relative">
                <AriaInput
                    ref={inputRef}
                    placeholder={placeholder}
                    className="flex w-full rounded-lg border border-gray-300 bg-white px-3 h-10 text-sm placeholder:text-gray-500 focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-300 disabled:cursor-not-allowed disabled:opacity-50 transition-all dark:bg-gray-950 dark:border-gray-700 dark:text-gray-100 dark:placeholder:text-gray-400 dark:focus:ring-primary-900/30 dark:focus:border-primary-500 pr-10"
                />
                <AriaButton className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors focus:outline-none">
                    <ChevronDown size={16} />
                </AriaButton>
            </div>
            {description && <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>}
            {errorMessage && (
                <p className="text-xs text-error-600 dark:text-error-400">
                    {typeof errorMessage === 'function' ? 'Invalid' : errorMessage}
                </p>
            )}
            
            <AriaPopover className="w-(--trigger-width) overflow-auto rounded-lg bg-white dark:bg-gray-900 shadow-lg ring-1 ring-black/5 dark:ring-gray-800 focus:outline-none z-50">
                <AriaListBox items={items} className="p-1 outline-none max-h-60 overflow-y-auto">
                    {children}
                </AriaListBox>
            </AriaPopover>
        </AriaComboBox>
    );
}

export function ComboBoxItem(props: AriaListBoxItemProps) {
    return (
        <AriaListBoxItem 
            {...props} 
            className={({ isFocused, isSelected }) => cx(
                "relative flex cursor-pointer select-none items-center rounded-md px-3 py-2 text-sm outline-none transition-colors",
                isFocused && "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100",
                isSelected && "bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 font-medium"
            )}
        />
    );
}
