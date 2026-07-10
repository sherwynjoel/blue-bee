import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CATALOG_ICON_KEYS, CatalogReorderScope, PricingModel, PricingUnit, RoleType, type MeResponse, type ServiceMenuCardView } from '@blue-bee/shared';

const mockClient = {
  serviceMenu: jest.fn(),
  updateServiceMenuCard: jest.fn(),
  reorderCatalog: jest.fn(),
};
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

import { ServiceMenuAdmin } from './ServiceMenuAdmin';

function me(...roles: RoleType[]): MeResponse {
  return {
    user: { userId: 'u', orgId: 'g', name: 'Staff', phone: null, email: null, roles: roles.map((role) => ({ role, scope: 'ORG' as never, scopeId: null })), accountIds: [], siteIds: [] },
    org: { id: 'g', name: 'Org' },
  };
}

const card = (over: Partial<ServiceMenuCardView>): ServiceMenuCardView => ({
  id: 'c1',
  name: 'Wash & Fold',
  description: null,
  features: [],
  icon: 'wash-fold',
  pricingModel: PricingModel.FIXED,
  unit: PricingUnit.PER_KG,
  priceFrom: null,
  currency: 'CAD',
  active: true,
  sortOrder: 0,
  rate: null,
  rateServiceId: null,
  childCount: 0,
  ...over,
});

beforeEach(() => {
  mockMe = me(RoleType.OWNER);
  mockClient.serviceMenu.mockReset();
  mockClient.updateServiceMenuCard.mockReset();
  mockClient.reorderCatalog.mockReset().mockResolvedValue({ scope: CatalogReorderScope.SERVICE_CARDS, ids: [] });
});

describe('[Inc-24] ServiceMenuAdmin — PER_LB unit', () => {
  it('offers "Per pound (lb)" and labels the rate field "/ lb" once selected', async () => {
    mockClient.serviceMenu.mockResolvedValue({ currency: 'CAD', cards: [card({})] });
    render(<ServiceMenuAdmin />);

    const unit = (await screen.findByLabelText('Wash & Fold unit')) as HTMLSelectElement;
    expect(Array.from(unit.options).map((o) => o.value)).toContain(PricingUnit.PER_LB);

    // the rate label tracks the selected unit (kg → lb)
    expect(screen.getByText(/Rate \(CAD \/ kg\)/)).toBeTruthy();
    fireEvent.change(unit, { target: { value: PricingUnit.PER_LB } });
    expect(screen.getByText(/Rate \(CAD \/ lb\)/)).toBeTruthy();
  });
});

describe('[Inc-24] ServiceMenuAdmin — icon picker', () => {
  it('is a picker limited to the icon keys the customer app supports (no free text)', async () => {
    mockClient.serviceMenu.mockResolvedValue({ currency: 'CAD', cards: [card({})] });
    render(<ServiceMenuAdmin />);

    const icon = (await screen.findByLabelText('Wash & Fold icon')) as HTMLSelectElement;
    expect(icon.tagName).toBe('SELECT');
    const values = Array.from(icon.options).map((o) => o.value);
    // every canonical key is offered, plus the explicit "none"
    for (const key of CATALOG_ICON_KEYS) expect(values).toContain(key);
    expect(values).toContain('');
    expect(icon.value).toBe('wash-fold');
  });

  it('surfaces a legacy/unsupported icon key instead of silently wiping it', async () => {
    mockClient.serviceMenu.mockResolvedValue({ currency: 'CAD', cards: [card({ icon: 'legacy-glyph' })] });
    render(<ServiceMenuAdmin />);

    const icon = (await screen.findByLabelText('Wash & Fold icon')) as HTMLSelectElement;
    expect(icon.value).toBe('legacy-glyph');
    expect(screen.getByText(/legacy-glyph \(unsupported\)/)).toBeTruthy();
  });

  it('saves the picked icon key through the existing PATCH (persistence unchanged)', async () => {
    mockClient.serviceMenu.mockResolvedValue({ currency: 'CAD', cards: [card({})] });
    mockClient.updateServiceMenuCard.mockResolvedValue(card({ icon: 'iron' }));
    render(<ServiceMenuAdmin />);

    fireEvent.change(await screen.findByLabelText('Wash & Fold icon'), { target: { value: 'iron' } });
    fireEvent.click(screen.getByTestId('service-card-save-c1'));
    await waitFor(() => expect(mockClient.updateServiceMenuCard).toHaveBeenCalledWith('c1', { icon: 'iron' }));
  });
});

describe('[Inc-24] ServiceMenuAdmin — reorder', () => {
  const two = [card({ id: 'a', name: 'Alpha', sortOrder: 0 }), card({ id: 'b', name: 'Beta', sortOrder: 1 })];

  it('moving a card down persists the FULL new order (server renumbers sortOrder 0..n-1)', async () => {
    mockClient.serviceMenu.mockResolvedValue({ currency: 'CAD', cards: two });
    render(<ServiceMenuAdmin />);

    fireEvent.click(await screen.findByLabelText('Move Alpha down'));
    await waitFor(() =>
      expect(mockClient.reorderCatalog).toHaveBeenCalledWith({ scope: CatalogReorderScope.SERVICE_CARDS, ids: ['b', 'a'] }),
    );
  });

  it('disables the arrows at the ends of the list', async () => {
    mockClient.serviceMenu.mockResolvedValue({ currency: 'CAD', cards: two });
    render(<ServiceMenuAdmin />);

    expect((await screen.findByLabelText('Move Alpha up')).hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Move Beta down').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Move Alpha down').hasAttribute('disabled')).toBe(false);
  });

  it('surfaces a reorder failure instead of pretending it saved', async () => {
    mockClient.serviceMenu.mockResolvedValue({ currency: 'CAD', cards: two });
    mockClient.reorderCatalog.mockRejectedValue(new Error('boom'));
    render(<ServiceMenuAdmin />);

    fireEvent.click(await screen.findByLabelText('Move Alpha down'));
    expect(await screen.findByText('Could not save the new order.')).toBeTruthy();
  });
});
