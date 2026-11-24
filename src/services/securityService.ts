export interface SecurityLockConfig {
  pinEnabled: boolean;
  pinLength: number;
  pinSalt: string;
  pinHash: string;
  biometricEnabled: boolean;
  biometricCredentialId: string;
  lockBeforeLogin: boolean;
  autoLockMinutes: number;
  failedAttempts: number;
  lockedUntilTs: number;
}

const SECURITY_KEY = 'fintrack-security-lock-v1';
export const SECURITY_EVENT = 'fintrack-security-updated';

export const DEFAULT_SECURITY_CONFIG: SecurityLockConfig = {
  pinEnabled: false,
  pinLength: 4,
  pinSalt: '',
  pinHash: '',
  biometricEnabled: false,
  biometricCredentialId: '',
  lockBeforeLogin: true,
  autoLockMinutes: 5,
  failedAttempts: 0,
  lockedUntilTs: 0,
};

export function loadSecurityConfig(): SecurityLockConfig {
  if (typeof window === 'undefined') return DEFAULT_SECURITY_CONFIG;
  try {
    const raw = window.localStorage.getItem(SECURITY_KEY);
    if (!raw) return DEFAULT_SECURITY_CONFIG;
    const parsed = JSON.parse(raw) as Partial<SecurityLockConfig>;
    return {
      ...DEFAULT_SECURITY_CONFIG,
      ...parsed,
      pinLength: Math.min(6, Math.max(4, Number(parsed.pinLength) || 4)),
      failedAttempts: Number(parsed.failedAttempts) || 0,
      lockedUntilTs: Number(parsed.lockedUntilTs) || 0,
    };
  } catch {
    return DEFAULT_SECURITY_CONFIG;
  }
}

export function saveSecurityConfig(config: SecurityLockConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SECURITY_KEY, JSON.stringify(config));
    window.dispatchEvent(new Event(SECURITY_EVENT));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearSecurityConfig(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SECURITY_KEY);
  window.dispatchEvent(new Event(SECURITY_EVENT));
}

export function isAppSecurityConfigured(cfg: SecurityLockConfig): boolean {
  return Boolean(
    (cfg.pinEnabled && cfg.pinHash) || (cfg.biometricEnabled && cfg.biometricCredentialId)
  );
}

function randomBytes(length = 16): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function hashPinWithSalt(pin: string, salt: string): Promise<string> {
  const payload = `${salt}:fintrack-pin-v1:${pin}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return toBase64Url(new Uint8Array(digest));
  }
  // Fallback deterministic mixing when SubtleCrypto is unavailable
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch + i), 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16)}_${(h2 >>> 0).toString(16)}`;
}

export async function enablePinLock(pin: string): Promise<SecurityLockConfig> {
  const clean = pin.trim();
  if (!/^\d{4,6}$/.test(clean)) {
    throw new Error('PIN must be 4 to 6 digits.');
  }
  const salt = toBase64Url(randomBytes(16));
  const hash = await hashPinWithSalt(clean, salt);
  const current = loadSecurityConfig();
  const next: SecurityLockConfig = {
    ...current,
    pinEnabled: true,
    pinLength: clean.length,
    pinSalt: salt,
    pinHash: hash,
    lockBeforeLogin: true,
    failedAttempts: 0,
    lockedUntilTs: 0,
  };
  saveSecurityConfig(next);
  return next;
}

export function disablePinLock(): SecurityLockConfig {
  const current = loadSecurityConfig();
  const next: SecurityLockConfig = {
    ...current,
    pinEnabled: false,
    pinSalt: '',
    pinHash: '',
    failedAttempts: 0,
    lockedUntilTs: 0,
  };
  saveSecurityConfig(next);
  return next;
}

