'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Inbox,
  Info,
  RefreshCw,
  TriangleAlert,
  X,
  XCircle,
} from 'lucide-react';

/**
 * Daylight UI primitives — the shared console design system. Restyled to the
 * Daylight tokens (tailwind.config + globals.css) with full dark-mode parity,
 * accessible focus, and reduced-motion-aware motion. APIs are backward-compatible
 * with Increment-13 callers; new primitives (Skeleton, StatusPill, Tabs,
 * SegmentedControl, Sheet, Textarea, Toast, Table) extend the set.
 */

/** Tiny classNames joiner (no dependency). Falsy entries are dropped. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export type Tone = 'neutral' | 'green' | 'blue' | 'amber' | 'red';

// ───────────────────────────── Surfaces ─────────────────────────────

export function Card({
  title,
  subtitle,
  children,
  actions,
  className = '',
  padded = true,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  padded?: boolean;
}): React.ReactElement {
  return (
    <section className={cn('rounded-card border border-hairline bg-surface shadow-e1', padded && 'p-5', className)}>
      {(title || actions || subtitle) && (
        <div className={cn('flex items-start justify-between gap-3', padded ? 'mb-4' : 'p-5 pb-0')}>
          <div className="min-w-0">
            {title ? <h2 className="truncate text-headline text-ink">{title}</h2> : <span />}
            {subtitle && <p className="mt-0.5 text-footnote text-secondary">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Page-level header: title (+ optional subtitle) on the left, actions on the right. */
export function PageHeader({
  title,
  subtitle,
  actions,
  className = '',
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="text-title1 text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-subhead font-normal text-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ───────────────────────────── Buttons ─────────────────────────────

const BTN_BASE =
  'inline-flex items-center justify-center gap-2 rounded-btn font-semibold whitespace-nowrap transition duration-fast ease-daylight select-none disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:shadow-focus active:scale-[0.97]';
const BTN_SIZES = { sm: 'h-8 px-3 text-footnote', md: 'h-10 px-4 text-subhead', lg: 'h-11 px-5 text-body' };
const BTN_VARIANTS = {
  primary: 'bg-primary text-primary-fg shadow-e1 hover:bg-primary-hover active:bg-primary-active',
  secondary: 'border border-hairline bg-surface text-ink hover:bg-subtle',
  ghost: 'text-secondary hover:bg-subtle hover:text-ink',
  // back-compat: the Inc-13 "danger" is a quiet outline action (Decline / Delete / Remove).
  danger: 'border border-hairline bg-surface text-danger hover:border-danger hover:bg-danger-tint',
  destructive: 'bg-danger text-white shadow-e1 hover:opacity-90',
  success: 'bg-success text-white shadow-e1 hover:opacity-90',
};
export type ButtonVariant = keyof typeof BTN_VARIANTS;

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: keyof typeof BTN_SIZES;
  loading?: boolean;
};
export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  children,
  className = '',
  disabled,
  ...rest
}: BtnProps): React.ReactElement {
  return (
    <button className={cn(BTN_BASE, BTN_SIZES[size], BTN_VARIANTS[variant], className)} disabled={disabled || loading} {...rest}>
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

/** A square icon-only button (toolbar / close / toggle). `label` becomes the aria-label. */
export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  children,
  className = '',
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  label: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
}): React.ReactElement {
  return (
    <button
      aria-label={label}
      className={cn(BTN_BASE, BTN_VARIANTS[variant], size === 'sm' ? 'h-8 w-8' : 'h-10 w-10', 'p-0', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ small }: { small?: boolean }): React.ReactElement {
  return (
    <span
      role="status"
      aria-label="loading"
      className={cn('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', small ? 'h-4 w-4' : 'h-8 w-8')}
    />
  );
}

// ───────────────────────────── Badges / pills ─────────────────────────────

const BADGE_TONES: Record<Tone, string> = {
  neutral: 'bg-subtle text-neutral-strong',
  green: 'bg-success-tint text-success-strong',
  blue: 'bg-primary-tint text-primary-strong',
  amber: 'bg-warning-tint text-warning-strong',
  red: 'bg-danger-tint text-danger-strong',
};
const DOT_TONES: Record<Tone, string> = {
  neutral: 'bg-tertiary',
  green: 'bg-success',
  blue: 'bg-primary',
  amber: 'bg-warning',
  red: 'bg-danger',
};

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}): React.ReactElement {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-caption font-semibold', BADGE_TONES[tone], className)}>
      {children}
    </span>
  );
}

