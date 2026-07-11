import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccountType, type CustomerSite } from '@blue-bee/shared';

const site = (over: Partial<CustomerSite> = {}): CustomerSite => ({
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
  ...over,
});

const mockClient = {
  getSites: jest.fn(),
  updateSite: jest.fn(),
  deactivateSite: jest.fn(),
};
jest.mock('../session/SessionProvider', () => ({
  useSession: () => ({ client: mockClient, me: { user: { accountIds: ['acc-1'] } } }),
}));

import { AddressesScreen } from './AddressesScreen';

jest.setTimeout(30000);

const navigation = { navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => jest.fn()) };
const props = () => ({ navigation }) as unknown as React.ComponentProps<typeof AddressesScreen>;

describe('AddressesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    navigation.addListener.mockReturnValue(jest.fn());
  });

  it('shows the zero-state with an Add CTA when the customer has no saved address', async () => {
    mockClient.getSites.mockResolvedValue({ sites: [] });
    const { findByTestId } = render(<AddressesScreen {...props()} />);
    await findByTestId('addresses-empty');
  });

  it('renders each address with its details, and badges the default', async () => {
    mockClient.getSites.mockResolvedValue({ sites: [site(), site({ id: 'site-2', name: 'Work', isDefault: false })] });
    const { findByTestId, queryByTestId } = render(<AddressesScreen {...props()} />);

    await findByTestId('address-line-site-1');
    await findByTestId('default-badge-site-1');
    // Only one default is badged, and the non-default offers the promote action.
    expect(queryByTestId('default-badge-site-2')).toBeNull();
    await findByTestId('make-default-site-2');
    // The default itself has no "make default" action.
    expect(queryByTestId('make-default-site-1')).toBeNull();
  });

  it('remove is TWO-STEP: the first tap only arms it, the second calls the API', async () => {
    mockClient.getSites.mockResolvedValue({ sites: [site()] });
    mockClient.deactivateSite.mockResolvedValue({ site: site({ isDefault: false }), promotedDefaultSiteId: null });
    const { findByTestId } = render(<AddressesScreen {...props()} />);

    fireEvent.press(await findByTestId('remove-site-1'));
    expect(mockClient.deactivateSite).not.toHaveBeenCalled();

    fireEvent.press(await findByTestId('confirm-remove-site-1'));
    await waitFor(() => expect(mockClient.deactivateSite).toHaveBeenCalledWith('site-1'));
  });

  it('re-reads the list from the SERVER after a remove (the server may have moved the default)', async () => {
    mockClient.getSites
      .mockResolvedValueOnce({ sites: [site(), site({ id: 'site-2', name: 'Work', isDefault: false })] })
      .mockResolvedValueOnce({ sites: [site({ id: 'site-2', name: 'Work', isDefault: true })] });
    mockClient.deactivateSite.mockResolvedValue({ site: site(), promotedDefaultSiteId: 'site-2' });

    const { findByTestId, queryByTestId } = render(<AddressesScreen {...props()} />);
    fireEvent.press(await findByTestId('remove-site-1'));
    fireEvent.press(await findByTestId('confirm-remove-site-1'));

    // The promoted default comes from the refetch, never from local guessing.
    await findByTestId('default-badge-site-2');
    await waitFor(() => expect(queryByTestId('address-line-site-1')).toBeNull());
  });

  it('make-default PATCHes isDefault and refreshes', async () => {
    mockClient.getSites
      .mockResolvedValueOnce({ sites: [site({ isDefault: false }), site({ id: 'site-2', name: 'Work', isDefault: true })] })
      .mockResolvedValueOnce({ sites: [site({ isDefault: true }), site({ id: 'site-2', name: 'Work', isDefault: false })] });
    mockClient.updateSite.mockResolvedValue({
      site: site({ isDefault: true }),
      serviceability: { checked: false, serviceable: false, coverageRequestId: null },
    });

    const { findByTestId } = render(<AddressesScreen {...props()} />);
    fireEvent.press(await findByTestId('make-default-site-1'));

    await waitFor(() => expect(mockClient.updateSite).toHaveBeenCalledWith('site-1', { isDefault: true }));
    await findByTestId('default-badge-site-1');
  });

  it('surfaces a failed remove without dropping the address from the list', async () => {
    mockClient.getSites.mockResolvedValue({ sites: [site()] });
    mockClient.deactivateSite.mockRejectedValue(new Error('network down'));
    const { findByTestId } = render(<AddressesScreen {...props()} />);

    fireEvent.press(await findByTestId('remove-site-1'));
    fireEvent.press(await findByTestId('confirm-remove-site-1'));

    await findByTestId('addresses-action-error');
    await findByTestId('address-line-site-1'); // still listed — nothing was removed
  });

  it('surfaces a load failure with a retry', async () => {
    mockClient.getSites.mockRejectedValue(new Error('offline'));
    const { findByTestId } = render(<AddressesScreen {...props()} />);
    await findByTestId('addresses-error');
  });

  it('opens the form to add, and to edit an existing address', async () => {
    mockClient.getSites.mockResolvedValue({ sites: [site()] });
    const { findByTestId, getByTestId } = render(<AddressesScreen {...props()} />);

    fireEvent.press(await findByTestId('add-address'));
    expect(navigation.navigate).toHaveBeenCalledWith('AddressForm', {});

    fireEvent.press(getByTestId('edit-site-1'));
    expect(navigation.navigate).toHaveBeenCalledWith('AddressForm', { siteId: 'site-1' });
  });
});
