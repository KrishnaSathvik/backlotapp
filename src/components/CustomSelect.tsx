'use client';

import React from 'react';
import { MenuSelect, type MenuOption } from './MenuSelect';

/** Reads <option value>label</option> children (also inside fragments and arrays). */
function optionsFrom(children: React.ReactNode): MenuOption[] {
  const out: MenuOption[] = [];
  const text = (node: React.ReactNode): string =>
    React.Children.toArray(node)
      .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : React.isValidElement(c) ? text((c.props as { children?: React.ReactNode }).children) : ''))
      .join('');
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as { value?: string | number; children?: React.ReactNode; disabled?: boolean };
    if (child.type === 'option') {
      if (props.disabled) return;
      const label = text(props.children);
      out.push({ value: String(props.value ?? label), label });
    } else if (props.children) {
      out.push(...optionsFrom(props.children));
    }
  });
  return out;
}

interface FormSelectProps {
  id?: string;
  value: string | number;
  /** Called like a native select's onChange: only `e.target.value` is set. */
  onChange?: (e: { target: { value: string } }) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  children: React.ReactNode;
}

/**
 * Backlot's form dropdown. Same API as a native <select> with <option> children, rendered as the
 * styled MenuSelect (not the browser's built-in list).
 */
export const FormSelect: React.FC<FormSelectProps> = ({ id, value, onChange, disabled, className = '', children, 'aria-label': ariaLabel }) => (
  <MenuSelect
    id={id}
    value={String(value ?? '')}
    onChange={(v) => onChange?.({ target: { value: v } })}
    options={optionsFrom(children)}
    ariaLabel={ariaLabel}
    disabled={disabled}
    className={className}
    sizeClass={/(^|\s)h-/.test(className) ? '' : 'h-11'}
  />
);
