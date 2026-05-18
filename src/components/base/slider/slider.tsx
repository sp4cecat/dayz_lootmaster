import React from "react";
import type { SliderProps as AriaSliderProps } from "react-aria-components";
import {
    Label as AriaLabel,
    Slider as AriaSlider,
    SliderOutput as AriaSliderOutput,
    SliderThumb as AriaSliderThumb,
    SliderTrack as AriaSliderTrack,
} from "react-aria-components";
import { cx, sortCx, hasLayoutClass } from "@/utils/cx";

const styles = sortCx({
    default: "hidden",
    bottom: "absolute top-2 left-1/2 -translate-x-1/2 translate-y-full text-md font-medium text-primary",
    "top-floating":
        "absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full rounded-lg bg-primary px-2 py-1.5 text-xs font-semibold text-secondary shadow-lg ring-1 ring-secondary_alt",
    hidden: "hidden",
});

interface SliderProps<T extends number | number[] = number> extends AriaSliderProps<T> {
    label?: string;
    labelPosition?: keyof typeof styles;
    labelFormatter?: (value: number) => string;
    helperText?: React.ReactNode;
    suffix?: string;
}

export const Slider = <T extends number | number[] = number>({ 
    labelPosition = "default", 
    minValue = 0, 
    maxValue = 100, 
    labelFormatter, 
    formatOptions, 
    label, 
    helperText, 
    suffix,
    className,
    ...rest 
}: SliderProps<T>) => {
    // Format thumb value as percentage by default.
    const defaultFormatOptions: Intl.NumberFormatOptions = {
        style: "percent",
        maximumFractionDigits: 0,
    };

    return (
        <AriaSlider 
            {...rest} 
            {...{ minValue, maxValue }} 
            formatOptions={formatOptions ?? defaultFormatOptions} 
            className={cx(!hasLayoutClass(className) && "w-full", className)}
        >
            <div className="flex flex-col gap-3">
                {labelPosition !== "hidden" && (label || labelPosition === "default") && (
                    <div className="flex items-center justify-between gap-4">
                        <AriaLabel className="text-sm font-medium text-secondary dark:text-gray-300 truncate">{label}</AriaLabel>
                        <AriaSliderOutput className="text-sm font-bold text-brand-solid whitespace-nowrap">
                            {({ state }) => {
                                const val = state.getThumbValue(0);
                                if (labelFormatter) return labelFormatter(val);
                                if (suffix) return `${val}${suffix}`;
                                return state.getFormattedValue(val / 100);
                            }}
                        </AriaSliderOutput>
                    </div>
                )}
                <AriaSliderTrack className="relative h-6 w-full flex items-center">
                    {({ state: { values, getThumbValue, getThumbPercent, getFormattedValue } }) => {
                        const left = values.length === 1 ? 0 : getThumbPercent(0);
                        const width = values.length === 1 ? getThumbPercent(0) : getThumbPercent(1) - left;

                        return (
                            <>
                                <span className="absolute h-2 w-full rounded-full bg-quaternary" />
                                <span
                                    className="absolute h-2 rounded-full bg-brand-solid"
                                    style={{
                                        left: `${left * 100}%`,
                                        width: `${width * 100}%`,
                                    }}
                                />
                                {values.map((_, index) => {
                                    return (
                                        <AriaSliderThumb
                                            key={index}
                                            index={index}
                                            className={({ isFocusVisible, isDragging }) =>
                                                cx(
                                                    "top-1/2 -translate-y-1/2 box-border size-6 cursor-grab rounded-full bg-slider-handle-bg shadow-md ring-2 ring-slider-handle-border ring-inset",
                                                    isFocusVisible && "outline-2 outline-offset-2 outline-focus-ring",
                                                    isDragging && "cursor-grabbing",
                                                )
                                            }
                                        >
                                            {labelPosition !== "default" && (
                                                <AriaSliderOutput className={cx("whitespace-nowrap", styles[labelPosition])}>
                                                    {labelFormatter 
                                                        ? labelFormatter(getThumbValue(index)) 
                                                        : suffix 
                                                            ? `${getThumbValue(index)}${suffix}` 
                                                            : getFormattedValue(getThumbValue(index) / 100)}
                                                </AriaSliderOutput>
                                            )}
                                        </AriaSliderThumb>
                                    );
                                })}
                            </>
                        );
                    }}
                </AriaSliderTrack>
                {helperText && (
                    <div className="text-sm text-tertiary dark:text-gray-400">
                        {helperText}
                    </div>
                )}
            </div>
        </AriaSlider>
    );
};
