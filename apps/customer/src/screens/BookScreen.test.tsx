import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ServiceVertical, ServiceUnit, AccountType, type PickupSlot, type PickupSlotsResult } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';

const siteWithGeo = (address: string, geo: { lng: number; lat: number }) => ({
  sites: [{ id: 'site-1', accountId: 'acc', name: 'Home', address, accountName: 'Rita', accountType: AccountType.RESIDENTIAL, geo }],
});

// ───────────── [Inc-28] pickup availability fixtures ─────────────
//
// `start`/`end` are the SERVER's DST-resolved instants; `startLocal`/`endLocal` are the founder's wall clock,
// which is what the picker renders. The screen never converts an instant into a time-of-day.
const mkSlot = (over: Partial<PickupSlot> & Pick<PickupSlot, 'label'>): PickupSlot => ({
  start: '2026-07-11T13:00:00.000Z',
  end: '2026-07-11T16:00:00.000Z',
  startLocal: '09:00',
  endLocal: '12:00',
  available: true,
  remaining: null,
  reason: null,
  ...over,
});

const MORNING = mkSlot({ label: 'Morning' });
const AFTERNOON = mkSlot({ label: 'Afternoon', start: '2026-07-11T16:00:00.000Z', end: '2026-07-11T19:00:00.000Z', startLocal: '12:00', endLocal: '15:00' });

const mkDay = (over: Partial<PickupSlotsResult> = {}): PickupSlotsResult => ({
  date: '2026-07-11',
  timezone: 'America/Toronto',
  bookableDates: ['2026-07-11', '2026-07-12'],
  closed: false,
  capacityChecked: false,
  scheduleSource: 'org',
  slots: [MORNING, AFTERNOON],
  ...over,
});

const mockClient = {
  getServices: jest.fn(async () => ({ services: [{ id: 'svc-1', vertical: ServiceVertical.SPECIALTY, name: 'Rug cleaning', unit: ServiceUnit.SQFT, baseRate: '6.5' }] })),
  getSites: jest.fn(async () => ({ sites: [{ id: 'site-1', accountId: 'acc', name: 'Home', address: '1 Main St', accountName: 'Rita', accountType: AccountType.RESIDENTIAL }] })),
  // [Inc-16] BookScreen reads memberships to show the corporate-pricing badge; default = none.
  listMyMemberships: jest.fn(async () => ({ memberships: [] as Array<{ id: string; accountId: string; accountName: string; status: string; source: string; createdAt: string }> })),
  // [Inc-17] BookScreen reads the dry-clean catalog for the visual picker; default = empty (no picker).
  getDrycleanCatalog: jest.fn(async () => ({ categories: [] as unknown[], currency: 'CAD', pricingAccountName: null })),
  // [Inc-28] The real pickup windows. BLOCKING, unlike the two reads above: with no slot chosen, no booking.
  getPickupSlots: jest.fn(async (): Promise<PickupSlotsResult> => mkDay()),
  book: jest.fn(),
};
jest.mock('../session/SessionProvider', () => ({
  useSession: () => ({ client: mockClient, me: { user: { accountIds: ['acc'] } } }),
}));

import { BookScreen } from './BookScreen';

jest.setTimeout(30000);
// [Inc-26] `addListener` mirrors the real navigation prop: BookScreen subscribes to its 'focus' event to
// re-read the address picker after an address is saved. It must return the unsubscribe fn React cleans up
// with. Typed explicitly so `mock.calls` is a `[event, handler]` tuple the focus test can destructure.
const navigation = {
  replace: jest.fn(),
  navigate: jest.fn(),
  addListener: jest.fn((_event: string, _handler: () => void) => jest.fn()),
};
// BookScreen only uses `navigation`; cast the screen props (route is unused by the test path).
const screenProps = { navigation } as unknown as React.ComponentProps<typeof BookScreen>;

