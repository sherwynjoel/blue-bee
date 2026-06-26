'use client';

import React, { useState } from 'react';
import { OrderStatus, RoleType } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '@/lib/session';
import { hasAnyRole } from '@/lib/rbac';
import type { OrderDetail } from '@/lib/types';
import { Button, Field, Input, Modal } from '../ui';

const CSR_ROLES = [RoleType.OWNER, RoleType.CSR];
const TERMINAL: OrderStatus[] = [OrderStatus.CLOSED, OrderStatus.CLOSED_NO_WORK, OrderStatus.QUOTE_DECLINED];

/** The §5.1 lifecycle actions ops can drive from the order header (CSR/OWNER). Illegal → server 409 surfaced. */
export function OrderActions({ order, onChanged }: { order: OrderDetail; onChanged: (o: OrderDetail) => void }): React.ReactElement | null {
  const { client, me } = useSession();
  const [modal, setModal] = useState<'pickup' | 'hold' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!hasAnyRole(me, CSR_ROLES)) return null;

  const run = async (fn: () => Promise<OrderDetail>, key: string): Promise<void> => {
    setBusy(key);
    setError(null);
    try {
      onChanged(await fn());
      setModal(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  };

  const s = order.status;
  const canReceive = s === OrderStatus.SCHEDULED_PICKUP || s === OrderStatus.PICKUP_EN_ROUTE;
  const canHold = s !== OrderStatus.ON_HOLD && !TERMINAL.includes(s);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {s === OrderStatus.REQUESTED && (
        <Button variant="secondary" onClick={() => setModal('pickup')}>
          Schedule pickup
        </Button>
      )}
      {canReceive && (
        <Button variant="secondary" loading={busy === 'receive'} onClick={() => void run(() => client.receivedAtPlant(order.id), 'receive')}>
          Receive at plant
        </Button>
      )}
      {canHold && (
        <Button variant="secondary" onClick={() => setModal('hold')}>
          Hold
        </Button>
      )}
      {s === OrderStatus.ON_HOLD && (
        <Button variant="secondary" loading={busy === 'resume'} onClick={() => void run(() => client.resumeOrder(order.id), 'resume')}>
          Resume
        </Button>
      )}
      {error && <span className="text-sm text-red-700">{error}</span>}

      {modal === 'pickup' && <PickupModal onClose={() => setModal(null)} busy={busy === 'pickup'} error={error} onSubmit={(w) => void run(() => client.schedulePickup(order.id, { pickupWindow: w }), 'pickup')} />}
      {modal === 'hold' && <HoldModal onClose={() => setModal(null)} busy={busy === 'hold'} error={error} onSubmit={(reason) => void run(() => client.holdOrder(order.id, { reason }), 'hold')} />}
    </div>
  );
}

function PickupModal({ onClose, onSubmit, busy, error }: { onClose: () => void; onSubmit: (w: { start: string; end: string }) => void; busy: boolean; error: string | null }): React.ReactElement {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!start || !end) return;
    onSubmit({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
  };
  return (
    <Modal title="Schedule pickup" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Window start">
          <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Window start" />
        </Field>
        <Field label="Window end">
          <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Window end" />
        </Field>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!start || !end}>
            Schedule
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function HoldModal({ onClose, onSubmit, busy, error }: { onClose: () => void; onSubmit: (reason: string) => void; busy: boolean; error: string | null }): React.ReactElement {
  const [reason, setReason] = useState('');
  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (reason.trim().length < 3) return;
    onSubmit(reason.trim());
  };
  return (
    <Modal title="Place on hold" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this on hold?" aria-label="Hold reason" />
        </Field>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={reason.trim().length < 3}>
            Hold
          </Button>
        </div>
      </form>
    </Modal>
  );
}
