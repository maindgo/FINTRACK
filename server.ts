import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  checkRateLimit,
  getClientKeyFromHeaders,
  handleAIChat,
  handleAIInsights,
  handleDiamondForecast,
  handleHealth,
  handleVoiceTransaction,
} from './api/_lib/aiHandlers.ts';
import {
  trackRateLimitViolation,
  verifyCallerSecurityAccess,
  type SecurityGuardOptions,
  type SecurityGuardResult,
} from './api/_lib/securityGuard.ts';
import {
  handleAdminSecurityTelemetry,
  handleAuthSecurityEvent,
  handleSecurityStatus,
  handleVipCancel,
  handleVipEntitlementCheck,
  handleVipStatus,
  handleVipSubscribe,
} from './api/_lib/securityHandlers.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

interface SecuredRequest extends Request {
  verifiedSecurity?: Extract<SecurityGuardResult, { allowed: true }>;
}

function createSecurityMiddleware(options: SecurityGuardOptions) {
  return async (req: SecuredRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const guard = await verifyCallerSecurityAccess(
        req.headers as Record<string, string | string[] | undefined>,
        req.ip || 'unknown',
        options
      );
      if (guard.allowed === false) {
        res.status(guard.status).json(guard.body);
        return;
      }
      req.verifiedSecurity = guard;
      next();
    } catch (err) {
      res.status(500).json({
        error: (err as Error)?.message || 'Security verification failed unexpectedly.',
        code: 'SECURITY_CHECK_ERROR',
      });
    }
  };
}

function aiRateLimiter(req: SecuredRequest, res: Response, next: NextFunction): void {
  const verified = req.verifiedSecurity;
  const key = verified
    ? `uid:${verified.token.uid}`
    : getClientKeyFromHeaders(
        req.headers as Record<string, string | string[] | undefined>,
        req.ip || 'unknown'
      );
  const rate = checkRateLimit(key);
  if (!rate.allowed) {
    trackRateLimitViolation({
      clientKey: key,
      userId: verified?.token.uid,
      userEmail: verified?.token.email,
      endpoint: req.path || '/api',
      retryAfterSeconds: rate.retryAfterSeconds,
      headers: req.headers as Record<string, string | string[] | undefined>,
    });
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    res.status(429).json({
      error: `Too many requests. Please wait ${rate.retryAfterSeconds} seconds before trying again.`,
      code: 'RATE_LIMITED',
      retryAfterSeconds: rate.retryAfterSeconds,
    });
    return;
  }
  next();
}

