/**
 * app/api/weather/sync/route.ts — Weather sync trigger API.
 *
 * POST /api/weather/sync — Triggers a WeatherSync cycle using forceSync()
 */

import { NextResponse } from 'next/server';
import { WeatherSyncRequestSchema } from '@/lib/schemas';
import { getWeatherSync } from '@/lib/services';
import { WeatherSyncError } from '@/lib/shell/weatherSync';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parseResult = WeatherSyncRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', issues: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { storeId, latitude, longitude } = parseResult.data;
    const weatherSync = getWeatherSync();

    const record = await weatherSync.forceSync({ storeId, latitude, longitude });

    return NextResponse.json({ ok: true, weatherRecord: record });
  } catch (error: any) {
    if (error instanceof WeatherSyncError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { ok: false, error: error?.message ?? 'Weather sync failed' },
      { status: 500 }
    );
  }
}
