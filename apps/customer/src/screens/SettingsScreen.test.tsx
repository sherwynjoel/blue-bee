import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiError } from '@blue-bee/api-client';

const mockDeleteAccount = jest.fn(async () => undefined);
const mockLogout = jest.fn(async () => undefined);
const mockReloadMe = jest.fn(async () => undefined);
const mockUpdateProfile = jest.fn();
// [Inc-16] SettingsScreen renders <CorporatePricingSection/>, which reads memberships on mount.
const mockListMemberships = jest.fn(async () => ({ memberships: [] as unknown[] }));
const mockRedeem = jest.fn();
// [Inc-35] Profile now renders <LoginSecuritySection/>, which reads /auth/methods on mount.
const mockGetSecurity = jest.fn(async () => ({ email: 'rita@bluebee.example', emailVerified: true, phone: '+14165550010', hasPassword: false, methods: ['otp'] }));
const mockSetPassword = jest.fn();
const mockUnlinkMethod = jest.fn();
// STABLE client object (mirrors the real single useRef instance) — a fresh object per render would loop
// the membership effect in the corporate section.
const mockClient = {
  deleteAccount: mockDeleteAccount,
  updateProfile: mockUpdateProfile,
  listMyMemberships: mockListMemberships,
  redeemJoinCode: mockRedeem,
  getSecurity: mockGetSecurity,
  setPassword: mockSetPassword,
  unlinkMethod: mockUnlinkMethod,
};

jest.mock('../session/SessionProvider', () => ({
  useSession: () => ({
    // [Inc-33] `me.user` now carries `email` too — the Profile screen views + edits name/email.
    me: { user: { name: 'Rita Patel', email: 'rita@bluebee.example', phone: '+14165550010' } },
    client: mockClient,
    logout: mockLogout,
    reloadMe: mockReloadMe,
  }),
}));

// [Inc-26] Settings/Profile is a TAB screen with no `navigation` prop, so it reaches the root stack through
// `useNavigation()` to open Saved addresses. That hook needs a NavigationContainer, which a bare screen
// render does not have — stub just the hook, keeping the module's other exports real.
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

import { SettingsScreen } from './SettingsScreen';

jest.setTimeout(30000); // jest-expo cold render on the external drive can exceed the 5s default

beforeEach(() => {
  mockUpdateProfile.mockReset();
  mockReloadMe.mockClear();
});

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

  it('[Inc-26] the Addresses row opens the saved-addresses screen', async () => {
    mockNavigate.mockClear();
    const { getByTestId } = render(<SettingsScreen />);
    fireEvent.press(getByTestId('settings-addresses'));
    expect(mockNavigate).toHaveBeenCalledWith('Addresses');
  });
});

describe('SettingsScreen — edit profile (Inc-33)', () => {
  it('renders the current identity: editable name/email + read-only phone (your login)', () => {
    const { getByTestId, getByText } = render(<SettingsScreen />);
    expect(getByTestId('profile-name-input').props.value).toBe('Rita Patel');
    expect(getByTestId('profile-email-input').props.value).toBe('rita@bluebee.example');
    // Phone is shown read-only as the login identity (not an editable field).
    expect(getByText('+14165550010')).toBeTruthy();
    expect(getByText('This is your login')).toBeTruthy();
  });

  it('Save is disabled until a real change is made (and an empty name never saves)', () => {
    const { getByTestId } = render(<SettingsScreen />);
    // Pristine → disabled, and a stray press does nothing.
    expect(getByTestId('profile-save').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(getByTestId('profile-save'));
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    // Blanking the (required) name keeps Save disabled even though the field "changed".
    fireEvent.changeText(getByTestId('profile-name-input'), '   ');
    expect(getByTestId('profile-save').props.accessibilityState.disabled).toBe(true);
    // A genuine edit enables it.
    fireEvent.changeText(getByTestId('profile-name-input'), 'Rita P');
    expect(getByTestId('profile-save').props.accessibilityState.disabled).toBe(false);
  });

  it('editing name + email round-trips — sends the change, shows the normalized result, refreshes /me', async () => {
    mockUpdateProfile.mockResolvedValueOnce({ id: 'u1', name: 'Rita P', email: 'rita.new@bluebee.example', phone: '+14165550010' });
    const { getByTestId, findByTestId } = render(<SettingsScreen />);

    fireEvent.changeText(getByTestId('profile-name-input'), 'Rita P');
    fireEvent.changeText(getByTestId('profile-email-input'), 'RITA.NEW@bluebee.example');
    fireEvent.press(getByTestId('profile-save'));

    // Only the changed fields are sent (raw — the server normalizes).
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith({ name: 'Rita P', email: 'RITA.NEW@bluebee.example' }));
    // /me is re-pulled so the rest of the app (greeting, avatar, console parity) sees the change.
    await waitFor(() => expect(mockReloadMe).toHaveBeenCalledTimes(1));
    await findByTestId('profile-saved');
    // The field reflects the SERVER-normalized (lower-cased) email — a true round-trip.
    expect(getByTestId('profile-email-input').props.value).toBe('rita.new@bluebee.example');
  });

  it('a taken email → inline error, no success, and /me is NOT refreshed (409)', async () => {
    mockUpdateProfile.mockRejectedValueOnce(new ApiError(409, { error: 'email_taken' }, 'That email is already in use.'));
    const { getByTestId, findByText, queryByTestId } = render(<SettingsScreen />);

    fireEvent.changeText(getByTestId('profile-email-input'), 'taken@bluebee.example');
    fireEvent.press(getByTestId('profile-save'));

    await findByText('That email is already in use.');
    expect(mockReloadMe).not.toHaveBeenCalled();
    expect(queryByTestId('profile-saved')).toBeNull();
  });

  it('a non-conflict failure surfaces a form error and does NOT refresh /me', async () => {
    mockUpdateProfile.mockRejectedValueOnce(new ApiError(500, { error: 'server_error' }, 'Server error'));
    const { getByTestId, findByTestId } = render(<SettingsScreen />);

    fireEvent.changeText(getByTestId('profile-name-input'), 'New Name');
    fireEvent.press(getByTestId('profile-save'));

    await findByTestId('profile-error');
    expect(mockReloadMe).not.toHaveBeenCalled();
  });
});
