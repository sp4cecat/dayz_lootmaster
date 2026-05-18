import type { MouseEventHandler, ReactNode } from "react";
import { X as CloseX } from "@untitledui/icons";
import { Dot } from "@/components/foundations/dot-icon";
import { cx } from "@/utils/cx";
import type { BadgeColors, BadgeTypeToColorMap, BadgeTypes, FlagTypes, IconComponentType, Sizes } from "./badge-types";
import { badgeTypes } from "./badge-types";

export const filledColors: Record<BadgeColors, { root: string; addon: string; addonButton: string }> = {
    gray: {
        root: "bg-utility-neutral-50 text-utility-neutral-700 ring-utility-neutral-300 dark:bg-utility-neutral-800 dark:text-utility-neutral-300 dark:ring-utility-neutral-700",
        addon: "text-utility-neutral-500 dark:text-utility-neutral-400",
        addonButton: "hover:bg-utility-neutral-100 text-utility-neutral-400 hover:text-utility-neutral-500 dark:hover:bg-utility-neutral-800 dark:text-utility-neutral-500 dark:hover:text-utility-neutral-400",
    },
    brand: {
        root: "bg-utility-brand-50 text-utility-brand-700 ring-utility-brand-200 dark:bg-utility-brand-900 dark:text-utility-brand-300 dark:ring-utility-brand-800",
        addon: "text-utility-brand-500 dark:text-utility-brand-400",
        addonButton: "hover:bg-utility-brand-100 text-utility-brand-400 hover:text-utility-brand-500 dark:hover:bg-utility-brand-800 dark:text-utility-brand-500 dark:hover:text-utility-brand-400",
    },
    error: {
        root: "bg-utility-red-50 text-utility-red-700 ring-utility-red-200 dark:bg-utility-red-900 dark:text-utility-red-300 dark:ring-utility-red-800",
        addon: "text-utility-red-500 dark:text-utility-red-400",
        addonButton: "hover:bg-utility-red-100 text-utility-red-400 hover:text-utility-red-500 dark:hover:bg-utility-red-800 dark:text-utility-red-500 dark:hover:text-utility-red-400",
    },
    warning: {
        root: "bg-utility-yellow-50 text-utility-yellow-700 ring-utility-yellow-200 dark:bg-utility-yellow-900 dark:text-utility-yellow-300 dark:ring-utility-yellow-800",
        addon: "text-utility-yellow-500 dark:text-utility-yellow-400",
        addonButton: "hover:bg-utility-yellow-100 text-utility-yellow-400 hover:text-utility-yellow-500 dark:hover:bg-utility-yellow-800 dark:text-utility-yellow-500 dark:hover:text-utility-yellow-400",
    },
    success: {
        root: "bg-utility-green-50 text-utility-green-700 ring-utility-green-200 dark:bg-utility-green-900 dark:text-utility-green-300 dark:ring-utility-green-800",
        addon: "text-utility-green-500 dark:text-utility-green-400",
        addonButton: "hover:bg-utility-green-100 text-utility-green-400 hover:text-utility-green-500 dark:hover:bg-utility-green-800 dark:text-utility-green-500 dark:hover:text-utility-green-400",
    },
    slate: {
        root: "bg-utility-slate-50 text-utility-slate-700 ring-utility-slate-200 dark:bg-utility-slate-900 dark:text-utility-slate-300 dark:ring-utility-slate-800",
        addon: "text-utility-slate-500 dark:text-utility-slate-400",
        addonButton: "hover:bg-utility-slate-100 text-utility-slate-400 hover:text-utility-slate-500 dark:hover:bg-utility-slate-800 dark:text-utility-slate-500 dark:hover:text-utility-slate-400",
    },
    sky: {
        root: "bg-utility-sky-50 text-utility-sky-700 ring-utility-sky-200 dark:bg-utility-sky-900 dark:text-utility-sky-300 dark:ring-utility-sky-800",
        addon: "text-utility-sky-500 dark:text-utility-sky-400",
        addonButton: "hover:bg-utility-sky-100 text-utility-sky-400 hover:text-utility-sky-500 dark:hover:bg-utility-sky-800 dark:text-utility-sky-500 dark:hover:text-utility-sky-400",
    },
    blue: {
        root: "bg-utility-blue-50 text-utility-blue-700 ring-utility-blue-200 dark:bg-utility-blue-900 dark:text-utility-blue-300 dark:ring-utility-blue-800",
        addon: "text-utility-blue-500 dark:text-utility-blue-400",
        addonButton: "hover:bg-utility-blue-100 text-utility-blue-400 hover:text-utility-blue-500 dark:hover:bg-utility-blue-800 dark:text-utility-blue-500 dark:hover:text-utility-blue-400",
    },
    indigo: {
        root: "bg-utility-indigo-50 text-utility-indigo-700 ring-utility-indigo-200 dark:bg-utility-indigo-900 dark:text-utility-indigo-300 dark:ring-utility-indigo-800",
        addon: "text-utility-indigo-500 dark:text-utility-indigo-400",
        addonButton: "hover:bg-utility-indigo-100 text-utility-indigo-400 hover:text-utility-indigo-500 dark:hover:bg-utility-indigo-800 dark:text-utility-indigo-500 dark:hover:text-utility-indigo-400",
    },
    purple: {
        root: "bg-utility-purple-50 text-utility-purple-700 ring-utility-purple-200 dark:bg-utility-purple-900 dark:text-utility-purple-300 dark:ring-utility-purple-800",
        addon: "text-utility-purple-500 dark:text-utility-purple-400",
        addonButton: "hover:bg-utility-purple-100 text-utility-purple-400 hover:text-utility-purple-500 dark:hover:bg-utility-purple-800 dark:text-utility-purple-500 dark:hover:text-utility-purple-400",
    },
    pink: {
        root: "bg-utility-pink-50 text-utility-pink-700 ring-utility-pink-200 dark:bg-utility-pink-900 dark:text-utility-pink-300 dark:ring-utility-pink-800",
        addon: "text-utility-pink-500 dark:text-utility-pink-400",
        addonButton: "hover:bg-utility-pink-100 text-utility-pink-400 hover:text-utility-pink-500 dark:hover:bg-utility-pink-800 dark:text-utility-pink-500 dark:hover:text-utility-pink-400",
    },
    orange: {
        root: "bg-utility-orange-50 text-utility-orange-700 ring-utility-orange-200 dark:bg-utility-orange-900 dark:text-utility-orange-300 dark:ring-utility-orange-800",
        addon: "text-utility-orange-500 dark:text-utility-orange-400",
        addonButton: "hover:bg-utility-orange-100 text-utility-orange-400 hover:text-utility-orange-500 dark:hover:bg-utility-orange-800 dark:text-utility-orange-500 dark:hover:text-utility-orange-400",
    },
};

