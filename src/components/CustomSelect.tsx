'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

interface FilterDropdownProps {
  label: string;
  value: string;
  options: SelectOption[];
  allLabel: string;
  emptyHint?: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}

export const FilterDropdown: React.FC<FilterDropdownProps> = ({
  value,
  options,
  allLabel,
  emptyHint,
  onChange,
  ariaLabel,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const selectedOption = options.find((opt) => opt.value === value);
  const displayLabel = value === 'all' ? allLabel : selectedOption?.label ?? allLabel;
  const isFiltered = value !== 'all';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex h-9 items-center justify-between gap-2 rounded-lg border px-3 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
          isFiltered
            ? 'border-blue-600/40 bg-blue-50/70 text-blue-700 hover:bg-blue-50 dark:border-blue-500/40 dark:bg-blue-950/30 dark:text-blue-300'
            : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-800'
        }`}
      >
        <span className="truncate max-w-[140px]">{displayLabel}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${
            isFiltered
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-zinc-400 dark:text-zinc-500'
          } ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute right-0 z-30 mt-1.5 min-w-[190px] overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
        >
          <button
            type="button"
            role="option"
            aria-selected={value === 'all'}
            onClick={() => {
              onChange('all');
              setOpen(false);
            }}
            className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors ${
              value === 'all'
                ? 'bg-zinc-100 text-zinc-950 dark:bg-zinc-900 dark:text-white'
                : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900/60'
            }`}
          >
            <span>{allLabel}</span>
            {value === 'all' ? (
              <Check className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            ) : null}
          </button>

          {options.length > 0 ? (
            <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
          ) : null}

          {options.map((option) => {
            const active = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                  active
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900/60'
                }`}
              >
                <span className="truncate">{option.label}</span>
                {active ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                ) : null}
              </button>
            );
          })}

          {options.length === 0 && emptyHint ? (
            <p className="px-2.5 py-2 text-[11px] text-zinc-400 dark:text-zinc-500">
              {emptyHint}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

interface FormSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  children: React.ReactNode;
}

export const FormSelect: React.FC<FormSelectProps> = ({
  children,
  className = '',
  ...props
}) => {
  return (
    <div className="relative">
      <select
        {...props}
        className={`w-full appearance-none rounded-lg border border-zinc-200 bg-white pl-3 pr-9 text-sm text-zinc-900 focus:border-blue-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 ${className}`}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-500"
        aria-hidden="true"
      />
    </div>
  );
};
