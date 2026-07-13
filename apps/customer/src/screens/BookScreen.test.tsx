import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ServiceVertical, ServiceUnit, AccountType, ItemKind, PricingUnit, type PickupSlot, type PickupSlotsResult } from '@blue-bee/shared';
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
  // [Inc-28] The real pickup windows. BLOCKING, unlike the membership read: with no slot chosen, no booking.
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
/**
 * [Inc-36] Book is now ALWAYS opened from a Home service card, which carries the backing `serviceId` + the
 * card's `PricingUnit`. That is what makes the screen the focused single-measure checkout — without it the
 * screen is a dead end that sends the customer back to the grid (covered by its own test below).
 * This card is the PER_MEASURE (sqft) rug service, matching `getServices()`'s `svc-1` @ $6.50/sqft.
 */
const CARD = { serviceId: 'svc-1', serviceName: 'Rug cleaning', unit: PricingUnit.PER_MEASURE, kind: ItemKind.RUG };
const screenProps = { navigation, route: { params: CARD } } as unknown as React.ComponentProps<typeof BookScreen>;

describe('BookScreen', () => {
  beforeEach(() => {
    mockClient.book.mockReset();
    mockClient.listMyMemberships.mockReset();
    mockClient.listMyMemberships.mockResolvedValue({ memberships: [] });
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
   * [Inc-28] Stage a bookable order: the measure, plus a pickup slot the SERVER offered. A booking with no
   * chosen slot is precisely what Inc-28 made impossible (no hard-coded "tomorrow 9am").
   * [Inc-36] There is no "Add" step any more — typing the single measure IS the order line.
   */
  const stageBooking = async (screen: ReturnType<typeof render>, slotLabel = 'Morning'): Promise<void> => {
    fireEvent.changeText(screen.getByTestId('measure-input'), '40');
    fireEvent.press(await screen.findByTestId(`slot-${slotLabel}`));
  };

  // ───────────── [Inc-36] the simplified single-measure checkout ─────────────

  it('[Inc-36] is ONE measure — no item-type chips, no service picker, no garment sub-catalog, no "Add" step', async () => {
    const { findByTestId, queryByTestId } = render(<BookScreen {...screenProps} />);
    await findByTestId('measure-input');
    // The complexity that used to greet a customer here is gone.
    expect(queryByTestId('kind-RUG')).toBeNull();
    expect(queryByTestId('service-svc-1')).toBeNull();
    expect(queryByTestId('dryclean-item-dc-1')).toBeNull();
    expect(queryByTestId('add-item')).toBeNull();
  });

  it('[Inc-36] shows a LIVE estimate as the measure is typed (no Add tap), labelled as rough — never final', async () => {
    const screen = render(<BookScreen {...screenProps} />);
    await screen.findByTestId('measure-input');
    expect(screen.queryByTestId('estimate')).toBeNull(); // nothing typed yet

    // 40 sqft × $6.50 (svc-1 baseRate) = $260 → the ±band the screen renders.
    fireEvent.changeText(screen.getByTestId('measure-input'), '40');
    const estimate = await screen.findByTestId('estimate');
    expect(String(estimate.props.children)).toContain('234.00'); // 260 × 0.9
    expect(String(estimate.props.children)).toContain('299.00'); // 260 × 1.15
    // Honesty firewall: never presented as a final/guaranteed price.
    expect(screen.getByTestId('estimate-caveat').props.children).toMatch(/final quote confirmed/i);
  });

  it('[Inc-36] drives the measure unit from the CARD, not the screen (a PER_KG card asks for kg)', async () => {
    const kgCard = { serviceId: 'svc-1', serviceName: 'Wash & Fold', unit: PricingUnit.PER_KG, kind: ItemKind.GARMENT };
    const kgProps = { navigation, route: { params: kgCard } } as unknown as React.ComponentProps<typeof BookScreen>;
    const { findByText, getByText } = render(<BookScreen {...kgProps} />);
    await findByText('kg'); // the unit suffix on the input — sqft never appears for a wash service
    getByText('About how much does your load weigh?');
  });

  it('[Inc-36] opened with NO service it is a dead end back to the grid — the general composer is unreachable', async () => {
    const noCardProps = { navigation, route: { params: undefined } } as unknown as React.ComponentProps<typeof BookScreen>;
    const { findByTestId, queryByTestId } = render(<BookScreen {...noCardProps} />);
    await findByTestId('book-no-service');
    expect(queryByTestId('measure-input')).toBeNull();
    expect(queryByTestId('service-svc-1')).toBeNull(); // no service picker to fall into
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
    await findByTestId('measure-input');
    expect(queryByTestId('corp-pricing-note')).toBeNull();
  });

  it('still books normally when the memberships read FAILS (degrades — no badge, no block)', async () => {
    mockClient.listMyMemberships.mockRejectedValue(new Error('offline'));
    mockClient.book.mockResolvedValue({ id: 'order-1' });
    const screen = render(<BookScreen {...screenProps} />);
    await screen.findByTestId('measure-input');
    expect(screen.queryByTestId('corp-pricing-note')).toBeNull();
    await stageBooking(screen);
    fireEvent.press(screen.getByTestId('submit-booking'));
    await waitFor(() => expect(mockClient.book).toHaveBeenCalled());
  });

  it('builds an order from the catalog and books it (real serviceId + siteId + the chosen window)', async () => {
    mockClient.book.mockResolvedValue({ id: 'order-1' });
    const screen = render(<BookScreen {...screenProps} />);
    await screen.findByTestId('measure-input'); // focused checkout ready

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
    await screen.findByTestId('measure-input');
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
    await screen.findByTestId('measure-input');
    await stageBooking(screen);
    fireEvent.press(screen.getByTestId('submit-booking'));
    await waitFor(() => expect(screen.getByTestId('book-out-of-area')).toBeTruthy());
    expect(screen.queryByTestId('book-error')).toBeNull(); // NOT the red crash box
    expect(screen.getByTestId('book-out-of-area-body').props.children).toContain('99 Far Away Rd'); // honest captured address
  });

  it('reuses the SAME idempotency key on retry after a failure (no double-booking)', async () => {
    mockClient.book.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ id: 'order-1' });
    const screen = render(<BookScreen {...screenProps} />);
    await screen.findByTestId('measure-input');

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
      await screen.findByTestId('measure-input');
      await stageBooking(screen, 'Afternoon');
      fireEvent.press(screen.getByTestId('submit-booking'));

      await waitFor(() => expect(mockClient.book).toHaveBeenCalled());
      const [dto] = mockClient.book.mock.calls[0]!;
      expect(dto.pickupWindow).toEqual({ start: AFTERNOON.start, end: AFTERNOON.end });
    });

    it('blocks submit until a slot is chosen, and names what is missing', async () => {
      const screen = render(<BookScreen {...screenProps} />);
      await screen.findByTestId('measure-input');
      fireEvent.changeText(screen.getByTestId('measure-input'), '40');

      // Measure ✔, address ✔, slot ✘ → the button says so and refuses. The old screen would have booked
      // a window the customer never saw.
      screen.getByText('Choose a pickup time');
      fireEvent.press(screen.getByTestId('submit-booking'));
      await waitFor(() => expect(mockClient.book).not.toHaveBeenCalled());

      fireEvent.press(await screen.findByTestId('slot-Morning'));
      screen.getByText('Book pickup'); // [Inc-36] one service, one measure — no item count in the label
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
