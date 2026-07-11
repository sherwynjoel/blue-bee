import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiError } from '@blue-bee/api-client';

const mockGetSecurity = jest.fn();
const mockSetPassword = jest.fn();
const mockUnlinkMethod = jest.fn();
const mockClient = { getSecurity: mockGetSecurity, setPassword: mockSetPassword, unlinkMethod: mockUnlinkMethod };
jest.mock('../session/SessionProvider', () => ({ useSession: () => ({ client: mockClient }) }));

import { LoginSecuritySection } from './LoginSecurity';

jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('LoginSecuritySection (Inc-35)', () => {
  it('lists linked methods and can unlink when more than one is linked', async () => {
    mockGetSecurity.mockResolvedValue({ email: 'a@example.com', emailVerified: true, phone: '+14165550010', hasPassword: true, methods: ['otp', 'password', 'google'] });
    mockUnlinkMethod.mockResolvedValue({ email: 'a@example.com', emailVerified: true, phone: '+14165550010', hasPassword: true, methods: ['otp', 'password'] });

    const { findByTestId, getByTestId } = render(<LoginSecuritySection />);
    await findByTestId('security-methods');
    // google is linked and unlinkable (3 methods) → its unlink button exists.
    fireEvent.press(getByTestId('security-unlink-google'));
    await waitFor(() => expect(mockUnlinkMethod).toHaveBeenCalledWith('google'));
  });

  it('sets a password (no current password needed when none is set)', async () => {
    mockGetSecurity.mockResolvedValue({ email: 'a@example.com', emailVerified: true, phone: '+14165550010', hasPassword: false, methods: ['google'] });
    mockSetPassword.mockResolvedValue({ email: 'a@example.com', emailVerified: true, phone: '+14165550010', hasPassword: true, methods: ['google', 'password'] });

    const { findByTestId, getByTestId, queryByTestId } = render(<LoginSecuritySection />);
    fireEvent.press(await findByTestId('security-set-password'));
    // No current-password field when the account has no password yet.
    expect(queryByTestId('security-current-password')).toBeNull();
    fireEvent.changeText(getByTestId('security-new-password'), 'a-brand-new-password');
    fireEvent.press(getByTestId('security-save-password'));
    await waitFor(() => expect(mockSetPassword).toHaveBeenCalledWith({ newPassword: 'a-brand-new-password' }));
    await findByTestId('security-saved');
  });

  it('surfaces the server error when unlinking the last method is refused', async () => {
    mockGetSecurity.mockResolvedValue({ email: null, emailVerified: false, phone: '+14165550010', hasPassword: false, methods: ['otp', 'google'] });
    mockUnlinkMethod.mockRejectedValueOnce(new ApiError(409, { error: 'last_method' }, 'You must keep at least one sign-in method.'));

    const { findByTestId, getByTestId } = render(<LoginSecuritySection />);
    await findByTestId('security-methods');
    fireEvent.press(getByTestId('security-unlink-google'));
    await findByTestId('security-error');
  });
});
