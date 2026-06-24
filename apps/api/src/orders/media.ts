/**
 * Media object-reference validation (PRD §8.3/§12.1, A4 photos).
 *
 * Increment-3 deferral (documented): the binary upload pipeline (presigned S3/MinIO
 * PUT) lands in the dedicated storage increment. Until then, photo routes register a
 * reference to an object ALREADY uploaded to our configured object store — never a
 * fabricated/placeholder URL. We validate it is an HTTPS URL on an allow-listed media
 * origin (the configured S3 bucket / CDN) with a non-empty object path, then persist
 * the real reference. No mock storage client, no fake URLs.
 */

import { BadRequestException, Injectable } from '@nestjs/common';
import { ORDER_ERRORS } from '@blue-bee/shared';

export interface MediaConfig {
  allowedOrigins: string[];
}

/** Build the allow-list from env: explicit origins + the configured S3 bucket + optional CDN. */
export function resolveMediaConfig(env: NodeJS.ProcessEnv = process.env): MediaConfig {
  const origins = new Set<string>();
  for (const o of (env.MEDIA_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    origins.add(o);
  }
  const bucket = env.S3_BUCKET?.trim();
  const region = env.AWS_REGION?.trim();
  if (bucket && region) {
    origins.add(`https://${bucket}.s3.${region}.amazonaws.com`);
  }
  const cdn = env.MEDIA_CDN_ORIGIN?.trim();
  if (cdn) origins.add(cdn);
  return { allowedOrigins: [...origins] };
}

export type MediaUrlResult = { ok: true; url: string } | { ok: false; reason: string };

/** Validate that `url` points at an already-hosted object on an allow-listed media origin. */
export function validateMediaUrl(url: string, cfg: MediaConfig): MediaUrlResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'media URL must be https' };
  if (!parsed.pathname || parsed.pathname === '/') {
    return { ok: false, reason: 'media URL must reference an object path' };
  }
  if (cfg.allowedOrigins.length === 0) {
    return { ok: false, reason: 'no media origins configured (set MEDIA_ALLOWED_ORIGINS or S3_BUCKET+AWS_REGION)' };
  }
  if (!cfg.allowedOrigins.includes(parsed.origin)) {
    return { ok: false, reason: `origin ${parsed.origin} is not in the media allow-list` };
  }
  return { ok: true, url: parsed.toString() };
}

/**
 * Injectable wrapper — resolves the allow-list once at construction and validates
 * caller-supplied object references, throwing 400 problem+json on a bad URL.
 */
@Injectable()
export class MediaService {
  private readonly config: MediaConfig = resolveMediaConfig();

  get allowedOrigins(): string[] {
    return this.config.allowedOrigins;
  }

  /** Validate + normalize a media URL, or throw 400 (`invalid_media_url`). */
  requireValidUrl(url: string): string {
    const result = validateMediaUrl(url, this.config);
    if (!result.ok) {
      throw new BadRequestException({ error: ORDER_ERRORS.INVALID_MEDIA_URL, message: result.reason });
    }
    return result.url;
  }
}