/**
 * A status pill: a Badge with a leading status dot — the canonical way to render a
 * domain status (order/route/garment/payment). Pass the tone the screen already
 * computes; the label text is preserved verbatim so existing assertions hold.
 */
export function StatusPill({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}): React.ReactElement {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold', BADGE_TONES[tone], className)}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', DOT_TONES[tone])} aria-hidden="true" />
      {children}
    </span>
  );
}

// ───────────────────────────── Feedback states ─────────────────────────────

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }): React.ReactElement {
  return (
    <div role="alert" className="flex gap-3 rounded-card border border-danger bg-danger-tint p-4 text-footnote text-danger-strong">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" strokeWidth={2} aria-hidden="true" />
      <div>
        <p className="font-medium">{message}</p>
        {onRetry && (
          <button
            className="mt-2 inline-flex items-center gap-1.5 font-semibold text-danger underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus rounded"
            onClick={onRetry}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A friendly, consistent empty state. `message` is always rendered; an optional
 * `title`, `icon`, and `action` make individual screens more inviting.
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
    <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-hairline bg-surface px-6 py-12 text-center">
      <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-primary-tint text-primary" aria-hidden="true">
        {icon ?? <Inbox className="h-5 w-5" strokeWidth={1.75} />}
      </span>
      {title && <p className="text-subhead font-semibold text-ink">{title}</p>}
      <p className="max-w-sm text-footnote text-secondary">{message}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-center gap-3 p-10 text-secondary" role="status">
      <Spinner /> <span className="text-footnote">{label}</span>
    </div>
  );
}

// ───────────────────────────── Skeletons ─────────────────────────────

/** A single shimmering placeholder block. Compose for screen-shaped loaders. */
export function Skeleton({ className = '' }: { className?: string }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn('relative block overflow-hidden rounded-md bg-subtle', 'after:absolute after:inset-0 after:-translate-x-full after:animate-shimmer', 'after:bg-gradient-to-r after:from-transparent after:via-black/5 after:to-transparent dark:after:via-white/10', className)}
    />
  );
}

