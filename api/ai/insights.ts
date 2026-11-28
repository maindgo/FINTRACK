import { handleAIInsights } from '../_lib/aiHandlers';
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
    128 * 1024,
    (body, guard) => handleAIInsights(body, guard),
    {
      requireVerifiedEmail: true,
      checkAiAccess: true,
      requiredVipTier: 'silver',
      aiQuotaType: 'insights',
      endpointLabel: '/api/ai/insights',
    }
  );
}
