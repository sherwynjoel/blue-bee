'use client';

import React from 'react';

/** Small Tailwind UI primitives shared across the console (Increment 13). */

export function Card({ title, children, actions }: { title?: string; children: React.ReactNode; actions?: React.ReactNode }): React.ReactElement {
  return (
    <div className="rounded-xl border border-bb-line bg-white p-5">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between">
          {title ? <h2 className="text-base font-semibold text-bb-ink">{title}</h2> : <span />}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger'; loading?: boolean };
export function Button({ variant = 'primary', loading, children, className = '', disabled, ...rest }: BtnProps): React.ReactElement {
  const base = 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition';
  const styles = {
    primary: 'bg-bb-blue text-white hover:bg-bb-blueDark',
    secondary: 'border border-bb-line bg-white text-bb-ink hover:bg-gray-50',
    danger: 'border border-red-300 bg-white text-red-700 hover:bg-red-50',
  }[variant];
  return (
    <button className={`${base} ${styles} ${className}`} disabled={disabled || loading} {...rest}>
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export function Spinner({ small }: { small?: boolean }): React.ReactElement {
  return (
    <span
      role="status"
      aria-label="loading"
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${small ? 'h-4 w-4' : 'h-8 w-8'}`}
    />
  );
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'green' | 'blue' | 'amber' | 'red' }): React.ReactElement {
  const tones = {
    neutral: 'bg-gray-100 text-gray-700',
    green: 'bg-green-100 text-green-800',
    blue: 'bg-blue-100 text-blue-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
  }[tone];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones}`}>{children}</span>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }): React.ReactElement {
  return (
    <div role="alert" className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <svg viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0 text-red-500" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM10 5a.9.9 0 01.9.9v4.2a.9.9 0 11-1.8 0V5.9A.9.9 0 0110 5zm0 8.2a1.05 1.05 0 100 2.1 1.05 1.05 0 000-2.1z"
          clipRule="evenodd"
        />
      </svg>
      <div>
        <p>{message}</p>
        {onRetry && (
          <button className="mt-2 font-semibold underline hover:no-underline" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A friendly, consistent empty state (console demo-polish). `message` is always rendered; an optional
 * `title`, `icon`, and `action` (e.g. a "New route" button) make individual screens more inviting
 * without each page re-styling its own empty box.
 */
export function EmptyState({
  title,
  message,
  icon,
  action,
}: {
  title?: string;
  message: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-bb-line bg-white px-6 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-bb-blueSoft text-bb-blue" aria-hidden="true">
        {icon ?? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7l9-4 9 4-9 4-9-4z" />
            <path d="M3 7v10l9 4 9-4V7" />
          </svg>
        )}
      </span>
      {title && <p className="text-sm font-semibold text-bb-ink">{title}</p>}
      <p className="max-w-sm text-sm text-bb-sub">{message}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-center gap-3 p-10 text-bb-sub" role="status">
      <Spinner /> <span>{label}</span>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-bb-sub">{label}</span>
      {children}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>): React.ReactElement {
  return <input {...props} className={`w-full rounded-lg border border-bb-line px-3 py-2 text-sm ${props.className ?? ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>): React.ReactElement {
  return <select {...props} className={`w-full rounded-lg border border-bb-line bg-white px-3 py-2 text-sm ${props.className ?? ''}`} />;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-bb-ink">{title}</h2>
          <button aria-label="Close" className="text-bb-sub hover:text-bb-ink" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