/** A few lines of skeleton text. */
export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }): React.ReactElement {
  return (
    <div className={cn('space-y-2', className)} role="status" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

/** A table-shaped skeleton (header + rows), the default loader for data tables. */
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }): React.ReactElement {
  return (
    <div role="status" aria-label="Loading" className="overflow-hidden">
      <div className="flex gap-4 border-b border-hairline pb-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-hairline">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 py-3.5">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className={cn('h-3.5 flex-1', c === 0 && 'max-w-[42%]')} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────────── Form controls ─────────────────────────────

/**
 * A labelled field. The control is wrapped by the <label> (implicit association,
 * so getByLabelText finds it); helper/error render OUTSIDE the label so the
 * accessible name stays exactly the label text.
 */
export function Field({
  label,
  helper,
  error,
  children,
  className = '',
}: {
  label: string;
  helper?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn('block', className)}>
      <label className="block">
        <span className="mb-1.5 block text-footnote font-medium text-secondary">{label}</span>
        {children}
      </label>
      {error ? (
        <p className="mt-1 text-caption font-medium text-danger">{error}</p>
      ) : helper ? (
        <p className="mt-1 text-caption text-tertiary">{helper}</p>
      ) : null}
    </div>
  );
}

const CONTROL_BASE =
  'w-full rounded-input border border-hairline bg-surface px-3 py-2 text-subhead text-ink placeholder:text-tertiary transition duration-fast ease-daylight focus-visible:outline-none focus-visible:border-primary focus-visible:shadow-focus disabled:opacity-60 disabled:cursor-not-allowed';

/**
 * A caller-supplied width MUST beat the control's default `w-full`.
 *
 * `cn()` is a plain join (no tailwind-merge), and Tailwind emits `w-full` AFTER the numeric width scale — so
 * `<Input className="w-24" />` silently lost: the control still stretched to `w-full`, then got crushed to a
 * few pixels by its flex siblings. That is exactly what turned the catalog's price box into an unreadable
 * sliver. Six call sites were passing a width that never applied. Rather than make each one fight the base
 * class, the base simply yields its width when the caller states one.
 */
const controlClass = (className: string | undefined, extra: string): string =>
  cn(/(^|\s)!?w-\S+/.test(className ?? '') ? CONTROL_BASE.replace('w-full ', '') : CONTROL_BASE, extra, className);

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>): React.ReactElement {
  const { className, ...rest } = props;
  return <input {...rest} className={controlClass(className, 'h-10')} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>): React.ReactElement {
  const { className, ...rest } = props;
  return <textarea {...rest} className={controlClass(className, 'min-h-[88px] resize-y leading-relaxed')} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>): React.ReactElement {
  const { className, ...rest } = props;
  return (
    <select
      {...rest}
      className={controlClass(
        className,
        cn(
          'h-10 cursor-pointer appearance-none bg-[length:18px] bg-[right_0.6rem_center] bg-no-repeat pr-9',
          // chevron rendered via an inline SVG data-uri so no extra asset/markup is needed
          "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%238A99AE%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')]",
        ),
      )}
    />
  );
}

// ───────────────────────────── Tabs ─────────────────────────────

export interface TabDef {
  value: string;
  label: React.ReactNode;
}