const addonOnlyColors = Object.fromEntries(Object.entries(filledColors).map(([key, value]) => [key, { root: "", addon: value.addon }])) as Record<
    BadgeColors,
    { root: string; addon: string }
>;

const withPillTypes = {
    [badgeTypes.pillColor]: {
        common: "size-max flex items-center whitespace-nowrap rounded-full ring-1 ring-inset",
        styles: filledColors,
    },
    [badgeTypes.badgeColor]: {
        common: "size-max flex items-center whitespace-nowrap rounded-md ring-1 ring-inset",
        styles: filledColors,
    },
    [badgeTypes.badgeModern]: {
        common: "size-max flex items-center whitespace-nowrap rounded-md ring-1 ring-inset bg-primary text-secondary dark:text-gray-300 ring-primary shadow-xs",
        styles: addonOnlyColors,
    },
};

const withBadgeTypes = {
    [badgeTypes.pillColor]: {
        common: "size-max flex items-center whitespace-nowrap rounded-full ring-1 ring-inset",
        styles: filledColors,
    },
    [badgeTypes.badgeColor]: {
        common: "size-max flex items-center whitespace-nowrap rounded-md ring-1 ring-inset",
        styles: filledColors,
    },
    [badgeTypes.badgeModern]: {
        common: "size-max flex items-center whitespace-nowrap rounded-md ring-1 ring-inset bg-primary text-secondary dark:text-gray-300 ring-primary shadow-xs",
        styles: addonOnlyColors,
    },
};

export type BadgeColor<T extends BadgeTypes> = BadgeTypeToColorMap<typeof withPillTypes>[T];

interface BadgeProps<T extends BadgeTypes> {
    type?: T;
    size?: Sizes;
    color?: BadgeColor<T>;
    children: ReactNode;
    className?: string;
    onClick?: MouseEventHandler<HTMLSpanElement>;
}

