// Vault / App Lock: Face ID / Touch ID / fingerprint through a device passkey (WebAuthn platform
// authenticator, checked entirely in the browser), with a PIN as fallback. Nothing leaves the device.
import { getSetting, setSetting } from '../db/db';

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return b64(d);
}

// ------------------------------------------------------------------ PIN

export async function hasPin(): Promise<boolean> {
  return !!(await getSetting<string>('lock_pin_hash', ''));
}

export async function setPin(pin: string): Promise<void> {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  await setSetting('lock_pin_salt', salt);
  await setSetting('lock_pin_hash', await sha256(`${salt}:${pin}`));
}

export async function checkPin(pin: string): Promise<boolean> {
  const salt = await getSetting<string>('lock_pin_salt', '');
  const hash = await getSetting<string>('lock_pin_hash', '');
  if (!hash) return false;
  return (await sha256(`${salt}:${pin}`)) === hash;
}

export async function clearPin(): Promise<void> {
  await setSetting('lock_pin_hash', '');
  await setSetting('lock_pin_salt', '');
}

// ------------------------------------------------------------------ passkey (biometrics)

export async function isBiometricAvailable(): Promise<boolean> {
  try {
    return (
      !!window.PublicKeyCredential &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

export async function hasPasskey(): Promise<boolean> {
  return !!(await getSetting<string>('lock_passkey_id', ''));
}

export async function createPasskey(): Promise<void> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Phantom Scanner' },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: 'Phantom Scanner lock',
        displayName: 'Phantom Scanner lock',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged',
      },
      timeout: 60000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Face ID / fingerprint setup was cancelled');
  await setSetting('lock_passkey_id', b64(cred.rawId));
}

export async function verifyPasskey(): Promise<boolean> {
  const id = await getSetting<string>('lock_passkey_id', '');
  if (!id) return false;
  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: unb64(id) as BufferSource }],
        userVerification: 'required',
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;
    if (!assertion) return false;
    const flags = new Uint8Array((assertion.response as AuthenticatorAssertionResponse).authenticatorData)[32];
    // bit 0 = user present, bit 2 = user verified (Face ID / Touch ID / device PIN)
    return (flags & 0x05) === 0x05;
  } catch {
    return false;
  }
}

export async function clearPasskey(): Promise<void> {
  await setSetting('lock_passkey_id', '');
}

export async function isLockConfigured(): Promise<boolean> {
  return (await hasPin()) || (await hasPasskey());
}
