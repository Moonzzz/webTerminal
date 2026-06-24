const REQUEST_TTL_MS = 2 * 60 * 1000;
const FUTURE_SKEW_MS = 30 * 1000;
const GCM_IV_BYTES = 12;

type HandshakeResponse = {
  id: string;
  challenge: string;
  expiresAt: number;
  publicKeyJwk: JsonWebKey;
};

type SecureHandshakeResponse = {
  keyCiphertext: string;
  iv: string;
  ciphertext: string;
};

type SecureSessionResponse = {
  ok: true;
  username: string;
  secureSession: {
    id: string;
    username: string;
    encryptionKey: string;
    signingKey: string;
    expiresAt: number;
  };
};

export type SecureSession = SecureSessionResponse['secureSession'] & {
  sequences: Record<string, number>;
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

export async function secureLogin(username: string, password: string) {
  clearSecureSession();
  return openSecureSession('login', { username, password });
}

export async function ensureSecureSession() {
  clearSecureSession();
  return openSecureSession('session', {});
}

export function clearSecureSession() {
  try {
    window.sessionStorage.removeItem('webTerminal-secure-session');
  } catch {}
}

export async function encryptSecurePayload(
  session: SecureSession,
  channel: string,
  payload: unknown
): Promise<SecureEnvelope> {
  assertWebCrypto();

  const sequence = (session.sequences[channel] ?? 0) + 1;
  session.sequences[channel] = sequence;

  const ivBytes = window.crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const base = {
    secure: true as const,
    sessionId: session.id,
    channel,
    sequence,
    requestId: randomRequestId(),
    timestamp: Date.now(),
    iv: toBase64Url(ivBytes),
  };
  const aad = envelopeAad(base);
  const encryptionKey = await importAesKey(session.encryptionKey, ['encrypt']);
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes,
      additionalData: aad,
    },
    encryptionKey,
    textBytes(JSON.stringify(payload))
  );
  const ciphertext = toBase64Url(new Uint8Array(encrypted));

  return {
    ...base,
    ciphertext,
    signature: await signEnvelope(session.signingKey, aad, ciphertext),
  };
}

export async function decryptSecurePayload<T>(
  session: SecureSession,
  envelope: unknown,
  expectedChannel: string,
  lastSequence = 0
): Promise<{ payload: T; sequence: number }> {
  assertWebCrypto();

  const normalized = normalizeEnvelope(envelope);
  if (normalized.sessionId !== session.id || normalized.channel !== expectedChannel) {
    throw new Error('安全通道响应不匹配');
  }
  if (normalized.sequence <= lastSequence) {
    throw new Error('检测到重复的安全通道响应');
  }
  validateTimestamp(normalized.timestamp);

  const aad = envelopeAad(normalized);
  const valid = await verifyEnvelope(
    session.signingKey,
    aad,
    normalized.ciphertext,
    normalized.signature
  );
  if (!valid) {
    throw new Error('安全通道响应签名无效');
  }

  const encryptionKey = await importAesKey(session.encryptionKey, ['decrypt']);
  const plaintext = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64Url(normalized.iv),
      additionalData: aad,
    },
    encryptionKey,
    fromBase64Url(normalized.ciphertext)
  );

  return {
    payload: JSON.parse(new TextDecoder().decode(plaintext)) as T,
    sequence: normalized.sequence,
  };
}

async function openSecureSession(purpose: 'login' | 'session', payload: Record<string, unknown>) {
  assertWebCrypto();

  const handshake = await fetchHandshake();
  const serverPublicKey = await window.crypto.subtle.importKey(
    'jwk',
    handshake.publicKeyJwk,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    false,
    ['encrypt']
  );
  const clientKeys = (await window.crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt']
  )) as CryptoKeyPair;
  const clientPublicKeyJwk = await window.crypto.subtle.exportKey('jwk', clientKeys.publicKey);
  const requestBody = await encryptHandshakePayload(handshake, serverPublicKey, purpose, {
    ...payload,
    clientPublicKeyJwk,
  });

  const response = await fetch(purpose === 'login' ? '/api/auth/login' : '/api/crypto/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify(requestBody),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : '安全认证失败');
  }

  const decrypted = await decryptHandshakeResponse<SecureSessionResponse>(
    clientKeys.privateKey,
    data.secure
  );
  const session: SecureSession = {
    ...decrypted.secureSession,
    sequences: {},
  };
  return session;
}

async function fetchHandshake(): Promise<HandshakeResponse> {
  const response = await fetch('/api/crypto/handshake', {
    method: 'POST',
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : '安全握手失败');
  }

  return data as HandshakeResponse;
}

