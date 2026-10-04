/**
 * app/api/donations/route.ts — Donation manifests and dispatch confirmation.
 *
 * GET /api/donations — List all DonationManifest records from the audit ledger
 * POST /api/donations — Confirm dispatch of an emergency donation manifest
 */

import { NextResponse } from 'next/server';
import { DonationDispatchSchema } from '@/lib/schemas';
import { getAuditLedger, getBatchStore } from '@/lib/services';
import type { DonationManifest } from '@/lib/types';

export async function GET() {
  try {
    const ledger = getAuditLedger();
    const store = getBatchStore();
    // Query all DONATION_MANIFEST entries from the database
    const db = (ledger as any).db;
    const stmt = db.prepare(`
      SELECT entry_id, occurred_at, store_id, payload
      FROM audit_entries
      WHERE entry_type = 'DONATION_MANIFEST'
      ORDER BY occurred_at DESC
    `);
    const rows = stmt.all() as Array<{
      entry_id: string;
      occurred_at: string;
      store_id: string;
      payload: string;
    }>;

    const rawDonations = rows.map((r) => JSON.parse(r.payload) as DonationManifest);

    // Group by batchId to show the latest manifest per active perishable lot
    const latestByBatch = new Map<string, DonationManifest>();
    for (const d of rawDonations) {
      if (d.batchId && !latestByBatch.has(d.batchId)) {
        latestByBatch.set(d.batchId, d);
      }
    }
    const donations = Array.from(latestByBatch.values()).map((d) => ({
      ...d,
      productName: (d as any).productName ?? store.get(d.batchId)?.productName ?? 'Perishable Inventory Lot',
    }));
    const totalDeductions = donations.reduce(
      (sum, d) => sum + (d.irsDeductionAmount || 0),
      0
    );

    return NextResponse.json({
      ok: true,
      donations,
      summary: {
        totalManifests: donations.length,
        totalDeductionsUsd: Math.round(totalDeductions * 100) / 100,
        totalAuditEvents: rawDonations.length,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Failed to query donations' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parseResult = DonationDispatchSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', issues: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { manifestId, notes } = parseResult.data;
    const ledger = getAuditLedger();

    // Persist dispatch confirmation audit entry
    await ledger.insertEntry({
      entryType: 'DONATION_MANIFEST',
      batchId: null,
      storeId: 'STORE-DISPATCH',
      payload: {
        dispatchedAt: new Date().toISOString(),
        manifestId,
        status: 'DISPATCHED_TO_FOOD_BANK',
        notes: notes ?? 'Carrier pickup confirmed',
      } as any,
    });

    return NextResponse.json({
      ok: true,
      message: `Manifest ${manifestId} marked as dispatched to food bank partner.`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Failed to confirm dispatch' },
      { status: 500 }
    );
  }
}
