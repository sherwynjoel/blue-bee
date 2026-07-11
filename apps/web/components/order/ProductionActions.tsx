'use client';

import React, { useState } from 'react';
import { CheckCircle2, ClipboardCheck, RotateCcw, Sparkles } from 'lucide-react';
import { OrderStatus } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '@/lib/session';
import { can } from '@/lib/rbac';
import type { OrderDetail } from '@/lib/types';
import { Button, Field, Input, Modal } from '../ui';

/**
 * Plant/production actions (Inc-30) — the §5.1 back-half QUOTE_APPROVED → IN_CLEANING → QC → READY
 * (+ the REWASH branch) that ops drive from the console. Only the LEGAL next action(s) for the current
 * status are offered (mirrors SPECIALTY_ORDER_TRANSITIONS), so an illegal call is never issued from the
 * UI; if the order was moved concurrently the server returns 409 and we ask the user to refresh. Gated to
 * OWNER/CSR/PLANT_OP — the server independently re-checks the same @Roles, so this is UX only.
 */
export function ProductionActions({ order, onChanged }: { order: OrderDetail; onChanged: (o: OrderDetail) => void }): React.ReactElement | null {
  const { client, me } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<'rewash' | 'qcFail' | null>(null);

  if (!can.production(me)) return null;

  const run = async (fn: () => Promise<OrderDetail>, key: string): Promise<void> => {
    setBusy(key);
    setError(null);
    try {
      onChanged(await fn());
      setModal(null);
    } catch (err) {
      if (err instanceof ApiError && err.isConflict) {
        // 409 — the order was moved concurrently (someone else advanced it); re-sync to server truth.
        setError('This order just moved on — refresh to see its current step.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Action failed.');
      }
    } finally {
      setBusy(null);
    }
  };

  const s = order.status;
  const anyAction =
    s === OrderStatus.QUOTE_APPROVED || s === OrderStatus.IN_CLEANING || s === OrderStatus.QC || s === OrderStatus.REWASH;
  if (!anyAction) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="production-actions">
      {s === OrderStatus.QUOTE_APPROVED && (
        <Button variant="secondary" loading={busy === 'start'} onClick={() => void run(() => client.startCleaning(order.id), 'start')} data-testid="prod-start-cleaning">
          {busy !== 'start' && <Sparkles className="h-4 w-4" aria-hidden="true" />} Start cleaning
        </Button>
      )}
      {s === OrderStatus.REWASH && (
        <Button variant="secondary" loading={busy === 'start'} onClick={() => void run(() => client.startCleaning(order.id), 'start')} data-testid="prod-restart-cleaning">
          {busy !== 'start' && <RotateCcw className="h-4 w-4" aria-hidden="true" />} Restart cleaning
        </Button>
      )}
      {s === OrderStatus.IN_CLEANING && (
        <>
          <Button variant="secondary" loading={busy === 'send-qc'} onClick={() => void run(() => client.sendToQc(order.id), 'send-qc')} data-testid="prod-send-to-qc">
            {busy !== 'send-qc' && <ClipboardCheck className="h-4 w-4" aria-hidden="true" />} Send to QC
          </Button>
          <Button variant="secondary" onClick={() => setModal('rewash')} data-testid="prod-rewash">
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Rewash
          </Button>
        </>
      )}
      {s === OrderStatus.QC && (
        <>
          <Button variant="secondary" loading={busy === 'ready'} onClick={() => void run(() => client.recordQc(order.id, { result: 'pass' }), 'ready')} data-testid="prod-pass-qc">
            {busy !== 'ready' && <CheckCircle2 className="h-4 w-4" aria-hidden="true" />} Pass QC — mark ready
          </Button>
          <Button variant="secondary" onClick={() => setModal('qcFail')} data-testid="prod-fail-qc">
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Fail QC — rewash
          </Button>
        </>
      )}
      {error && <span className="text-footnote font-medium text-danger" data-testid="prod-error">{error}</span>}

      {modal === 'rewash' && (
        <ReasonModal
          title="Send back for a rewash"
          prompt="Why does this load need another cleaning cycle?"
          onClose={() => setModal(null)}
          busy={busy === 'rewash'}
          error={error}
          onSubmit={(reason) => void run(() => client.rewashOrder(order.id, { reason }), 'rewash')}
        />
      )}
      {modal === 'qcFail' && (
        <ReasonModal
          title="Fail QC — send back for a rewash"
          prompt="What did QC find? (recorded on the order)"
          onClose={() => setModal(null)}
          busy={busy === 'qcFail'}
          error={error}
          onSubmit={(reason) => void run(() => client.recordQc(order.id, { result: 'fail', reason }), 'qcFail')}
        />
      )}
    </div>
  );
}

/** A reason-required modal (rewash / QC fail). Mirrors OrderActions' HoldModal; reason must be ≥3 chars. */
function ReasonModal({
  title,
  prompt,
  onClose,
  onSubmit,
  busy,
  error,
}: {
  title: string;
  prompt: string;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  busy: boolean;
  error: string | null;
}): React.ReactElement {
  const [reason, setReason] = useState('');
  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (reason.trim().length < 3) return;
    onSubmit(reason.trim());
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={prompt} aria-label="Rewash reason" />
        </Field>
        {error && <p className="text-footnote font-medium text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={reason.trim().length < 3}>
            Send back
          </Button>
        </div>
      </form>
    </Modal>
  );
}
