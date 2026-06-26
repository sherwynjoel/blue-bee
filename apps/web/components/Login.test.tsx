import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const requestOtp = jest.fn();
const login = jest.fn();
jest.mock('@/lib/session', () => ({ useSession: () => ({ requestOtp, login }) }));

import { Login } from './Login';

beforeEach(() => jest.clearAllMocks());

describe('Login (phone OTP)', () => {
  it('requests a code then signs in (dev code prefilled)', async () => {
    requestOtp.mockResolvedValue({ devCode: '123456' });
    login.mockResolvedValue(undefined);
    render(<Login />);
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '+14165550001' } });
    fireEvent.click(screen.getByText('Send code'));
    await waitFor(() => expect(requestOtp).toHaveBeenCalledWith('+14165550001'));
    await waitFor(() => expect(screen.getByText(/Dev code: 123456/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Sign in'));
    await waitFor(() => expect(login).toHaveBeenCalledWith('+14165550001', '123456'));
  });

  it('shows an error when the code is rejected', async () => {
    const { ApiError } = jest.requireActual('@blue-bee/api-client');
    requestOtp.mockResolvedValue({});
    login.mockRejectedValue(new ApiError(401, { title: 'bad code' }, 'bad code'));
    render(<Login />);
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '+1416' } });
    fireEvent.click(screen.getByText('Send code'));
    await waitFor(() => expect(screen.getByLabelText('Verification code')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByText('Sign in'));
    await waitFor(() => expect(screen.getByText('bad code')).toBeInTheDocument());
  });
});
