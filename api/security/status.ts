import { handleSecurityStatus } from '../_lib/securityHandlers';
import {
  runVercelGetHandler,
  type VercelLikeRequest,
  type VercelLikeResponse,
} from '../_lib/vercelHttp';

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  await runVercelGetHandler(req, res, (guard) => handleSecurityStatus(guard), {
    requireVerifiedEmail: false,
    endpointLabel: '/api/security/status',
  });
}