export async function verifyPinInput(
  pin: string
): Promise<{ ok: boolean; remainingAttempts: number; cooldownSeconds: number; message?: string }> {
  const cfg = loadSecurityConfig();
  if (!cfg.pinEnabled || !cfg.pinHash) {
    return { ok: true, remainingAttempts: 5, cooldownSeconds: 0 };
  }

  const now = Date.now();
  if (cfg.lockedUntilTs > now) {
    const secs = Math.ceil((cfg.lockedUntilTs - now) / 1000);
    return {
      ok: false,
      remainingAttempts: 0,
      cooldownSeconds: secs,
      message: `Too many wrong attempts. Try again in ${secs}s.`,
    };
  }

  const candidate = await hashPinWithSalt(pin.trim(), cfg.pinSalt);
  if (candidate === cfg.pinHash) {
    saveSecurityConfig({ ...cfg, failedAttempts: 0, lockedUntilTs: 0 });
    return { ok: true, remainingAttempts: 5, cooldownSeconds: 0 };
  }

  const nextFailures = cfg.failedAttempts + 1;
  const maxAttempts = 5;
  if (nextFailures >= maxAttempts) {
    const lockedUntilTs = now + 30_000;
    saveSecurityConfig({ ...cfg, failedAttempts: 0, lockedUntilTs });
    return {
      ok: false,
      remainingAttempts: 0,
      cooldownSeconds: 30,
      message: 'Incorrect PIN 5 times. Locked for 30 seconds.',
    };
  }

  saveSecurityConfig({ ...cfg, failedAttempts: nextFailures, lockedUntilTs: 0 });
  const remaining = maxAttempts - nextFailures;
  return {
    ok: false,
    remainingAttempts: remaining,
    cooldownSeconds: 0,
    message: `Incorrect PIN. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
  };
}

export async function isBiometricHardwareAvailable(): Promise<{
  supported: boolean;
  platformAvailable: boolean;
  reason?: string;
}> {
  if (typeof window === 'undefined' || !('PublicKeyCredential' in window)) {
    return {
      supported: false,
      platformAvailable: false,
      reason: 'WebAuthn biometrics are not supported in this browser.',
    };
  }

  try {
    const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) {
      return {
        supported: true,
        platformAvailable: false,
        reason: 'No built-in fingerprint, Face ID, or device screen lock authenticator detected.',
      };
    }
    return { supported: true, platformAvailable: true };
  } catch {
    return {
      supported: true,
      platformAvailable: false,
      reason: 'Biometric authenticator check was blocked in this context.',
    };
  }
}

export async function enrollBiometricLock(
  label = 'FinTrack User'
): Promise<{ ok: boolean; config?: SecurityLockConfig; message: string }> {
  const hw = await isBiometricHardwareAvailable();
  if (!hw.supported || !hw.platformAvailable) {
    return {
      ok: false,
      message: hw.reason || 'Device biometric authentication is unavailable here.',
    };
  }

  try {
    const challenge = randomBytes(32);
    const userId = randomBytes(16);

    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: challenge.buffer as ArrayBuffer,
        rp: {
          name: 'FinTrack – Smart Money Manager',
        },
        user: {
          id: userId.buffer as ArrayBuffer,
          name: label || 'fintrack-device-owner',
          displayName: label || 'FinTrack Owner',
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60_000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null;

    if (!credential) {
      return { ok: false, message: 'Biometric enrollment was cancelled.' };
    }

    const credId = toBase64Url(new Uint8Array(credential.rawId));
    const current = loadSecurityConfig();
    const next: SecurityLockConfig = {
      ...current,
      biometricEnabled: true,
      biometricCredentialId: credId,
      lockBeforeLogin: true,
    };
    saveSecurityConfig(next);
    return {
      ok: true,
      config: next,
      message: 'Biometric authentication (Fingerprint / Face ID) enabled.',
    };
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name || '';
    const msg = (err as Error)?.message || '';
    if (name === 'NotAllowedError') {
      return {
        ok: false,
        message:
          'Biometric prompt was cancelled or blocked by the preview frame. Open FinTrack in its own mobile/desktop browser tab to enroll Fingerprint or Face ID.',
      };
    }
    if (name === 'SecurityError' || msg.toLowerCase().includes('publickey')) {
      return {
        ok: false,
        message:
          'Biometrics require a top-level HTTPS tab (embedded preview frames restrict WebAuthn). You can still use PIN Lock here and enroll Biometrics in a direct browser tab.',
      };
    }
    return {
      ok: false,
      message: msg || 'Failed to register device biometric credential.',
    };
  }
}

export function disableBiometricLock(): SecurityLockConfig {
  const current = loadSecurityConfig();
  const next: SecurityLockConfig = {
    ...current,
    biometricEnabled: false,
    biometricCredentialId: '',
  };
  saveSecurityConfig(next);
  return next;
}

export async function verifyBiometricLock(): Promise<{ ok: boolean; message?: string }> {
  const cfg = loadSecurityConfig();
  if (!cfg.biometricEnabled || !cfg.biometricCredentialId) {
    return { ok: false, message: 'Biometric unlock is not configured.' };
  }

  try {
    const challenge = randomBytes(32);
    const credBytes = fromBase64Url(cfg.biometricCredentialId);
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challenge.buffer as ArrayBuffer,
        allowCredentials: [
          {
            id: credBytes.buffer as ArrayBuffer,
            type: 'public-key',
            transports: ['internal'],
          },
        ],
        userVerification: 'required',
        timeout: 60_000,
      },
    });

    if (!assertion) {
      return { ok: false, message: 'Biometric verification was not completed.' };
    }
    return { ok: true };
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name || '';
    if (name === 'NotAllowedError') {
      return { ok: false, message: 'Biometric prompt cancelled or timed out. Use your PIN to unlock.' };
    }
    return {
      ok: false,
      message: (err as Error)?.message || 'Biometric verification failed. Please enter your PIN.',
    };
  }
}
