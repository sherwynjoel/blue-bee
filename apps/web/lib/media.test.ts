import { PhotoKind } from '@blue-bee/shared';
import { uploadPhoto, MediaError } from './media';
import type { ConsoleApiClient } from './api-client';

function fileOf(type: string, size: number): File {
  return new File([new Uint8Array(size)], 'x', { type });
}

function mockClient(over: Partial<Record<string, jest.Mock>> = {}): ConsoleApiClient {
  return {
    presignMedia: jest.fn(async () => ({ uploadUrl: 'https://minio/put?sig=1', storageKey: 'org/x/INTAKE/u.jpg', contentType: 'image/jpeg', expiresInSec: 600, maxBytes: 1_000_000 })),
    confirmMedia: jest.fn(async () => ({ id: 'photo-1', kind: PhotoKind.INTAKE, downloadUrl: 'https://minio/get?sig=1' })),
    ...over,
  } as unknown as ConsoleApiClient;
}

describe('uploadPhoto (web /media presign → PUT real bytes → confirm)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects a non-allow-listed type BEFORE presigning', async () => {
    const client = mockClient();
    await expect(uploadPhoto(client, { orderId: 'o', kind: PhotoKind.INTAKE, file: fileOf('text/plain', 10) })).rejects.toThrow(MediaError);
    expect(client.presignMedia).not.toHaveBeenCalled();
  });

  it('presigns, PUTs the real bytes with the signed Content-Type, then confirms', async () => {
    const putSpy = jest.fn(async (_url: string, _init: RequestInit) => ({ ok: true, status: 200 }) as unknown as Response);
    global.fetch = putSpy as unknown as typeof fetch;
    const client = mockClient();
    const res = await uploadPhoto(client, { orderId: 'o1', itemId: 'i1', kind: PhotoKind.INTAKE, file: fileOf('image/jpeg', 500) });
    expect(client.presignMedia).toHaveBeenCalledWith({ orderId: 'o1', itemId: 'i1', kind: PhotoKind.INTAKE, contentType: 'image/jpeg', byteSize: 500 });
    const [url, init] = putSpy.mock.calls[0]!;
    expect(url).toBe('https://minio/put?sig=1');
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(client.confirmMedia).toHaveBeenCalledWith(expect.objectContaining({ storageKey: 'org/x/INTAKE/u.jpg' }));
    expect(res.id).toBe('photo-1');
  });

  it('rejects a file larger than the server max BEFORE the PUT', async () => {
    const client = mockClient({ presignMedia: jest.fn(async () => ({ uploadUrl: 'u', storageKey: 'k', contentType: 'image/jpeg', expiresInSec: 600, maxBytes: 100 })) });
    global.fetch = jest.fn() as unknown as typeof fetch;
    await expect(uploadPhoto(client, { orderId: 'o', kind: PhotoKind.INTAKE, file: fileOf('image/jpeg', 5000) })).rejects.toThrow(/too large/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('surfaces a failed PUT (never confirms a non-uploaded object)', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 403 }) as unknown as Response) as unknown as typeof fetch;
    const client = mockClient();
    await expect(uploadPhoto(client, { orderId: 'o', kind: PhotoKind.INTAKE, file: fileOf('image/jpeg', 10) })).rejects.toThrow(/Upload failed/);
    expect(client.confirmMedia).not.toHaveBeenCalled();
  });
});
