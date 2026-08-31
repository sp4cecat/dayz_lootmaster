import { type FC, type RefAttributes, useCallback } from "react";
import { Check, ChevronRight, DotsVertical } from "@untitledui/icons";
import type {
    ButtonProps as AriaButtonProps,
    MenuItemProps as AriaMenuItemProps,
    MenuProps as AriaMenuProps,
    PopoverProps as AriaPopoverProps,
    SeparatorProps as AriaSeparatorProps,
    MenuItemRenderProps,
} from "react-aria-components";
import {
    Button as AriaButton,
    Header as AriaHeader,
    Menu as AriaMenu,
    MenuItem as AriaMenuItem,
    MenuSection as AriaMenuSection,
    MenuTrigger as AriaMenuTrigger,
    Popover as AriaPopover,
    Separator as AriaSeparator,
} from "react-aria-components";
import { cx } from "@/utils/cx";
import { Avatar } from "../avatar/avatar";
import { CheckboxBase } from "../checkbox/checkbox";
import { RadioButtonBase } from "../radio-buttons/radio-buttons";
import { ToggleBase } from "../toggle/toggle";

/**
 * Untitled UI's dropdown, restyled onto this project's actual palette.
 *
 * As vendored, it was painted entirely in Untitled UI's semantic tokens -- `bg-primary` for
 * the popover surface, `bg-primary_hover` for row hover and keyboard focus, `ring-secondary_alt`
 * for its edge, `text-fg-quaternary` for icons. None of those exist here: `tailwind.config.js`
 * defines `primary` only as a numbered scale (no DEFAULT) and never defines the `fg-*` or
 * `*_hover` families at all, so every one of them compiled to nothing. The visible result was
 * a fully transparent menu with no hover feedback and no focus cursor -- the only class that
 * did land was the bare `ring-1`, picking up Tailwind's default ring colour.
 *
 * A couple of classes were also Tailwind v4 syntax on a v3.4 install (`outline-hidden`,
 * `origin-(--trigger-anchor-point)`), and `w-62` is not on the v3 spacing scale, so the menu
 * had no width of its own either.
 *
 * Everything here is now concrete gray/primary utilities with explicit `dark:` variants,
 * matching the rest of the app. If you add to this file, check the class actually emits CSS
 * before trusting it -- these failures are silent, and the same dead tokens are still present
 * in avatar.tsx, table.tsx and tooltip.tsx.
 */
interface DropdownItemProps extends AriaMenuItemProps {
    /** The label of the item to be displayed. */
    label?: string;
    /** An addon to be displayed on the right side of the item. */
    addon?: string;
    /** If true, the item will not have any styles. */
    unstyled?: boolean;
    /** An icon to be displayed on the left side of the item. */
    icon?: FC<{ className?: string }>;
    /** Avatar URL to be displayed on the left side of the item. */
    avatarUrl?: string;
    /** The selection indicator to be displayed on the item. */
    selectionIndicator?: "checkmark" | "checkbox" | "radio" | "toggle" | "none";
}

