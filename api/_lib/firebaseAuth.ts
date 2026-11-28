import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

interface FirebaseClientConfig {
  projectId: string;
  firestoreDatabaseId: string;
}

export interface VerifiedFirebaseToken {
  uid: string;
  email: string;
  emailVerified: boolean;
  issuer: string;
  audience: string;
  authTime: number;
  issuedAt: number;
  expiresAt: number;
}

const SECURETOKEN_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let cachedConfig: FirebaseClientConfig | null = null;
let cachedCerts: { certs: Record<string, string>; expiresAtMs: number } | null = null;

export function getFirebaseServerConfig(): FirebaseClientConfig {
  if (cachedConfig) return cachedConfig;

  const envProject = (process.env.FIREBASE_PROJECT_ID || '').trim();
  const envDatabase = (process.env.FIREBASE_DATABASE_ID || '').trim();

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(currentDir, '../../firebase-applet-config.json'),
  ];

  for (const cfgPath of candidatePaths) {
    try {
      if (fs.existsSync(cfgPath)) {
        const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as Partial<FirebaseClientConfig>;
        const projectId = envProject || String(parsed.projectId || '').trim();
        const firestoreDatabaseId =
          envDatabase || String(parsed.firestoreDatabaseId || '(default)').trim();
        if (projectId) {
          cachedConfig = { projectId, firestoreDatabaseId };
          return cachedConfig;
        }
      }
    } catch {
      // Try next candidate
    }
  }

  cachedConfig = {
    projectId: envProject,
    firestoreDatabaseId: envDatabase || '(default)',
  };
  return cachedConfig;
}

function parseBase64UrlToBuffer(segment: string): Buffer {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64');
}

function parseJwtJson<T>(segment: string): T | null {
  try {
    const raw = parseBase64UrlToBuffer(segment).toString('utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function fetchFirebasePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && cachedCerts && now < cachedCerts.expiresAtMs) {
    return cachedCerts.certs;
  }

  const res = await fetch(SECURETOKEN_CERTS_URL, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    if (cachedCerts) return cachedCerts.certs;
    throw new Error(`Failed to fetch Firebase auth certificates (${res.status})`);
  }

  const certs = (await res.json()) as Record<string, string>;
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Math.min(86400, Math.max(60, Number(maxAgeMatch[1]))) : 3600;

  cachedCerts = {
    certs,
    expiresAtMs: now + maxAgeSec * 1000,
  };
  return certs;
}

export async function verifyFirebaseIdToken(
  idToken: string
): Promise<VerifiedFirebaseToken | null> {
  const cleaned = idToken.trim();
  if (!cleaned || cleaned.length > 8192) return null;

  const segments = cleaned.split('.');
  if (segments.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = segments;

  const header = parseJwtJson<{ alg?: string; kid?: string; typ?: string }>(headerB64);
  const payload = parseJwtJson<{
    aud?: unknown;
    iss?: unknown;
    sub?: unknown;
    exp?: unknown;
    iat?: unknown;
    auth_time?: unknown;
    email?: unknown;
    email_verified?: unknown;
  }>(payloadB64);

  if (!header || !payload) return null;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    return null;
  }

  const { projectId } = getFirebaseServerConfig();
  if (!projectId) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;

  if (payload.aud !== projectId || payload.iss !== expectedIssuer) {
    return null;
  }
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) {
    return null;
  }

  const exp = Number(payload.exp);
  const iat = Number(payload.iat);
  const authTime = Number(payload.auth_time ?? iat);
  if (!Number.isFinite(exp) || exp <= nowSec) {
    return null;
  }
  if (!Number.isFinite(iat) || iat > nowSec + 300) {
    return null;
  }
  if (!Number.isFinite(authTime) || authTime > nowSec + 300) {
    return null;
  }

  let certs = await fetchFirebasePublicCerts(false);
  let certPem = certs[header.kid];
  if (!certPem) {
    certs = await fetchFirebasePublicCerts(true);
    certPem = certs[header.kid];
  }
  if (!certPem) return null;

  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = parseBase64UrlToBuffer(signatureB64);
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(signingInput);
  verifier.end();

  let verified = false;
  try {
    verified = verifier.verify(certPem, signature);
  } catch {
    verified = false;
  }

  if (!verified) return null;

  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : '',
    emailVerified: payload.email_verified === true,
    issuer: expectedIssuer,
    audience: projectId,
    authTime,
    issuedAt: iat,
    expiresAt: exp,
  };
}

