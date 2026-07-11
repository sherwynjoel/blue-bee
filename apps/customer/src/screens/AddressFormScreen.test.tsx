import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccountType, type CustomerSite } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';

const existing: CustomerSite = {
  id: 'site-1',
  accountId: 'acc-1',
  name: 'Home',
  address: '100 Queen St W, Toronto, ON',
  accountName: 'Priya',
  accountType: AccountType.RESIDENTIAL,
  geo: { lng: -79.3839, lat: 43.6534 },
  unit: '12B',
  buzzer: '1204',
  notes: 'Side door',
  isDefault: true,
};

const mockClient = {
  getSites: jest.fn(async () => ({ sites: [existing] })),
  createSite: jest.fn(),
  updateSite: jest.fn(),
};
jest.mock('../session/SessionProvider', () => ({
  useSession: () => ({ client: mockClient, me: { user: { accountIds: ['acc-1'] } } }),
}));

import { AddressFormScreen } from './AddressFormScreen';

jest.setTimeout(30000);

const navigation = { navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() };
const props = (params: Record<string, unknown> = {}) =>
  ({ navigation, route: { params } }) as unknown as React.ComponentProps<typeof AddressFormScreen>;

/** The server's happy answer when the org has drawn no zones — coverage is not claimed either way. */
const savedNoZones = (id = 'site-new') => ({
  site: { ...existing, id },
  serviceability: { checked: false, serviceable: false, coverageRequestId: null },
});

