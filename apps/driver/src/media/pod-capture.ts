import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as Location from 'expo-location';
import type { GeoPoint, ProofOfDeliveryView } from '@blue-bee/shared';
import type { ApiClient } from '../api/client';

/**
 * The driver proof-of-delivery capture pipeline (Increment 17) — the REAL Increment-10 media path,
 * stop-scoped: take a delivery photo + draw a signature, upload BOTH as real object bytes (presign →
 * PUT → the POD endpoint head-verifies), capture the device geo, then POST the POD. No mock camera/
 * signature/storage in this shipped code — the on-device camera + signature pad + GPS are real; only
 * tests mock the native bridge. The §5.4 complete stays server-authoritative (driven by the screen
 * AFTER a successful POST), never faked locally.
 */
export class PodCaptureError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PodCaptureError';
  }
}

export interface PickedAsset {
  uri: string;
  contentType: string;
  byteSize: number;
}

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

function contentTypeForUri(uri: string, fallback = 'image/jpeg'): string {
  const ext = uri.split('?')[0]?.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return fallback;
}

/** Client-side mirror of the server allow-list + max (fail fast before presign; the PUT is signed anyway). */
function validate(contentType: string, byteSize: number, maxBytes = 15 * 1024 * 1024): { code: string; message: string } | null {
  if (!byteSize || byteSize <= 0) return { code: 'empty', message: 'The capture is empty.' };
  if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType.toLowerCase())) {
    return { code: 'unsupported_content_type', message: `Unsupported type "${contentType}".` };
  }
  if (byteSize > maxBytes) return { code: 'too_large', message: `Capture is too large (max ${(maxBytes / 1024 / 1024).toFixed(0)} MiB).` };
  return null;
}

async function fileByteSize(uri: string, picked?: number): Promise<number> {
  if (picked && picked > 0) return picked;
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  return info.exists && 'size' in info ? (info.size as number) : 0;
}

/** Open the camera and return the delivery photo asset (or null if cancelled). Real camera on device. */
export async function pickDeliveryPhoto(): Promise<PickedAsset | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new PodCaptureError('permission_denied', 'Camera permission is required for the delivery photo.');
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
  if (result.canceled || !result.assets || result.assets.length === 0) return null;
  const asset = result.assets[0]!;
  const contentType = asset.mimeType ?? contentTypeForUri(asset.uri);
  return { uri: asset.uri, contentType, byteSize: await fileByteSize(asset.uri, asset.fileSize ?? undefined) };
}

/** A drawn signature (base64 PNG from the signature pad) → a real PNG file asset for upload. */
export async function signatureToAsset(base64Png: string): Promise<PickedAsset> {
  const clean = base64Png.replace(/^data:image\/\w+;base64,/, '');
  const uri = `${FileSystem.cacheDirectory ?? ''}pod-signature-${clean.length}.png`;
  await FileSystem.writeAsStringAsync(uri, clean, { encoding: FileSystem.EncodingType.Base64 });
  const byteSize = (await fileByteSize(uri)) || Math.floor((clean.length * 3) / 4);
  return { uri, contentType: 'image/png', byteSize };
}

/** PUT the asset's REAL bytes to the presigned URL (Content-Type signed in; Content-Length from the file). */
async function putBytes(uri: string, uploadUrl: string, contentType: string): Promise<void> {
  const res = await FileSystem.uploadAsync(uploadUrl, uri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { 'Content-Type': contentType },
  });
  if (res.status < 200 || res.status >= 300) throw new PodCaptureError('upload_failed', `Upload failed (HTTP ${res.status}).`);
}

/** Presign + PUT one POD object (photo or signature) for the stop → its confirmed storage key. */
async function uploadPodObject(client: ApiClient, stopId: string, asset: PickedAsset): Promise<string> {
  const local = validate(asset.contentType, asset.byteSize);
  if (local) throw new PodCaptureError(local.code, local.message);
  const pre = await client.presignPodMedia(stopId, { contentType: asset.contentType, byteSize: asset.byteSize });
  const server = validate(asset.contentType, asset.byteSize, pre.maxBytes); // defense in depth (deployment may lower the max)
  if (server) throw new PodCaptureError(server.code, server.message);
  await putBytes(asset.uri, pre.uploadUrl, pre.contentType);
  return pre.storageKey;
}

/** One-shot FOREGROUND geo for the POD; tolerates denial/failure (geo is optional, never blocks capture). */
export async function oneShotGeo(): Promise<GeoPoint | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lng: pos.coords.longitude, lat: pos.coords.latitude };
  } catch {
    return null;
  }
}

/**
 * Capture proof of delivery: upload the photo + signature (real bytes) then POST the POD for the stop.
 * Idempotent server-side (unique routeStopId); a retry after a partial failure is safe. Returns the
 * captured POD view (signed reads). The caller drives the §5.4 `complete` AFTER this resolves.
 */
export async function capturePod(
  client: ApiClient,
  stopId: string,
  input: { photo: PickedAsset; signatureBase64: string; geo: GeoPoint | null },
): Promise<ProofOfDeliveryView> {
  const photoStorageKey = await uploadPodObject(client, stopId, input.photo);
  const signatureStorageKey = await uploadPodObject(client, stopId, await signatureToAsset(input.signatureBase64));
  return client.captureProofOfDelivery(stopId, {
    signatureStorageKey,
    photoStorageKeys: [photoStorageKey],
    ...(input.geo ? { geo: input.geo } : {}),
  });
}
