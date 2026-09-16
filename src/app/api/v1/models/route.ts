import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from '@/lib/auth';
import { RelayError } from '@/lib/errors';
import { listPublicModels } from '@/lib/relay/selector';

export const dynamic = 'force-dynamic';

/** GET /v1/models — OpenAI compatible model list */
export async function GET(req: NextRequest) {
  try {
    const ctx = await authenticateBearer(req);
    let models = await listPublicModels();
    if (ctx.token.allowedModels.length) models = models.filter((m) => ctx.token.allowedModels.includes(m));
    return NextResponse.json({
      object: 'list',
      data: models.map((id) => ({ id, object: 'model', created: 0, owned_by: 'relay' })),
    });
  } catch (e) {
    if (e instanceof RelayError) return e.toResponse();
    throw e;
  }
}