export const Badge = <T extends BadgeTypes>(props: BadgeProps<T>) => {
    const { type = "pill-color", size = "md", color = "gray", children, onClick } = props;
    const colors = withPillTypes[type];

    const pillSizes = {
        sm: "py-0.5 px-2 text-xs font-medium",
        md: "py-0.5 px-2.5 text-sm font-medium",
        lg: "py-1 px-3 text-sm font-medium",
    };
    const badgeSizes = {
        sm: "py-0.5 px-1.5 text-xs font-medium",
        md: "py-0.5 px-2 text-sm font-medium",
        lg: "py-1 px-2.5 text-sm font-medium rounded-lg",
    };

    const sizes = {
        [badgeTypes.pillColor]: pillSizes,
        [badgeTypes.badgeColor]: badgeSizes,
        [badgeTypes.badgeModern]: badgeSizes,
    };

    return (
        <span
            onClick={onClick}
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={
                onClick
                    ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              (onClick as any)(e);
                          }
                      }
                    : undefined
            }
            className={cx(colors.common, sizes[type][size], colors.styles[color].root, props.className)}
        >
            {children}
        </span>
    );
};

interface BadgeWithDotProps<T extends BadgeTypes> {
    type?: T;
    size?: Sizes;
    color?: BadgeTypeToColorMap<typeof withBadgeTypes>[T];
    className?: string;
    children: ReactNode;
    onClick?: MouseEventHandler<HTMLSpanElement>;
}

export const BadgeWithDot = <T extends BadgeTypes>(props: BadgeWithDotProps<T>) => {
    const { size = "md", color = "gray", type = "pill-color", className, children, onClick } = props;

    const colors = withBadgeTypes[type];

    const pillSizes = {
        sm: "gap-1 py-0.5 pl-1.5 pr-2 text-xs font-medium",
        md: "gap-1.5 py-0.5 pl-2 pr-2.5 text-sm font-medium",
        lg: "gap-1.5 py-1 pl-2.5 pr-3 text-sm font-medium",
    };

    const badgeSizes = {
        sm: "gap-1 py-0.5 px-1.5 text-xs font-medium",
        md: "gap-1.5 py-0.5 px-2 text-sm font-medium",
        lg: "gap-1.5 py-1 px-2.5 text-sm font-medium rounded-lg",
    };

    const sizes = {
        [badgeTypes.pillColor]: pillSizes,
        [badgeTypes.badgeColor]: badgeSizes,
        [badgeTypes.badgeModern]: badgeSizes,
    };

    return (
        <span
            onClick={onClick}
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={
                onClick
                    ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              (onClick as any)(e);
                          }
                      }
                    : undefined
            }
            className={cx(colors.common, sizes[type][size], colors.styles[color].root, className)}
        >
            <Dot className={colors.styles[color].addon} size="sm" />
            {children}
        </span>
    );
};

interface BadgeWithIconProps<T extends BadgeTypes> {
    type?: T;
    size?: Sizes;
    color?: BadgeTypeToColorMap<typeof withBadgeTypes>[T];
    iconLeading?: IconComponentType;
    iconTrailing?: IconComponentType;
    children: ReactNode;
    className?: string;
    onClick?: MouseEventHandler<HTMLSpanElement>;
}

export const BadgeWithIcon = <T extends BadgeTypes>(props: BadgeWithIconProps<T>) => {
    const {
        size = "md",
        color = "gray",
        type = "pill-color",
        iconLeading: IconLeading,
        iconTrailing: IconTrailing,
        children,
        className,
        onClick,
    } = props;

    const colors = withBadgeTypes[type];

    const icon = IconLeading ? "leading" : "trailing";

    const pillSizes = {
        sm: {
            trailing: "gap-0.5 py-0.5 pl-2 pr-1.5 text-xs font-medium",
            leading: "gap-0.5 py-0.5 pr-2 pl-1.5 text-xs font-medium",
        },
        md: {
            trailing: "gap-1 py-0.5 pl-2.5 pr-2 text-sm font-medium",
            leading: "gap-1 py-0.5 pr-2.5 pl-2 text-sm font-medium",
        },
        lg: {
            trailing: "gap-1 py-1 pl-3 pr-2.5 text-sm font-medium",
            leading: "gap-1 py-1 pr-3 pl-2.5 text-sm font-medium",
        },
    };
    const badgeSizes = {
        sm: {
            trailing: "gap-0.5 py-0.5 pl-2 pr-1.5 text-xs font-medium",
            leading: "gap-0.5 py-0.5 pr-2 pl-1.5 text-xs font-medium",
        },
        md: {
            trailing: "gap-1 py-0.5 pl-2 pr-1.5 text-sm font-medium",
            leading: "gap-1 py-0.5 pr-2 pl-1.5 text-sm font-medium",
        },
        lg: {
            trailing: "gap-1 py-1 pl-2.5 pr-2 text-sm font-medium rounded-lg",
            leading: "gap-1 py-1 pr-2.5 pl-2 text-sm font-medium rounded-lg",
        },
    };

    const sizes = {
        [badgeTypes.pillColor]: pillSizes,
        [badgeTypes.badgeColor]: badgeSizes,
        [badgeTypes.badgeModern]: badgeSizes,
    };

    return (
        <span
            onClick={onClick}
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={
                onClick
                    ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              (onClick as any)(e);
                          }
                      }
                    : undefined
            }
            className={cx(colors.common, sizes[type][size][icon], colors.styles[color].root, className)}
        >
            {IconLeading && <IconLeading className={cx(colors.styles[color].addon, "size-3 stroke-3")} />}
            {children}
            {IconTrailing && <IconTrailing className={cx(colors.styles[color].addon, "size-3 stroke-3")} />}
        </span>
    );
};