const DropdownItem = ({ label, children, addon, icon: Icon, avatarUrl, unstyled, selectionIndicator = "checkmark", ...props }: DropdownItemProps) => {
    const SelectionIndicator = useCallback(
        (state: MenuItemRenderProps & { className?: string }) => {
            if (selectionIndicator === "checkmark") {
                return (
                    <Check
                        aria-hidden="true"
                        className={cx("size-4 shrink-0 stroke-[2.25px] text-primary-600 dark:text-primary-400", !state.isSelected && "invisible", state.className)}
                    />
                );
            }
            if (selectionIndicator === "checkbox") {
                return (
                    <CheckboxBase
                        isSelected={state.isSelected && !state.hasSubmenu}
                        isIndeterminate={state.isSelected && state.hasSubmenu}
                        size="sm"
                        className={cx("shrink-0", state.className)}
                    />
                );
            }
            if (selectionIndicator === "radio") {
                return <RadioButtonBase isSelected={state.isSelected} className={cx("shrink-0", state.className)} />;
            }
            if (selectionIndicator === "toggle") {
                return <ToggleBase slim size="sm" isSelected={state.isSelected} className={cx("shrink-0", state.className)} />;
            }
            return null;
        },
        [selectionIndicator],
    );

    if (unstyled) {
        return <AriaMenuItem id={label} textValue={label} {...props} />;
    }

    return (
        <AriaMenuItem
            {...props}
            className={(state) =>
                cx(
                    "group block cursor-pointer px-1.5 py-px outline-none",
                    state.isDisabled && "cursor-not-allowed opacity-50",
                    typeof props.className === "function" ? props.className(state) : props.className,
                )
            }
        >
            {(state) => (
                <div
                    className={cx(
                        "relative flex items-center rounded-md px-2.5 py-2 transition duration-100 ease-linear",
                        !state.isDisabled && "group-hover:bg-gray-100 dark:group-hover:bg-gray-800",
                        state.isFocused && "bg-gray-100 dark:bg-gray-800",
                        state.isFocusVisible && "outline-2 -outline-offset-2 outline-focus-ring",
                        state.hasSubmenu && "pr-1.5",
                    )}
                >
                    {state.selectionMode !== "none" && !avatarUrl && !Icon && <SelectionIndicator {...state} className="mr-2" />}

                    {avatarUrl && (
                        <div className="mr-2 flex size-4 items-center justify-center">
                            <Avatar aria-hidden="true" size="xs" src={avatarUrl} alt={label} className="size-5" />
                        </div>
                    )}

                    {Icon && <Icon aria-hidden="true" className="mr-2 size-4 shrink-0 stroke-[2.25px] text-gray-400 dark:text-gray-500" />}

                    <span className={cx("grow truncate text-sm font-semibold text-secondary dark:text-gray-300", state.isFocused && "text-gray-900 dark:text-white")}>
                        {label || (typeof children === "function" ? children(state) : children)}
                    </span>

                    {addon && <span className="ml-1 shrink-0 pr-1 text-xs font-medium text-gray-400 dark:text-gray-500">{addon}</span>}

                    {state.selectionMode !== "none" && (avatarUrl || Icon) && <SelectionIndicator {...state} className="ml-1" />}

                    {state.hasSubmenu && <ChevronRight aria-hidden="true" className="ml-auto size-4 shrink-0 stroke-[2.25px] text-gray-400 dark:text-gray-500" />}
                </div>
            )}
        </AriaMenuItem>
    );
};

type DropdownMenuProps<T extends object> = AriaMenuProps<T>;

const DropdownMenu = <T extends object>(props: DropdownMenuProps<T>) => {
    return (
        <AriaMenu
            {...props}
            className={(state) =>
                cx("h-min overflow-y-auto py-1 outline-none select-none", typeof props.className === "function" ? props.className(state) : props.className)
            }
        />
    );
};

type DropdownPopoverProps = AriaPopoverProps;

const DropdownPopover = (props: DropdownPopoverProps) => {
    return (
        <AriaPopover
            placement="bottom right"
            {...props}
            className={(state) =>
                cx(
                    "w-56 z-[100] origin-[var(--trigger-anchor-point)] overflow-auto rounded-lg bg-white dark:bg-gray-900 shadow-lg ring-1 ring-gray-200 dark:ring-gray-700 will-change-transform",
                    state.isEntering &&
                        "duration-150 ease-out animate-in fade-in placement-right:slide-in-from-left-0.5 placement-top:slide-in-from-bottom-0.5 placement-bottom:slide-in-from-top-0.5",
                    state.isExiting &&
                        "duration-100 ease-in animate-out fade-out placement-right:slide-out-to-left-0.5 placement-top:slide-out-to-bottom-0.5 placement-bottom:slide-out-to-top-0.5",
                    typeof props.className === "function" ? props.className(state) : props.className,
                )
            }
        >
            {props.children}
        </AriaPopover>
    );
};

const DropdownSeparator = (props: AriaSeparatorProps) => {
    return <AriaSeparator {...props} className={cx("my-1 h-px w-full bg-gray-100 dark:bg-gray-800/50", props.className)} />;
};

const DropdownDotsButton = (props: AriaButtonProps & RefAttributes<HTMLButtonElement>) => {
    return (
        <AriaButton
            {...props}
            aria-label="Open menu"
            className={(state) =>
                cx(
                    "cursor-pointer rounded-md text-gray-400 dark:text-gray-500 transition duration-100 ease-linear",
                    (state.isPressed || state.isHovered) && "text-gray-600 dark:text-gray-300",
                    (state.isPressed || state.isFocusVisible) && "outline-2 outline-offset-2 outline-focus-ring",
                    typeof props.className === "function" ? props.className(state) : props.className,
                )
            }
        >
            <DotsVertical className="size-5 transition-inherit-all" />
        </AriaButton>
    );
};

export const Dropdown = {
    Root: AriaMenuTrigger,
    Popover: DropdownPopover,
    Menu: DropdownMenu,
    Section: AriaMenuSection,
    SectionHeader: AriaHeader,
    Item: DropdownItem,
    Separator: DropdownSeparator,
    DotsButton: DropdownDotsButton,
};
