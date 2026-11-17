'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

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
        className={`h-11 w-full appearance-none rounded-xl border border-zinc-200 bg-white pl-3.5 pr-10 text-sm text-zinc-900 shadow-xs transition-colors hover:border-zinc-300 focus:border-electric-500 focus:outline-none focus:ring-4 focus:ring-electric-500/15 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-700 ${className}`}
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
