import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import type { MediaResult, PhotoKind } from '@blue-bee/shared';
import type { CustomerApiClient } from '../api/customer-client';
import { contentTypeForUri, validateMedia } from './constants';

export class MediaCaptureError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MediaCaptureError';
  }
}

export type CaptureSource = 'camera' | 'library';

export interface CaptureTarget {
  orderId: string;
  itemId?: string;
  kind: PhotoKind;
}

/** A picked asset, normalized (uri + content type + byte size). Exported for testing the upload step. */
export interface PickedAsset {
  uri: string;
  contentType: string;
  byteSize: number;
}

/** Launch the camera or library and return the picked asset, or null if the user cancelled. */
export async function pickAsset(source: CaptureSource): Promise<PickedAsset | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new MediaCaptureError('permission_denied', 'Camera permission is required to take a photo.');
  } else {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) throw new MediaCaptureError('permission_denied', 'Photo library permission is required.');
  }

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });

  if (result.canceled || !result.assets || result.assets.length === 0) return null;
  const asset = result.assets[0]!;
  const contentType = asset.mimeType ?? contentTypeForUri(asset.uri);
  // Prefer the picker's fileSize; fall back to a real stat of the file on disk.
  let byteSize = asset.fileSize ?? 0;
  if (!byteSize) {
    const info = await FileSystem.getInfoAsync(asset.uri, { size: true });
    byteSize = info.exists && 'size' in info ? (info.size as number) : 0;
  }
  return { uri: asset.uri, contentType, byteSize };
}

/**
 * The full before/after capture flow against the customer's OWN order (Increment 10 path):
 *   pick (camera/library) → validate content-type + size client-side (match the server allow-list) →
 *   POST /v1/media/presign → PUT the REAL bytes to the presigned URL (Content-Type signed in) →
 *   POST /v1/media/confirm → the persisted MediaResult (with a fresh signed downloadUrl).
 * Returns null if the user cancelled the picker.
 */
export async function capturePhotoToOrder(
  client: CustomerApiClient,
  target: CaptureTarget,
  source: CaptureSource,
): Promise<MediaResult | null> {
  const asset = await pickAsset(source);
  if (!asset) return null;

  const localError = validateMedia(asset.contentType, asset.byteSize);
  if (localError) throw new MediaCaptureError(localError.code, localError.message);

  const presign = await client.presignMedia({
    orderId: target.orderId,
    itemId: target.itemId,
    kind: target.kind,
    contentType: asset.contentType,
    byteSize: asset.byteSize,
  });

  // Defense in depth: re-check against the server's authoritative max (a deployment may have lowered it).
  const serverError = validateMedia(asset.contentType, asset.byteSize, presign.maxBytes);
  if (serverError) throw new MediaCaptureError(serverError.code, serverError.message);

  await putBytes(asset.uri, presign.uploadUrl, presign.contentType);

  return client.confirmMedia({ storageKey: presign.storageKey, takenAt: new Date().toISOString() });
}

/**
 * PUT the file's REAL bytes to the presigned URL via expo-file-system's binary upload. The
 * Content-Type must match what was presigned (it's signed into the URL); Content-Length is set from
 * the actual file bytes by the upload layer, so a truthful declared byteSize at presign matches.
 */
export async function putBytes(uri: string, uploadUrl: string, contentType: string): Promise<void> {
  const res = await FileSystem.uploadAsync(uploadUrl, uri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { 'Content-Type': contentType },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new MediaCaptureError('upload_failed', `Upload failed (HTTP ${res.status}).`);
  }
}
