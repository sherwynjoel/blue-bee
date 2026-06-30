import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiError } from '@blue-bee/api-client';

const mockDeleteAccount = jest.fn(async () => undefined);
const mockLogout = jest.fn(async () => undefined);
// [Inc-16] SettingsScreen now renders <CorporatePricingSection/>, which reads memberships on mount.
const mockListMemberships = jest.fn(async () => ({ memberships: [] as unknown[] }));
const mockRedeem = jest.fn();
// STABLE client object (mirrors the real single useRef instance) — a fresh object per render would loop
// the membership effect in the corporate section.
const mockClient = { deleteAccount: mockDeleteAccount, listMyMemberships: mockListMemberships, redeemJoinCode: mockRedeem };

jest.mock('../session/SessionProvider', () => ({
  useSession: () => ({
    me: { user: { name: 'Rita Patel', phone: '+14165550010' } },
    client: mockClient,
    logout: mockLogout,
  }),
}));

import { SettingsScreen } from './SettingsScreen';

jest.setTimeout(30000); // jest-expo cold render on the external drive can exceed the 5s default

describe('SettingsScreen — delete account flow', () => {
  beforeEach(() => {
    mockDeleteAccount.mockClear();
    mockLogout.mockClear();
  });

  it('two-step confirm → calls the API delete → signs out', async () => {
    const { getByTestId, findByTestId } = render(<SettingsScreen />);

    // First press only reveals the confirm step — it does NOT delete yet.
    fireEvent.press(getByTestId('delete-account'));
    expect(mockDeleteAccount).not.toHaveBeenCalled();

    const confirm = await findByTestId('confirm-delete');
    fireEvent.press(confirm);

    await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  });

  it('cancel backs out without deleting', async () => {
    const { getByTestId, findByTestId, queryByTestId } = render(<SettingsScreen />);
    fireEvent.press(getByTestId('delete-account'));
    fireEvent.press(await findByTestId('cancel-delete'));
    expect(queryByTestId('delete-confirm')).toBeNull();
    expect(mockDeleteAccount).not.toHaveBeenCalled();
  });

  it('a failed delete surfaces an error and does NOT sign out', async () => {
    mockDeleteAccount.mockRejectedValueOnce(new ApiError(500, { error: 'server_error' }, 'Server error'));
    const { getByTestId, findByTestId } = render(<SettingsScreen />);
    fireEvent.press(getByTestId('delete-account'));
    fireEvent.press(await findByTestId('confirm-delete'));

    await findByTestId('delete-error');
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('the plain Sign out button signs out', async () => {
    const { getByTestId } = render(<SettingsScreen />);
    fireEvent.press(getByTestId('signout'));
    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  });
});
