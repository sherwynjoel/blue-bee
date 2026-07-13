'use client';

import React, { useState } from 'react';
import { CatalogReorderScope, type AdminCatalogView, type CatalogItemView, type CategoryView } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { Plus, Tag, ImagePlus } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { money } from '@/lib/format';
import { reorderedIds } from '@/lib/reorder';
import { uploadCatalogImage, MediaError } from '@/lib/media';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, PageHeader, TableSkeleton } from './ui';
import { IconPicker } from './catalog/IconPicker';
import { MoveControls } from './catalog/MoveControls';
import { RequireCapability } from './AppShell';

const apiErr = (e: unknown, fallback: string): string =>
  e instanceof MediaError ? e.message : e instanceof ApiError ? e.message : fallback;

/**
 * Dry-clean visual catalog admin (Inc-17) — OWNER/FINANCE manage categories + per-item catalog items with a
 * real photo (uploaded through the existing media seam) + a base per-item price. Per-account price overrides
 * are the Inc-15 rate-card editor (`/corporate`) — these items appear there automatically. Reuses the console
 * primitives + patterns (no new design system).
 */
export function CatalogAdmin(): React.ReactElement {
  const { me } = useSession();
  return (
    <RequireCapability allowed={can.catalog(me)}>
      <CatalogAdminInner />
    </RequireCapability>
  );
}

