import { waitUntil } from '@vercel/functions';
import type { NextApiRequest, NextApiResponse } from 'next';
import { handle, setBackgroundRunner } from '@api/serverless';

/**
 * The whole API as one serverless function on Vercel. Template: the Vercel
 * build copies it to src/pages/api/[...path].ts (see vercel.json); other
 * builds never include it and proxy /api to the API service instead.
 */
setBackgroundRunner((work) => waitUntil(work));

export const config = {
  api: { bodyParser: false, responseLimit: false, externalResolver: true },
  maxDuration: 60,
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return handle(req, res);
}
