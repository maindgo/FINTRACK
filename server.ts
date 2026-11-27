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
  handleHealth,
  handleVoiceTransaction,
} from './api/_lib/aiHandlers.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function aiRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const key = getClientKeyFromHeaders(
    req.headers as Record<string, string | string[] | undefined>,
    req.ip || 'unknown'
  );
  const rate = checkRateLimit(key);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    res.status(429).json({
      error: `Too many AI requests. Please wait ${rate.retryAfterSeconds} seconds before trying again.`,
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
  const json4mb = express.json({ limit: '4mb' });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api/ai/voice-transaction') {
      json4mb(req, res, next);
    } else {
      json128kb(req, res, next);
    }
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    const result = handleHealth();
    res.status(result.status).json(result.body);
  });

  app.post('/api/ai/insights', aiRateLimiter, async (req: Request, res: Response) => {
    const result = await handleAIInsights(req.body);
    res.status(result.status).json(result.body);
  });

  app.post('/api/ai/chat', aiRateLimiter, async (req: Request, res: Response) => {
    const result = await handleAIChat(req.body);
    res.status(result.status).json(result.body);
  });

  app.post('/api/ai/voice-transaction', aiRateLimiter, async (req: Request, res: Response) => {
    const result = await handleVoiceTransaction(req.body);
    res.status(result.status).json(result.body);
  });

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