interface BadgeWithFlagProps<T extends BadgeTypes> {
    type?: T;
    size?: Sizes;
    flag?: FlagTypes;
    color?: BadgeTypeToColorMap<typeof withPillTypes>[T];
    children: ReactNode;
    className?: string;
    onClick?: MouseEventHandler<HTMLSpanElement>;
}

export const BadgeWithFlag = <T extends BadgeTypes>(props: BadgeWithFlagProps<T>) => {
    const { size = "md", color = "gray", flag = "AU", type = "pill-color", children, className, onClick } = props;

    const colors = withPillTypes[type];

    const pillSizes = {
        sm: "gap-1 py-0.5 pl-0.75 pr-2 text-xs font-medium",
        md: "gap-1.5 py-0.5 pl-1 pr-2.5 text-sm font-medium",
        lg: "gap-1.5 py-1 pl-1.5 pr-3 text-sm font-medium",
    };
    const badgeSizes = {
        sm: "gap-1 py-0.5 pl-1 pr-1.5 text-xs font-medium",
        md: "gap-1.5 py-0.5 pl-1.5 pr-2 text-sm font-medium",
        lg: "gap-1.5 py-1 pl-2 pr-2.5 text-sm font-medium rounded-lg",
    };

    const sizes = {
        [badgeTypes.pillColor]: pillSizes,
        [badgeTypes.badgeColor]: badgeSizes,
        [badgeTypes.badgeModern]: badgeSizes,
    };

    return (
        <span
            onClick={onClick}
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={
                onClick
                    ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              (onClick as any)(e);
                          }
                      }
                    : undefined
            }
            className={cx(colors.common, sizes[type][size], colors.styles[color].root, className)}
        >
            <img src={`https://www.untitledui.com/images/flags/${flag}.svg`} className="size-4 max-w-none rounded-full" alt={`${flag} flag`} />
            {children}
        </span>
    );
};

interface BadgeWithImageProps<T extends BadgeTypes> {
    type?: T;
    size?: Sizes;
    imgSrc: string;
    color?: BadgeTypeToColorMap<typeof withPillTypes>[T];
    children: ReactNode;
    className?: string;
    onClick?: MouseEventHandler<HTMLSpanElement>;
}

export const BadgeWithImage = <T extends BadgeTypes>(props: BadgeWithImageProps<T>) => {
    const { size = "md", color = "gray", type = "pill-color", imgSrc, children, className, onClick } = props;

    const colors = withPillTypes[type];

    const pillSizes = {
        sm: "gap-1 py-0.5 pl-0.75 pr-2 text-xs font-medium",
        md: "gap-1.5 py-0.5 pl-1 pr-2.5 text-sm font-medium",
        lg: "gap-1.5 py-1 pl-1.5 pr-3 text-sm font-medium",
    };
    const badgeSizes = {
        sm: "gap-1 py-0.5 pl-1 pr-1.5 text-xs font-medium",
        md: "gap-1.5 py-0.5 pl-1.5 pr-2 text-sm font-medium",
        lg: "gap-1.5 py-1 pl-2 pr-2.5 text-sm font-medium rounded-lg",
    };

    const sizes = {
        [badgeTypes.pillColor]: pillSizes,
        [badgeTypes.badgeColor]: badgeSizes,
        [badgeTypes.badgeModern]: badgeSizes,
    };

    return (
        <span
            onClick={onClick}
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={
                onClick
                    ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              (onClick as any)(e);
                          }
                      }
                    : undefined
            }
            className={cx(colors.common, sizes[type][size], colors.styles[color].root, className)}
        >
            <img src={imgSrc} className="size-4 max-w-none rounded-full" alt="Badge image" />
            {children}
        </span>
    );
};

