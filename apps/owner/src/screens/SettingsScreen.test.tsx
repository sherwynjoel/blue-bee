import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiError } from '@blue-bee/api-client';

const mockDeleteAccount = jest.fn(async () => undefined);
const mockLogout = jest.fn(async () => undefined);

jest.mock('../session/SessionProvider', () => ({
  useSession: () => ({
    me: { user: { name: 'Olivia Owner', phone: '+14165550001' } },
    client: { deleteAccount: mockDeleteAccount },
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
