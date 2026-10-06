const encoder = new TextEncoder();
const P256 = { name: 'ECDSA', namedCurve: 'P-256' };
const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' };

export function toBase64Url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function fromBase64Url(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) {
    throw new TypeError('Invalid base64url');
  }
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export async function sha256(data) {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

export function randomToken(size = 32) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

// A key's id is a short fingerprint of its public key, so browsers can
// compute it without asking the server.
export async function parsePublicKey(publicKey) {
  try {
    const raw = fromBase64Url(publicKey);
    if (raw.length !== 65 || raw[0] !== 4) return null;
    const key = await crypto.subtle.importKey('raw', raw, P256, false, [
      'verify',
    ]);
    return { id: toBase64Url(await sha256(raw)).slice(0, 16), key };
  } catch {
    return null;
  }
}

export async function verifySignature(key, signature, message) {
  try {
    return await crypto.subtle.verify(
      ECDSA_SHA256,
      key,
      fromBase64Url(signature),
      encoder.encode(message)
    );
  } catch {
    return false;
  }
}

export async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
