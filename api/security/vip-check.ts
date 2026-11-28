import { handleVipEntitlementCheck } from '../_lib/securityHandlers';
import {
  runVercelGetHandler,
  type VercelLikeRequest,
  type VercelLikeResponse,
} from '../_lib/vercelHttp';

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  const rawUrl = req.url || '';
  const claimedVip = rawUrl.includes('claimedVip=true');

  await runVercelGetHandler(req, res, (guard) => handleVipEntitlementCheck(guard), {
    requireVerifiedEmail: true,
    checkVipAccess: true,
    claimedVip,
    endpointLabel: '/api/security/vip-check',
  });
}
