import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiError } from '@blue-bee/api-client';

const mockListMemberships = jest.fn();
const mockRedeem = jest.fn();
// A STABLE client object (mirrors the real SessionProvider's single useRef instance) — a fresh object per
// render would re-fire the membership effect every render (infinite loop).
const mockClient = { listMyMemberships: mockListMemberships, redeemJoinCode: mockRedeem };
jest.mock('../session/SessionProvider', () => ({
  useSession: () => ({ client: mockClient }),
}));

import { CorporatePricingSection, CorporatePricingNote } from './CorporatePricing';

jest.setTimeout(30000); // jest-expo cold render on the external drive can exceed the 5s default

const membership = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  accountId: 'corp-1',
  accountName: 'Maple District Towers',
  status: 'ACTIVE' as const,
  source: 'JOIN_CODE' as const,
  createdAt: '2026-07-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  mockListMemberships.mockReset();
  mockRedeem.mockReset();
  mockListMemberships.mockResolvedValue({ memberships: [] });
});

describe('CorporatePricingSection — join-code entry + memberships', () => {
  it('lists an existing ACTIVE membership on load (server truth — the account NAME the server returned)', async () => {
    mockListMemberships.mockResolvedValue({ memberships: [membership()] });
    const { findByTestId, getByText } = render(<CorporatePricingSection />);
    expect(await findByTestId('corp-membership-corp-1')).toBeTruthy();
    expect(getByText('Maple District Towers', { exact: false })).toBeTruthy();
  });

  it('redeems a valid code → success message + refreshes the membership list', async () => {
    mockListMemberships.mockResolvedValueOnce({ memberships: [] }); // initial load
    mockRedeem.mockResolvedValue({ accountId: 'corp-1', accountName: 'Maple District Towers', status: 'ACTIVE', source: 'JOIN_CODE', alreadyMember: false });
    mockListMemberships.mockResolvedValueOnce({ memberships: [membership()] }); // reload after redeem

    const { getByTestId, findByTestId } = render(<CorporatePricingSection />);
    fireEvent.changeText(getByTestId('corp-code-input'), 'MAPLELOFT');
    fireEvent.press(getByTestId('corp-apply'));

    await waitFor(() => expect(mockRedeem).toHaveBeenCalledWith({ code: 'MAPLELOFT' }));
    expect(await findByTestId('corp-success')).toBeTruthy();
    expect(await findByTestId('corp-membership-corp-1')).toBeTruthy();
  });

  it('a bad/expired code surfaces a clean inline error (server 400) and never crashes or fakes a join', async () => {
    mockRedeem.mockRejectedValue(new ApiError(400, { error: 'corporate.invalid_join_code' }, 'that join code is not valid'));
    const { getByTestId, findByTestId, queryByTestId } = render(<CorporatePricingSection />);
    fireEvent.changeText(getByTestId('corp-code-input'), 'NOPE');
    fireEvent.press(getByTestId('corp-apply'));

    expect(await findByTestId('corp-error')).toBeTruthy();
    expect(queryByTestId('corp-success')).toBeNull();
  });

  it('degrades silently when the memberships read fails — still lets the user enter a code', async () => {
    mockListMemberships.mockRejectedValue(new Error('offline'));
    const { getByTestId } = render(<CorporatePricingSection />);
    await waitFor(() => expect(mockListMemberships).toHaveBeenCalled());
    expect(getByTestId('corp-code-input')).toBeTruthy();
    expect(getByTestId('corp-apply')).toBeTruthy();
  });
});

describe('CorporatePricingNote — the read-only indicator', () => {
  it('renders the server-provided pricing account name', () => {
    const { getByTestId, getByText } = render(<CorporatePricingNote accountName="Maple District Towers" />);
    expect(getByTestId('corp-pricing-note')).toBeTruthy();
    expect(getByText('Maple District Towers', { exact: false })).toBeTruthy();
  });
});
