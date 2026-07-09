import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ItemKind, PricingModel, PricingUnit, type HomeServiceCardView, type HomeServiceMenuView } from '@blue-bee/shared';

// [Inc-21] HomeScreen renders the service menu off client.getServiceMenu(); mock the session + navigation
// (safe-area / icons / theme are handled by jest.setup + the useTheme() lightTheme fallback).
const card = (over: Partial<HomeServiceCardView>): HomeServiceCardView => ({
  id: 'c', name: 'Svc', description: 'desc', features: ['A', 'B'], icon: 'wash-fold',
  pricingModel: PricingModel.FIXED, unit: PricingUnit.PER_ITEM, priceFrom: null, currency: 'CAD', sortOrder: 1, serviceId: null, ...over,
});

const mockClient = { getServiceMenu: jest.fn<Promise<HomeServiceMenuView>, []>() };
jest.mock('../session/SessionProvider', () => ({
  useSession: () => ({ client: mockClient, me: { user: { name: 'Grace Okafor' } } }),
}));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));

import { HomeScreen } from './HomeScreen';

jest.setTimeout(30000);

describe('HomeScreen service grid (Inc-21)', () => {
  beforeEach(() => {
    mockClient.getServiceMenu.mockReset();
    mockNavigate.mockReset();
  });

  it('renders every footer variant honestly (Get a quote / from $X + per kg / per item / measured at pickup)', async () => {
    mockClient.getServiceMenu.mockResolvedValue({
      currency: 'CAD',
      cards: [
        // FIXED PER_KG, no price → honest "Get a quote" (never a fake number)
        card({ id: 'wf', name: 'Wash & Fold', unit: PricingUnit.PER_KG, priceFrom: null }),
        // FIXED PER_KG, priced → "from $X" + "per kg"
        card({ id: 'wf2', name: 'Wash & Fold Priced', unit: PricingUnit.PER_KG, priceFrom: '21.00' }),
        // FIXED PER_ITEM, priced → "from $X" + "per item"
        card({ id: 'wi', name: 'Wash & Iron', unit: PricingUnit.PER_ITEM, priceFrom: '2.50' }),
        // FROM_MEASURED, no price → "Get a quote"
        card({ id: 'rug', name: 'Rug Cleaning', pricingModel: PricingModel.FROM_MEASURED, unit: PricingUnit.PER_MEASURE, priceFrom: null, icon: 'rug' }),
        // FROM_MEASURED, priced → "from $X" + "measured at pickup"
        card({ id: 'rug2', name: 'Rug Priced', pricingModel: PricingModel.FROM_MEASURED, unit: PricingUnit.PER_MEASURE, priceFrom: '40.00', icon: 'rug' }),
      ],
    });

    const { findByTestId, getByTestId, getAllByText, getByText } = render(<HomeScreen />);

    // all 5 cards render
    await findByTestId('home-service-wf');
    for (const id of ['wf2', 'wi', 'rug', 'rug2']) expect(getByTestId(`home-service-${id}`)).toBeTruthy();

    // honesty firewall: unpriced cards show "Get a quote", NOT a number
    expect(getByTestId('home-price-wf').props.children).toBe('Get a quote');
    expect(getByTestId('home-price-rug').props.children).toBe('Get a quote');
    expect(getAllByText('Get a quote').length).toBe(2);

    // priced cards show a "from …" primary + the right sub-note
    expect(String(getByTestId('home-price-wf2').props.children)).toMatch(/^from /);
    expect(getByText('per kg')).toBeTruthy();
    expect(String(getByTestId('home-price-wi').props.children)).toMatch(/^from /);
    expect(getByText('per item')).toBeTruthy();
    expect(String(getByTestId('home-price-rug2').props.children)).toMatch(/^from /);
    expect(getByText('measured at pickup')).toBeTruthy();
  });

  it('tapping an unpriced card (no backing service) opens the general Book composer', async () => {
    mockClient.getServiceMenu.mockResolvedValue({ currency: 'CAD', cards: [card({ id: 'wf', name: 'Wash & Fold', serviceId: null })] });
    const { findByTestId } = render(<HomeScreen />);
    fireEvent.press(await findByTestId('home-service-wf'));
    expect(mockNavigate).toHaveBeenCalledWith('Book', undefined);
  });

  it('[Inc-23] tapping a priced card carries its backing service + unit + kind into Book', async () => {
    mockClient.getServiceMenu.mockResolvedValue({
      currency: 'CAD',
      cards: [card({ id: 'wf', name: 'Wash & Fold', unit: PricingUnit.PER_KG, icon: 'wash-fold', serviceId: 'svc-wf-1', priceFrom: '21.00' })],
    });
    const { findByTestId } = render(<HomeScreen />);
    fireEvent.press(await findByTestId('home-service-wf'));
    expect(mockNavigate).toHaveBeenCalledWith('Book', { serviceId: 'svc-wf-1', serviceName: 'Wash & Fold', unit: PricingUnit.PER_KG, kind: ItemKind.GARMENT });
  });

  it('shows the empty state when the catalog has no cards', async () => {
    mockClient.getServiceMenu.mockResolvedValue({ currency: 'CAD', cards: [] });
    const { findByText } = render(<HomeScreen />);
    expect(await findByText('No services yet')).toBeTruthy();
  });

  it('shows an error state (with retry) when the menu fails to load', async () => {
    mockClient.getServiceMenu.mockRejectedValue(new Error('offline'));
    const { findByTestId } = render(<HomeScreen />);
    expect(await findByTestId('home-retry')).toBeTruthy();
  });
});
