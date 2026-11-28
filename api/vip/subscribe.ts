import { handleVipSubscribe } from '../_lib/securityHandlers';
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
    1024 * 1024,
    async (body, guard) => {
      if (!guard) {
        return {
          status: 401,
          body: { error: 'Authentication is required.', code: 'UNAUTHORIZED' },
        };
      }
      return handleVipSubscribe(body, guard);
    },
    {
      requireVerifiedEmail: true,
      endpointLabel: '/api/vip/subscribe',
    }
  );
}
