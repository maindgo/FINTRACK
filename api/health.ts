import { handleHealth } from './_lib/aiHandlers';
import {
  sendJson,
  type VercelLikeRequest,
  type VercelLikeResponse,
} from './_lib/vercelHttp';

export default function handler(req: VercelLikeRequest, res: VercelLikeResponse): void {
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

  const result = handleHealth();
  sendJson(res, result.status, result.body);
}
