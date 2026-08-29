import {
  UploadPartCommand,
  S3Client,
  ListPartsCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Request, Response } from 'express';
import path from 'path';
import { randomStorageName } from '@postsider/nestjs-libraries/upload/storage-key';
import { detectFileType } from '@postsider/nestjs-libraries/upload/detect-file-type';
import {
  maxUploadBytesForMime,
  UPLOAD_MAX_FILE_BYTES,
} from '@postsider/nestjs-libraries/upload/upload.limits';
import {
  classifyMime,
  MediaKind,
} from '@postsider/nestjs-libraries/upload/mime.types';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';

// Keep in sync with the shared MIME allow-list (mime.types.ts): multipart
// uploads are the path used for LARGE files, so omitting webm/mov/mkv/audio
// here rejected formats the rest of the storage layer accepts.
const ALLOWED_EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.weba': 'audio/webm',
};

// S3-compatible multipart uploads require all non-final parts to be at least
// 5 MiB and cap an upload at 10,000 parts. Bound the client-facing part numbers
// from the declared object size before issuing any presigned URLs.
const MULTIPART_MIN_PART_BYTES = 5 * 1024 * 1024;
const MULTIPART_MAX_PARTS = 10_000;
const MULTIPART_SESSION_TTL_MS = 15 * 60 * 1000;
const MULTIPART_MAX_SESSIONS_PER_OWNER = 4;
const MULTIPART_ABORT_RETRY_ATTEMPTS = 3;
const MULTIPART_ABORT_RETRY_DELAY_MS = 30 * 1000;
const MULTIPART_REDIS_PREFIX = 'r2:multipart';

type MultipartUploadSession = {
  key: string;
  uploadId: string;
  organizationId: string;
  actorId: string;
  ownerId: string;
  reservationKey: string;
  slotKey: string;
  declaredSize: number;
  maxPartNumber: number;
  expiresAt: number;
  state: 'active' | 'completing' | 'aborting';
};

type MultipartOwner = {
  organizationId: string;
  actorId: string;
  ownerId: string;
};

function multipartSessionKey(key: string, uploadId: string) {
  return `${MULTIPART_REDIS_PREFIX}:session:${encodeURIComponent(uploadId)}:${encodeURIComponent(key)}`;
}

function multipartOwner(req: Request): MultipartOwner | null {
  const request = req as Request & {
    org?: { id?: unknown };
    user?: { id?: unknown };
  };
  if (typeof request.org?.id !== 'string' || !request.org.id) return null;

  // Public API credentials deliberately have no user identity. Their tenant is
  // still enough to keep another organization from using the upload session.
  const userId =
    typeof request.user?.id === 'string' && request.user.id
      ? request.user.id
      : 'public-api';
  return {
    organizationId: request.org.id,
    actorId: userId,
    ownerId: `${request.org.id}:${userId}`,
  };
}

function multipartSlotKey(ownerId: string, slot: number) {
  return `${MULTIPART_REDIS_PREFIX}:owner:${encodeURIComponent(ownerId)}:slot:${slot}`;
}

function multipartReservationKey() {
  return `${MULTIPART_REDIS_PREFIX}:reservation:${randomStorageName(15)}`;
}

function multipartSessionTtlMs(session: MultipartUploadSession) {
  return Math.max(1, session.expiresAt - Date.now());
}

async function reserveMultipartSlot(ownerId: string, ttlMs: number) {
  const reservationKey = multipartReservationKey();
  for (let slot = 1; slot <= MULTIPART_MAX_SESSIONS_PER_OWNER; slot++) {
    const slotKey = multipartSlotKey(ownerId, slot);
    const reserved = await ioRedis.set(
      slotKey,
      reservationKey,
      'PX',
      ttlMs,
      'NX'
    );
    if (reserved === 'OK') {
      return { reservationKey, slotKey };
    }
  }
  return null;
}

async function releaseMultipartSession(session: MultipartUploadSession) {
  await ioRedis.eval(
    // Only release the slot if it still belongs to this session. A slot can be
    // reused after its TTL, so a get-then-del sequence would race a new upload.
    "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end; redis.call('DEL', KEYS[2]); return 1",
    2,
    session.slotKey,
    multipartSessionKey(session.key, session.uploadId),
    session.reservationKey
  );
}

async function releaseMultipartReservation(
  slotKey: string,
  reservationKey: string
) {
  await ioRedis.eval(
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0",
    1,
    slotKey,
    reservationKey
  );
}

