/**
 * lib/schemas.ts — Zod validation schemas for FreshFlow API endpoints.
 *
 * Enforces runtime boundary validation on all external JSON payloads.
 */

import { z } from 'zod';

export const ProductCategorySchema = z.enum([
  'produce',
  'dairy',
  'meat',
  'bakery',
  'prepared',
]);

export const TemperatureReadingSchema = z.object({
  timestampIso: z.string().datetime(),
  celsius: z.number().min(-30).max(60),
});

export const PerishableBatchSchema = z
  .object({
    batchId: z.string().uuid(),
    sku: z.string().min(1),
    productName: z.string().min(1),
    category: ProductCategorySchema,
    storeId: z.string().min(1),
    nominalShelfLifeDays: z.number().int().positive(),
    expiryDateIso: z.string().datetime(),
    costBasisPerUnit: z.number().positive(),
    msrpPerUnit: z.number().positive(),
    quantityOnHand: z.number().int().positive(),
    temperatureHistory: z.array(TemperatureReadingSchema),
    dailySalesVelocity: z.number().min(0),
    createdAt: z.string().datetime(),
  })
  .refine((data) => data.costBasisPerUnit < data.msrpPerUnit, {
    message: 'costBasisPerUnit must be strictly less than msrpPerUnit',
    path: ['costBasisPerUnit'],
  });

export type PerishableBatchInput = z.infer<typeof PerishableBatchSchema>;

export const EvaluateRequestSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  simulatedTemperatureCelsius: z.number().min(-30).max(60).optional(),
  nowIso: z.string().datetime().optional(),
});

export type EvaluateRequestInput = z.infer<typeof EvaluateRequestSchema>;

export const DonationDispatchSchema = z.object({
  manifestId: z.string().min(1),
  notes: z.string().optional(),
});

export type DonationDispatchInput = z.infer<typeof DonationDispatchSchema>;

export const AuditQuerySchema = z.object({
  batchId: z.string().min(1),
});

export type AuditQueryInput = z.infer<typeof AuditQuerySchema>;

export const WeatherSyncRequestSchema = z.object({
  storeId: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export type WeatherSyncRequestInput = z.infer<typeof WeatherSyncRequestSchema>;
