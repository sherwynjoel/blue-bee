import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import { ApiError } from '@blue-bee/api-client';

// [Inc-34] ReferScreen loads client.getReferral() + getReferrals(); mock the session (theme/icons come
// from the useTheme() light fallback + jest.setup, as with the other screen tests).
const mockGetReferral = jest.fn();
const mockGetReferrals = jest.fn();
const mockClient = { getReferral: mockGetReferral, getReferrals: mockGetReferrals };
jest.mock('../session/SessionProvider', () => ({ useSession: () => ({ client: mockClient }) }));

import { ReferScreen } from './ReferScreen';

jest.setTimeout(30000);

const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);

beforeEach(() => {
  mockGetReferral.mockReset();
  mockGetReferrals.mockReset();
  shareSpy.mockClear();
});

describe('ReferScreen (Inc-34 — invite + code, reward deferred)', () => {
  it('renders my code + the joined list, shares the code, and states NO reward anywhere', async () => {
    mockGetReferral.mockResolvedValue({ code: 'ABCD2345', shareUrl: null });
    mockGetReferrals.mockResolvedValue({
      count: 2,
      joiners: [
        { userId: 'u1', name: 'Priya Nair', joinedAt: '2026-07-01T10:00:00.000Z' },
        { userId: 'u2', name: 'Grace Okafor', joinedAt: '2026-06-20T10:00:00.000Z' },
      ],
    });

    const { getByTestId, findByTestId, toJSON } = render(<ReferScreen />);

    // my code + the joiners render
    expect((await findByTestId('refer-code')).props.children).toBe('ABCD2345');
    expect(getByTestId('refer-joined-count')).toBeTruthy();
    expect(getByTestId('refer-joiner-u1')).toBeTruthy();
    expect(getByTestId('refer-joiner-u2')).toBeTruthy();

    // the native Share sheet fires with the code (and no fabricated domain, since shareUrl is null)
    fireEvent.press(getByTestId('refer-share'));
    await waitFor(() => expect(shareSpy).toHaveBeenCalledTimes(1));
    const message = (shareSpy.mock.calls[0]![0] as { message: string }).message;
    expect(message).toContain('ABCD2345');
    expect(message).not.toMatch(/https?:\/\//); // no link when the server gave none

    // HONESTY FIREWALL: nothing rendered implies a reward/credit.
    expect(JSON.stringify(toJSON())).not.toMatch(/reward|credit|\bearn\b|bonus|\bfree\b|\$\d|discount|cashback/i);
  });

  it('shows the empty state when no one has joined yet', async () => {
    mockGetReferral.mockResolvedValue({ code: 'ABCD2345', shareUrl: null });
    mockGetReferrals.mockResolvedValue({ count: 0, joiners: [] });
    const { findByTestId } = render(<ReferScreen />);
    expect(await findByTestId('refer-empty')).toBeTruthy();
  });

  it('surfaces an error with a retry when the API fails', async () => {
    mockGetReferral.mockRejectedValue(new ApiError(500, { error: 'server_error' }, 'Server error'));
    mockGetReferrals.mockRejectedValue(new ApiError(500, { error: 'server_error' }, 'Server error'));
    const { findByTestId } = render(<ReferScreen />);
    expect(await findByTestId('refer-retry')).toBeTruthy();
  });

  it('includes the shareUrl in the message only when the server actually provides one', async () => {
    mockGetReferral.mockResolvedValue({ code: 'ABCD2345', shareUrl: 'https://bluebee.app/r?ref=ABCD2345' });
    mockGetReferrals.mockResolvedValue({ count: 0, joiners: [] });
    const { getByTestId, findByTestId } = render(<ReferScreen />);
    await findByTestId('refer-code');
    fireEvent.press(getByTestId('refer-share'));
    await waitFor(() => expect(shareSpy).toHaveBeenCalled());
    expect((shareSpy.mock.calls[0]![0] as { message: string }).message).toContain('https://bluebee.app/r?ref=ABCD2345');
  });
});