async function saveMultipartSession(session: MultipartUploadSession) {
  const saved = await ioRedis.eval(
    "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3]); return 1",
    2,
    session.slotKey,
    multipartSessionKey(session.key, session.uploadId),
    session.reservationKey,
    JSON.stringify(session),
    String(multipartSessionTtlMs(session))
  );
  return Number(saved) === 1;
}

/**
 * Extends a live session's expiry whenever part activity is seen, so a large
 * upload that takes longer than the base 15 minutes is not killed mid-flight.
 * The owner slot TTL is extended atomically with the same reservation guard,
 * otherwise the cap would silently drop after the first 15 minutes.
 */
async function touchMultipartSession(
  session: MultipartUploadSession
): Promise<boolean> {
  const expiresAt = Date.now() + MULTIPART_SESSION_TTL_MS;
  const touched = await ioRedis.eval(
    "local raw = redis.call('GET', KEYS[1]); if not raw then return 0 end; local session = cjson.decode(raw); if session.state ~= 'active' then return 0 end; if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('PEXPIRE', KEYS[2], ARGV[3]) end; session.expiresAt = tonumber(ARGV[2]); redis.call('SET', KEYS[1], cjson.encode(session), 'PX', ARGV[3]); return 1",
    2,
    multipartSessionKey(session.key, session.uploadId),
    session.slotKey,
    session.reservationKey,
    String(expiresAt),
    String(MULTIPART_SESSION_TTL_MS)
  );
  return Number(touched) === 1;
}

async function loadMultipartSession(
  req: Request,
  key: unknown,
  uploadId: unknown,
  allowedStates: MultipartUploadSession['state'][] = ['active']
): Promise<MultipartUploadSession | null> {
  const owner = multipartOwner(req);
  if (typeof key !== 'string' || typeof uploadId !== 'string' || !owner) {
    return null;
  }

  const raw = await ioRedis.get(multipartSessionKey(key, uploadId));
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as MultipartUploadSession;
    if (
      session.key !== key ||
      session.uploadId !== uploadId ||
      session.organizationId !== owner.organizationId ||
      session.ownerId !== owner.ownerId ||
      !allowedStates.includes(session.state) ||
      session.expiresAt <= Date.now()
    ) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

async function claimMultipartSession(
  req: Request,
  key: unknown,
  uploadId: unknown,
  expectedState: MultipartUploadSession['state'],
  nextState: MultipartUploadSession['state'],
  allowExpired = false
): Promise<MultipartUploadSession | null> {
  const owner = multipartOwner(req);
  if (typeof key !== 'string' || typeof uploadId !== 'string' || !owner) {
    return null;
  }
  return claimMultipartSessionForOwner(
    owner,
    key,
    uploadId,
    expectedState,
    nextState,
    allowExpired
  );
}

async function claimMultipartSessionForOwner(
  owner: MultipartOwner,
  key: string,
  uploadId: string,
  expectedState: MultipartUploadSession['state'],
  nextState: MultipartUploadSession['state'],
  allowExpired: boolean
): Promise<MultipartUploadSession | null> {
  const raw = await ioRedis.eval(
    "local raw = redis.call('GET', KEYS[1]); if not raw then return nil end; local session = cjson.decode(raw); if session.organizationId ~= ARGV[1] or session.ownerId ~= ARGV[2] or session.state ~= ARGV[3] or (ARGV[6] ~= '1' and session.expiresAt <= tonumber(ARGV[4])) then return nil end; session.state = ARGV[5]; redis.call('SET', KEYS[1], cjson.encode(session), 'KEEPTTL'); return cjson.encode(session)",
    1,
    multipartSessionKey(key, uploadId),
    owner.organizationId,
    owner.ownerId,
    expectedState,
    String(Date.now()),
    nextState,
    allowExpired ? '1' : '0'
  );
  if (!raw) return null;

  try {
    return JSON.parse(raw as string) as MultipartUploadSession;
  } catch {
    return null;
  }
}

function retryDelay(attempt: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, attempt * 100);
  });
}

