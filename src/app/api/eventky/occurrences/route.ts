import type { NextRequest } from 'next/server';
import { EventkyProxyController } from '@/controllers/eventky-proxy/eventky-proxy';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const result = await EventkyProxyController.occurrences(request.nextUrl.searchParams);
  return Response.json(result, {
    status: result.ok ? 200 : result.code === 'INVALID_QUERY' ? 400 : result.code === 'STALE_CURSOR' ? 409 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
