import crypto from 'crypto';

const HANDSHAKE_TTL_MS = 2 * 60 * 1000;
const REQUEST_TTL_MS = 2 * 60 * 1000;
const FUTURE_SKEW_MS = 30 * 1000;
const AES_KEY_BYTES = 32;
const HMAC_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const MAX_SEEN_REQUEST_IDS = 2048;

type RequestContext = {
  ip: string;
  userAgent: string;
};

type HandshakeRecord = RequestContext & {
  id: string;
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
  challenge: string;
  expiresAt: number;
};

type SecureSessionRecord = {
  id: string;
  username: string;
  encryptionKey: Buffer;
  signingKey: Buffer;
  expiresAt: number;
  lastIncomingSequenceByChannel: Map<string, number>;
  outgoingSequenceByChannel: Map<string, number>;
  seenRequestIds: Map<string, number>;
};

export type SecureSessionMaterial = {
  id: string;
  username: string;
  encryptionKey: string;
  signingKey: string;
  expiresAt: number;
};

export type HandshakePayload = {
  challenge?: unknown;
  timestamp?: unknown;
  requestId?: unknown;
};

export type SecureHandshakeResponse = {
  keyCiphertext: string;
  iv: string;
  ciphertext: string;
};

export type SecureEnvelope = {
  secure: true;
  sessionId: string;
  channel: string;
  sequence: number;
  requestId: string;
  timestamp: number;
  iv: string;
  ciphertext: string;
  signature: string;
};

export class SecureChannelError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'SecureChannelError';
  }
}

export class SecureChannelService {
  private readonly handshakes = new Map<string, HandshakeRecord>();
  private readonly sessions = new Map<string, SecureSessionRecord>();

  constructor(private readonly sessionTtlMs: number) {}

