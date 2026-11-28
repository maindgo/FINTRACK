import { handleVipCancel } from '../_lib/securityHandlers';
import {
  runVercelPostHandler,
  type VercelLikeRequest,
  type VercelLikeResponse,
} from '../_lib/vercelHttp';

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  await runVercelPostHandler(
    req,
    res,
    16 * 1024,
    async (_body, guard) => {
      if (!guard) {
        return {
          status: 401,
          body: { error: 'Authentication is required.', code: 'UNAUTHORIZED' },
        };
      }
      return handleVipCancel(guard);
    },
    {
      requireVerifiedEmail: true,
      endpointLabel: '/api/vip/cancel',
    }
  );
}