async function abortR2MultipartUpload(session: MultipartUploadSession) {
  for (let attempt = 1; attempt <= MULTIPART_ABORT_RETRY_ATTEMPTS; attempt++) {
    try {
      await R2.send(
        new AbortMultipartUploadCommand({
          Bucket: CLOUDFLARE_BUCKETNAME,
          Key: session.key,
          UploadId: session.uploadId,
        })
      );
      return true;
    } catch (err) {
      if (attempt === MULTIPART_ABORT_RETRY_ATTEMPTS) {
        console.error('Unable to abort multipart upload', err);
        break;
      }
      await retryDelay(attempt);
    }
  }
  return false;
}

function scheduleAbortRetry(session: MultipartUploadSession) {
  const timer = setTimeout(async () => {
    const raw = await ioRedis.get(
      multipartSessionKey(session.key, session.uploadId)
    );
    if (!raw) return;
    try {
      const current = JSON.parse(raw) as MultipartUploadSession;
      if (current.state !== 'aborting' || current.expiresAt <= Date.now()) return;
      if (await abortR2MultipartUpload(current)) {
        await releaseMultipartSession(current);
      } else {
        scheduleAbortRetry(current);
      }
    } catch (err) {
      console.error('Unable to retry multipart upload abort', err);
    }
  }, MULTIPART_ABORT_RETRY_DELAY_MS);
  timer.unref?.();
}

async function abortMultipartSession(session: MultipartUploadSession) {
  if (await abortR2MultipartUpload(session)) {
    await releaseMultipartSession(session);
    return true;
  }
  scheduleAbortRetry(session);
  return false;
}

function scheduleMultipartExpiry(session: MultipartUploadSession) {
  const timer = setTimeout(async () => {
    const raw = await ioRedis.get(
      multipartSessionKey(session.key, session.uploadId)
    );
    if (!raw) return;
    try {
      const current = JSON.parse(raw) as MultipartUploadSession;
      if (current.state !== 'active') return;

      // Part activity may have extended the session past this timer's firing
      // time. Only abort when the session is genuinely stale — otherwise re-arm
      // for the new expiry instead of killing an upload that is still moving.
      // Compared against the schedule-time expiry because this timer fires one
      // millisecond early to win the race with the Redis key TTL.
      if (current.expiresAt > session.expiresAt) {
        scheduleMultipartExpiry(current);
        return;
      }

      const claimed = await claimMultipartSessionForOwner(
        {
          organizationId: current.organizationId,
          actorId: current.actorId,
          ownerId: current.ownerId,
        },
        current.key,
        current.uploadId,
        'active',
        'aborting',
        true
      );
      if (claimed) await abortMultipartSession(claimed);
      // Claim while the Redis key is still valid; a timer that fires at exactly
      // the key TTL can otherwise race Redis expiry and lose the R2 abort.
    } catch (err) {
      console.error('Unable to expire multipart upload session', err);
    }
  }, Math.max(0, multipartSessionTtlMs(session) - 1));
  timer.unref?.();
}

function isValidPartNumber(
  value: unknown,
  maxPartNumber: number
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= maxPartNumber
  );
}

function validPreparedPartNumbers(
  parts: unknown,
  maxPartNumber: number
): number[] | null {
  if (
    !Array.isArray(parts) ||
    parts.length === 0 ||
    parts.length > maxPartNumber
  ) {
    return null;
  }

  const numbers = parts.map((part) => (part as { number?: unknown })?.number);
  if (
    numbers.some((number) => !isValidPartNumber(number, maxPartNumber)) ||
    new Set(numbers).size !== numbers.length
  ) {
    return null;
  }
  return numbers as number[];
}

function hasValidCompletedParts(
  parts: unknown,
  maxPartNumber: number
): boolean {
  if (
    !Array.isArray(parts) ||
    parts.length === 0 ||
    parts.length > maxPartNumber
  ) {
    return false;
  }

  let previousPartNumber = 0;
  return parts.every((part) => {
    const completedPart = part as { PartNumber?: unknown; ETag?: unknown };
    const partNumber = completedPart?.PartNumber;
    if (
      !isValidPartNumber(partNumber, maxPartNumber) ||
      typeof completedPart?.ETag !== 'string' ||
      !completedPart.ETag ||
      partNumber <= previousPartNumber
    ) {
      return false;
    }
    previousPartNumber = partNumber;
    return true;
  });
}

async function deleteCompletedObject(key: string) {
  try {
    await R2.send(
      new DeleteObjectCommand({ Bucket: CLOUDFLARE_BUCKETNAME, Key: key })
    );
  } catch (err) {
    console.error('Unable to remove rejected multipart upload', err);
  }
}

