'use client';

import React, { useState } from 'react';
import { WeighPoint } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '@/lib/session';
import { can } from '@/lib/rbac';
import { useOrderWeightLive } from '@/lib/useOrderWeightLive';
import { shortDate } from '@/lib/format';
import { Badge, Button, Card, ErrorBox, Field, Input, Select, SkeletonText } from '../ui';

/**
 * [Inc-23 P3] The order's weight — LIVE. Shows the authoritative weight + weigh point + who/when + the
 * full append-only capture history + the computed price line, updated the moment a driver approves (via
 * the fleet `weight` socket → REST re-read). OWNER/PLANT can post an AUDITED correction, which writes a
 * NEW capture (never mutates history); the old captures stay intact in the list. RBAC + org-scoping are
 * enforced server-side; the form only mirrors the gate.
 */
export function WeightPanel({ orderId }: { orderId: string }): React.ReactElement {
  const { client, me } = useSession();
  const { weight, loading, error, live, lastEvent, refresh } = useOrderWeightLive(client, orderId);
  const canOverride = can.intake(me); // OWNER / CSR / PLANT_OP

  const [kg, setKg] = useState('');
  const [point, setPoint] = useState<WeighPoint>(WeighPoint.PLANT);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const w = Number(kg);
    if (!(w > 0)) {
      setErr('Enter a weight in kilograms.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await client.weighOrder(orderId, { weightKg: w, weighPoint: point, source: 'owner_adjustment', ...(note.trim() ? { note: note.trim() } : {}) });
      setKg('');
      setNote('');
      refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not record the weight.');
    } finally {
      setBusy(false);
    }
  };

  const priceLine = lastEvent?.priceTotal ?? null;

  return (
    <Card title="Weight" actions={<Badge tone={live ? 'green' : 'neutral'}>{live ? '● Live' : 'Snapshot'}</Badge>}>
      {loading ? (
        <SkeletonText lines={3} />
      ) : error ? (
        <ErrorBox message={error} onRetry={refresh} />
      ) : (
        <div className="space-y-3">
          {weight?.authoritativeWeightKg ? (
            <div>
              <div className="flex items-baseline gap-2">
                <span data-testid="weight-authoritative" className="text-title1 font-semibold tabular-nums text-ink">
                  {weight.authoritativeWeightKg} kg
                </span>
                {weight.authoritativeWeighPoint && <Badge tone="blue">{weight.authoritativeWeighPoint}</Badge>}
              </div>
              {weight.captures[0] && (
                <p className="mt-0.5 text-caption text-tertiary">
                  {weight.captures[0].source ?? 'captured'} · {shortDate(weight.captures[0].capturedAt)}
                  {priceLine ? ` · priced ${priceLine}` : ''}
                </p>
              )}
            </div>
          ) : (
            <p className="text-subhead text-secondary" data-testid="weight-pending">
              Not weighed yet{weight?.customerEstimate != null ? ` — customer estimate ~${weight.customerEstimate} kg` : ''}.
            </p>
          )}

          {weight && weight.captures.length > 0 && (
            <div className="space-y-1 border-t border-hairline pt-2" data-testid="weight-history">
              <p className="text-caption font-semibold text-secondary">History ({weight.captures.length})</p>
              {weight.captures.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 text-caption text-tertiary" data-testid={`weight-capture-${c.id}`}>
                  <span className="tabular-nums text-ink">
                    {c.weightKg} kg · {c.weighPoint}
                  </span>
                  <span className="truncate">
                    {c.source ?? ''} · {shortDate(c.capturedAt)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {canOverride && (
            <div className="space-y-2 border-t border-hairline pt-3" data-testid="weight-override">
              <p className="text-caption font-semibold text-secondary">Post an audited correction (writes a new capture — history is preserved)</p>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Weight (kg)">
                  <Input value={kg} onChange={(e) => setKg(e.target.value)} type="number" step="0.01" min="0" className="w-28" aria-label="correction weight" data-testid="weight-override-input" />
                </Field>
                <Field label="Point">
                  <Select value={point} onChange={(e) => setPoint(e.target.value as WeighPoint)} aria-label="weigh point">
                    <option value={WeighPoint.PLANT}>Plant</option>
                    <option value={WeighPoint.PICKUP}>Pickup</option>
                  </Select>
                </Field>
                <Field label="Note">
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="reason" aria-label="correction note" />
                </Field>
                <Button size="sm" loading={busy} disabled={!kg.trim()} onClick={() => void submit()} data-testid="weight-override-save">
                  Record
                </Button>
              </div>
              {err && (
                <p className="text-sm text-danger" role="alert">
                  {err}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