interface BadgeWithButtonProps<T extends BadgeTypes> {
    type?: T;
    size?: Sizes;
    icon?: IconComponentType;
    color?: BadgeTypeToColorMap<typeof withPillTypes>[T];
    children: ReactNode;
    /**
     * The label for the button.
     */
    buttonLabel?: string;
    /**
     * The click event handler for the button.
     */
    onButtonClick?: MouseEventHandler<HTMLButtonElement>;
    className?: string;
    onClick?: MouseEventHandler<HTMLSpanElement>;
}

export const BadgeWithButton = <T extends BadgeTypes>(props: BadgeWithButtonProps<T>) => {
    const {
        size = "md",
        color = "gray",
        type = "pill-color",
        icon: Icon = CloseX,
        buttonLabel,
        children,
        className,
        onClick,
    } = props;

    const colors = withPillTypes[type];

    const pillSizes = {
        sm: "gap-0.5 py-0.5 pl-2 pr-0.75 text-xs font-medium",
        md: "gap-0.5 py-0.5 pl-2.5 pr-1 text-sm font-medium",
        lg: "gap-0.5 py-1 pl-3 pr-1.5 text-sm font-medium",
    };
    const badgeSizes = {
        sm: "gap-0.5 py-0.5 pl-1.5 pr-0.75 text-xs font-medium",
        md: "gap-0.5 py-0.5 pl-2 pr-1 text-sm font-medium",
        lg: "gap-0.5 py-1 pl-2.5 pr-1.5 text-sm font-medium rounded-lg",
    };

    const sizes = {
        [badgeTypes.pillColor]: pillSizes,
        [badgeTypes.badgeColor]: badgeSizes,
        [badgeTypes.badgeModern]: badgeSizes,
    };

    return (
        <span
            onClick={onClick}
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={
                onClick
                    ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              (onClick as any)(e);
                          }
                      }
                    : undefined
            }
            className={cx(colors.common, sizes[type][size], colors.styles[color].root, className)}
        >
            {children}
            <button
                type="button"
                aria-label={buttonLabel}
                onClick={(e) => {
                    e.stopPropagation();
                    props.onButtonClick?.(e);
                }}
                className={cx(
                    "flex cursor-pointer items-center justify-center p-0.5 transition duration-100 ease-linear focus-visible:outline-2 focus-visible:outline-focus-ring",
                    colors.styles[color].addonButton,
                    type === "pill-color" ? "rounded-full" : "rounded-[3px]",
                )}
            >
                <Icon className="size-3 stroke-[3px] transition-inherit-all" />
            </button>
        </span>
    );
};

interface BadgeIconProps<T extends BadgeTypes> {
    type?: T;
    size?: Sizes;
    icon: IconComponentType;
    color?: BadgeTypeToColorMap<typeof withPillTypes>[T];
    children?: ReactNode;
    className?: string;
    onClick?: MouseEventHandler<HTMLSpanElement>;
}

export const BadgeIcon = <T extends BadgeTypes>(props: BadgeIconProps<T>) => {
    const { size = "md", color = "gray", type = "pill-color", icon: Icon, className, onClick } = props;

    const colors = withPillTypes[type];

    const pillSizes = {
        sm: "p-1.25",
        md: "p-1.5",
        lg: "p-2",
    };

    const badgeSizes = {
        sm: "p-1.25",
        md: "p-1.5",
        lg: "p-2 rounded-lg",
    };

    const sizes = {
        [badgeTypes.pillColor]: pillSizes,
        [badgeTypes.badgeColor]: badgeSizes,
        [badgeTypes.badgeModern]: badgeSizes,
    };

    return (
        <span
            onClick={onClick}
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={
                onClick
                    ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              (onClick as any)(e);
                          }
                      }
                    : undefined
            }
            className={cx(colors.common, sizes[type][size], colors.styles[color].root, className)}
        >
            <Icon className={cx("size-3 stroke-[3px]", colors.styles[color].addon)} />
        </span>
    );
};
