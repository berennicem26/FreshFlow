/**
 * app/api/audit/route.ts — Query audit trail for a specific batch.
 *
 * GET /api/audit?batchId=...
 */

import { NextResponse } from 'next/server';
import { getAuditLedger } from '@/lib/services';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batchId');

    if (!batchId) {
      return NextResponse.json(
        { ok: false, error: 'batchId query parameter is required' },
        { status: 400 }
      );
    }

    const ledger = getAuditLedger();
    const entries = ledger.queryEntries(batchId);

    return NextResponse.json({ ok: true, batchId, entries });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Failed to retrieve audit trail' },
      { status: 500 }
    );
  }
}
