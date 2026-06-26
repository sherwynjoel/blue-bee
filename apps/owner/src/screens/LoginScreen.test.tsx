import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockRequestOtp = jest.fn(async () => ({ devCode: '123456' }));
const mockLogin = jest.fn(async () => undefined);
jest.mock('../session/SessionProvider', () => ({
  useSession: () => ({ requestOtp: mockRequestOtp, login: mockLogin }),
}));

import { LoginScreen } from './LoginScreen';

jest.setTimeout(30000); // jest-expo cold render + waitFor polling

describe('LoginScreen', () => {
  beforeEach(() => {
    mockRequestOtp.mockClear();
    mockLogin.mockClear();
  });

  it('walks phone → code → sign in (dev code prefilled)', async () => {
    const { getByTestId, findByTestId } = render(<LoginScreen />);

    fireEvent.changeText(getByTestId('phone-input'), '+14165550001');
    fireEvent.press(getByTestId('send-code'));

    const verify = await findByTestId('verify');
    expect(mockRequestOtp).toHaveBeenCalledWith('+14165550001');

    fireEvent.press(verify);
    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('+14165550001', '123456'));
  });
});
