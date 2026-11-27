import { handleVoiceTransaction } from '../_lib/aiHandlers';
import {
  runVercelPostHandler,
  type VercelLikeRequest,
  type VercelLikeResponse,
} from '../_lib/vercelHttp';

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
): Promise<void> {
  await runVercelPostHandler(req, res, 4 * 1024 * 1024, handleVoiceTransaction);
}
