import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const MiB = 1024 * 1024;
const mockClient = {
  presignPodMedia: jest.fn(async (_s: string, dto: { contentType: string; byteSize: number }) => ({
    uploadUrl: 'https://minio.local/put',
    storageKey: dto.contentType === 'image/png' ? 'sigkey' : 'photokey',
    contentType: dto.contentType,
    expiresInSec: 600,
    maxBytes: 15 * MiB,
  })),
  captureProofOfDelivery: jest.fn(async (s: string, dto: { geo?: unknown }) => ({ id: 'pod-1', routeStopId: s, capturedAt: 'now', capturedBy: 'u', geo: dto.geo ?? null, signature: null, photos: [] })),
};
const mockDoStopAction = jest.fn(async () => undefined);

jest.mock('../session/SessionProvider', () => ({
  useSession: () => ({
    assignment: {
      driverId: 'd',
      shift: null,
      route: {
        id: 'r',
        date: '',
        status: 'IN_PROGRESS',
        stops: [{ id: 'stop-1', seq: 1, kind: 'DELIVERY', status: 'IN_PROGRESS', orderId: 'o', siteName: 'Harbourfront Lobby', address: '1 York St', lat: null, lng: null, timeWindow: null, eta: null, etaLow: null, etaHigh: null, exceptionReason: null }],
      },
    },
    client: mockClient,
    doStopAction: mockDoStopAction,
  }),
}));

import { PodScreen } from './PodScreen';
import type { PodProps } from '../navigation';

const nav = { goBack: jest.fn(), navigate: jest.fn() } as unknown as PodProps['navigation'];
const route = { params: { stopId: 'stop-1' } } as unknown as PodProps['route'];

jest.setTimeout(30000); // jest-expo cold render on the external drive can exceed the 5s default

describe('PodScreen — capture proof of delivery then complete', () => {
  beforeEach(() => jest.clearAllMocks());

  it('captures the photo + signature, POSTs the POD with confirmed keys, then completes the stop', async () => {
    const { getByTestId } = render(<PodScreen route={route} navigation={nav} />);

    fireEvent.press(getByTestId('pod-take-photo'));
    await waitFor(() => getByTestId('pod-photo-preview'));

    fireEvent.press(getByTestId('pod-confirm-signature')); // mocked readSignature → onOK(base64)
    await waitFor(() => getByTestId('pod-resign')); // "Signature captured" state

    fireEvent.press(getByTestId('pod-submit'));

    await waitFor(() => expect(mockClient.captureProofOfDelivery).toHaveBeenCalledTimes(1));
    expect(mockClient.presignPodMedia).toHaveBeenCalledTimes(2); // photo + signature
    expect(mockClient.captureProofOfDelivery).toHaveBeenCalledWith('stop-1', expect.objectContaining({ signatureStorageKey: 'sigkey', photoStorageKeys: ['photokey'] }));
    // the §5.4 complete is driven AFTER the POD (server-authoritative), then we return to the stop
    await waitFor(() => expect(mockDoStopAction).toHaveBeenCalledWith('stop-1', 'complete'));
    await waitFor(() => expect(nav.goBack).toHaveBeenCalled());
  });

  it('a failed POD capture surfaces an error and NEVER fakes a local complete', async () => {
    mockClient.captureProofOfDelivery.mockRejectedValueOnce(new Error('no signal'));
    const { getByTestId } = render(<PodScreen route={route} navigation={nav} />);

    fireEvent.press(getByTestId('pod-take-photo'));
    await waitFor(() => getByTestId('pod-photo-preview'));
    fireEvent.press(getByTestId('pod-confirm-signature'));
    await waitFor(() => getByTestId('pod-resign'));
    fireEvent.press(getByTestId('pod-submit'));

    await waitFor(() => expect(mockClient.captureProofOfDelivery).toHaveBeenCalled());
    expect(mockDoStopAction).not.toHaveBeenCalled(); // complete never attempted
    expect(nav.goBack).not.toHaveBeenCalled();
  });
});
