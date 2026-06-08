import React from 'react';
import { 
  DatePicker as AriaDatePicker, 
  DatePickerProps as AriaDatePickerProps,
  DateValue,
  Button as AriaButton,
  Calendar as AriaCalendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridHeader,
  CalendarGridBody,
  CalendarHeaderCell,
  Dialog,
  Group,
  Heading,
  Input as AriaInput,
  Label,
  Popover,
  DateSegment,
  DateInput
} from 'react-aria-components';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from '@/utils/cx';

export interface DatePickerProps<T extends DateValue> extends AriaDatePickerProps<T> {
  label?: string;
  error?: string;
  hint?: string;
}

export const DatePicker = <T extends DateValue>({ label, error, hint, ...props }: DatePickerProps<T>) => {
  return (
    <AriaDatePicker {...props} className={cx("group flex flex-col gap-1.5 w-full", props.className)}>
      {label && <Label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</Label>}
      <Group className="relative flex items-center bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded-lg focus-within:ring-4 focus-within:ring-primary-100 focus-within:border-primary-300 dark:focus-within:ring-primary-900/30 dark:focus-within:border-primary-500 transition-all h-10 px-3">
        <DateInput className="flex flex-1 text-sm text-gray-900 dark:text-gray-100 py-2">
          {segment => <DateSegment segment={segment} className="px-0.5 rounded-sm focus:bg-primary-600 focus:text-white outline-none caret-transparent" />}
        </DateInput>
        <AriaButton className="p-1 -mr-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 outline-none">
          <CalendarIcon size={18} />
        </AriaButton>
      </Group>
      {hint && !error && <p className="text-sm text-gray-500 dark:text-gray-400">{hint}</p>}
      {error && <p className="text-sm text-error-600 dark:text-error-400">{error}</p>}
      <Popover className="p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl z-50 overflow-auto">
        <Dialog className="outline-none">
          <AriaCalendar>
            <header className="flex items-center justify-between mb-4">
              <Heading className="text-sm font-semibold text-gray-900 dark:text-white" />
              <div className="flex items-center gap-1">
                <AriaButton slot="previous" className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg outline-none transition-colors">
                  <ChevronLeft size={18} />
                </AriaButton>
                <AriaButton slot="next" className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg outline-none transition-colors">
                  <ChevronRight size={18} />
                </AriaButton>
              </div>
            </header>
            <CalendarGrid className="border-separate border-spacing-1 [&_tr]:flex [&_tr]:flex-row">
              <CalendarGridHeader>
                {day => (
                  <CalendarHeaderCell className="text-xs font-medium text-gray-500 dark:text-gray-400 w-8 h-8">
                    <div className="flex items-center justify-center w-full h-full">
                      {day}
                    </div>
                  </CalendarHeaderCell>
                )}
              </CalendarGridHeader>
              <CalendarGridBody>
                {date => (
                  <CalendarCell 
                    date={date} 
                    className={({ isSelected, isToday, isOutsideMonth, isFocusVisible }) => cx(
                      "w-8 h-8 text-sm rounded-lg cursor-pointer transition-colors outline-none p-0",
                      isSelected ? "bg-primary-600 text-white" : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800",
                      isToday && !isSelected && "text-primary-600 font-bold",
                      isOutsideMonth && "text-gray-300 dark:text-gray-600",
                      isFocusVisible && "ring-2 ring-primary-600 ring-offset-2 dark:ring-offset-gray-900"
                    )}
                  >
                    {({formattedDate}) => (
                      <div className="flex items-center justify-center w-full h-full">
                        {formattedDate}
                      </div>
                    )}
                  </CalendarCell>
                )}
              </CalendarGridBody>
            </CalendarGrid>
          </AriaCalendar>
        </Dialog>
      </Popover>
    </AriaDatePicker>
  );
};
