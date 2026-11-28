import { handleAuthSecurityEvent } from '../_lib/securityHandlers';
import {
  runVercelPostHandler,
  type VercelLikeRequest,
  type VercelLikeResponse,
} from '../_lib/vercelHttp';

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  await runVercelPostHandler(req, res, 16 * 1024, async (body) =>
    handleAuthSecurityEvent(body, req.headers, req.socket?.remoteAddress)
  );
}