function normalizeExtension(filename: string): string | null {
  const ext = path.extname(filename || '').toLowerCase();
  return ALLOWED_EXT_TO_MIME[ext] ? ext : null;
}

export function parseMultipartUploadSize(
  value: unknown,
  maxBytes = UPLOAD_MAX_FILE_BYTES
): number | null {
  const size =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : NaN;

  return Number.isSafeInteger(size) && size >= 0 && size <= maxBytes
    ? size
    : null;
}

export function multipartUploadSizeMatches(
  declaredSize: unknown,
  actualSize: unknown,
  maxBytes = UPLOAD_MAX_FILE_BYTES
): boolean {
  const declared = parseMultipartUploadSize(declaredSize, maxBytes);
  return declared !== null && declared === actualSize;
}

export type CompletedR2MultipartUpload = {
  response: Record<string, unknown>;
  key: string;
  location: string;
  originalName?: string;
  type: MediaKind;
  size: number;
};

type CompleteR2MultipartUpload = (
  upload: CompletedR2MultipartUpload
) => Promise<unknown>;

const {
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_ACCESS_KEY,
  CLOUDFLARE_SECRET_ACCESS_KEY,
  CLOUDFLARE_BUCKETNAME,
  CLOUDFLARE_BUCKET_URL,
} = process.env;

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: CLOUDFLARE_ACCESS_KEY!,
    secretAccessKey: CLOUDFLARE_SECRET_ACCESS_KEY!,
  },
});

// Function to generate a random string
function generateRandomString() {
  return randomStorageName(15);
}

export default async function handleR2Upload(
  endpoint: string,
  req: Request,
  res: Response,
  onComplete?: CompleteR2MultipartUpload
) {
  switch (endpoint) {
    case 'create-multipart-upload':
      return createMultipartUpload(req, res);
    case 'prepare-upload-parts':
      return prepareUploadParts(req, res);
    case 'complete-multipart-upload':
      return completeMultipartUpload(req, res, onComplete);
    case 'list-parts':
      return listParts(req, res);
    case 'abort-multipart-upload':
      return abortMultipartUpload(req, res);
    case 'sign-part':
      return signPart(req, res);
  }
  return res.status(404).end();
}

export async function simpleUpload(
  data: Buffer,
  originalFilename: string,
  _contentType: string
) {
  const detected = await detectFileType(data);
  if (
    !detected ||
    !Object.values(ALLOWED_EXT_TO_MIME).includes(detected.mime)
  ) {
    throw new Error('Unsupported file type.');
  }
  if (data.byteLength > maxUploadBytesForMime(detected.mime)) {
    throw new Error('File too large.');
  }
  const fileExtension = `.${detected.ext}`;
  const safeContentType = detected.mime;
  const randomFilename = generateRandomString() + fileExtension;

  const params = {
    Bucket: CLOUDFLARE_BUCKETNAME,
    Key: randomFilename,
    Body: data,
    ContentType: safeContentType,
  };

  const command = new PutObjectCommand({ ...params });
  await R2.send(command);

  return CLOUDFLARE_BUCKET_URL + '/' + randomFilename;
}