function CatalogAdminInner(): React.ReactElement {
  const { client } = useSession();
  const [nonce, setNonce] = useState(0);
  const reload = (): void => setNonce((n) => n + 1);
  const state = useAsync<AdminCatalogView>(() => client.adminCatalog(), [nonce]);

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const createCategory = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await client.createCatalogCategory({ name: name.trim() });
      setName('');
      reload();
    } catch (e2) {
      setErr(apiErr(e2, 'Could not create the category.'));
    } finally {
      setBusy(false);
    }
  };

  const categories = state.data?.categories ?? [];

  /** [Inc-24] Reorder the garment sub-categories; the customer picker renders in this order. */
  const moveCategory = async (index: number, delta: number): Promise<void> => {
    const ids = reorderedIds(categories, index, delta);
    if (!ids) return;
    setErr(null);
    try {
      await client.reorderCatalog({ scope: CatalogReorderScope.CATEGORIES, ids });
      reload();
    } catch (e2) {
      setErr(apiErr(e2, 'Could not save the new category order.'));
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Dry-clean catalog" subtitle="Categories + per-item dry-clean items (photo + base price). Per-account prices are set on the Corporate rate card." />

      <Card title="New category" subtitle="e.g. Shirts, Outerwear, Formalwear.">
        <form onSubmit={createCategory} className="flex flex-wrap items-end gap-3" data-testid="catalog-new-category">
          <div className="min-w-[16rem] flex-1">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shirts" required />
            </Field>
          </div>
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            <Plus className="h-4 w-4" strokeWidth={2} /> Add category
          </Button>
        </form>
        {err && <p className="mt-2 text-sm text-danger" role="alert">{err}</p>}
      </Card>

      {/* [Inc-25] Same rule as the service menu: never show an "empty" state until a CONFIRMED response. */}
      {state.error ? (
        <ErrorBox message={state.error} onRetry={state.reload} />
      ) : state.loading || !state.data ? (
        <Card padded={false} className="p-5"><div data-testid="catalog-admin-loading"><TableSkeleton rows={4} cols={3} /></div></Card>
      ) : categories.length === 0 && state.data.uncategorized.length === 0 ? (
        <Card>
          <EmptyState icon={<Tag className="h-5 w-5" strokeWidth={1.75} />} title="No catalog yet" message="Create a category above, then add items with a photo + price." />
        </Card>
      ) : (
        <>
          {categories.map((c, i) => (
            <CategorySection
              key={c.id}
              category={c}
              onChanged={reload}
              onMoveUp={i > 0 ? () => void moveCategory(i, -1) : undefined}
              onMoveDown={i < categories.length - 1 ? () => void moveCategory(i, 1) : undefined}
            />
          ))}
          {state.data.uncategorized.length > 0 && (
            <Card title="Uncategorized" subtitle="Items with no category (assign one by editing the item).">
              <ItemList items={state.data.uncategorized} onChanged={reload} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function CategorySection({
  category,
  onChanged,
  onMoveUp,
  onMoveDown,
}: {
  category: CategoryView & { items: CatalogItemView[] };
  onChanged: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}): React.ReactElement {
  const { client } = useSession();
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(category.name);
  const [err, setErr] = useState<string | null>(null);

  // [Inc-20] The Home service-card presentation (description / feature tags / icon key). Founder-editable
  // here; the customer app renders these on the Home grid. features is edited as a comma-separated list.
  const [editingCard, setEditingCard] = useState(false);
  const [savingCard, setSavingCard] = useState(false);
  const [draftDesc, setDraftDesc] = useState(category.description ?? '');
  const [draftFeatures, setDraftFeatures] = useState((category.features ?? []).join(', '));
  const [draftIcon, setDraftIcon] = useState(category.icon ?? '');

  const saveName = async (): Promise<void> => {
    setErr(null);
    try {
      await client.updateCatalogCategory(category.id, { name: draftName.trim() });
      setRenaming(false);
      onChanged();
    } catch (e) {
      setErr(apiErr(e, 'Could not rename the category.'));
    }
  };
  const toggleActive = async (): Promise<void> => {
    setErr(null);
    try {
      await client.updateCatalogCategory(category.id, { active: !category.active });
      onChanged();
    } catch (e) {
      setErr(apiErr(e, 'Could not update the category.'));
    }
  };
  const saveCard = async (): Promise<void> => {
    setSavingCard(true);
    setErr(null);
    try {
      // Split the comma-separated tags into a clean array; a blank description/icon clears the field (null).
      const features = draftFeatures.split(',').map((s) => s.trim()).filter(Boolean);
      await client.updateCatalogCategory(category.id, {
        description: draftDesc.trim() ? draftDesc.trim() : null,
        features,
        icon: draftIcon.trim() ? draftIcon.trim() : null,
      });
      setEditingCard(false);
      onChanged();
    } catch (e) {
      setErr(apiErr(e, 'Could not update the card presentation.'));
    } finally {
      setSavingCard(false);
    }
  };

  /** [Inc-24] Reorder the items inside this category; the customer picker renders them in this order. */
  const moveItem = async (index: number, delta: number): Promise<void> => {
    const ids = reorderedIds(category.items, index, delta);
    if (!ids) return;
    setErr(null);
    try {
      await client.reorderCatalog({ scope: CatalogReorderScope.ITEMS, ids });
      onChanged();
    } catch (e) {
      setErr(apiErr(e, 'Could not save the new item order.'));
    }
  };

  const actions = (
    <div className="flex items-center gap-2">
      {!category.active && <Badge tone="neutral">Hidden</Badge>}
      <MoveControls onUp={onMoveUp} onDown={onMoveDown} label={category.name} testIdPrefix={`catalog-category-${category.id}`} />
      <Button size="sm" variant="secondary" onClick={() => setRenaming((r) => !r)}>Rename</Button>
      <Button size="sm" variant="secondary" onClick={() => setEditingCard((c) => !c)}>Card</Button>
      <Button size="sm" variant="secondary" onClick={() => void toggleActive()}>{category.active ? 'Deactivate' : 'Activate'}</Button>
    </div>
  );

  return (
    <div data-testid={`catalog-category-${category.id}`}>
    <Card title={category.name} subtitle={`${category.itemCount} item${category.itemCount === 1 ? '' : 's'} · order ${category.sortOrder}`} actions={actions}>
      {renaming && (
        <div className="mb-4 flex items-end gap-2" data-testid={`catalog-rename-${category.id}`}>
          <div className="flex-1"><Field label="New name"><Input value={draftName} onChange={(e) => setDraftName(e.target.value)} /></Field></div>
          <Button size="sm" onClick={() => void saveName()} disabled={!draftName.trim()}>Save</Button>
        </div>
      )}
      {editingCard && (
        <div className="mb-4 space-y-3 rounded-card border border-hairline bg-subtle p-4" data-testid={`catalog-card-${category.id}`}>
          <p className="text-footnote text-secondary">How this service appears on the customer Home grid.</p>
          <Field label="Description"><Input value={draftDesc} onChange={(e) => setDraftDesc(e.target.value)} placeholder="Crisp, hand-finished shirts and blouses." aria-label={`${category.name} description`} /></Field>
          <Field label="Feature tags (comma-separated)"><Input value={draftFeatures} onChange={(e) => setDraftFeatures(e.target.value)} placeholder="DRY CLEAN, PRESS, ON HANGERS" aria-label={`${category.name} features`} /></Field>
          <IconPicker value={draftIcon} onChange={setDraftIcon} ariaLabel={`${category.name} icon`} testId={`catalog-category-icon-${category.id}`} />
          <Button size="sm" loading={savingCard} onClick={() => void saveCard()}>Save card</Button>
        </div>
      )}
      {err && <p className="mb-2 text-sm text-danger" role="alert">{err}</p>}
      <ItemList items={category.items} onChanged={onChanged} onMove={moveItem} />
      <div className="mt-4 border-t border-hairline pt-4">
        <AddItemForm categoryId={category.id} onAdded={onChanged} />
      </div>
    </Card>
    </div>
  );
}

/** `onMove` is omitted for the uncategorized bucket — those items have no category order to arrange. */
function ItemList({ items, onChanged, onMove }: { items: CatalogItemView[]; onChanged: () => void; onMove?: (index: number, delta: number) => void }): React.ReactElement {
  if (items.length === 0) return <p className="text-sm text-tertiary">No items yet.</p>;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((it, i) => (
        <ItemCard
          key={it.id}
          item={it}
          onChanged={onChanged}
          onMoveUp={onMove && i > 0 ? () => onMove(i, -1) : undefined}
          onMoveDown={onMove && i < items.length - 1 ? () => onMove(i, 1) : undefined}
        />
      ))}
    </div>
  );
}

function ItemCard({
  item,
  onChanged,
  onMoveUp,
  onMoveDown,
}: {
  item: CatalogItemView;
  onChanged: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}): React.ReactElement {
  const { client } = useSession();
  const [price, setPrice] = useState(String(Number(item.baseRate)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = price.trim() !== '' && Number(price) > 0 && Number(price) !== Number(item.baseRate);

  const savePrice = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      await client.updateCatalogItem(item.id, { price: Number(price) });
      onChanged();
    } catch (e) {
      setErr(apiErr(e, 'Could not update the price.'));
    } finally {
      setBusy(false);
    }
  };
  const toggleActive = async (): Promise<void> => {
    setErr(null);
    try {
      await client.updateCatalogItem(item.id, { active: !item.active });
      onChanged();
    } catch (e) {
      setErr(apiErr(e, 'Could not update the item.'));
    }
  };

  return (
    <div className={`rounded-card border border-hairline p-3 ${item.active ? '' : 'opacity-60'}`} data-testid={`catalog-item-${item.id}`}>
      <div className="flex gap-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-subtle">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" data-testid={`catalog-item-photo-${item.id}`} />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-tertiary"><ImagePlus className="h-5 w-5" /></div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-semibold text-primary">{item.name}</span>
            {!item.active && <Badge tone="neutral">Off</Badge>}
          </div>
          <div className="mt-1 text-footnote text-secondary">Base {money(item.baseRate)}</div>
          {/* The price field used to be an unlabelled box that collapsed to a sliver — the founder could not
              tell what it was ("I don't even know what that is"). It now says Price, shows the $ it is edited
              in, and holds its width instead of being crushed by the buttons beside it. */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label htmlFor={`catalog-price-${item.id}`} className="text-footnote font-medium text-secondary">
              Price
            </label>
            <div className="relative w-28 shrink-0">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subhead text-tertiary">$</span>
              <Input
                id={`catalog-price-${item.id}`}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                type="number"
                step="0.01"
                min="0"
                className="w-28 pl-7 tabular-nums"
                aria-label={`${item.name} price`}
                data-testid={`catalog-item-price-${item.id}`}
              />
            </div>
            <Button size="sm" variant="secondary" loading={busy} disabled={!dirty} onClick={() => void savePrice()}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => void toggleActive()}>{item.active ? 'Deactivate' : 'Activate'}</Button>
            <MoveControls onUp={onMoveUp} onDown={onMoveDown} label={item.name} testIdPrefix={`catalog-item-${item.id}`} />
          </div>
          {err && <p className="mt-1 text-xs text-danger" role="alert">{err}</p>}
        </div>
      </div>
    </div>
  );
}

const BLANK_ITEM = { name: '', price: '' };

function AddItemForm({ categoryId, onAdded }: { categoryId: string; onAdded: () => void }): React.ReactElement {
  const { client } = useSession();
  const [form, setForm] = useState(BLANK_ITEM);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      // Real upload through the media seam first; the storageKey is verified server-side when the item saves.
      const imageKey = file ? await uploadCatalogImage(client, file) : undefined;
      await client.createCatalogItem({ name: form.name.trim(), price: Number(form.price), categoryId, ...(imageKey ? { imageKey } : {}) });
      setForm(BLANK_ITEM);
      setFile(null);
      onAdded();
    } catch (e2) {
      setErr(apiErr(e2, 'Could not add the item.'));
    } finally {
      setBusy(false);
    }
  };

  const ready = form.name.trim() !== '' && form.price.trim() !== '' && Number(form.price) > 0;

  return (
    <form onSubmit={add} className="flex flex-wrap items-end gap-3" data-testid={`catalog-add-item-${categoryId}`}>
      <div className="min-w-[10rem] flex-1"><Field label="Item name"><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Dress shirt" /></Field></div>
      <Field label="Base price"><Input value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} type="number" step="0.01" min="0" placeholder="6.00" className="w-28" /></Field>
      <Field label="Photo">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          aria-label="Item photo"
          data-testid={`catalog-item-file-${categoryId}`}
          className="block w-full text-footnote text-secondary file:mr-3 file:rounded-btn file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-footnote file:font-semibold file:text-ink hover:file:bg-subtle"
        />
      </Field>
      <Button type="submit" loading={busy} disabled={!ready}><Plus className="h-4 w-4" strokeWidth={2} /> Add item</Button>
      {err && <p className="w-full text-sm text-danger" role="alert">{err}</p>}
    </form>
  );
}