describe('BookScreen', () => {
  beforeEach(() => {
    mockClient.book.mockReset();
    mockClient.listMyMemberships.mockReset();
    mockClient.listMyMemberships.mockResolvedValue({ memberships: [] });
    mockClient.getDrycleanCatalog.mockReset();
    mockClient.getDrycleanCatalog.mockResolvedValue({ categories: [], currency: 'CAD', pricingAccountName: null });
    mockClient.getPickupSlots.mockReset();
    mockClient.getPickupSlots.mockResolvedValue(mkDay());
    navigation.replace.mockClear();
    // [Inc-26] These are module-level mocks shared by every test — clear the recorded CALLS (keeping the
    // default implementations) so per-test call-count assertions aren't polluted by earlier tests.
    mockClient.getSites.mockClear();
    navigation.navigate.mockClear();
    navigation.addListener.mockClear();
  });

  /**
   * [Inc-28] Stage a bookable order: one real item, plus a pickup slot the SERVER offered. Every booking test
   * routes through here, because a booking with no chosen slot is precisely what this increment made
   * impossible — the old screen would have quietly sent a hard-coded "tomorrow 9am".
   */
  const stageBooking = async (screen: ReturnType<typeof render>, slotLabel = 'Morning'): Promise<void> => {
    fireEvent.changeText(screen.getByTestId('measure-input'), '40');
    fireEvent.press(screen.getByTestId('add-item'));
    fireEvent.press(await screen.findByTestId(`slot-${slotLabel}`));
  };

  it('renders the dry-clean visual picker when the catalog loads, and tapping + stages an ITEM line for booking', async () => {
    mockClient.getDrycleanCatalog.mockResolvedValue({
      currency: 'CAD',
      pricingAccountName: null,
      categories: [{ id: 'cat-1', name: 'Shirts', sortOrder: 1, items: [{ id: 'dc-1', name: 'Dress shirt', imageUrl: null, price: '6.00', priceSource: 'service_base' }] }],
    });
    mockClient.book.mockResolvedValue({ id: 'order-1' });
    const screen = render(<BookScreen {...screenProps} />);
    const { getByTestId, findByLabelText, findByTestId } = screen;
    await findByTestId('dryclean-item-dc-1');

    fireEvent.press(await findByLabelText('Add one Dress shirt'));
    expect(getByTestId('dryclean-qty-dc-1').props.children).toBe(1); // staged one unit

    fireEvent.press(await findByTestId('slot-Morning'));
    fireEvent.press(getByTestId('submit-booking'));
    await waitFor(() => expect(mockClient.book).toHaveBeenCalled());
    const [dto] = mockClient.book.mock.calls[0]!;
    expect(dto.items).toEqual([{ kind: 'GARMENT', serviceId: 'dc-1', estimatedMeasure: 1 }]); // through the existing line-item path
  });

  it('shows the corporate-pricing badge when the user holds an active membership (server truth); hidden otherwise', async () => {
    mockClient.listMyMemberships.mockResolvedValue({
      memberships: [{ id: 'm1', accountId: 'corp-1', accountName: 'Maple District Towers', status: 'ACTIVE', source: 'JOIN_CODE', createdAt: '2026-07-01T00:00:00.000Z' }],
    });
    const { findByTestId } = render(<BookScreen {...screenProps} />);
    expect(await findByTestId('corp-pricing-note')).toBeTruthy();
  });

  it('hides the corporate-pricing badge when there is no membership (and never blocks booking)', async () => {
    const { findByTestId, queryByTestId } = render(<BookScreen {...screenProps} />);
    await findByTestId('service-svc-1');
    expect(queryByTestId('corp-pricing-note')).toBeNull();
  });

  it('still books normally when the memberships read FAILS (degrades — no badge, no block)', async () => {
    mockClient.listMyMemberships.mockRejectedValue(new Error('offline'));
    mockClient.book.mockResolvedValue({ id: 'order-1' });
    const screen = render(<BookScreen {...screenProps} />);
    await screen.findByTestId('service-svc-1');
    expect(screen.queryByTestId('corp-pricing-note')).toBeNull();
    await stageBooking(screen);
    fireEvent.press(screen.getByTestId('submit-booking'));
    await waitFor(() => expect(mockClient.book).toHaveBeenCalled());
  });

  it('builds an order from the catalog and books it (real serviceId + siteId + the chosen window)', async () => {
    mockClient.book.mockResolvedValue({ id: 'order-1' });
    const screen = render(<BookScreen {...screenProps} />);
    await screen.findByTestId('service-svc-1'); // catalog loaded

    await stageBooking(screen);
    fireEvent.press(screen.getByTestId('submit-booking'));

    await waitFor(() => expect(mockClient.book).toHaveBeenCalled());
    const [dto, key] = mockClient.book.mock.calls[0]!;
    expect(dto).toMatchObject({ accountId: 'acc', siteId: 'site-1', items: [{ serviceId: 'svc-1', estimatedMeasure: 40 }] });
    expect(typeof key).toBe('string');
  });

  it('[Inc-19] sends the selected site’s serviceGeo so the SERVER can geo-block (app never decides)', async () => {
    mockClient.getSites.mockResolvedValueOnce(siteWithGeo('1 Main St', { lng: -79.38, lat: 43.65 }));
    mockClient.book.mockResolvedValue({ id: 'order-1' });
    const screen = render(<BookScreen {...screenProps} />);
    await screen.findByTestId('service-svc-1');
    await stageBooking(screen);
    fireEvent.press(screen.getByTestId('submit-booking'));
    await waitFor(() => expect(mockClient.book).toHaveBeenCalled());
    const [dto] = mockClient.book.mock.calls[0]!;
    expect(dto.serviceGeo).toEqual({ lng: -79.38, lat: 43.65 });
  });

  it('[Inc-19] renders a CALM out-of-area state (not the red error) on a 422 out_of_service_area', async () => {
    mockClient.getSites.mockResolvedValueOnce(siteWithGeo('99 Far Away Rd', { lng: -79.0, lat: 43.5 }));
    mockClient.book.mockRejectedValue(
      new ApiError(422, { error: 'zone.out_of_service_area', title: 'zone.out_of_service_area', status: 422 }, 'This address is outside our current service area'),
    );
    const screen = render(<BookScreen {...screenProps} />);
    await screen.findByTestId('service-svc-1');
    await stageBooking(screen);
    fireEvent.press(screen.getByTestId('submit-booking'));
    await waitFor(() => expect(screen.getByTestId('book-out-of-area')).toBeTruthy());
    expect(screen.queryByTestId('book-error')).toBeNull(); // NOT the red crash box
    expect(screen.getByTestId('book-out-of-area-body').props.children).toContain('99 Far Away Rd'); // honest captured address
  });

  it('reuses the SAME idempotency key on retry after a failure (no double-booking)', async () => {
    mockClient.book.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ id: 'order-1' });
    const screen = render(<BookScreen {...screenProps} />);
    await screen.findByTestId('service-svc-1');

    await stageBooking(screen);

    fireEvent.press(screen.getByTestId('submit-booking'));
    await waitFor(() => expect(mockClient.book).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getByTestId('submit-booking'));
    await waitFor(() => expect(mockClient.book).toHaveBeenCalledTimes(2));

    const key1 = mockClient.book.mock.calls[0]![1];
    const key2 = mockClient.book.mock.calls[1]![1];
    expect(key1).toBe(key2); // same key → server de-dupes the retry, no second order
  });

  // ───────────── [Inc-26] saved addresses — the onboarding hole this feature closes ─────────────

  it('[Inc-26] a customer with NO saved address sees an Add-address CTA (not a hidden card) and cannot book', async () => {
    mockClient.getSites.mockResolvedValueOnce({ sites: [] });
    const screen = render(<BookScreen {...screenProps} />);
    const { getByTestId, getByText, findByTestId } = screen;

    // The zero-state IS the call to action. Previously the whole card was hidden and the user was stuck.
    await findByTestId('no-addresses');

    // Stage a real item AND a real slot, so the ONLY thing blocking the booking is the missing address.
    await stageBooking(screen);

    // The button names what's missing rather than letting the booking fail at the server.
    await findByTestId('submit-booking');
    getByText('Add an address to book');
    fireEvent.press(getByTestId('submit-booking'));
    await waitFor(() => expect(mockClient.book).not.toHaveBeenCalled());

    fireEvent.press(getByText('Add address'));
    expect(navigation.navigate).toHaveBeenCalledWith('AddressForm', { returnTo: 'Book' });
  });

  it('[Inc-26] re-reads the picker when Book regains focus, and pre-selects the address just saved', async () => {
    mockClient.getSites
      .mockResolvedValueOnce({ sites: [] }) // mount: nothing saved yet
      .mockResolvedValueOnce(siteWithGeo('290 Bremner Blvd', { lng: -79.387, lat: 43.6426 })); // after adding one
    const { findByTestId } = render(<BookScreen {...screenProps} />);
    await findByTestId('no-addresses');

    // The first `focus` fires right after mount and is skipped; the second is the real return from the form.
    const onFocus = navigation.addListener.mock.calls.find(([event]) => event === 'focus')![1];
    onFocus();
    onFocus();

    // The new address is now listed and selected, so booking is unblocked.
    const row = await findByTestId('site-site-1');
    expect(row.props.accessibilityState?.selected).toBe(true);
    expect(mockClient.getSites).toHaveBeenCalledTimes(2);
  });

  // ───────────── [Inc-28] the real pickup picker (was: a Switch, and a hard-coded tomorrow-9am) ─────────────

  describe('[Inc-28] pickup slot picker', () => {
    it('renders the server\'s day strip and its windows, in the ORG\'s wall clock', async () => {
      const screen = render(<BookScreen {...screenProps} />);
      await screen.findByTestId('slots-list');

      // The strip is `bookableDates` verbatim — the app never decides which days are open.
      screen.getByTestId('day-2026-07-11');
      screen.getByTestId('day-2026-07-12');
      // 09:00–12:00 Toronto, rendered from `startLocal`/`endLocal` — NOT from the ISO instants, which a
      // device outside Toronto would render as some other time entirely.
      expect(screen.getByTestId('slot-Morning-time').props.children).toBe('9:00 AM – 12:00 PM');
      expect(screen.getByTestId('slot-Afternoon-time').props.children).toBe('12:00 PM – 3:00 PM');
      // The old Switch is gone.
      expect(screen.queryByTestId('schedule-toggle')).toBeNull();
    });

    it('books the EXACT instants of the chosen slot (no client-side date math)', async () => {
      mockClient.book.mockResolvedValue({ id: 'order-1' });
      const screen = render(<BookScreen {...screenProps} />);
      await screen.findByTestId('service-svc-1');
      await stageBooking(screen, 'Afternoon');
      fireEvent.press(screen.getByTestId('submit-booking'));

      await waitFor(() => expect(mockClient.book).toHaveBeenCalled());
      const [dto] = mockClient.book.mock.calls[0]!;
      expect(dto.pickupWindow).toEqual({ start: AFTERNOON.start, end: AFTERNOON.end });
    });

    it('blocks submit until a slot is chosen, and names what is missing', async () => {
      const screen = render(<BookScreen {...screenProps} />);
      await screen.findByTestId('service-svc-1');
      fireEvent.changeText(screen.getByTestId('measure-input'), '40');
      fireEvent.press(screen.getByTestId('add-item'));

      // Item ✔, address ✔, slot ✘ → the button says so and refuses. The old screen would have booked
      // a window the customer never saw.
      screen.getByText('Choose a pickup time');
      fireEvent.press(screen.getByTestId('submit-booking'));
      await waitFor(() => expect(mockClient.book).not.toHaveBeenCalled());

      fireEvent.press(await screen.findByTestId('slot-Morning'));
      screen.getByText('Book 1 item');
    });

    it('a full or past slot is DISABLED, says why, and cannot be selected', async () => {
      mockClient.getPickupSlots.mockResolvedValue(
        mkDay({
          capacityChecked: true,
          slots: [
            mkSlot({ label: 'Morning', available: false, remaining: 0, reason: 'full' }),
            mkSlot({ label: 'Afternoon', available: false, remaining: 2, reason: 'past' }),
            mkSlot({ label: 'Evening', available: true, remaining: 2 }),
          ],
        }),
      );
      const screen = render(<BookScreen {...screenProps} />);
      await screen.findByTestId('slots-list');

      expect(screen.getByTestId('slot-Morning').props.accessibilityState).toMatchObject({ disabled: true });
      expect(screen.getByTestId('slot-Morning-reason').props.children).toBe('Fully booked');
      expect(screen.getByTestId('slot-Afternoon-reason').props.children).toBe('No longer available');

      // Pressing a disabled slot selects nothing, so the booking stays blocked.
      fireEvent.press(screen.getByTestId('slot-Morning'));
      fireEvent.changeText(screen.getByTestId('measure-input'), '40');
      fireEvent.press(screen.getByTestId('add-item'));
      screen.getByText('Choose a pickup time');
    });

    it('shows a remaining count ONLY when the server actually counted against a cap', async () => {
      // capacityChecked: true + a real remaining ⇒ the count is a measured fact, so it may be shown.
      mockClient.getPickupSlots.mockResolvedValue(mkDay({ capacityChecked: true, slots: [mkSlot({ label: 'Morning', remaining: 2 })] }));
      const counted = render(<BookScreen {...screenProps} />);
      expect((await counted.findByTestId('slot-Morning-remaining')).props.children).toEqual([2, ' left']);
      counted.unmount();

      // capacityChecked: false + remaining null ⇒ NO cap is configured. Nothing may be rendered from it:
      // "0 left" or "— left" here would be inventing scarcity out of an absence of data.
      mockClient.getPickupSlots.mockResolvedValue(mkDay({ capacityChecked: false, slots: [mkSlot({ label: 'Morning', remaining: null })] }));
      const uncounted = render(<BookScreen {...screenProps} />);
      await uncounted.findByTestId('slot-Morning');
      expect(uncounted.queryByTestId('slot-Morning-remaining')).toBeNull();
    });

    it('a fully-booked day says so — and never silently falls back to a fabricated window', async () => {
      mockClient.getPickupSlots.mockResolvedValue(
        mkDay({ capacityChecked: true, slots: [mkSlot({ label: 'Morning', available: false, remaining: 0, reason: 'full' })] }),
      );
      const screen = render(<BookScreen {...screenProps} />);
      await screen.findByTestId('slots-empty');
      screen.getByText('Fully booked that day');

      fireEvent.changeText(screen.getByTestId('measure-input'), '40');
      fireEvent.press(screen.getByTestId('add-item'));
      fireEvent.press(screen.getByTestId('submit-booking'));
      await waitFor(() => expect(mockClient.book).not.toHaveBeenCalled());
    });

    it('a closed day says we are closed, and offers the other days', async () => {
      mockClient.getPickupSlots.mockResolvedValue(mkDay({ closed: true, slots: [], bookableDates: ['2026-07-13'] }));
      const screen = render(<BookScreen {...screenProps} />);
      await screen.findByTestId('slots-closed');
      screen.getByText("We're closed that day");
      screen.getByTestId('day-2026-07-13');
    });

    it('tapping another day re-reads that day, and drops a slot chosen on the previous one', async () => {
      const screen = render(<BookScreen {...screenProps} />);
      await screen.findByTestId('slots-list');
      fireEvent.press(screen.getByTestId('slot-Morning'));
      expect(screen.getByTestId('slot-Morning').props.accessibilityState).toMatchObject({ selected: true });

      // The new day offers an identically-labelled Morning window. It is a DIFFERENT window all the same,
      // so the old selection must not carry over and quietly book the wrong date.
      mockClient.getPickupSlots.mockResolvedValue(mkDay({ date: '2026-07-12', slots: [MORNING] }));
      fireEvent.press(screen.getByTestId('day-2026-07-12'));

      await waitFor(() => expect(mockClient.getPickupSlots).toHaveBeenCalledWith('2026-07-12', 'site-1'));
      await waitFor(() => expect(screen.getByTestId('slot-Morning').props.accessibilityState).toMatchObject({ selected: false }));
    });

    it('reads availability ONCE on mount, with the resolved address (not twice, against undefined)', async () => {
      const screen = render(<BookScreen {...screenProps} />);
      await screen.findByTestId('slots-list');
      expect(mockClient.getPickupSlots).toHaveBeenCalledTimes(1);
      // No date: the SERVER names the first bookable day. The app never guesses which day that is.
      expect(mockClient.getPickupSlots).toHaveBeenCalledWith(undefined, 'site-1');
    });

    it('re-reads availability when the customer switches address', async () => {
      mockClient.getSites.mockResolvedValue({
        sites: [
          { id: 'site-1', accountId: 'acc', name: 'Home', address: '1 Main St', accountName: 'Rita', accountType: AccountType.RESIDENTIAL },
          { id: 'site-2', accountId: 'acc', name: 'Work', address: '2 King St', accountName: 'Rita', accountType: AccountType.RESIDENTIAL },
        ],
      });
      const screen = render(<BookScreen {...screenProps} />);
      await screen.findByTestId('slots-list');
      fireEvent.press(screen.getByTestId('site-site-2'));
      // Still no explicit day, so the server picks the first bookable one for the NEW address — a zone could
      // one day close a day for one address and not another.
      await waitFor(() => expect(mockClient.getPickupSlots).toHaveBeenCalledWith(undefined, 'site-2'));
    });

    it('keeps the day the customer chose when they then switch address', async () => {
      mockClient.getSites.mockResolvedValue({
        sites: [
          { id: 'site-1', accountId: 'acc', name: 'Home', address: '1 Main St', accountName: 'Rita', accountType: AccountType.RESIDENTIAL },
          { id: 'site-2', accountId: 'acc', name: 'Work', address: '2 King St', accountName: 'Rita', accountType: AccountType.RESIDENTIAL },
        ],
      });
      const screen = render(<BookScreen {...screenProps} />);
      await screen.findByTestId('slots-list');
      fireEvent.press(screen.getByTestId('day-2026-07-12'));
      await waitFor(() => expect(mockClient.getPickupSlots).toHaveBeenCalledWith('2026-07-12', 'site-1'));

      fireEvent.press(screen.getByTestId('site-site-2'));
      await waitFor(() => expect(mockClient.getPickupSlots).toHaveBeenCalledWith('2026-07-12', 'site-2'));
    });

    it('surfaces a failed availability read and retries it — it never books blind', async () => {
      mockClient.getPickupSlots.mockRejectedValueOnce(new ApiError(503, { error: 'x', title: 'x', status: 503 }, 'Availability is unavailable right now'));
      const screen = render(<BookScreen {...screenProps} />);
      const err = await screen.findByTestId('slots-error');
      expect(err).toBeTruthy();
      screen.getByText('Availability is unavailable right now');

      // No fabricated window is offered in the meantime: submit stays blocked.
      fireEvent.changeText(screen.getByTestId('measure-input'), '40');
      fireEvent.press(screen.getByTestId('add-item'));
      screen.getByText('Choose a pickup time');

      mockClient.getPickupSlots.mockResolvedValue(mkDay());
      fireEvent.press(screen.getByTestId('slots-retry'));
      await screen.findByTestId('slots-list');
      expect(screen.queryByTestId('slots-error')).toBeNull();
    });

    it('says out loud when the hours are our DEFAULT rather than the founder\'s saved ones', async () => {
      mockClient.getPickupSlots.mockResolvedValue(mkDay({ scheduleSource: 'default' }));
      const onDefault = render(<BookScreen {...screenProps} />);
      expect(await onDefault.findByTestId('slots-default-note')).toBeTruthy();
      onDefault.unmount();

      mockClient.getPickupSlots.mockResolvedValue(mkDay({ scheduleSource: 'org' }));
      const onOrg = render(<BookScreen {...screenProps} />);
      await onOrg.findByTestId('slots-list');
      expect(onOrg.queryByTestId('slots-default-note')).toBeNull();
    });
  });
});