export async function createMultipartUpload(req: Request, res: Response) {
  const { file, fileHash } = req.body;
  const owner = multipartOwner(req);
  if (!owner) {
    return res.status(403).json({ message: 'Upload session not authorized.' });
  }
  const safeExt = normalizeExtension(file?.name || '');
  if (!safeExt) {
    return res.status(400).json({ message: 'Unsupported file type.' });
  }
  const safeContentType = ALLOWED_EXT_TO_MIME[safeExt];
  const declaredSize = parseMultipartUploadSize(
    file?.size,
    maxUploadBytesForMime(safeContentType)
  );
  if (declaredSize === null || declaredSize === 0) {
    return res.status(400).json({ message: 'Invalid file size.' });
  }
  const randomFilename = generateRandomString() + safeExt;
  const expiresAt = Date.now() + MULTIPART_SESSION_TTL_MS;

  let reservation: { reservationKey: string; slotKey: string } | null = null;
  try {
    // SET ... NX reserves a fixed owner slot atomically, before R2 receives a
    // create request. Concurrent processes therefore cannot exceed the cap.
    reservation = await reserveMultipartSlot(
      owner.ownerId,
      Math.max(1, expiresAt - Date.now())
    );
    if (!reservation) {
      return res.status(429).json({ message: 'Too many active uploads.' });
    }

    const params = {
      Bucket: CLOUDFLARE_BUCKETNAME,
      Key: `${randomFilename}`,
      ContentType: safeContentType,
      Metadata: {
        'x-amz-meta-file-hash': fileHash,
        'declared-size': String(declaredSize),
        'original-name': path.basename(file?.name || 'upload').slice(0, 255),
      },
    };

    const command = new CreateMultipartUploadCommand({ ...params });
    const response = await R2.send(command);
    if (
      typeof response.UploadId !== 'string' ||
      typeof response.Key !== 'string'
    ) {
      await releaseMultipartReservation(
        reservation.slotKey,
        reservation.reservationKey
      );
      return res.status(500).json({ source: { status: 500 } });
    }
    const session: MultipartUploadSession = {
      key: response.Key,
      uploadId: response.UploadId,
      organizationId: owner.organizationId,
      actorId: owner.actorId,
      ownerId: owner.ownerId,
      reservationKey: reservation.reservationKey,
      slotKey: reservation.slotKey,
      declaredSize,
      maxPartNumber: Math.min(
        MULTIPART_MAX_PARTS,
        Math.max(1, Math.ceil(declaredSize / MULTIPART_MIN_PART_BYTES))
      ),
      expiresAt,
      state: 'active',
    };
    if (!(await saveMultipartSession(session))) {
      await abortMultipartSession(session);
      return res.status(500).json({ source: { status: 500 } });
    }
    scheduleMultipartExpiry(session);
    return res.status(200).json({
      uploadId: response.UploadId,
      key: response.Key,
    });
  } catch (err) {
    if (reservation) {
      await releaseMultipartReservation(
        reservation.slotKey,
        reservation.reservationKey
      );
    }
    console.log('Error', err);
    return res.status(500).json({ source: { status: 500 } });
  }
}

export async function prepareUploadParts(req: Request, res: Response) {
  const { partData } = req.body;
  const session = await loadMultipartSession(
    req,
    partData?.key,
    partData?.uploadId
  );
  if (!session) {
    return res.status(403).json({ message: 'Upload session not authorized.' });
  }
  const partNumbers = validPreparedPartNumbers(
    partData?.parts,
    session.maxPartNumber
  );
  if (!partNumbers) {
    return res.status(400).json({ message: 'Invalid upload parts.' });
  }
  await touchMultipartSession(session);

  const response = {
    presignedUrls: {},
  };

  for (const partNumber of partNumbers) {
    try {
      const params = {
        Bucket: CLOUDFLARE_BUCKETNAME,
        Key: session.key,
        PartNumber: partNumber,
        UploadId: session.uploadId,
      };
      const command = new UploadPartCommand({ ...params });
      const url = await getSignedUrl(R2, command, { expiresIn: 900 });

      // @ts-ignore
      response.presignedUrls[partNumber] = url;
    } catch (err) {
      console.log('Error', err);
      return res.status(500).json(err);
    }
  }

  return res.status(200).json(response);
}

export async function listParts(req: Request, res: Response) {
  const { key, uploadId } = req.body;
  const session = await loadMultipartSession(req, key, uploadId);
  if (!session) {
    return res.status(403).json({ message: 'Upload session not authorized.' });
  }
  await touchMultipartSession(session);

  try {
    const params = {
      Bucket: CLOUDFLARE_BUCKETNAME,
      Key: session.key,
      UploadId: session.uploadId,
    };
    const command = new ListPartsCommand({ ...params });
    const response = await R2.send(command);

    return res.status(200).json(response['Parts']);
  } catch (err) {
    console.log('Error', err);
    return res.status(500).json(err);
  }
}

