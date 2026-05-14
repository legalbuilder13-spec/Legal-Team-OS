// PRD §9.2 step 3 — snapshot storage. Thin S3-compatible client used
// by the take-snapshot handler. Works with AWS S3, Cloudflare R2,
// MinIO, or any S3-API-compatible bucket; the endpoint URL + region
// + credentials are configurable via env.
//
// Deliberately lazy: the @aws-sdk/* modules are dynamic-imported so
// deployments that don't enable SCREENSHOTS_ENABLED don't pay the
// install cost. If the SDK isn't installed, calls return null and
// the caller falls back to text-level verification.

import { env } from '../env.js';

interface PutSnapshotResult {
  key: string;
  publicUrl: string | null;
  size: number;
}

let _client: unknown = null;
let _modulePromise: Promise<unknown> | null = null;

async function getS3Client() {
  if (_client) return _client;
  if (_modulePromise) return _modulePromise;
  _modulePromise = (async () => {
    try {
      const mod = (await import('@aws-sdk/client-s3')) as unknown as {
        S3Client: new (cfg: Record<string, unknown>) => unknown;
      };
      _client = new mod.S3Client({
        endpoint: env.SNAPSHOTS_S3_ENDPOINT,
        region: env.SNAPSHOTS_S3_REGION,
        credentials:
          env.SNAPSHOTS_S3_ACCESS_KEY_ID && env.SNAPSHOTS_S3_SECRET_ACCESS_KEY
            ? {
                accessKeyId: env.SNAPSHOTS_S3_ACCESS_KEY_ID,
                secretAccessKey: env.SNAPSHOTS_S3_SECRET_ACCESS_KEY,
              }
            : undefined,
        // R2 / MinIO need path-style addressing. AWS S3 prefers virtual-
        // host style; the SDK auto-detects from endpoint so this is safe.
        forcePathStyle: true,
      });
      return _client;
    } catch (err) {
      console.warn('snapshot_storage: @aws-sdk/client-s3 not installed', { err: String(err) });
      return null;
    }
  })();
  return _modulePromise;
}

export async function putSnapshot(
  key: string,
  body: Buffer,
  contentType = 'image/png',
): Promise<PutSnapshotResult | null> {
  if (!env.SNAPSHOTS_BUCKET) {
    console.warn('snapshot_storage: SNAPSHOTS_BUCKET not configured');
    return null;
  }
  const client = await getS3Client();
  if (!client) return null;

  try {
    const sdk = (await import('@aws-sdk/client-s3')) as unknown as {
      PutObjectCommand: new (cfg: Record<string, unknown>) => unknown;
    };
    const cmd = new sdk.PutObjectCommand({
      Bucket: env.SNAPSHOTS_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Snapshots are immutable per-source-row; long cache header helps
      // when the public-base-url path is used directly by the browser.
      CacheControl: 'public, max-age=31536000, immutable',
    });
    await (client as { send: (c: unknown) => Promise<unknown> }).send(cmd);

    const publicUrl = env.SNAPSHOTS_PUBLIC_BASE_URL
      ? `${env.SNAPSHOTS_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`
      : null;

    return { key, publicUrl, size: body.byteLength };
  } catch (err) {
    console.error('snapshot_storage: putSnapshot failed', { key, err: String(err) });
    return null;
  }
}

// Generate a presigned URL for short-lived browser access when the
// bucket isn't publicly readable. Used by the web router so the UI
// can render snapshots without exposing the bucket.
export async function presignSnapshotUrl(key: string, ttlSeconds = 3600): Promise<string | null> {
  if (!env.SNAPSHOTS_BUCKET) return null;
  const client = await getS3Client();
  if (!client) return null;
  try {
    const sdkS3 = (await import('@aws-sdk/client-s3')) as unknown as {
      GetObjectCommand: new (cfg: Record<string, unknown>) => unknown;
    };
    const presigner = (await import('@aws-sdk/s3-request-presigner')) as unknown as {
      getSignedUrl: (
        c: unknown,
        cmd: unknown,
        opts: { expiresIn: number },
      ) => Promise<string>;
    };
    const cmd = new sdkS3.GetObjectCommand({ Bucket: env.SNAPSHOTS_BUCKET, Key: key });
    return await presigner.getSignedUrl(client, cmd, { expiresIn: ttlSeconds });
  } catch (err) {
    console.error('snapshot_storage: presign failed', { key, err: String(err) });
    return null;
  }
}