  createHandshake(context: RequestContext) {
    this.cleanupExpired();

    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicExponent: 0x10001,
    });
    const id = crypto.randomUUID();
    const challenge = randomToken(32);
    const expiresAt = Date.now() + HANDSHAKE_TTL_MS;

    this.handshakes.set(id, {
      id,
      publicKey,
      privateKey,
      challenge,
      expiresAt,
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return {
      id,
      challenge,
      expiresAt,
      publicKeyJwk: publicKey.export({ format: 'jwk' }),
      algorithms: {
        keyExchange: 'RSA-OAEP-2048-SHA-256',
        requestEncryption: 'AES-256-GCM',
        sessionEncryption: 'AES-256-GCM',
        signature: 'HMAC-SHA-256',
      },
    };
  }

  decryptHandshakePayload<T extends HandshakePayload>(
    body: unknown,
    expectedPurpose: 'login' | 'session',
    context: RequestContext
  ): T {
    this.cleanupExpired();

    const request = normalizeHandshakeRequest(body);
    if (request.purpose !== expectedPurpose) {
      throw new SecureChannelError('Invalid secure request purpose');
    }

    const handshake = this.handshakes.get(request.handshakeId);
    if (!handshake) {
      throw new SecureChannelError('Secure handshake expired or not found', 401);
    }

    if (handshake.expiresAt <= Date.now()) {
      this.handshakes.delete(handshake.id);
      throw new SecureChannelError('Secure handshake expired', 401);
    }

    if (handshake.ip !== context.ip || handshake.userAgent !== context.userAgent) {
      this.handshakes.delete(handshake.id);
      throw new SecureChannelError('Secure handshake context mismatch', 401);
    }

    try {
      const contentKey = crypto.privateDecrypt(
        {
          key: handshake.privateKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        fromBase64Url(request.keyCiphertext)
      );

      if (contentKey.length !== AES_KEY_BYTES) {
        throw new Error('Invalid handshake content key');
      }

      const plaintext = decryptAesGcm(
        contentKey,
        request.iv,
        request.ciphertext,
        handshakeAad(request.handshakeId, request.purpose, request.iv)
      );
      const payload = JSON.parse(plaintext.toString('utf-8')) as T;
      validateHandshakePayload(payload, handshake);
      this.handshakes.delete(handshake.id);
      return payload;
    } catch (error) {
      this.handshakes.delete(handshake.id);
      if (error instanceof SecureChannelError) {
        throw error;
      }
      throw new SecureChannelError('Invalid encrypted secure request', 400);
    }
  }

  createSession(username: string): SecureSessionMaterial {
    this.cleanupExpired();

    const session: SecureSessionRecord = {
      id: crypto.randomUUID(),
      username,
      encryptionKey: crypto.randomBytes(AES_KEY_BYTES),
      signingKey: crypto.randomBytes(HMAC_KEY_BYTES),
      expiresAt: Date.now() + this.sessionTtlMs,
      lastIncomingSequenceByChannel: new Map(),
      outgoingSequenceByChannel: new Map(),
      seenRequestIds: new Map(),
    };

    this.sessions.set(session.id, session);
    return serializeSession(session);
  }

  deleteSession(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  encryptHandshakeResponse(
    clientPublicKeyJwk: unknown,
    payload: unknown
  ): SecureHandshakeResponse {
    const publicKey = crypto.createPublicKey({
      key: clientPublicKeyJwk as crypto.JsonWebKey,
      format: 'jwk',
    });
    const contentKey = crypto.randomBytes(AES_KEY_BYTES);
    const iv = crypto.randomBytes(GCM_IV_BYTES).toString('base64url');
    const keyCiphertext = crypto
      .publicEncrypt(
        {
          key: publicKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        contentKey
      )
      .toString('base64url');
    const ciphertext = encryptAesGcm(
      contentKey,
      iv,
      Buffer.from(JSON.stringify(payload), 'utf-8'),
      handshakeResponseAad(iv)
    );

    return {
      keyCiphertext,
      iv,
      ciphertext,
    };
  }

  decryptEnvelope<T>(
    envelope: unknown,
    options: {
      channel: string;
      username?: string;
      sessionId?: string;
    }
  ): { payload: T; session: SecureSessionMaterial } {
    this.cleanupExpired();

    const normalized = normalizeSecureEnvelope(envelope);
    if (normalized.channel !== options.channel) {
      throw new SecureChannelError('Invalid secure channel');
    }
    if (options.sessionId && normalized.sessionId !== options.sessionId) {
      throw new SecureChannelError('Secure session mismatch', 401);
    }

    const session = this.sessions.get(normalized.sessionId);
    if (!session) {
      throw new SecureChannelError('Secure session expired or not found', 401);
    }
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(session.id);
      throw new SecureChannelError('Secure session expired', 401);
    }
    if (options.username && session.username !== options.username) {
      throw new SecureChannelError('Secure session user mismatch', 401);
    }

    validateTimestamp(normalized.timestamp);
    cleanupSeenRequestIds(session);

    const lastSequence = session.lastIncomingSequenceByChannel.get(normalized.channel) ?? 0;
    if (normalized.sequence <= lastSequence) {
      throw new SecureChannelError('Secure message replay detected', 401);
    }
    if (session.seenRequestIds.has(normalized.requestId)) {
      throw new SecureChannelError('Secure request replay detected', 401);
    }

    const aad = envelopeAad(normalized);
    const expectedSignature = signEnvelope(session.signingKey, aad, normalized.ciphertext);
    if (!safeEqual(normalized.signature, expectedSignature)) {
      throw new SecureChannelError('Invalid secure message signature', 401);
    }

    try {
      const plaintext = decryptAesGcm(
        session.encryptionKey,
        normalized.iv,
        normalized.ciphertext,
        aad
      );
      session.lastIncomingSequenceByChannel.set(normalized.channel, normalized.sequence);
      session.seenRequestIds.set(normalized.requestId, normalized.timestamp + REQUEST_TTL_MS);
      trimSeenRequestIds(session);
      return {
        payload: JSON.parse(plaintext.toString('utf-8')) as T,
        session: serializeSession(session),
      };
    } catch {
      throw new SecureChannelError('Invalid encrypted secure message', 400);
    }
  }

  encryptEnvelope(sessionId: string, channel: string, payload: unknown): SecureEnvelope {
    this.cleanupExpired();

    const session = this.sessions.get(sessionId);
    if (!session || session.expiresAt <= Date.now()) {
      if (session) this.sessions.delete(session.id);
      throw new SecureChannelError('Secure session expired or not found', 401);
    }

    const sequence = (session.outgoingSequenceByChannel.get(channel) ?? 0) + 1;
    session.outgoingSequenceByChannel.set(channel, sequence);

    const base = {
      secure: true as const,
      sessionId,
      channel,
      sequence,
      requestId: crypto.randomUUID(),
      timestamp: Date.now(),
      iv: crypto.randomBytes(GCM_IV_BYTES).toString('base64url'),
    };
    const aad = envelopeAad(base);
    const ciphertext = encryptAesGcm(
      session.encryptionKey,
      base.iv,
      Buffer.from(JSON.stringify(payload), 'utf-8'),
      aad
    );

    return {
      ...base,
      ciphertext,
      signature: signEnvelope(session.signingKey, aad, ciphertext),
    };
  }

  private cleanupExpired() {
    const now = Date.now();

    for (const [id, handshake] of this.handshakes.entries()) {
      if (handshake.expiresAt <= now) {
        this.handshakes.delete(id);
      }
    }

    for (const [id, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        this.sessions.delete(id);
      } else {
        cleanupSeenRequestIds(session);
      }
    }
  }
}

function normalizeHandshakeRequest(value: unknown) {
  if (!value || typeof value !== 'object') {
    throw new SecureChannelError('Secure request body is required');
  }

  const item = value as Record<string, unknown>;
  const purpose = item.purpose;
  if (purpose !== 'login' && purpose !== 'session') {
    throw new SecureChannelError('Invalid secure request purpose');
  }

  return {
    handshakeId: readSafeString(item, 'handshakeId'),
    purpose,
    keyCiphertext: readSafeString(item, 'keyCiphertext'),
    iv: readSafeString(item, 'iv'),
    ciphertext: readSafeString(item, 'ciphertext'),
  };
}

function normalizeSecureEnvelope(value: unknown): SecureEnvelope {
  if (!value || typeof value !== 'object') {
    throw new SecureChannelError('Secure envelope is required');
  }

  const item = value as Record<string, unknown>;
  if (item.secure !== true) {
    throw new SecureChannelError('Secure envelope marker is required');
  }

  const sequence = item.sequence;
  const timestamp = item.timestamp;
  if (
    typeof sequence !== 'number' ||
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    typeof timestamp !== 'number' ||
    !Number.isInteger(timestamp)
  ) {
    throw new SecureChannelError('Invalid secure envelope metadata');
  }

  return {
    secure: true,
    sessionId: readSafeString(item, 'sessionId'),
    channel: readSafeString(item, 'channel'),
    sequence,
    requestId: readSafeString(item, 'requestId'),
    timestamp,
    iv: readSafeString(item, 'iv'),
    ciphertext: readSafeString(item, 'ciphertext'),
    signature: readSafeString(item, 'signature'),
  };
}

function validateHandshakePayload(payload: HandshakePayload, handshake: HandshakeRecord) {
  if (!payload || typeof payload !== 'object') {
    throw new SecureChannelError('Invalid secure payload');
  }
  if (payload.challenge !== handshake.challenge) {
    throw new SecureChannelError('Secure challenge mismatch', 401);
  }
  if (typeof payload.requestId !== 'string' || payload.requestId.length > 128) {
    throw new SecureChannelError('Invalid secure request id');
  }
  if (typeof payload.timestamp !== 'number' || !Number.isInteger(payload.timestamp)) {
    throw new SecureChannelError('Invalid secure request timestamp');
  }
  validateTimestamp(payload.timestamp);
}

function validateTimestamp(timestamp: number) {
  const now = Date.now();
  if (timestamp > now + FUTURE_SKEW_MS || timestamp < now - REQUEST_TTL_MS) {
    throw new SecureChannelError('Secure request expired', 401);
  }
}

function encryptAesGcm(key: Buffer, ivValue: string, plaintext: Buffer, aad: Buffer) {
  const iv = fromBase64Url(ivValue);
  if (iv.length !== GCM_IV_BYTES) {
    throw new SecureChannelError('Invalid secure IV');
  }

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64url');
}

function decryptAesGcm(key: Buffer, ivValue: string, ciphertextValue: string, aad: Buffer) {
  const iv = fromBase64Url(ivValue);
  const ciphertext = fromBase64Url(ciphertextValue);
  if (iv.length !== GCM_IV_BYTES || ciphertext.length <= GCM_TAG_BYTES) {
    throw new SecureChannelError('Invalid secure ciphertext');
  }

  const data = ciphertext.subarray(0, ciphertext.length - GCM_TAG_BYTES);
  const tag = ciphertext.subarray(ciphertext.length - GCM_TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function handshakeAad(handshakeId: string, purpose: string, iv: string) {
  return Buffer.from(JSON.stringify({ v: 1, type: 'handshake', handshakeId, purpose, iv }), 'utf-8');
}

function handshakeResponseAad(iv: string) {
  return Buffer.from(JSON.stringify({ v: 1, type: 'handshake-response', iv }), 'utf-8');
}

function envelopeAad(envelope: Omit<SecureEnvelope, 'ciphertext' | 'signature'>) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      sessionId: envelope.sessionId,
      channel: envelope.channel,
      sequence: envelope.sequence,
      requestId: envelope.requestId,
      timestamp: envelope.timestamp,
      iv: envelope.iv,
    }),
    'utf-8'
  );
}