async function encryptHandshakePayload(
  handshake: HandshakeResponse,
  serverPublicKey: CryptoKey,
  purpose: 'login' | 'session',
  payload: Record<string, unknown>
) {
  const contentKey = await window.crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt']
  );
  const rawContentKey = await window.crypto.subtle.exportKey('raw', contentKey);
  const ivBytes = window.crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const iv = toBase64Url(ivBytes);
  const keyCiphertext = toBase64Url(
    new Uint8Array(
      await window.crypto.subtle.encrypt(
        {
          name: 'RSA-OAEP',
        },
        serverPublicKey,
        rawContentKey
      )
    )
  );
  const plaintext = {
    ...payload,
    challenge: handshake.challenge,
    timestamp: Date.now(),
    requestId: randomRequestId(),
  };
  const ciphertext = toBase64Url(
    new Uint8Array(
      await window.crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: ivBytes,
          additionalData: handshakeAad(handshake.id, purpose, iv),
        },
        contentKey,
        textBytes(JSON.stringify(plaintext))
      )
    )
  );

  return {
    handshakeId: handshake.id,
    purpose,
    keyCiphertext,
    iv,
    ciphertext,
  };
}

async function decryptHandshakeResponse<T>(
  privateKey: CryptoKey,
  response: unknown
): Promise<T> {
  if (!response || typeof response !== 'object') {
    throw new Error('安全认证响应缺失');
  }

  const item = response as Record<string, unknown>;
  const keyCiphertext = readString(item, 'keyCiphertext');
  const iv = readString(item, 'iv');
  const ciphertext = readString(item, 'ciphertext');
  const rawContentKey = await window.crypto.subtle.decrypt(
    {
      name: 'RSA-OAEP',
    },
    privateKey,
    fromBase64Url(keyCiphertext)
  );
  const contentKey = await window.crypto.subtle.importKey(
    'raw',
    rawContentKey,
    {
      name: 'AES-GCM',
    },
    false,
    ['decrypt']
  );
  const plaintext = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64Url(iv),
      additionalData: handshakeResponseAad(iv),
    },
    contentKey,
    fromBase64Url(ciphertext)
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

async function importAesKey(rawKey: string, usages: KeyUsage[]) {
  return window.crypto.subtle.importKey(
    'raw',
    fromBase64Url(rawKey),
    {
      name: 'AES-GCM',
    },
    false,
    usages
  );
}

async function importHmacKey(rawKey: string, usages: KeyUsage[]) {
  return window.crypto.subtle.importKey(
    'raw',
    fromBase64Url(rawKey),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    usages
  );
}

async function signEnvelope(rawKey: string, aad: Uint8Array, ciphertext: string) {
  const key = await importHmacKey(rawKey, ['sign']);
  const signature = await window.crypto.subtle.sign(
    'HMAC',
    key,
    concatBytes(aad, textBytes('.'), textBytes(ciphertext))
  );
  return toBase64Url(new Uint8Array(signature));
}

async function verifyEnvelope(
  rawKey: string,
  aad: Uint8Array,
  ciphertext: string,
  signature: string
) {
  const key = await importHmacKey(rawKey, ['verify']);
  return window.crypto.subtle.verify(
    'HMAC',
    key,
    fromBase64Url(signature),
    concatBytes(aad, textBytes('.'), textBytes(ciphertext))
  );
}

function normalizeEnvelope(value: unknown): SecureEnvelope {
  if (!value || typeof value !== 'object') {
    throw new Error('安全通道响应格式错误');
  }

  const item = value as Record<string, unknown>;
  if (item.secure !== true) {
    throw new Error('安全通道响应缺少标记');
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
    throw new Error('安全通道响应元数据无效');
  }

  return {
    secure: true,
    sessionId: readString(item, 'sessionId'),
    channel: readString(item, 'channel'),
    sequence,
    requestId: readString(item, 'requestId'),
    timestamp,
    iv: readString(item, 'iv'),
    ciphertext: readString(item, 'ciphertext'),
    signature: readString(item, 'signature'),
  };
}

function validateTimestamp(timestamp: number) {
  const now = Date.now();
  if (timestamp > now + FUTURE_SKEW_MS || timestamp < now - REQUEST_TTL_MS) {
    throw new Error('安全通道响应已过期');
  }
}

function handshakeAad(handshakeId: string, purpose: string, iv: string) {
  return textBytes(JSON.stringify({ v: 1, type: 'handshake', handshakeId, purpose, iv }));
}

function handshakeResponseAad(iv: string) {
  return textBytes(JSON.stringify({ v: 1, type: 'handshake-response', iv }));
}

function envelopeAad(envelope: Omit<SecureEnvelope, 'ciphertext' | 'signature'>) {
  return textBytes(
    JSON.stringify({
      v: 1,
      sessionId: envelope.sessionId,
      channel: envelope.channel,
      sequence: envelope.sequence,
      requestId: envelope.requestId,
      timestamp: envelope.timestamp,
      iv: envelope.iv,
    })
  );
}

function assertWebCrypto() {
  if (!window.crypto?.subtle) {
    throw new Error('当前浏览器环境不支持 Web Crypto 安全通道');
  }
}

function randomRequestId() {
  if (window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return toBase64Url(window.crypto.getRandomValues(new Uint8Array(16)));
}

function readString(item: Record<string, unknown>, key: string) {
  const value = item[key];
  if (typeof value !== 'string' || !value) {
    throw new Error(`安全通道字段无效：${key}`);
  }
  return value;
}

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function concatBytes(...items: Uint8Array[]) {
  const size = items.reduce((total, item) => total + item.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const item of items) {
    output.set(item, offset);
    offset += item.length;
  }
  return output;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    Math.ceil(value.length / 4) * 4,
    '='
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
