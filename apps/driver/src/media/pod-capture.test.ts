import * as FileSystem from 'expo-file-system';
import * as Location from 'expo-location';
import { capturePod, oneShotGeo, pickDeliveryPhoto, PodCaptureError, signatureToAsset, type PickedAsset } from './pod-capture';

jest.setTimeout(30000); // jest-expo cold start on the external drive can exceed the 5s default

const MiB = 1024 * 1024;

/** A stub driver ApiClient — only the two POD methods the capture pipeline touches. */
function stubClient() {
  return {
    presignPodMedia: jest.fn(async (_stopId: string, dto: { contentType: string; byteSize: number }) => ({
      uploadUrl: `https://minio.local/put?ct=${dto.contentType}`,
      storageKey: dto.contentType === 'image/png' ? 'org/o/pod/sig.png' : 'org/o/pod/photo.jpg',
      contentType: dto.contentType,
      expiresInSec: 600,
      maxBytes: 15 * MiB,
    })),
    captureProofOfDelivery: jest.fn(async (stopId: string, dto: unknown) => ({ id: 'pod-1', routeStopId: stopId, capturedAt: 'now', capturedBy: 'u', geo: null, signature: null, photos: [], __dto: dto })),
  };
}

const PHOTO: PickedAsset = { uri: 'file:///pod-photo.jpg', contentType: 'image/jpeg', byteSize: 2048 };

beforeEach(() => {
  jest.clearAllMocks();
  (FileSystem.uploadAsync as jest.Mock).mockResolvedValue({ status: 200, body: '' });
  (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size: 1500 });
});

describe('capturePod — the real media round-trip pipeline', () => {
  it('uploads the photo + signature (real bytes) then POSTs the POD with the keys + geo', async () => {
    const client = stubClient();
    const view = await capturePod(client as never, 'stop-1', { photo: PHOTO, signatureBase64: 'data:image/png;base64,AAAA', geo: { lng: -79.41, lat: 43.76 } });

    // presigned once per object, with the right content types
    expect(client.presignPodMedia).toHaveBeenCalledTimes(2);
    expect(client.presignPodMedia).toHaveBeenCalledWith('stop-1', expect.objectContaining({ contentType: 'image/jpeg' }));
    expect(client.presignPodMedia).toHaveBeenCalledWith('stop-1', expect.objectContaining({ contentType: 'image/png' }));
    // real PUTs (one per object) + the signature written to a real file first
    expect(FileSystem.uploadAsync).toHaveBeenCalledTimes(2);
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledTimes(1);
    // the POD POST references the CONFIRMED keys (never a raw client URL) + the geo
    expect(client.captureProofOfDelivery).toHaveBeenCalledWith('stop-1', {
      signatureStorageKey: 'org/o/pod/sig.png',
      photoStorageKeys: ['org/o/pod/photo.jpg'],
      geo: { lng: -79.41, lat: 43.76 },
    });
    expect(view.id).toBe('pod-1');
  });

  it('omits geo when the device has no fix', async () => {
    const client = stubClient();
    await capturePod(client as never, 'stop-1', { photo: PHOTO, signatureBase64: 'AAAA', geo: null });
    expect(client.captureProofOfDelivery).toHaveBeenCalledWith('stop-1', expect.not.objectContaining({ geo: expect.anything() }));
  });

  it('rejects an oversize photo BEFORE presigning (fails fast)', async () => {
    const client = stubClient();
    await expect(capturePod(client as never, 'stop-1', { photo: { ...PHOTO, byteSize: 20 * MiB }, signatureBase64: 'AAAA', geo: null })).rejects.toBeInstanceOf(PodCaptureError);
    expect(client.presignPodMedia).not.toHaveBeenCalled();
  });

  it('surfaces an upload failure (no POD POST on a failed PUT)', async () => {
    const client = stubClient();
    (FileSystem.uploadAsync as jest.Mock).mockResolvedValueOnce({ status: 500, body: 'err' });
    await expect(capturePod(client as never, 'stop-1', { photo: PHOTO, signatureBase64: 'AAAA', geo: null })).rejects.toBeInstanceOf(PodCaptureError);
    expect(client.captureProofOfDelivery).not.toHaveBeenCalled();
  });
});

describe('oneShotGeo', () => {
  it('returns {lng,lat} when foreground permission is granted', async () => {
    const geo = await oneShotGeo();
    expect(geo).toEqual({ lng: -79.4111, lat: 43.7615 });
  });

  it('returns null (tolerated) when permission is denied', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'denied' });
    expect(await oneShotGeo()).toBeNull();
  });
});

describe('pickDeliveryPhoto / signatureToAsset', () => {
  it('opens the camera and returns the picked asset', async () => {
    const asset = await pickDeliveryPhoto();
    expect(asset).toEqual({ uri: 'file:///pod-photo.jpg', contentType: 'image/jpeg', byteSize: 2048 });
  });

  it('writes a drawn signature to a real PNG file asset', async () => {
    const asset = await signatureToAsset('data:image/png;base64,iVBORw0KGgo');
    expect(asset.contentType).toBe('image/png');
    expect(asset.byteSize).toBe(1500);
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(expect.stringContaining('pod-signature-'), 'iVBORw0KGgo', { encoding: 'base64' });
  });
});
