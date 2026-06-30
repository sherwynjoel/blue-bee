import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ServiceVertical, ServiceUnit, AccountType } from '@blue-bee/shared';

const mockClient = {
  getServices: jest.fn(async () => ({ services: [{ id: 'svc-1', vertical: ServiceVertical.SPECIALTY, name: 'Rug cleaning', unit: ServiceUnit.SQFT, baseRate: '6.5' }] })),
  getSites: jest.fn(async () => ({ sites: [{ id: 'site-1', accountId: 'acc', name: 'Home', address: '1 Main St', accountName: 'Rita', accountType: AccountType.RESIDENTIAL }] })),
  // [Inc-16] BookScreen reads memberships to show the corporate-pricing badge; default = none.
  listMyMemberships: jest.fn(async () => ({ memberships: [] as Array<{ id: string; accountId: string; accountName: string; status: string; source: string; createdAt: string }> })),
  book: jest.fn(),
};
jest.mock('../session/SessionProvider', () => ({
  useSession: () => ({ client: mockClient, me: { user: { accountIds: ['acc'] } } }),
}));

import { BookScreen } from './BookScreen';

jest.setTimeout(30000);
const navigation = { replace: jest.fn(), navigate: jest.fn() };
// BookScreen only uses `navigation`; cast the screen props (route is unused by the test path).
const screenProps = { navigation } as unknown as React.ComponentProps<typeof BookScreen>;

describe('BookScreen', () => {
  beforeEach(() => {
    mockClient.book.mockReset();
    mockClient.listMyMemberships.mockReset();
    mockClient.listMyMemberships.mockResolvedValue({ memberships: [] });
    navigation.replace.mockClear();
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
    const { getByTestId, findByTestId, queryByTestId } = render(<BookScreen {...screenProps} />);
    await findByTestId('service-svc-1');
    expect(queryByTestId('corp-pricing-note')).toBeNull();
    fireEvent.changeText(getByTestId('measure-input'), '40');
    fireEvent.press(getByTestId('add-item'));
    fireEvent.press(getByTestId('submit-booking'));
    await waitFor(() => expect(mockClient.book).toHaveBeenCalled());
  });

  it('builds an order from the catalog and books it (real serviceId + siteId)', async () => {
    mockClient.book.mockResolvedValue({ id: 'order-1' });
    const { getByTestId, findByTestId } = render(<BookScreen {...screenProps} />);
    await findByTestId('service-svc-1'); // catalog loaded

    fireEvent.changeText(getByTestId('measure-input'), '40');
    fireEvent.press(getByTestId('add-item'));
    fireEvent.press(getByTestId('submit-booking'));

    await waitFor(() => expect(mockClient.book).toHaveBeenCalled());
    const [dto, key] = mockClient.book.mock.calls[0]!;
    expect(dto).toMatchObject({ accountId: 'acc', siteId: 'site-1', items: [{ serviceId: 'svc-1', estimatedMeasure: 40 }] });
    expect(typeof key).toBe('string');
  });

  it('reuses the SAME idempotency key on retry after a failure (no double-booking)', async () => {
    mockClient.book.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ id: 'order-1' });
    const { getByTestId, findByTestId } = render(<BookScreen {...screenProps} />);
    await findByTestId('service-svc-1');

    fireEvent.changeText(getByTestId('measure-input'), '40');
    fireEvent.press(getByTestId('add-item'));

    fireEvent.press(getByTestId('submit-booking'));
    await waitFor(() => expect(mockClient.book).toHaveBeenCalledTimes(1));
    fireEvent.press(getByTestId('submit-booking'));
    await waitFor(() => expect(mockClient.book).toHaveBeenCalledTimes(2));

    const key1 = mockClient.book.mock.calls[0]![1];
    const key2 = mockClient.book.mock.calls[1]![1];
    expect(key1).toBe(key2); // same key → server de-dupes the retry, no second order
  });
});
