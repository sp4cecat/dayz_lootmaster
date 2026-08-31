import type { ReactNode } from "react";
import type {
    ButtonProps as AriaButtonProps,
    TooltipProps as AriaTooltipProps,
    TooltipTriggerComponentProps as AriaTooltipTriggerComponentProps,
} from "react-aria-components";
import { Button as AriaButton, OverlayArrow as AriaOverlayArrow, Tooltip as AriaTooltip, TooltipTrigger as AriaTooltipTrigger } from "react-aria-components";
import { cx } from "@/utils/cx";

/**
 * Untitled UI's tooltip, restyled onto this project's actual palette.
 *
 * As vendored, the surface was `bg-primary-solid`, the description `text-tooltip-supporting-text`
 * and the arrow `fill-bg-primary-solid` -- none of which `tailwind.config.js` defines, so the
 * tooltip rendered as unstyled floating text with an invisible arrow. Same failure the dropdown
 * had; see `base/dropdown/dropdown.tsx` for the full account.
 *
 * The arrow's rotation used `in-placement-*` variants from `tailwindcss-react-aria-components`,
 * which is not installed, so the arrow always pointed up. It now rotates off `data-placement`,
 * which react-aria sets on `OverlayArrow` itself -- hence the classes moved from the `<svg>` up
 * to its parent, since Tailwind v3 has no parent-attribute variant.
 *
 * Still inert: the enter/exit animation classes (`animate-in`, `fade-in`, `zoom-in-95`,
 * `slide-in-from-*`) need `tailwindcss-animate`, and the `in-placement-*` variants wrapping them
 * need `tailwindcss-react-aria-components`. Neither is a dependency, so the tooltip appears and
 * disappears instantly. Left in place so they come alive if those plugins are ever added.
 */
interface TooltipProps extends AriaTooltipTriggerComponentProps, Omit<AriaTooltipProps, "children"> {
    /**
     * The title of the tooltip.
     */
    title: ReactNode;
    /**
     * The description of the tooltip.
     */
    description?: ReactNode;
    /**
     * Whether to show the arrow on the tooltip.
     *
     * @default false
     */
    arrow?: boolean;
    /**
     * Delay in milliseconds before the tooltip is shown.
     *
     * @default 300
     */
    delay?: number;
}

export const Tooltip = ({
    title,
    description,
    children,
    arrow = false,
    delay = 300,
    closeDelay = 0,
    trigger,
    isDisabled,
    isOpen,
    defaultOpen,
    offset = 6,
    crossOffset,
    placement = "top",
    onOpenChange,
    ...tooltipProps
}: TooltipProps) => {
    const isTopOrBottomLeft = ["top left", "top end", "bottom left", "bottom end"].includes(placement);
    const isTopOrBottomRight = ["top right", "top start", "bottom right", "bottom start"].includes(placement);
    // Set negative cross offset for left and right placement to visually balance the tooltip.
    const calculatedCrossOffset = isTopOrBottomLeft ? -12 : isTopOrBottomRight ? 12 : 0;

    return (
        <AriaTooltipTrigger {...{ trigger, delay, closeDelay, isDisabled, isOpen, defaultOpen, onOpenChange }}>
            {children}

            <AriaTooltip
                {...tooltipProps}
                offset={offset}
                placement={placement}
                crossOffset={crossOffset ?? calculatedCrossOffset}
                className={({ isEntering, isExiting }) => cx(isEntering && "ease-out animate-in", isExiting && "ease-in animate-out")}
            >
                {({ isEntering, isExiting }) => (
                    <div
                        className={cx(
                            "z-50 flex max-w-xs origin-[var(--trigger-anchor-point)] flex-col items-start gap-1 rounded-lg bg-gray-900 dark:bg-gray-700 px-3 shadow-lg will-change-transform",
                            description ? "py-3" : "py-2",

                            isEntering &&
                                "ease-out animate-in fade-in zoom-in-95 in-placement-left:slide-in-from-right-0.5 in-placement-right:slide-in-from-left-0.5 in-placement-top:slide-in-from-bottom-0.5 in-placement-bottom:slide-in-from-top-0.5",
                            isExiting &&
                                "ease-in animate-out fade-out zoom-out-95 in-placement-left:slide-out-to-right-0.5 in-placement-right:slide-out-to-left-0.5 in-placement-top:slide-out-to-bottom-0.5 in-placement-bottom:slide-out-to-top-0.5",
                        )}
                    >
                        <span className="text-xs font-semibold text-white">{title}</span>

                        {description && <span className="text-xs font-medium text-gray-300">{description}</span>}

                        {arrow && (
                            <AriaOverlayArrow className="data-[placement=left]:-rotate-90 data-[placement=right]:rotate-90 data-[placement=bottom]:rotate-180">
                                <svg
                                    viewBox="0 0 100 100"
                                    className="size-2.5 fill-gray-900 dark:fill-gray-700"
                                >
                                    <path d="M0,0 L35.858,35.858 Q50,50 64.142,35.858 L100,0 Z" />
                                </svg>
                            </AriaOverlayArrow>
                        )}
                    </div>
                )}
            </AriaTooltip>
        </AriaTooltipTrigger>
    );
};

type TooltipTriggerProps = AriaButtonProps;

export const TooltipTrigger = ({ children, className, ...buttonProps }: TooltipTriggerProps) => {
    return (
        <AriaButton {...buttonProps} className={(values) => cx("h-max w-max outline-none", typeof className === "function" ? className(values) : className)}>
            {children}
        </AriaButton>
    );
};