async function startServer(): Promise<void> {
  const app = express();
  app.set('trust proxy', 1);

  const json128kb = express.json({ limit: '128kb' });
  const json1mb = express.json({ limit: '1mb' });
  const json4mb = express.json({ limit: '4mb' });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api/ai/voice-transaction') {
      json4mb(req, res, next);
    } else if (req.path === '/api/vip/subscribe') {
      json1mb(req, res, next);
    } else {
      json128kb(req, res, next);
    }
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    const result = handleHealth();
    res.status(result.status).json(result.body);
  });

  app.post(
    '/api/ai/insights',
    createSecurityMiddleware({
      requireVerifiedEmail: true,
      checkAiAccess: true,
      requiredVipTier: 'silver',
      aiQuotaType: 'insights',
      endpointLabel: '/api/ai/insights',
    }),
    aiRateLimiter,
    async (req: SecuredRequest, res: Response) => {
      const result = await handleAIInsights(req.body, req.verifiedSecurity);
      res.status(result.status).json(result.body);
    }
  );

  app.post(
    '/api/ai/chat',
    createSecurityMiddleware({
      requireVerifiedEmail: true,
      checkAiAccess: true,
      requiredVipTier: 'gold',
      aiQuotaType: 'advisor',
      endpointLabel: '/api/ai/chat',
    }),
    aiRateLimiter,
    async (req: SecuredRequest, res: Response) => {
      const result = await handleAIChat(req.body, req.verifiedSecurity);
      res.status(result.status).json(result.body);
    }
  );

  app.post(
    '/api/ai/forecast',
    createSecurityMiddleware({
      requireVerifiedEmail: true,
      checkAiAccess: true,
      requiredVipTier: 'diamond',
      aiQuotaType: 'forecast',
      endpointLabel: '/api/ai/forecast',
    }),
    aiRateLimiter,
    async (req: SecuredRequest, res: Response) => {
      const result = await handleDiamondForecast(req.body, req.verifiedSecurity);
      res.status(result.status).json(result.body);
    }
  );

  app.get(
    '/api/vip/status',
    createSecurityMiddleware({
      requireVerifiedEmail: true,
      endpointLabel: '/api/vip/status',
    }),
    (req: SecuredRequest, res: Response) => {
      if (!req.verifiedSecurity) {
        res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
        return;
      }
      const result = handleVipStatus(req.verifiedSecurity);
      res.status(result.status).json(result.body);
    }
  );

  app.post(
    '/api/vip/subscribe',
    createSecurityMiddleware({
      requireVerifiedEmail: true,
      endpointLabel: '/api/vip/subscribe',
    }),
    aiRateLimiter,
    async (req: SecuredRequest, res: Response) => {
      if (!req.verifiedSecurity) {
        res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
        return;
      }
      try {
        const result = await handleVipSubscribe(req.body, req.verifiedSecurity);
        res.status(result.status).json(result.body);
      } catch (err) {
        res.status(500).json({
          error: (err as Error)?.message || 'Unable to process VIP subscription request.',
          code: 'VIP_SUBSCRIBE_ERROR',
        });
      }
    }
  );

  app.post(
    '/api/vip/cancel',
    createSecurityMiddleware({
      requireVerifiedEmail: true,
      endpointLabel: '/api/vip/cancel',
    }),
    aiRateLimiter,
    async (req: SecuredRequest, res: Response) => {
      if (!req.verifiedSecurity) {
        res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
        return;
      }
      const result = await handleVipCancel(req.verifiedSecurity);
      res.status(result.status).json(result.body);
    }
  );

  app.post(
    '/api/ai/voice-transaction',
    createSecurityMiddleware({
      requireVerifiedEmail: true,
      checkAiAccess: true,
      endpointLabel: '/api/ai/voice-transaction',
    }),
    aiRateLimiter,
    async (req: Request, res: Response) => {
      const result = await handleVoiceTransaction(req.body);
      res.status(result.status).json(result.body);
    }
  );

  app.get(
    '/api/security/status',
    createSecurityMiddleware({
      requireVerifiedEmail: false,
      endpointLabel: '/api/security/status',
    }),
    (req: SecuredRequest, res: Response) => {
      if (!req.verifiedSecurity) {
        res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
        return;
      }
      const result = handleSecurityStatus(req.verifiedSecurity);
      res.status(result.status).json(result.body);
    }
  );

  app.post('/api/security/auth-event', aiRateLimiter, (req: Request, res: Response) => {
    const result = handleAuthSecurityEvent(
      req.body,
      req.headers as Record<string, string | string[] | undefined>,
      req.ip || 'unknown'
    );
    res.status(result.status).json(result.body);
  });

  app.get('/api/security/vip-check', async (req: Request, res: Response) => {
    const claimedVip = String(req.query.claimedVip || '') === 'true';
    const guard = await verifyCallerSecurityAccess(
      req.headers as Record<string, string | string[] | undefined>,
      req.ip || 'unknown',
      {
        requireVerifiedEmail: true,
        checkVipAccess: true,
        claimedVip,
        endpointLabel: '/api/security/vip-check',
      }
    );
    if (guard.allowed === false) {
      res.status(guard.status).json(guard.body);
      return;
    }
    const result = handleVipEntitlementCheck(guard);
    res.status(result.status).json(result.body);
  });

  app.get(
    '/api/admin/security-telemetry',
    createSecurityMiddleware({
      requireAdmin: true,
      requireVerifiedEmail: true,
      endpointLabel: '/api/admin/security-telemetry',
    }),
    (req: SecuredRequest, res: Response) => {
      if (!req.verifiedSecurity) {
        res.status(403).json({ error: 'Administrator permissions required.', code: 'ADMIN_REQUIRED' });
        return;
      }
      const result = handleAdminSecurityTelemetry(req.verifiedSecurity);
      res.status(result.status).json(result.body);
    }
  );

  const distDir = path.resolve(__dirname, 'dist');
  const distIndex = path.resolve(distDir, 'index.html');
  const useViteDev =
    process.env.VITE_DEV_MODE === 'true' ||
    (process.env.NODE_ENV !== 'production' && !fs.existsSync(distIndex));

  if (useViteDev) {
    app.get('/@vite/client', (_req: Request, res: Response) => {
      res.type('application/javascript');
      res.send(`
const sheetsMap = new Map();
let lastInsertedStyle;

export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => {
        lastInsertedStyle = undefined;
      }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement('afterend', style);
    }
    lastInsertedStyle = style;
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}

export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}

export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    decline() {},
    on() {},
    off() {},
    send() {},
  };
}

export function injectQuery(url, queryToInject) {
  if (typeof url !== 'string' || (url[0] !== '.' && url[0] !== '/')) return url;
  const [pathname, search] = url.split('?');
  const [cleanSearch, hash] = (search || '').split('#');
  const query = cleanSearch ? \`\${cleanSearch}&\${queryToInject}\` : queryToInject;
  return \`\${pathname}?\${query}\${hash ? \`#\${hash}\` : ''}\`;
}

export class ErrorOverlay {
  constructor() {}
}
`);
    });

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (req: Request, res: Response) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'API endpoint not found.', code: 'NOT_FOUND' });
        return;
      }
      res.sendFile(distIndex);
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FinTrack server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
