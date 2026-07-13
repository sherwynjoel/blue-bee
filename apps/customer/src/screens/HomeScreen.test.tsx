import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ItemKind, PricingModel, PricingUnit, type HomeServiceCardView, type HomeServiceMenuView } from '@blue-bee/shared';

// [Inc-21] HomeScreen renders the service menu off client.getServiceMenu(); mock the session + navigation
// (safe-area / icons / theme are handled by jest.setup + the useTheme() lightTheme fallback).
const card = (over: Partial<HomeServiceCardView>): HomeServiceCardView => ({
  id: 'c', name: 'Svc', description: 'desc', features: ['A', 'B'], icon: 'wash-fold',
  pricingModel: PricingModel.FIXED, unit: PricingUnit.PER_ITEM, priceFrom: null, currency: 'CAD', sortOrder: 1, serviceId: null,
  garmentCount: 0, ...over,
});

const mockClient = { getServiceMenu: jest.fn<Promise<HomeServiceMenuView>, []>() };
jest.mock('../session/SessionProvider', () => ({
  useSession: () => ({ client: mockClient, me: { user: { name: 'Grace Okafor' } } }),
}));
const mockNavigate = jest.fn();
// [Inc-36] HomeScreen subscribes to the tab's 'focus' event to re-read the catalog (a console edit must reach
// an app that is already open). Mirror the real navigation prop: `addListener` returns the unsubscribe fn.
const mockAddListener = jest.fn((_event: string, _handler: () => void) => jest.fn());
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, addListener: mockAddListener }),
}));

import { HomeScreen } from './HomeScreen';

jest.setTimeout(30000);

