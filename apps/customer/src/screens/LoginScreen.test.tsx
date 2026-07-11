import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiError } from '@blue-bee/api-client';

const mockRequestOtp = jest.fn(async () => ({ devCode: '123456' }));
const mockLogin = jest.fn(async () => undefined);
const mockCompleteSignIn = jest.fn(async () => undefined);
const mockClient = {
  loginWithEmail: jest.fn(async () => ({ tokens: {}, emailVerified: true, provider: 'password', created: false })),
  registerWithEmail: jest.fn(async () => ({ tokens: {}, emailVerified: false, provider: 'password', created: true })),
  oauthSignIn: jest.fn(async () => ({ tokens: {}, emailVerified: true, provider: 'google', created: false })),
  requestPasswordReset: jest.fn(async () => ({})),
  confirmPasswordReset: jest.fn(async () => ({ ok: true })),
};
jest.mock('../session/SessionProvider', () => ({
  useSession: () => ({ requestOtp: mockRequestOtp, login: mockLogin, completeSignIn: mockCompleteSignIn, client: mockClient }),
}));

// The on-device provider-token acquisition is behind a helper — mock it (default: unavailable).
jest.mock('../auth/oauth-native', () => {
  class OAuthUnavailableError extends Error {
    constructor(providerName: string) {
      super(`${providerName === 'apple' ? 'Apple' : 'Google'} sign-in isn’t set up in this app build yet.`);
      this.name = 'OAuthUnavailableError';
    }
  }
  return { OAuthUnavailableError, getProviderIdToken: jest.fn() };
});
import { getProviderIdToken, OAuthUnavailableError } from '../auth/oauth-native';
const mockGetProviderIdToken = getProviderIdToken as jest.Mock;

import { LoginScreen } from './LoginScreen';

jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('LoginScreen — phone OTP (existing primary path)', () => {
  it('walks phone → code → sign in (dev code prefilled)', async () => {
    const { getByTestId, findByTestId } = render(<LoginScreen />);
    fireEvent.changeText(getByTestId('phone-input'), '+14165550010');
    fireEvent.press(getByTestId('send-code'));
    const verify = await findByTestId('verify');
    expect(mockRequestOtp).toHaveBeenCalledWith('+14165550010');
    fireEvent.press(verify);
    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('+14165550010', '123456'));
  });
});

describe('LoginScreen — email + password (Inc-35)', () => {
  it('signs in with email + password, then completes sign-in', async () => {
    const { getByTestId, findByTestId } = render(<LoginScreen />);
    fireEvent.press(getByTestId('go-email'));
    fireEvent.changeText(await findByTestId('email-input'), 'alex@example.com');
    fireEvent.changeText(getByTestId('password-input'), 'my-password-123');
    fireEvent.press(getByTestId('email-signin'));
    await waitFor(() => expect(mockClient.loginWithEmail).toHaveBeenCalledWith({ email: 'alex@example.com', password: 'my-password-123' }));
    await waitFor(() => expect(mockCompleteSignIn).toHaveBeenCalledTimes(1));
  });

  it('registers a new account (passing an optional referral code) then completes sign-in', async () => {
    const { getByTestId, findByTestId } = render(<LoginScreen />);
    fireEvent.press(getByTestId('go-email'));
    fireEvent.press(await findByTestId('go-register'));
    fireEvent.changeText(await findByTestId('name-input'), 'Alex Rivera');
    fireEvent.changeText(getByTestId('email-input'), 'alex@example.com');
    fireEvent.changeText(getByTestId('password-input'), 'a-strong-password');
    fireEvent.changeText(getByTestId('referral-input'), 'REFKMNP2');
    fireEvent.press(getByTestId('register-submit'));
    await waitFor(() =>
      expect(mockClient.registerWithEmail).toHaveBeenCalledWith({ email: 'alex@example.com', password: 'a-strong-password', name: 'Alex Rivera', referralCode: 'REFKMNP2' }),
    );
    await waitFor(() => expect(mockCompleteSignIn).toHaveBeenCalledTimes(1));
  });

  it('a wrong-password sign-in surfaces the server error and does NOT complete sign-in', async () => {
    mockClient.loginWithEmail.mockRejectedValueOnce(new ApiError(401, { error: 'invalid_credentials' }, 'Invalid email or password.'));
    const { getByTestId, findByTestId } = render(<LoginScreen />);
    fireEvent.press(getByTestId('go-email'));
    fireEvent.changeText(await findByTestId('email-input'), 'alex@example.com');
    fireEvent.changeText(getByTestId('password-input'), 'wrong');
    fireEvent.press(getByTestId('email-signin'));
    await findByTestId('login-error');
    expect(mockCompleteSignIn).not.toHaveBeenCalled();
  });

  it('forgot-password: request a reset code, then confirm a new password', async () => {
    const { getByTestId, findByTestId } = render(<LoginScreen />);
    fireEvent.press(getByTestId('go-email'));
    fireEvent.press(await findByTestId('go-forgot'));
    fireEvent.changeText(await findByTestId('email-input'), 'alex@example.com');
    fireEvent.press(getByTestId('forgot-send'));
    await waitFor(() => expect(mockClient.requestPasswordReset).toHaveBeenCalledWith('alex@example.com'));
    // reveal the confirm step
    fireEvent.changeText(await findByTestId('reset-token-input'), 'a-reset-token-value-1234567890');
    fireEvent.changeText(getByTestId('reset-password-input'), 'brand-new-password');
    fireEvent.press(getByTestId('reset-submit'));
    await waitFor(() => expect(mockClient.confirmPasswordReset).toHaveBeenCalledWith({ token: 'a-reset-token-value-1234567890', password: 'brand-new-password' }));
  });
});

describe('LoginScreen — Apple/Google (Inc-35)', () => {
  it('signs in with Google when a provider token is acquired', async () => {
    mockGetProviderIdToken.mockResolvedValueOnce('google-id-token');
    const { getByTestId } = render(<LoginScreen />);
    fireEvent.press(getByTestId('oauth-google'));
    await waitFor(() => expect(mockClient.oauthSignIn).toHaveBeenCalledWith({ provider: 'google', idToken: 'google-id-token' }));
    await waitFor(() => expect(mockCompleteSignIn).toHaveBeenCalledTimes(1));
  });

  it('shows an HONEST message (no fake sign-in) when provider sign-in isn’t wired yet', async () => {
    mockGetProviderIdToken.mockRejectedValueOnce(new OAuthUnavailableError('apple'));
    const { getByTestId, findByTestId } = render(<LoginScreen />);
    fireEvent.press(getByTestId('oauth-apple'));
    const err = await findByTestId('login-error');
    expect(err.props.children).toMatch(/isn’t set up/i);
    expect(mockClient.oauthSignIn).not.toHaveBeenCalled();
    expect(mockCompleteSignIn).not.toHaveBeenCalled();
  });
});