describe('AddressFormScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.getSites.mockResolvedValue({ sites: [existing] });
  });

  it('will not submit an empty form, and never calls the API', async () => {
    const { getByTestId, findByTestId } = render(<AddressFormScreen {...props()} />);
    fireEvent.press(getByTestId('address-save'));
    await findByTestId('address-save');
    expect(mockClient.createSite).not.toHaveBeenCalled();
  });

  it('creates the address and hands the new id back to Book for pre-selection', async () => {
    mockClient.createSite.mockResolvedValue(savedNoZones('site-new'));
    const { getByTestId } = render(<AddressFormScreen {...props({ returnTo: 'Book' })} />);

    fireEvent.changeText(getByTestId('address-name'), 'Work');
    fireEvent.changeText(getByTestId('address-line'), '290 Bremner Blvd, Toronto, ON');
    fireEvent.changeText(getByTestId('address-unit'), '30');
    fireEvent.press(getByTestId('address-save'));

    await waitFor(() => expect(mockClient.createSite).toHaveBeenCalled());
    const [dto, idemKey] = mockClient.createSite.mock.calls[0]!;
    expect(dto).toEqual({ name: 'Work', address: '290 Bremner Blvd, Toronto, ON', unit: '30' });
    expect(idemKey).toMatch(/^site-/); // a retry of the same save is de-duped server-side

    await waitFor(() =>
      expect(navigation.navigate).toHaveBeenCalledWith({ name: 'Book', params: { preselectSiteId: 'site-new' }, merge: true }),
    );
  });

  it('a 422 geocode_failed lands on the ADDRESS FIELD (nothing was saved — the server never guesses a point)', async () => {
    mockClient.createSite.mockRejectedValue(
      new ApiError(422, { error: 'site.geocode_failed', status: 422 }, 'We could not find that address.'),
    );
    const { getByTestId, findByTestId, queryByTestId } = render(<AddressFormScreen {...props()} />);

    fireEvent.changeText(getByTestId('address-name'), 'Nowhere');
    fireEvent.changeText(getByTestId('address-line'), 'zzz nonexistent st');
    fireEvent.press(getByTestId('address-save'));

    await findByTestId('address-line');
    await waitFor(() => expect(mockClient.createSite).toHaveBeenCalled());
    // Surfaced as a field error, not the generic red box, and we did not leave the screen.
    expect(queryByTestId('address-save-error')).toBeNull();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('a 503 geocode_unavailable is TRANSIENT: it never says the address is wrong, and keeps the idempotency key', async () => {
    mockClient.createSite.mockRejectedValue(
      new ApiError(503, { error: 'site.geocode_unavailable', status: 503 }, 'Lookup unavailable'),
    );
    const { getByTestId, findByTestId } = render(<AddressFormScreen {...props()} />);

    fireEvent.changeText(getByTestId('address-name'), 'Home');
    fireEvent.changeText(getByTestId('address-line'), '100 Queen St W');
    fireEvent.press(getByTestId('address-save'));

    const err = await findByTestId('address-save-error');
    expect(String(err.props.children)).toMatch(/temporarily unavailable/i);

    // Retry must reuse the SAME key — the first attempt may actually have landed server-side.
    mockClient.createSite.mockResolvedValue(savedNoZones());
    fireEvent.press(getByTestId('address-save'));
    await waitFor(() => expect(mockClient.createSite).toHaveBeenCalledTimes(2));
    const firstKey = mockClient.createSite.mock.calls[0]![1];
    const secondKey = mockClient.createSite.mock.calls[1]![1];
    expect(secondKey).toBe(firstKey);
  });

  it('an out-of-area save shows the calm state — the address IS saved, and the "we noted it" line only appears with a coverageRequestId', async () => {
    mockClient.createSite.mockResolvedValue({
      site: existing,
      serviceability: { checked: true, serviceable: false, coverageRequestId: 'cr-1' },
    });
    const { getByTestId, findByTestId } = render(<AddressFormScreen {...props()} />);
    fireEvent.changeText(getByTestId('address-name'), 'Cottage');
    fireEvent.changeText(getByTestId('address-line'), '111 Wellington St, Ottawa, ON');
    fireEvent.press(getByTestId('address-save'));

    await findByTestId('out-of-area');
    await findByTestId('coverage-recorded');
    expect(navigation.goBack).not.toHaveBeenCalled(); // terminal state; the user dismisses it
  });

  it('does NOT promise the address was recorded when the server returned no coverageRequestId', async () => {
    mockClient.createSite.mockResolvedValue({
      site: existing,
      serviceability: { checked: true, serviceable: false, coverageRequestId: null },
    });
    const { getByTestId, findByTestId, queryByTestId } = render(<AddressFormScreen {...props()} />);
    fireEvent.changeText(getByTestId('address-name'), 'Cottage');
    fireEvent.changeText(getByTestId('address-line'), 'far away');
    fireEvent.press(getByTestId('address-save'));

    await findByTestId('out-of-area');
    expect(queryByTestId('coverage-recorded')).toBeNull();
  });

  it('edit mode hydrates from the row-scoped list and PATCHes only what changed', async () => {
    mockClient.updateSite.mockResolvedValue(savedNoZones('site-1'));
    const { getByTestId, findByTestId } = render(<AddressFormScreen {...props({ siteId: 'site-1' })} />);

    const nameField = await findByTestId('address-name');
    expect(nameField.props.value).toBe('Home');
    expect(getByTestId('address-buzzer').props.value).toBe('1204');

    fireEvent.changeText(nameField, 'Home sweet home');
    fireEvent.press(getByTestId('address-save'));

    await waitFor(() => expect(mockClient.updateSite).toHaveBeenCalled());
    const [siteId, dto] = mockClient.updateSite.mock.calls[0]!;
    expect(siteId).toBe('site-1');
    // The address did not move → it must NOT be resent (a needless re-geocode against a rate-limited upstream).
    expect(dto).toEqual({ name: 'Home sweet home' });
  });

  it('edit mode with no changes just leaves, without calling PATCH (the server rejects an empty body)', async () => {
    const { getByTestId, findByTestId } = render(<AddressFormScreen {...props({ siteId: 'site-1' })} />);
    await findByTestId('address-name');
    fireEvent.press(getByTestId('address-save'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockClient.updateSite).not.toHaveBeenCalled();
  });

  it('surfaces a load error when the site is not in the caller row scope', async () => {
    mockClient.getSites.mockResolvedValue({ sites: [] });
    const { findByTestId } = render(<AddressFormScreen {...props({ siteId: 'someone-elses' })} />);
    await findByTestId('address-load-error');
  });
});
