import { EventkyProxyController } from '@/controllers/eventky-proxy/eventky-proxy';

export const dynamic = 'force-dynamic';
export async function GET() {
  const result = await EventkyProxyController.status();
  return Response.json(result, { status: result.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
