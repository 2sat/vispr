'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const manageLinks = [
  { id: 'applications', href: '/applications', title: 'Applications & policies', desc: 'API keys, saved policies, limits, fallbacks' },
  { id: 'providers', href: '/providers', title: 'Provider console', desc: 'Endpoints, offerings, bid strategy, capacity' },
  { id: 'catalog', href: '/catalog', title: 'Model catalog', desc: 'Benchmarks, pricing, sources, refresh history' },
];

interface AppHeaderProps {
  active: 'playground' | 'trace' | 'applications' | 'providers' | 'catalog';
  traceHref: string;
  role: 'Builder' | 'Operator';
}

export function AppHeader({ active, traceHref, role }: AppHeaderProps) {
  return (
    <header className="app-header">
      <span className="app-header__brand">Vispr</span>
      <nav aria-label="Primary" className="app-header__nav">
        <Link href="/playground" className="nav-link" aria-current={active === 'playground' ? 'page' : undefined}>
          Playground
        </Link>
        <Link href={traceHref} className="nav-link" aria-current={active === 'trace' ? 'page' : undefined}>
          Request trace
        </Link>
        <ManageMenu active={active} />
      </nav>
      <span className="app-header__role">{role}</span>
    </header>
  );
}

function ManageMenu({ active }: { active: AppHeaderProps['active'] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={rootRef}>
      <button
        type="button"
        className="nav-link menu__button"
        data-section-active={manageLinks.some((l) => l.id === active) || undefined}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        Manage {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="menu__panel">
          {manageLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="menu__item"
              aria-current={active === l.id ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              <span className="menu__title">{l.title}</span>
              <span className="menu__desc">{l.desc}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
