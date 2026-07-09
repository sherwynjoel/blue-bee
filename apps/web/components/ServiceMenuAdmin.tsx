'use client';

import React, { useState } from 'react';
import { PricingModel, PricingUnit, type ServiceMenuCardView, type UpdateServiceMenuCardDto } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { Tag } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, PageHeader, Select, TableSkeleton, Textarea } from './ui';
import { RequireCapability } from './AppShell';

/**
 * Service-menu rate editor (Inc-21) — OWNER/FINANCE set the customer Home service cards' presentation
 * (description / feature tags / icon / unit / pricing model / sort order / active) AND the two money fields:
 * the backing per-unit RATE (what Inc-22 weight/measure pricing uses) and the "from $X" display anchor shown
 * on the card. HONESTY FIREWALL: both ship NULL — a card reads "Get a quote" on the customer app until a real
 * CAD price is entered HERE. RBAC + org-scoping are enforced server-side; this mirrors the console gate.
 */
export function ServiceMenuAdmin(): React.ReactElement {
  const { me } = useSession();
  return (
    <RequireCapability allowed={can.catalog(me)}>
      <ServiceMenuInner />
    </RequireCapability>
  );
}

function ServiceMenuInner(): React.ReactElement {
  const { client } = useSession();
  const [nonce, setNonce] = useState(0);
  const reload = (): void => setNonce((n) => n + 1);
  const state = useAsync<Awaited<ReturnType<typeof client.serviceMenu>>>(() => client.serviceMenu(), [nonce]);

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Service menu"
        subtitle="The customer Home service cards. Set the real CAD rate + 'from' price here — until you do, a card shows “Get a quote.” No placeholder prices are ever shipped."
      />
      {state.loading ? (
        <Card padded={false} className="p-5">
          <TableSkeleton rows={4} cols={3} />
        </Card>
      ) : state.error ? (
        <ErrorBox message={state.error} onRetry={state.reload} />
      ) : !state.data || state.data.cards.length === 0 ? (
        <Card>
          <EmptyState icon={<Tag className="h-5 w-5" strokeWidth={1.75} />} title="No service cards" message="Run the catalog seed to create the service menu." />
        </Card>
      ) : (
        state.data.cards.map((c) => <ServiceCardEditor key={c.id} card={c} onChanged={reload} />)
      )}
    </div>
  );
}

const UNIT_OPTS: Array<{ value: PricingUnit; label: string }> = [
  { value: PricingUnit.PER_ITEM, label: 'Per item' },
  { value: PricingUnit.PER_KG, label: 'Per kilogram' },
  { value: PricingUnit.PER_MEASURE, label: 'Per measure (sq ft)' },
];
const MODEL_OPTS: Array<{ value: PricingModel; label: string }> = [
  { value: PricingModel.FIXED, label: 'Fixed rate — auto-priced' },
  { value: PricingModel.FROM_MEASURED, label: 'From measured — quote sent' },
];
const rateSuffix = (u: PricingUnit): string => (u === PricingUnit.PER_KG ? '/ kg' : u === PricingUnit.PER_MEASURE ? '/ sq ft' : '/ item');

