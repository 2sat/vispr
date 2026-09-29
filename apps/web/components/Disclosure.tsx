'use client';

import { useId, useState, type ReactNode } from 'react';

interface DisclosureProps {
  title: string;
  /** Short hint shown next to the title while collapsed and expanded. */
  hint?: string;
  defaultOpen?: boolean;
  variant?: 'row' | 'inline';
  children: ReactNode;
}

export function Disclosure({ title, hint, defaultOpen = false, variant = 'row', children }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <div className={`disclosure disclosure--${variant}`}>
      <button
        type="button"
        className="disclosure__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="disclosure__chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="disclosure__title">{title}</span>
        {hint && <span className="disclosure__hint">{hint}</span>}
      </button>
      <div id={panelId} className="disclosure__panel" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
