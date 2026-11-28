import type { IncomingMessage, ServerResponse } from 'http';
import {
  checkRateLimit,
  getClientKeyFromHeaders,
  type HandlerResult,
} from './aiHandlers';
import {
  trackRateLimitViolation,
  verifyCallerSecurityAccess,
  type SecurityGuardOptions,
  type SecurityGuardResult,
} from './securityGuard';

export interface VercelLikeRequest extends IncomingMessage {
  body?: unknown;
}

export interface VercelLikeResponse extends ServerResponse {
  status?: (code: number) => VercelLikeResponse;
  json?: (body: unknown) => VercelLikeResponse;
}

export function sendJson(
  res: VercelLikeResponse,
  statusCode: number,
  payload: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      res.setHeader(k, v);
    }
  }
  res.end(JSON.stringify(payload));
}

export async function readJsonBody(req: VercelLikeRequest, maxBytes: number): Promise<unknown> {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      const trimmed = req.body.trim();
      return trimmed ? JSON.parse(trimmed) : {};
    }
    if (Buffer.isBuffer(req.body)) {
      const text = req.body.toString('utf8').trim();
      return text ? JSON.parse(text) : {};
    }
    return req.body;
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

export async function runVercelPostHandler(
  req: VercelLikeRequest,
  res: VercelLikeResponse,
  maxBytes: number,
  handler: (
    body: unknown,
    guard?: Extract<SecurityGuardResult, { allowed: true }>
  ) => Promise<HandlerResult>,
  securityOptions?: SecurityGuardOptions
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Allow', 'POST, OPTIONS');
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(
      res,
      405,
      { error: 'Method not allowed. Use POST.', code: 'METHOD_NOT_ALLOWED' },
      { Allow: 'POST, OPTIONS' }
    );
    return;
  }

  let verifiedGuard: Extract<SecurityGuardResult, { allowed: true }> | undefined;
  if (securityOptions) {
    const guard = await verifyCallerSecurityAccess(
      req.headers,
      req.socket?.remoteAddress,
      securityOptions
    );
    if (guard.allowed === false) {
      sendJson(res, guard.status, guard.body);
      return;
    }
    verifiedGuard = guard;
  }

  const clientKey = verifiedGuard
    ? `uid:${verifiedGuard.token.uid}`
    : getClientKeyFromHeaders(req.headers, req.socket?.remoteAddress);
  const rate = checkRateLimit(clientKey);
  if (!rate.allowed) {
    trackRateLimitViolation({
      clientKey,
      userId: verifiedGuard?.token.uid,
      userEmail: verifiedGuard?.token.email,
      endpoint: securityOptions?.endpointLabel || req.url || '/api',
      retryAfterSeconds: rate.retryAfterSeconds,
      headers: req.headers,
    });
    sendJson(
      res,
      429,
      {
        error: `Too many requests. Please wait ${rate.retryAfterSeconds} seconds before trying again.`,
        code: 'RATE_LIMITED',
        retryAfterSeconds: rate.retryAfterSeconds,
      },
      { 'Retry-After': String(rate.retryAfterSeconds) }
    );
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req, maxBytes);
  } catch (err) {
    const msg = (err as Error)?.message || '';
    if (msg === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, { error: 'Request payload is too large.', code: 'PAYLOAD_TOO_LARGE' });
      return;
    }
    sendJson(res, 400, { error: 'Invalid JSON request body.', code: 'BAD_REQUEST' });
    return;
  }

  try {
    const result = await handler(body, verifiedGuard);
    sendJson(res, result.status, result.body);
  } catch {
    sendJson(res, 500, {
      error: 'Unexpected service error. Please try again shortly.',
      code: 'INTERNAL_ERROR',
    });
  }
}

export async function runVercelGetHandler(
  req: VercelLikeRequest,
  res: VercelLikeResponse,
  handler: (guard: Extract<SecurityGuardResult, { allowed: true }>) => Promise<HandlerResult> | HandlerResult,
  securityOptions: SecurityGuardOptions
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Allow', 'GET, OPTIONS');
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendJson(
      res,
      405,
      { error: 'Method not allowed. Use GET.', code: 'METHOD_NOT_ALLOWED' },
      { Allow: 'GET, OPTIONS' }
    );
    return;
  }

  const guard = await verifyCallerSecurityAccess(
    req.headers,
    req.socket?.remoteAddress,
    securityOptions
  );
  if (guard.allowed === false) {
    sendJson(res, guard.status, guard.body);
    return;
  }

  try {
    const result = await handler(guard);
    sendJson(res, result.status, result.body);
  } catch {
    sendJson(res, 500, {
      error: 'Unexpected service error. Please try again shortly.',
      code: 'INTERNAL_ERROR',
    });
  }
}