describe('HomeScreen service grid (Inc-21)', () => {
  beforeEach(() => {
    mockClient.getServiceMenu.mockReset();
    mockNavigate.mockReset();
    mockAddListener.mockClear();
  });

  /** Invoke the 'focus' handler HomeScreen registered. The FIRST focus fires right after mount (already
   *  covered by the mount fetch) and is deliberately skipped, so a real re-fetch is the second call. */
  const refocus = async (times = 1): Promise<void> => {
    const handler = mockAddListener.mock.calls.find(([e]) => e === 'focus')?.[1];
    if (!handler) throw new Error('HomeScreen never subscribed to focus');
    handler(); // first focus → skipped (mount already loaded)
    for (let i = 0; i < times; i += 1) {
      await act(async () => {
        handler();
      });
    }
  };

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

  it('[Inc-36] renders NO process-identifier chips — just the plain one-line description', async () => {
    mockClient.getServiceMenu.mockResolvedValue({
      currency: 'CAD',
      cards: [card({ id: 'wf', name: 'Wash & Fold', description: 'For everyday laundry, bedsheets and towels.', features: ['WASH', 'TUMBLE-DRY', 'FOLDED', 'IN A BAG'] })],
    });
    const { findByTestId, getByText, queryByText } = render(<HomeScreen />);
    await findByTestId('home-service-wf');
    getByText('For everyday laundry, bedsheets and towels.'); // the plain line stays
    // The jargon chips are gone, even though the server still sends `features`.
    for (const chip of ['WASH', 'TUMBLE-DRY', 'FOLDED', 'IN A BAG']) expect(queryByText(chip)).toBeNull();
  });

  it('[Inc-36] re-reads the catalog when the Service tab regains focus — a console edit reaches an OPEN app', async () => {
    // The bug this closes: the grid was fetched once per app launch. A card whose `serviceId` was still null
    // in that stale copy navigated to Book with NO service → the customer dead-ended at "Choose a service".
    mockClient.getServiceMenu.mockResolvedValue({ currency: 'CAD', cards: [card({ id: 'wf', name: 'Wash & Fold', serviceId: null, priceFrom: null })] });
    const { findByTestId, getByTestId } = render(<HomeScreen />);
    await findByTestId('home-service-wf');
    expect(mockClient.getServiceMenu).toHaveBeenCalledTimes(1);
    expect(getByTestId('home-price-wf').props.children).toBe('Get a quote');

    // The founder now sets a rate + backing service in the console…
    mockClient.getServiceMenu.mockResolvedValue({
      currency: 'CAD',
      cards: [card({ id: 'wf', name: 'Wash & Fold', serviceId: 'svc-wf', unit: PricingUnit.PER_KG, priceFrom: '4.25' })],
    });
    await refocus(); // …and coming back to the tab picks it up — no app restart.

    expect(mockClient.getServiceMenu).toHaveBeenCalledTimes(2);
    expect(String(getByTestId('home-price-wf').props.children)).toMatch(/^from /);
    // …and the card now carries its backing service into Book (the focused checkout, not the dead end).
    fireEvent.press(getByTestId('home-service-wf'));
    expect(mockNavigate).toHaveBeenCalledWith('Book', { serviceId: 'svc-wf', serviceName: 'Wash & Fold', unit: PricingUnit.PER_KG, kind: ItemKind.GARMENT, cardId: 'wf', garmentCount: 0 });
  });

  it('[Inc-36] pull-to-refresh re-reads the catalog', async () => {
    mockClient.getServiceMenu.mockResolvedValue({ currency: 'CAD', cards: [card({ id: 'wf', name: 'Wash & Fold' })] });
    const { findByTestId, getByTestId } = render(<HomeScreen />);
    await findByTestId('home-service-wf');
    expect(mockClient.getServiceMenu).toHaveBeenCalledTimes(1);

    await act(async () => {
      getByTestId('home-scroll').props.refreshControl.props.onRefresh();
    });
    expect(mockClient.getServiceMenu).toHaveBeenCalledTimes(2);
  });

  it('[Inc-36] a FAILED refresh keeps the grid on screen (never blanks a working catalog)', async () => {
    mockClient.getServiceMenu.mockResolvedValue({ currency: 'CAD', cards: [card({ id: 'wf', name: 'Wash & Fold' })] });
    const { findByTestId, getByTestId, queryByTestId } = render(<HomeScreen />);
    await findByTestId('home-service-wf');

    mockClient.getServiceMenu.mockRejectedValue(new Error('offline'));
    await act(async () => {
      getByTestId('home-scroll').props.refreshControl.props.onRefresh();
    });
    // The grid the customer was looking at survives; no full-screen error takeover.
    expect(getByTestId('home-service-wf')).toBeTruthy();
    expect(queryByTestId('home-retry')).toBeNull();
  });

  it('[Inc-36] the general-composer CTA is gone — the grid IS the picker', async () => {
    mockClient.getServiceMenu.mockResolvedValue({ currency: 'CAD', cards: [card({ id: 'wf', name: 'Wash & Fold' })] });
    const { findByTestId, queryByTestId } = render(<HomeScreen />);
    await findByTestId('home-service-wf');
    // The Inc-33 "Book a pickup" button navigated to Book with no service — the only door into the
    // item-type/service/garment composer. It no longer exists.
    expect(queryByTestId('service-book')).toBeNull();
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
    expect(mockNavigate).toHaveBeenCalledWith('Book', { serviceId: 'svc-wf-1', serviceName: 'Wash & Fold', unit: PricingUnit.PER_KG, kind: ItemKind.GARMENT, cardId: 'wf', garmentCount: 0 });
  });

  it('[Inc-24] a priced PER_LB card shows "from $X" + "per lb"', async () => {
    mockClient.getServiceMenu.mockResolvedValue({
      currency: 'CAD',
      cards: [card({ id: 'wflb', name: 'Wash & Fold (lb)', unit: PricingUnit.PER_LB, priceFrom: '1.50' })],
    });
    const { findByTestId, getByText } = render(<HomeScreen />);
    expect(String((await findByTestId('home-price-wflb')).props.children)).toMatch(/^from /);
    expect(getByText('per lb')).toBeTruthy();
  });

  // [Inc-24] The console's reorder persists sortOrder; the Home grid must render in THAT order. The mocked
  // response is deliberately scrambled so this proves ordering-by-sortOrder, not order-of-arrival.
  it('[Inc-24] renders the service cards in sortOrder (the console-arranged order)', async () => {
    mockClient.getServiceMenu.mockResolvedValue({
      currency: 'CAD',
      cards: [
        card({ id: 'third', name: 'Third', sortOrder: 3 }),
        card({ id: 'first', name: 'First', sortOrder: 1 }),
        card({ id: 'second', name: 'Second', sortOrder: 2 }),
      ],
    });
    const { findByTestId, getAllByTestId } = render(<HomeScreen />);
    await findByTestId('home-service-first');
    const rendered = getAllByTestId(/^home-service-/).map((n) => n.props.testID);
    expect(rendered).toEqual(['home-service-first', 'home-service-second', 'home-service-third']);
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
