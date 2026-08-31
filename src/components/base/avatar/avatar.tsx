import { type FC, type ReactNode, useState } from "react";
import { User01 } from "@untitledui/icons";
import { cx } from "@/utils/cx";
import { AvatarOnlineIndicator, VerifiedTick } from "./base-components";
import { AvatarCount } from "./base-components/avatar-count";

/**
 * Untitled UI's avatar, restyled onto this project's actual palette.
 *
 * Same class of problem the dropdown had (see `base/dropdown/dropdown.tsx`): as vendored it
 * used semantic tokens `tailwind.config.js` never defines -- `text-fg-quaternary` for the
 * placeholder icon, `ring-secondary_alt` for the outer border -- plus `text-md` /
 * `text-display-xs` (not on the v3 font-size scale), `outline-black/16` and
 * `before:border-white/32` (bare opacity modifiers off the default scale), and
 * `before:mask-*` (a Tailwind v4 utility on a v3.4 install). Every one of them compiled to
 * nothing, so the placeholder icon inherited whatever colour its ancestor happened to set and
 * `ring-1` alone drew Tailwind's default blue ring.
 *
 * The circle behind the placeholder is `bg-tertiary` (#475467) -- this config aliases
 * `tertiary` to a *text* colour, so it renders dark. That is why the icon and initials are
 * deliberately light (gray-200), not the mid-gray Untitled UI would use.
 *
 * These failures are silent: a dead utility looks identical to a working one in source. To
 * check, compile the class with the CLI against `tailwind.config.js` and grep the output,
 * remembering that Tailwind hex-escapes commas in selectors -- naive escaping reports false deaths.
 */
export interface AvatarProps {
    size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
    className?: string;
    /**
     * The class name for the main child of the avatar.
     */
    contentClassName?: string;
    src?: string | null;
    alt?: string;
    /**
     * Display an inner contrast border around the avatar image.
     */
    contrastBorder?: boolean;
    /**
     * Whether the avatar should be rounded.
     * @default true
     */
    rounded?: boolean;
    /**
     * Display an outer border around the avatar.
     */
    border?: boolean;
    /**
     * Display a badge (i.e. company logo).
     */
    badge?: ReactNode;
    /**
     * Display a status indicator.
     */
    status?: "online" | "offline";
    /**
     * Display a verified tick icon.
     *
     * @default false
     */
    verified?: boolean;
    /**
     * Display a count badge.
     */
    count?: number;
    /**
     * The initials of the user to display if no image is available.
     */
    initials?: string;
    /**
     * An icon to display if no image is available.
     */
    placeholderIcon?: FC<{ className?: string }>;
    /**
     * A placeholder to display if no image is available.
     */
    placeholder?: ReactNode;

    /**
     * Whether the avatar should show a focus ring when the parent group is in focus.
     * For example, when the avatar is wrapped inside a link.
     *
     * @default false
     */
    focusable?: boolean;
}

const styles = {
    xs: { root: "size-6", rootWithBorder: "p-px", initials: "text-xs font-semibold", icon: "size-4" },
    sm: { root: "size-8", rootWithBorder: "p-px", initials: "text-sm font-semibold", icon: "size-5" },
    md: { root: "size-10", rootWithBorder: "p-px", initials: "text-base font-semibold", icon: "size-6" },
    lg: { root: "size-12", rootWithBorder: "p-[1.5px]", initials: "text-lg font-semibold", icon: "size-7" },
    xl: { root: "size-14", rootWithBorder: "p-0.5", initials: "text-xl font-semibold", icon: "size-8" },
    "2xl": { root: "size-16", rootWithBorder: "p-0.5", initials: "text-2xl font-semibold", icon: "size-8" },
};

export const Avatar = ({
    size = "md",
    src,
    alt,
    initials,
    placeholder,
    placeholderIcon: PlaceholderIcon,
    border,
    badge,
    status,
    verified,
    count,
    focusable = false,
    rounded = true,
    className,
    contentClassName,
}: AvatarProps) => {
    const [isFailed, setIsFailed] = useState(false);

    const canShowImage = src && !isFailed;

    const renderMainContent = () => {
        if (canShowImage) {
            return <img data-avatar-img className="size-full object-cover" src={src} alt={alt} onError={() => setIsFailed(true)} />;
        }

        if (initials) {
            return <span className={cx("text-quaternary", styles[size].initials)}>{initials}</span>;
        }

        if (PlaceholderIcon) {
            return <PlaceholderIcon className={cx("text-gray-200", styles[size].icon)} />;
        }

        return placeholder || <User01 className={cx("text-gray-200", styles[size].icon)} />;
    };

    const renderBadgeContent = () => {
        if (status) {
            return <AvatarOnlineIndicator status={status} size={size} />;
        }

        if (verified) {
            return <VerifiedTick size={size} className={cx("absolute right-0 bottom-0", size === "xs" && "-right-px -bottom-px")} />;
        }

        if (count) {
            return <AvatarCount count={count} />;
        }

        return badge;
    };

    return (
        <div
            data-avatar
            className={cx(
                "relative inline-flex shrink-0 rounded-[7px]",
                rounded && "rounded-full",
                // Focus styles
                focusable && "outline-transparent group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-focus-ring",
                border && "ring-1 ring-gray-200 dark:ring-gray-700",
                border && styles[size].rootWithBorder,
                styles[size].root,
                className,
            )}
        >
            <div
                className={cx(
                    "relative inline-flex size-full shrink-0 items-center justify-center overflow-hidden rounded-md bg-tertiary outline-[0.5px] -outline-offset-[0.5px] outline-black/[0.16] before:inset-[0.5px]",
                    rounded && "rounded-full",
                    canShowImage &&
                        size !== "xs" &&
                        "before:absolute before:inset-0 before:rounded-[inherit] before:border before:border-white/[0.32] before:[mask-image:linear-gradient(to_bottom,black_0%,transparent_25%,transparent_75%,black_100%)]",
                    contentClassName,
                )}
            >
                {renderMainContent()}
            </div>
            {renderBadgeContent()}
        </div>
    );
};