export async function completeMultipartUpload(
  req: Request,
  res: Response,
  onComplete?: CompleteR2MultipartUpload
) {
  const { key, uploadId, parts } = req.body;
  const session = await loadMultipartSession(req, key, uploadId);
  if (!session) {
    return res.status(403).json({ message: 'Upload session not authorized.' });
  }
  if (!hasValidCompletedParts(parts, session.maxPartNumber)) {
    const aborting = await claimMultipartSession(
      req,
      key,
      uploadId,
      'active',
      'aborting'
    );
    if (aborting) await abortMultipartSession(aborting);
    return res.status(400).json({ message: 'Invalid upload parts.' });
  }

  const completing = await claimMultipartSession(
    req,
    key,
    uploadId,
    'active',
    'completing'
  );
  if (!completing) {
    return res.status(403).json({ message: 'Upload session not authorized.' });
  }
  let completionAttempted = false;
  let completedObject = false;
  let verified = false;

  try {
    const command = new CompleteMultipartUploadCommand({
      Bucket: CLOUDFLARE_BUCKETNAME,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    });
    completionAttempted = true;
    const response = await R2.send(command);
    completedObject = true;

    const safeExt = normalizeExtension(key || '');
    if (!safeExt) {
      return res.status(400).json({ message: 'Unsupported file type.' });
    }
    const expectedMime = ALLOWED_EXT_TO_MIME[safeExt];
    const maxSize = maxUploadBytesForMime(expectedMime);

    // R2, not the client, supplies the final byte count. Delete mismatches so a
    // presigned part URL cannot be used to exceed or misrepresent the upload.
    const object = await R2.send(
      new HeadObjectCommand({
        Bucket: CLOUDFLARE_BUCKETNAME,
        Key: key,
      })
    );
    if (
      !multipartUploadSizeMatches(
        session.declaredSize,
        object.ContentLength,
        maxSize
      ) ||
      object.Metadata?.['declared-size'] !== String(session.declaredSize)
    ) {
      return res
        .status(400)
        .json({ message: 'File size does not match upload.' });
    }

    const head = await R2.send(
      new GetObjectCommand({
        Bucket: CLOUDFLARE_BUCKETNAME,
        Key: key,
        Range: 'bytes=0-4100',
      })
    );
    const chunks: Buffer[] = [];
    // @ts-ignore
    for await (const chunk of head.Body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const prefix = Buffer.concat(chunks);
    const detected = await detectFileType(prefix);

    if (!detected || detected.mime !== expectedMime) {
      return res
        .status(400)
        .json({ message: 'File contents do not match declared type.' });
    }

    const completed = {
      ...response,
      Location: `${process.env.CLOUDFLARE_BUCKET_URL}/${key}`,
    };
    let body: unknown = completed;
    if (onComplete) {
      try {
        body = await onComplete({
          response: completed,
          key,
          location: completed.Location,
          originalName: object.Metadata?.['original-name'],
          type: classifyMime(expectedMime),
          size: object.ContentLength!,
        });
      } catch (error) {
        throw error;
      }
    }
    verified = true;
    return res.status(200).json(body);
  } catch (err) {
    console.log('Error', err);
    return res.status(500).json(err);
  } finally {
    if (verified) {
      await releaseMultipartSession(completing);
    } else {
      if (completionAttempted) {
        await deleteCompletedObject(completing.key);
      }
      if (!completedObject) {
        const aborting = await claimMultipartSession(
          req,
          key,
          uploadId,
          'completing',
          'aborting'
        );
        if (aborting) await abortMultipartSession(aborting);
      } else {
        await releaseMultipartSession(completing);
      }
    }
  }
}

export async function abortMultipartUpload(req: Request, res: Response) {
  const { key, uploadId } = req.body;
  const session =
    (await claimMultipartSession(req, key, uploadId, 'active', 'aborting')) ||
    (await claimMultipartSession(req, key, uploadId, 'aborting', 'aborting'));
  if (!session) {
    return res.status(403).json({ message: 'Upload session not authorized.' });
  }

  try {
    if (await abortMultipartSession(session)) {
      return res.status(200).json({});
    }
    return res.status(500).json({ message: 'Unable to abort multipart upload.' });
  } catch (err) {
    console.error('Unable to abort multipart upload', err);
    return res.status(500).json({ message: 'Unable to abort multipart upload.' });
  }
}

export async function signPart(req: Request, res: Response) {
  const { key, uploadId } = req.body;
  const session = await loadMultipartSession(req, key, uploadId);
  if (!session) {
    return res.status(403).json({ message: 'Upload session not authorized.' });
  }
  const partNumber = Number(req.body.partNumber);
  if (!isValidPartNumber(partNumber, session.maxPartNumber)) {
    return res.status(400).json({ message: 'Invalid upload part.' });
  }
  await touchMultipartSession(session);

  const params = {
    Bucket: CLOUDFLARE_BUCKETNAME,
    Key: session.key,
    PartNumber: partNumber,
    UploadId: session.uploadId,
  };

  const command = new UploadPartCommand({ ...params });
  const url = await getSignedUrl(R2, command, { expiresIn: 900 });

  return res.status(200).json({
    url: url,
  });
}