function signEnvelope(key: Buffer, aad: Buffer, ciphertext: string) {
  return crypto
    .createHmac('sha256', key)
    .update(aad)
    .update('.')
    .update(ciphertext)
    .digest('base64url');
}

function serializeSession(session: SecureSessionRecord): SecureSessionMaterial {
  return {
    id: session.id,
    username: session.username,
    encryptionKey: session.encryptionKey.toString('base64url'),
    signingKey: session.signingKey.toString('base64url'),
    expiresAt: session.expiresAt,
  };
}

function cleanupSeenRequestIds(session: SecureSessionRecord) {
  const now = Date.now();
  for (const [requestId, expiresAt] of session.seenRequestIds.entries()) {
    if (expiresAt <= now) {
      session.seenRequestIds.delete(requestId);
    }
  }
}

function trimSeenRequestIds(session: SecureSessionRecord) {
  while (session.seenRequestIds.size > MAX_SEEN_REQUEST_IDS) {
    const first = session.seenRequestIds.keys().next().value as string | undefined;
    if (!first) return;
    session.seenRequestIds.delete(first);
  }
}

function randomToken(bytes: number) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function fromBase64Url(value: string) {
  return Buffer.from(value, 'base64url');
}

function readSafeString(item: Record<string, unknown>, key: string) {
  const value = item[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192) {
    throw new SecureChannelError(`Invalid secure field "${key}"`);
  }
  return value;
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
