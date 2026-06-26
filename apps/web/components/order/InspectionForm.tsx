'use client';

import React, { useState } from 'react';
import { PhotoKind, type InspectionDto } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '@/lib/session';
import { uploadPhoto, MediaError } from '@/lib/media';
import type { OrderDetail, ItemView } from '@/lib/types';
import { Button, Field, Input, Modal } from '../ui';

const MEASURE_FIELDS: { key: string; label: string }[] = [
  { key: 'sqft', label: 'Area (sq ft)' },
  { key: 'widthFt', label: 'Width (ft)' },
  { key: 'lengthFt', label: 'Length (ft)' },
  { key: 'pieces', label: 'Pieces' },
  { key: 'weightLb', label: 'Weight (lb)' },
];

/**
 * Intake/inspection workstation form (Increment 13) — records condition codes, measurements, and a
 * pre-existing-damage flag with a REAL photo via the /media presign→PUT→confirm flow (web file input).
 * The server computes everything downstream; this just submits the proven inspection endpoint.
 */
export function InspectionForm({ orderId, item, onClose, onDone }: { orderId: string; item: ItemView; onClose: () => void; onDone: (o: OrderDetail) => void }): React.ReactElement {
  const { client } = useSession();
  const [measures, setMeasures] = useState<Record<string, string>>({});
  const [conditionCodes, setConditionCodes] = useState('');
  const [notes, setNotes] = useState('');
  const [damage, setDamage] = useState(false);
  const [customerAck, setCustomerAck] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);

    const measurements: Record<string, number> = {};
    for (const f of MEASURE_FIELDS) {
      const v = measures[f.key];
      if (v != null && v.trim() !== '') {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) {
          setError(`${f.label} must be a positive number.`);
          return;
        }
        measurements[f.key] = n;
      }
    }
    if (Object.keys(measurements).length === 0) {
      setError('Capture at least one measurement (e.g. area in sq ft).');
      return;
    }
    if (damage && !file) {
      setError('A damage photo is required when flagging pre-existing damage.');
      return;
    }
    if (damage && !customerAck) {
      setError('Customer acknowledgement is required when flagging pre-existing damage.');
      return;
    }

    setBusy(true);
    try {
      let damagePhotoId: string | undefined;
      if (damage && file) {
        const photo = await uploadPhoto(client, { orderId, itemId: item.id, kind: PhotoKind.INTAKE, file });
        damagePhotoId = photo.id;
      }
      const dto: InspectionDto = {
        conditionCodes: conditionCodes.split(',').map((c) => c.trim()).filter(Boolean),
        notes: notes.trim() || undefined,
        measurements,
        preexistingDamage: damage,
        ...(damage ? { customerAck: true, damagePhotoId } : {}),
      };
      const updated = await client.inspectItem(orderId, item.id, dto);
      onDone(updated);
    } catch (err) {
      if (err instanceof MediaError) setError(err.message);
      else setError(err instanceof ApiError ? err.message : 'Could not save the inspection.');
      setBusy(false);
    }
  };

  return (
    <Modal title={`Inspect ${item.kind.toLowerCase()}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {MEASURE_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <Input
                type="number"
                step="any"
                min="0"
                value={measures[f.key] ?? ''}
                onChange={(e) => setMeasures((m) => ({ ...m, [f.key]: e.target.value }))}
                aria-label={f.label}
              />
            </Field>
          ))}
        </div>
        <Field label="Condition codes (comma-separated)">
          <Input value={conditionCodes} onChange={(e) => setConditionCodes(e.target.value)} placeholder="frayed, stain" />
        </Field>
        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </Field>

        <label className="flex items-center gap-2 text-sm text-bb-ink">
          <input type="checkbox" checked={damage} onChange={(e) => setDamage(e.target.checked)} aria-label="Pre-existing damage" />
          Flag pre-existing damage
        </label>

        {damage && (
          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <Field label="Damage photo (required)">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                aria-label="Damage photo"
                className="text-sm"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-bb-ink">
              <input type="checkbox" checked={customerAck} onChange={(e) => setCustomerAck(e.target.checked)} aria-label="Customer acknowledged" />
              Customer acknowledged the pre-existing damage
            </label>
          </div>
        )}

        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Save inspection
          </Button>
        </div>
      </form>
    </Modal>
  );
}
