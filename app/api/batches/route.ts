/**
 * app/api/batches/route.ts — Batch management endpoints.
 *
 * GET /api/batches — List all registered perishable inventory lots
 * POST /api/batches — Register a new perishable batch with runtime Zod validation
 */

import { NextResponse } from 'next/server';
import { PerishableBatchSchema } from '@/lib/schemas';
import { getBatchStore, resetBatchStore } from '@/lib/services';
import type { PerishableBatch } from '@/lib/types';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('reset') === 'true') {
      resetBatchStore();
    }
    const store = getBatchStore();
    const batches = Array.from(store.values());
    return NextResponse.json({ ok: true, batches });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Failed to retrieve batches' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parseResult = PerishableBatchSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Validation failed',
          issues: parseResult.error.flatten(),
        },
        { status: 400 }
      );
    }

    const batch = parseResult.data as PerishableBatch;
    const store = getBatchStore();
    store.set(batch.batchId, batch);

    return NextResponse.json({ ok: true, batch }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Internal server error' },
      { status: 500 }
    );
  }
}
