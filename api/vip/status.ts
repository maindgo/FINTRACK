import { handleVipStatus } from '../_lib/securityHandlers';
import {
  runVercelGetHandler,
  type VercelLikeRequest,
  type VercelLikeResponse,
} from '../_lib/vercelHttp';

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  await runVercelGetHandler(req, res, (guard) => handleVipStatus(guard), {
    requireVerifiedEmail: true,
    endpointLabel: '/api/vip/status',
  });
}
