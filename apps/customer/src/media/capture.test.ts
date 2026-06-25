import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { PhotoKind } from '@blue-bee/shared';
import type { CustomerApiClient } from '../api/customer-client';
import { capturePhotoToOrder, MediaCaptureError } from './capture';
import { contentTypeForUri, validateMedia } from './constants';

function fakeClient(over: Partial<Record<'presignMedia' | 'confirmMedia', jest.Mock>> = {}) {
  const presignMedia =
    over.presignMedia ??
    jest.fn(async () => ({ uploadUrl: 'https://minio/put', storageKey: 'org/x/before/abc.jpg', contentType: 'image/jpeg', expiresInSec: 300, maxBytes: 15 * 1024 * 1024 }));
  const confirmMedia =
    over.confirmMedia ??
    jest.fn(async () => ({ id: 'photo-1', kind: PhotoKind.BEFORE, storageKey: 'org/x/before/abc.jpg', contentType: 'image/jpeg', sizeBytes: 1234, downloadUrl: 'https://minio/get?sig=1', orderId: 'o1', itemId: 'i1', takenAt: 't', createdAt: 'c' }));
  return { presignMedia, confirmMedia } as unknown as CustomerApiClient & { presignMedia: jest.Mock; confirmMedia: jest.Mock };
}

describe('media validation', () => {
  it('accepts the allow-listed types under the max', () => {
    expect(validateMedia('image/jpeg', 1000)).toBeNull();
    expect(validateMedia('image/png', 1000)).toBeNull();
    expect(validateMedia('application/pdf', 1000)).toBeNull();
  });
  it('rejects an unsupported type, an empty file, and an oversize file', () => {
    expect(validateMedia('image/gif', 1000)?.code).toBe('unsupported_content_type');
    expect(validateMedia('image/jpeg', 0)?.code).toBe('empty');
    expect(validateMedia('image/jpeg', 100, 50)?.code).toBe('too_large');
  });
  it('infers content type from a uri', () => {
    expect(contentTypeForUri('file:///x/a.PNG')).toBe('image/png');
    expect(contentTypeForUri('file:///x/a.webp')).toBe('image/webp');
    expect(contentTypeForUri('file:///x/a.unknown')).toBe('image/jpeg');
  });
});

describe('capturePhotoToOrder (pick → presign → PUT real bytes → confirm)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('runs the full flow and returns the confirmed MediaResult', async () => {
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///tmp/x.jpg', mimeType: 'image/jpeg', fileSize: 2048 }],
    });
    const client = fakeClient();
    const result = await capturePhotoToOrder(client, { orderId: 'o1', itemId: 'i1', kind: PhotoKind.BEFORE }, 'camera');

    expect(client.presignMedia).toHaveBeenCalledWith({ orderId: 'o1', itemId: 'i1', kind: PhotoKind.BEFORE, contentType: 'image/jpeg', byteSize: 2048 });
    // PUT the REAL bytes to the presigned URL with the signed Content-Type.
    expect(FileSystem.uploadAsync).toHaveBeenCalledWith(
      'https://minio/put',
      'file:///tmp/x.jpg',
      expect.objectContaining({ httpMethod: 'PUT', headers: { 'Content-Type': 'image/jpeg' } }),
    );
    expect(client.confirmMedia).toHaveBeenCalledWith(expect.objectContaining({ storageKey: 'org/x/before/abc.jpg' }));
    expect(result?.downloadUrl).toBe('https://minio/get?sig=1');
  });

  it('returns null when the user cancels (no presign/upload)', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({ canceled: true, assets: null });
    const client = fakeClient();
    const result = await capturePhotoToOrder(client, { orderId: 'o1', kind: PhotoKind.AFTER }, 'library');
    expect(result).toBeNull();
    expect(client.presignMedia).not.toHaveBeenCalled();
  });

  it('rejects a non-allow-listed type BEFORE presign (client-side allow-list match)', async () => {
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///tmp/x.gif', mimeType: 'image/gif', fileSize: 2048 }],
    });
    const client = fakeClient();
    await expect(capturePhotoToOrder(client, { orderId: 'o1', kind: PhotoKind.BEFORE }, 'camera')).rejects.toBeInstanceOf(MediaCaptureError);
    expect(client.presignMedia).not.toHaveBeenCalled();
  });

  it('honours the presign response maxBytes (server authority) and does NOT confirm', async () => {
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///tmp/big.jpg', mimeType: 'image/jpeg', fileSize: 10_000_000 }],
    });
    const client = fakeClient({
      presignMedia: jest.fn(async () => ({ uploadUrl: 'u', storageKey: 'k', contentType: 'image/jpeg', expiresInSec: 300, maxBytes: 5_000_000 })),
    });
    await expect(capturePhotoToOrder(client, { orderId: 'o1', kind: PhotoKind.BEFORE }, 'camera')).rejects.toMatchObject({ code: 'too_large' });
    expect(client.confirmMedia).not.toHaveBeenCalled();
    expect(FileSystem.uploadAsync).not.toHaveBeenCalled();
  });

  it('throws when the PUT upload fails (non-2xx)', async () => {
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///tmp/x.jpg', mimeType: 'image/jpeg', fileSize: 2048 }],
    });
    (FileSystem.uploadAsync as jest.Mock).mockResolvedValueOnce({ status: 403, body: 'denied' });
    const client = fakeClient();
    await expect(capturePhotoToOrder(client, { orderId: 'o1', kind: PhotoKind.BEFORE }, 'camera')).rejects.toMatchObject({ code: 'upload_failed' });
    expect(client.confirmMedia).not.toHaveBeenCalled();
  });
});
