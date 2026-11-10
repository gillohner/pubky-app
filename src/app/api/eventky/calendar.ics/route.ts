import type { NextRequest } from 'next/server';
import { EventkyFeedProxyController } from '@/controllers/eventky-feed-proxy/eventky-feed-proxy';

export const dynamic = 'force-dynamic';
async function serve(request: NextRequest, head: boolean) {
  const result = await EventkyFeedProxyController.read(request.nextUrl.searchParams, {
    ifNoneMatch: request.headers.get('if-none-match') ?? undefined,
    ifModifiedSince: request.headers.get('if-modified-since') ?? undefined,
    head,
  });
  return new Response(result.body, { status: result.status, headers: result.headers });
}
export async function GET(request: NextRequest) {
  return serve(request, false);
}
export async function HEAD(request: NextRequest) {
  return serve(request, true);
}