function ServiceCardEditor({ card, onChanged }: { card: ServiceMenuCardView; onChanged: () => void }): React.ReactElement {
  const { client } = useSession();
  const [rate, setRate] = useState(card.rate ?? '');
  const [priceFrom, setPriceFrom] = useState(card.priceFrom ?? '');
  const [description, setDescription] = useState(card.description ?? '');
  const [features, setFeatures] = useState(card.features.join(', '));
  const [icon, setIcon] = useState(card.icon ?? '');
  const [unit, setUnit] = useState<PricingUnit>(card.unit);
  const [pricingModel, setPricingModel] = useState<PricingModel>(card.pricingModel);
  const [sortOrder, setSortOrder] = useState(String(card.sortOrder));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // A blank money field CLEARS the value (back to "Get a quote"); a number sets it. Compare against the
  // loaded card so Save sends only the fields that actually changed.
  const numOrNull = (raw: string): number | null => (raw.trim() === '' ? null : Number(raw));

  const buildPatch = (): UpdateServiceMenuCardDto => {
    const p: UpdateServiceMenuCardDto = {};
    if ((card.rate ?? '') !== rate.trim()) p.rate = numOrNull(rate);
    if ((card.priceFrom ?? '') !== priceFrom.trim()) p.priceFrom = numOrNull(priceFrom);
    if ((card.description ?? '') !== description.trim()) p.description = description.trim() || null;
    if (card.features.join(', ') !== features) p.features = features.split(',').map((s) => s.trim()).filter(Boolean);
    if ((card.icon ?? '') !== icon.trim()) p.icon = icon.trim() || null;
    if (card.unit !== unit) p.unit = unit;
    if (card.pricingModel !== pricingModel) p.pricingModel = pricingModel;
    if (String(card.sortOrder) !== sortOrder.trim() && sortOrder.trim() !== '') p.sortOrder = Number(sortOrder);
    return p;
  };

  const patch = buildPatch();
  const dirty = Object.keys(patch).length > 0;

  const save = async (): Promise<void> => {
    if (!dirty) return;
    setBusy(true);
    setErr(null);
    try {
      await client.updateServiceMenuCard(card.id, patch);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save the service card.');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (): Promise<void> => {
    setErr(null);
    try {
      await client.updateServiceMenuCard(card.id, { active: !card.active });
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not update the card.');
    }
  };

  const actions = (
    <div className="flex items-center gap-2">
      {!card.active && <Badge tone="neutral">Hidden</Badge>}
      {card.childCount > 0 && <Badge tone="blue">{card.childCount} sub-categories</Badge>}
      {card.priceFrom == null && <Badge tone="amber">No price — “Get a quote”</Badge>}
      <Button size="sm" variant="secondary" onClick={() => void toggleActive()}>{card.active ? 'Deactivate' : 'Activate'}</Button>
    </div>
  );

  return (
    <Card title={card.name} subtitle={`${pricingModel === 'FIXED' ? 'Fixed' : 'From measured'} · ${unit} · order ${card.sortOrder}`} actions={actions}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid={`service-card-${card.id}`}>
        <Field label={`Rate (CAD ${rateSuffix(unit)})`} helper="The per-unit price weight/measure pricing uses. Blank = not set yet.">
          <Input value={rate} onChange={(e) => setRate(e.target.value)} type="number" step="0.01" min="0" placeholder="e.g. 3.50" aria-label={`${card.name} rate`} data-testid={`service-card-rate-${card.id}`} />
        </Field>
        <Field label="“From” price (CAD)" helper="The “from $X” shown on the customer card. Blank = shows “Get a quote”.">
          <Input value={priceFrom} onChange={(e) => setPriceFrom(e.target.value)} type="number" step="0.01" min="0" placeholder="e.g. 21.00" aria-label={`${card.name} from price`} data-testid={`service-card-pricefrom-${card.id}`} />
        </Field>
        <Field label="Pricing model">
          <Select value={pricingModel} onChange={(e) => setPricingModel(e.target.value as PricingModel)} aria-label={`${card.name} pricing model`}>
            {MODEL_OPTS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Unit">
          <Select value={unit} onChange={(e) => setUnit(e.target.value as PricingUnit)} aria-label={`${card.name} unit`}>
            {UNIT_OPTS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="For everyday laundry, bedsheets and towels." aria-label={`${card.name} description`} />
        </Field>
        <Field label="Feature tags (comma-separated)" className="sm:col-span-2">
          <Input value={features} onChange={(e) => setFeatures(e.target.value)} placeholder="WASH, TUMBLE-DRY, FOLDED, IN A BAG" aria-label={`${card.name} features`} />
        </Field>
        <Field label="Icon key">
          <Input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="wash-fold" aria-label={`${card.name} icon`} />
        </Field>
        <Field label="Sort order">
          <Input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} type="number" min="0" aria-label={`${card.name} sort order`} />
        </Field>
      </div>
      {err && <p className="mt-3 text-sm text-danger" role="alert">{err}</p>}
      <div className="mt-4 flex justify-end">
        <Button size="sm" loading={busy} disabled={!dirty} onClick={() => void save()} data-testid={`service-card-save-${card.id}`}>Save</Button>
      </div>
    </Card>
  );
}
