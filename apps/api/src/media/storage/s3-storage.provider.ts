import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MEDIA_CONFIG, type MediaConfig } from '../../config/media.config';
import type { ObjectHead, StorageProvider } from './storage-provider';

/**
 * The REAL storage impl — `@aws-sdk/client-s3` + the presigner. One class serves both prod AWS S3
 * (no endpoint) and local/test MinIO (endpoint + path-style). MinIO is a real S3 server, so this
 * exact code path is exercised end-to-end without an AWS account. Presigned PUT signs the content
 * type; presigned GET gives §14 short-lived signed reads; head() verifies a real upload at confirm.
 */
@Injectable()
export class S3StorageProvider implements StorageProvider, OnModuleInit {
  private readonly logger = new Logger(S3StorageProvider.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(MEDIA_CONFIG) private readonly config: MediaConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: config.forcePathStyle } : {}),
      ...(config.accessKeyId && config.secretAccessKey
        ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
        : {}),
    });
  }

  /** Dev/MinIO convenience: create the bucket if missing. Never attempted against prod S3. */
  async onModuleInit(): Promise<void> {
    if (!this.config.ensureBucket) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`created media bucket '${this.bucket}' on ${this.config.endpoint ?? 'aws-s3'}`);
      } catch (err) {
        this.logger.warn(`could not ensure media bucket '${this.bucket}': ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  presignPut(key: string, contentType: string, byteSize: number, ttlSec: number): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      // Signing ContentLength binds the upload to EXACTLY the declared size — S3/MinIO reject a PUT
      // whose Content-Length differs, so an oversize object is rejected AT THE EDGE (not just at confirm).
      ContentLength: byteSize,
      ...(this.config.sse ? { ServerSideEncryption: this.config.sse as 'AES256' } : {}),
    });
    return getSignedUrl(this.client, command, { expiresIn: ttlSec, signableHeaders: new Set(['content-length', 'content-type']) });
  }

  presignGet(key: string, ttlSec: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: ttlSec });
  }

  async head(key: string): Promise<ObjectHead> {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { exists: true, contentType: r.ContentType ?? null, size: r.ContentLength ?? null };
    } catch (err) {
      // S3/MinIO return 404 (NotFound) for a missing object — treat as not-exists; rethrow real errors.
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      const name = (err as { name?: string })?.name;
      if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') {
        return { exists: false, contentType: null, size: null };
      }
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
