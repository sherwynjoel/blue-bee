import React from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { RoleType, type AdminCatalogView, type MeResponse } from '@blue-bee/shared';

const mockClient = {
  adminCatalog: jest.fn(),
  createCatalogCategory: jest.fn(),
  updateCatalogCategory: jest.fn(),
  createCatalogItem: jest.fn(),
  updateCatalogItem: jest.fn(),
  presignCatalogImage: jest.fn(),
};
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

const mockUpload = jest.fn();
jest.mock('@/lib/media', () => ({ uploadCatalogImage: (...a: unknown[]) => mockUpload(...a), MediaError: class extends Error {} }));

import { CatalogAdmin } from './CatalogAdmin';

function me(...roles: RoleType[]): MeResponse {
  return {
    user: { userId: 'u', orgId: 'g', name: 'Staff', phone: null, email: null, roles: roles.map((role) => ({ role, scope: 'ORG' as never, scopeId: null })), accountIds: [], siteIds: [] },
    org: { id: 'g', name: 'Org' },
  };
}

const catalog: AdminCatalogView = {
  currency: 'CAD',
  categories: [
    {
      id: 'cat-1', name: 'Shirts', description: 'Crisp shirts and blouses.', features: ['DRY CLEAN', 'PRESS'], icon: 'shirts', sortOrder: 1, active: true, itemCount: 1, createdAt: '2026-07-01T00:00:00.000Z',
      items: [
        { id: 'item-1', name: 'Dress shirt', unit: 'ITEM' as never, baseRate: '6.0000', categoryId: 'cat-1', categoryName: 'Shirts', imageKey: 'org/g/catalog/x.png', imageUrl: 'https://minio.local/x.png?sig=1', active: true, sortOrder: 1, createdAt: '2026-07-01T00:00:00.000Z' },
      ],
    },
  ],
  uncategorized: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = me(RoleType.FINANCE);
  mockClient.adminCatalog.mockResolvedValue(catalog);
  mockClient.createCatalogCategory.mockResolvedValue(catalog.categories[0]);
  mockClient.createCatalogItem.mockResolvedValue(catalog.categories[0]!.items[0]);
  mockUpload.mockResolvedValue('org/g/catalog/new.png');
});

describe('CatalogAdmin (dry-clean catalog, RBAC-gated)', () => {
  it('renders categories with their items — photo + name + base price', async () => {
    render(<CatalogAdmin />);
    await waitFor(() => expect(mockClient.adminCatalog).toHaveBeenCalled());
    const section = screen.getByTestId('catalog-category-cat-1');
    expect(within(section).getByText('Shirts')).toBeInTheDocument();
    const item = screen.getByTestId('catalog-item-item-1');
    expect(within(item).getByText('Dress shirt')).toBeInTheDocument();
    expect(within(item).getByText(/\$6\.00/)).toBeInTheDocument();
    expect(screen.getByTestId('catalog-item-photo-item-1')).toHaveAttribute('src', 'https://minio.local/x.png?sig=1');
  });

  it('FINANCE creates a category (calls the API with the typed name)', async () => {
    render(<CatalogAdmin />);
    await waitFor(() => expect(screen.getByTestId('catalog-new-category')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Shirts'), { target: { value: 'Outerwear' } });
    fireEvent.click(screen.getByRole('button', { name: /Add category/ }));
    await waitFor(() => expect(mockClient.createCatalogCategory).toHaveBeenCalledWith({ name: 'Outerwear' }));
  });

  it('FINANCE adds an item to a category (name + price, no photo) via the real order/pricing path', async () => {
    render(<CatalogAdmin />);
    const form = await screen.findByTestId('catalog-add-item-cat-1');
    fireEvent.change(within(form).getByPlaceholderText('Dress shirt'), { target: { value: 'Blouse' } });
    fireEvent.change(within(form).getByPlaceholderText('6.00'), { target: { value: '8' } });
    fireEvent.click(within(form).getByRole('button', { name: /Add item/ }));
    await waitFor(() => expect(mockClient.createCatalogItem).toHaveBeenCalledWith({ name: 'Blouse', price: 8, categoryId: 'cat-1' }));
    expect(mockUpload).not.toHaveBeenCalled(); // no file selected → no upload
  });

  it('adds an item WITH a photo — uploads through the media seam, then creates with the storageKey', async () => {
    render(<CatalogAdmin />);
    const form = await screen.findByTestId('catalog-add-item-cat-1');
    fireEvent.change(within(form).getByPlaceholderText('Dress shirt'), { target: { value: 'Blazer' } });
    fireEvent.change(within(form).getByPlaceholderText('6.00'), { target: { value: '18' } });
    const file = new File([new Uint8Array([1, 2, 3])], 'blazer.png', { type: 'image/png' });
    fireEvent.change(within(form).getByTestId('catalog-item-file-cat-1'), { target: { files: [file] } });
    fireEvent.click(within(form).getByRole('button', { name: /Add item/ }));
    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    await waitFor(() => expect(mockClient.createCatalogItem).toHaveBeenCalledWith({ name: 'Blazer', price: 18, categoryId: 'cat-1', imageKey: 'org/g/catalog/new.png' }));
  });

  it('editing an item price calls updateCatalogItem', async () => {
    render(<CatalogAdmin />);
    const item = await screen.findByTestId('catalog-item-item-1');
    fireEvent.change(within(item).getByLabelText('Dress shirt price'), { target: { value: '9' } });
    fireEvent.click(within(item).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockClient.updateCatalogItem).toHaveBeenCalledWith('item-1', { price: 9 }));
  });

  /**
   * The founder's report: *"can you fix the (box) before the Save — I don't even know what that is, it's too
   * small"*. The price field was an unlabelled input that collapsed to a few pixels, because `Input`'s base
   * class is `w-full` and Tailwind emits `w-full` AFTER `w-24` — so the fixed width the call site asked for
   * never applied, and the flex siblings crushed what was left. Money you cannot see is money you cannot
   * trust, so this pins BOTH halves of the fix.
   */
  it('the price field is visibly a PRICE — labelled, and it keeps the width it asks for', async () => {
    render(<CatalogAdmin />);
    const item = await screen.findByTestId('catalog-item-item-1');

    // It announces itself as a price, in $, and carries the item's real base rate.
    within(item).getByText('Price');
    within(item).getByText('$');
    const input = within(item).getByTestId('catalog-item-price-item-1');
    expect(input).toHaveValue(6); // the seeded base rate — not an empty mystery box

    // …and the width it declares actually survives: `w-full` must NOT come along and stretch it flat.
    expect(input.className).toContain('w-28');
    expect(input.className).not.toContain('w-full');
  });

  it('RBAC (UX): a non-catalog role gets a no-access notice and never fetches the catalog', async () => {
    mockMe = me(RoleType.RESIDENTIAL_CUSTOMER);
    render(<CatalogAdmin />);
    expect(screen.getByText(/don’t have access/)).toBeInTheDocument();
    expect(mockClient.adminCatalog).not.toHaveBeenCalled();
  });
});