export type FirestoreSimpleValue = string | number | boolean | null;

function decodeFirestoreFieldValue(val: Record<string, unknown> | undefined): FirestoreSimpleValue {
  if (!val || typeof val !== 'object') return null;
  if ('stringValue' in val && typeof val.stringValue === 'string') return val.stringValue;
  if ('booleanValue' in val && typeof val.booleanValue === 'boolean') return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('timestampValue' in val && typeof val.timestampValue === 'string') return val.timestampValue;
  if ('nullValue' in val) return null;
  return null;
}

export async function fetchFirestoreDocAsCaller(
  documentPath: string,
  idToken: string
): Promise<{ exists: boolean; data: Record<string, FirestoreSimpleValue>; errorStatus?: number }> {
  const { projectId, firestoreDatabaseId } = getFirebaseServerConfig();
  if (!projectId) {
    return { exists: false, data: {}, errorStatus: 500 };
  }

  const safePath = documentPath
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');

  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${encodeURIComponent(firestoreDatabaseId)}/documents/${safePath}`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${idToken}`,
        Accept: 'application/json',
      },
    });

    if (res.status === 404) {
      return { exists: false, data: {} };
    }
    if (!res.ok) {
      return { exists: false, data: {}, errorStatus: res.status };
    }

    const json = (await res.json()) as {
      fields?: Record<string, Record<string, unknown>>;
    };
    const out: Record<string, FirestoreSimpleValue> = {};
    if (json.fields && typeof json.fields === 'object') {
      for (const [key, rawField] of Object.entries(json.fields)) {
        out[key] = decodeFirestoreFieldValue(rawField);
      }
    }
    return { exists: true, data: out };
  } catch {
    return { exists: false, data: {}, errorStatus: 503 };
  }
}

export type FirestoreWriteValue =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'timestamp'; value: string }
  | { type: 'null' };

function encodeFirestoreWriteValue(entry: FirestoreWriteValue): Record<string, unknown> {
  switch (entry.type) {
    case 'string':
      return { stringValue: entry.value };
    case 'boolean':
      return { booleanValue: entry.value };
    case 'timestamp':
      return { timestampValue: entry.value };
    case 'null':
      return { nullValue: null };
    case 'number':
      if (Number.isInteger(entry.value)) {
        return { integerValue: String(entry.value) };
      }
      return { doubleValue: entry.value };
  }
}

export async function commitFirestoreDocAsCaller(params: {
  documentPath: string;
  idToken: string;
  fields: Record<string, FirestoreWriteValue>;
  serverTimestampFields?: string[];
}): Promise<{ ok: boolean; status: number; errorMessage?: string }> {
  const { projectId, firestoreDatabaseId } = getFirebaseServerConfig();
  if (!projectId) {
    return { ok: false, status: 500, errorMessage: 'Missing Firebase projectId.' };
  }

  const safePath = params.documentPath
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');

  const docName = `projects/${projectId}/databases/${firestoreDatabaseId}/documents/${safePath}`;
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${encodeURIComponent(firestoreDatabaseId)}/documents:commit`;

  const encodedFields: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(params.fields)) {
    encodedFields[k] = encodeFirestoreWriteValue(v);
  }

  const writePayload: Record<string, unknown> = {
    update: {
      name: docName,
      fields: encodedFields,
    },
  };

  if (params.serverTimestampFields && params.serverTimestampFields.length > 0) {
    writePayload.updateTransforms = params.serverTimestampFields.map((fieldPath) => ({
      fieldPath,
      setToServerValue: 'REQUEST_TIME',
    }));
  }

  try {
    const res = await fetch(commitUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.idToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ writes: [writePayload] }),
    });

    if (!res.ok) {
      let msg = `Firestore commit failed with status ${res.status}`;
      try {
        const errJson = (await res.json()) as { error?: { message?: string } };
        if (errJson.error?.message) msg = errJson.error.message;
      } catch {
        // ignore JSON parse failure
      }
      return { ok: false, status: res.status, errorMessage: msg };
    }

    return { ok: true, status: 200 };
  } catch {
    return { ok: false, status: 503, errorMessage: 'Network error communicating with Firestore.' };
  }
}

