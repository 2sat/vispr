'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const manageLinks = [
  { id: 'applications', href: '/applications', title: 'Applications & policies', desc: 'API keys, saved policies, limits, fallbacks' },
  { id: 'providers-console', href: '/providers/console', title: 'Provider console', desc: 'Endpoints, offerings, bid strategy, capacity' },
  { id: 'catalog', href: '/catalog', title: 'Model catalog', desc: 'Sourced inventory, pricing, context, evidence gaps' },
];

interface AppHeaderProps {
  active: 'playground' | 'trace' | 'applications' | 'providers' | 'providers-console' | 'catalog' | 'explorer' | 'flow';
  traceHref: string;
  role: 'Builder' | 'Operator' | 'Provider';
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
        <Link href="/explorer" className="nav-link" aria-current={active === 'explorer' ? 'page' : undefined}>Model explorer</Link>
        <Link href="/how-it-works" className="nav-link" aria-current={active === 'flow' ? 'page' : undefined}>How it works</Link>
        <ManageMenu active={active} />
        {active === 'providers' && <Link href="/providers" className="nav-link" aria-current="page">Providers</Link>}
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
          {manageLinks.map((l) => l.id === 'applications' ? (
            <div key={l.href} className="menu__item menu__item--unavailable" aria-disabled="true">
              <span className="menu__title">{l.title}</span>
              <span className="menu__desc">{l.desc}</span>
              <span className="menu__availability">Not yet available</span>
            </div>
          ) : (
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