/** Underlined tab bar with correct ARIA (role=tablist/tab, aria-selected). */
export function Tabs({
  tabs,
  value,
  onChange,
  className = '',
}: {
  tabs: TabDef[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}): React.ReactElement {
  return (
    <div role="tablist" className={cn('flex items-center gap-1 border-b border-hairline', className)}>
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn(
              '-mb-px border-b-2 px-3.5 py-2.5 text-subhead font-medium transition duration-fast ease-daylight focus-visible:outline-none focus-visible:shadow-focus rounded-t',
              active ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-ink',
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** A pill segmented control — same ARIA as Tabs, compact filled style. */
export function SegmentedControl({
  options,
  value,
  onChange,
  className = '',
}: {
  options: TabDef[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}): React.ReactElement {
  return (
    <div role="tablist" className={cn('inline-flex items-center gap-1 rounded-btn border border-hairline bg-subtle p-1', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-[8px] px-3 py-1.5 text-footnote font-semibold transition duration-fast ease-daylight focus-visible:outline-none focus-visible:shadow-focus',
              active ? 'bg-surface text-ink shadow-e1' : 'text-secondary hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────────── Overlays ─────────────────────────────

function Scrim({ onClose }: { onClose: () => void }): React.ReactElement {
  return <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-fade-in dark:bg-black/60" onClick={onClose} aria-hidden="true" />;
}

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])';

/**
 * Dialog focus management for an aria-modal overlay: autofocus into the panel on open, Escape to close,
 * a Tab focus-trap within the panel, and focus restoration to the trigger on close. Runs once on mount
 * (Escape uses a ref to the latest onClose) so it never steals focus on re-render (e.g. typing in a field).
 */
function useDialogFocus(onClose: () => void): React.RefObject<HTMLDivElement> {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && panel) {
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
    // Mount/unmount only — onClose is read via onCloseRef so re-renders never re-trigger focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return panelRef;
}

/** Centered modal dialog (scrim + blur, e3, scale-in). */
export function Modal({
  title,
  onClose,
  children,
  size = 'md',
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}): React.ReactElement {
  const w = size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg';
  const panelRef = useDialogFocus(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <Scrim onClose={onClose} />
      <div ref={panelRef} tabIndex={-1} className={cn('relative w-full rounded-sheet border border-hairline bg-surface p-6 shadow-e3 animate-scale-in focus-visible:outline-none', w)}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-title3 text-ink">{title}</h2>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A right-anchored sheet (scrim + blur, e3, slide-in) for detail/edit flows. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}): React.ReactElement {
  const panelRef = useDialogFocus(onClose);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <Scrim onClose={onClose} />
      <div ref={panelRef} tabIndex={-1} className="relative flex h-full w-full max-w-md origin-right flex-col border-l border-hairline bg-surface shadow-e3 animate-scale-in focus-visible:outline-none">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
          <h2 className="text-title3 text-ink">{title}</h2>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-hairline px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

// ───────────────────────────── Table ─────────────────────────────

/**
 * A scroll-safe table shell with a sticky, hairline-ruled header. Screens keep
 * their own <thead>/<tbody>/<tr data-testid> so existing queries hold; this just
 * standardizes the chrome. Use `Th`/`Td` for consistent cell rhythm.
 */
export function Table({ children, className = '' }: { children: React.ReactNode; className?: string }): React.ReactElement {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className={cn('w-full border-collapse text-footnote', className)}>{children}</table>
    </div>
  );
}

export function Th({
  children,
  className = '',
  numeric,
}: {
  children?: React.ReactNode;
  className?: string;
  numeric?: boolean;
}): React.ReactElement {
  return (
    <th
      className={cn(
        'sticky top-0 z-10 border-b border-hairline bg-surface py-2.5 px-3 text-caption font-semibold uppercase tracking-wide text-tertiary',
        numeric ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = '',
  numeric,
}: {
  children?: React.ReactNode;
  className?: string;
  numeric?: boolean;
}): React.ReactElement {
  return <td className={cn('py-3 px-3 align-middle text-ink', numeric && 'text-right font-mono tabular-nums', className)}>{children}</td>;
}

/** A label/value row (finance + detail views). Value is right-aligned, mono when numeric. */
export function KV({
  label,
  value,
  mono,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  mono?: boolean;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-footnote text-secondary">{label}</span>
      <span className={cn('text-subhead text-ink', mono && 'font-mono tabular-nums')}>{value}</span>
    </div>
  );
}

// ───────────────────────────── Toast ─────────────────────────────

export interface ToastInput {
  title: string;
  description?: string;
  tone?: 'success' | 'error' | 'info';
  duration?: number;
}
interface ToastItem extends Required<Omit<ToastInput, 'description' | 'duration'>> {
  id: number;
  description?: string;
}

const ToastCtx = createContext<(t: ToastInput) => void>(() => {
  /* no-op fallback so screens rendered outside a ToastProvider (e.g. unit tests) never crash */
});

export function useToast(): (t: ToastInput) => void {
  return useContext(ToastCtx);
}

const TOAST_ICON = { success: CheckCircle2, error: XCircle, info: Info } as const;
const TOAST_TONE = {
  success: 'text-success',
  error: 'text-danger',
  info: 'text-primary',
} as const;

export function ToastProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((cur) => cur.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (t: ToastInput) => {
      const id = (idRef.current += 1);
      const item: ToastItem = { id, title: t.title, description: t.description, tone: t.tone ?? 'info' };
      setToasts((cur) => [...cur, item]);
      const ms = t.duration ?? 4200;
      if (typeof window !== 'undefined') window.setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-0 right-0 z-[60] flex w-full max-w-sm flex-col gap-2 p-4" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => {
          const Icon = TOAST_ICON[t.tone];
          return (
            <div
              key={t.id}
              role="status"
              className="pointer-events-auto flex items-start gap-3 rounded-card border border-hairline bg-surface p-3.5 shadow-e3 animate-fade-up"
            >
              <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', TOAST_TONE[t.tone])} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-subhead font-semibold text-ink">{t.title}</p>
                {t.description && <p className="mt-0.5 text-footnote text-secondary">{t.description}</p>}
              </div>
              <IconButton label="Dismiss notification" size="sm" onClick={() => dismiss(t.id)}>
                <X className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

// re-export a couple of lucide icons commonly needed by screens for a single source
export { TriangleAlert };
