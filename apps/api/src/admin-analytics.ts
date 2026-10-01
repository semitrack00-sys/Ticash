import { Prisma } from '@prisma/client';
import { z } from 'zod';

export type AnalyticsDomain = 'TICASH' | 'FLUPFLAP';
const day = 86_400_000;
const date = z.iso.date();
const querySchema = z.object({
  period: z.enum(['today', '7d', '30d', 'year', 'custom']).default('30d'),
  mode: z.enum(['live', 'test']).default('live'),
  start: date.optional(), end: date.optional(),
}).strict();

/** UTC dates, inclusive custom end date, capped at 366 days. */
export function analyticsWindow(query: unknown, now = new Date()) {
  const input = querySchema.parse(query);
  const today = new Date(now.toISOString().slice(0, 10));
  let start = today;
  let end = now;
  if (input.period === 'custom') {
    if (!input.start || !input.end) throw new Error('INVALID_ANALYTICS_PERIOD');
    start = new Date(input.start);
    end = new Date(Math.min(new Date(input.end).getTime() + day, now.getTime()));
  } else {
    if (input.start || input.end) throw new Error('INVALID_ANALYTICS_PERIOD');
    if (input.period === '7d') start = new Date(today.getTime() - 6 * day);
    if (input.period === '30d') start = new Date(today.getTime() - 29 * day);
    if (input.period === 'year') start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  }
  if (end <= start || end.getTime() - start.getTime() > 366 * day) throw new Error('INVALID_ANALYTICS_PERIOD');
  const previousStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
  return { period: input.period, mode: input.mode, start, end, previousStart };
}

export type AnalyticsWindow = ReturnType<typeof analyticsWindow>;

/** One read-only statement gives every card/chart the same database snapshot.
 * Amounts are integer cents serialized as strings: no floating-point money sums.
 * Only static SQL fragments select the business; all request values are bound.
 */
export function analyticsQuery(domain: AnalyticsDomain, window: AnalyticsWindow) {
  const { start, end, previousStart, mode } = window;
  const source = domain === 'TICASH' ? Prisma.sql`
    SELECT t.id, t."senderUserId" AS customer, t."createdAt" AS created,
      t.status::text AS status,
      CASE WHEN t.status = 'COMPLETED' THEN 'SUCCESS'
           WHEN t.status = 'FAILED' THEN 'FAILED'
           WHEN t.status = 'REVERSED' THEN 'REVERSED' ELSE 'PENDING' END AS outcome,
      (t."amountUsd" * 100)::numeric(38,0) AS amount,
      (t."ticashFeeUsd" * 100)::numeric(38,0) AS fee,
      COALESCE(q."receiveCountry", 'UNKNOWN') AS country,
      'REMITTANCE' AS product, t.provider::text AS operator
    FROM "Transfer" t LEFT JOIN "FxQuote" q ON q.id = t."quoteId"
    WHERE t."testMode" = ${mode === 'test'}
      AND t."createdAt" >= ${previousStart} AND t."createdAt" < ${end}` : Prisma.sql`
    SELECT t.id, t."flupFlapCustomerId" AS customer, t."createdAt" AS created,
      t.status::text AS status,
      CASE WHEN t.status = 'REFUNDED' OR t."paymentStatus" IN ('REFUNDED', 'VOIDED') THEN 'REVERSED'
           WHEN t.status = 'FAILED' OR t."paymentStatus" = 'FAILED' THEN 'FAILED'
           WHEN t.status = 'DELIVERED' AND t."paymentStatus" = 'CAPTURED' THEN 'SUCCESS'
           ELSE 'PENDING' END AS outcome,
      (t."providerAmount" * 100)::numeric(38,0) AS amount, (t."feeUsd" * 100)::numeric(38,0) AS fee,
      t."countryCode" AS country, t.kind::text AS product, t."operatorName" AS operator
    FROM "MobileTopUpTransaction" t
    WHERE t."flupFlapCustomerId" IS NOT NULL AND t."userId" IS NULL
      AND t."testMode" = ${mode === 'test'}
      AND t."paymentEnvironment"::text = ${mode === 'test' ? 'SANDBOX' : 'PRODUCTION'}
      AND t."rechargeEnvironment"::text = ${mode === 'test' ? 'SANDBOX' : 'PRODUCTION'}
      AND t."providerCurrency" = 'USD'
      AND t."createdAt" >= ${previousStart} AND t."createdAt" < ${end}`;
  const customers = domain === 'TICASH' ? Prisma.sql`
    SELECT id, "createdAt" AS created, "guestExpiresAt" IS NOT NULL AS guest
    FROM "User" WHERE role = 'CUSTOMER' AND "createdAt" < ${end}` : Prisma.sql`
    SELECT id, "createdAt" AS created, "guestExpiresAt" IS NOT NULL AS guest
    FROM "FlupFlapCustomer" WHERE "createdAt" < ${end}`;
  return Prisma.sql`
    WITH records AS (${source}), customers AS (${customers}),
    current AS (SELECT * FROM records WHERE created >= ${start}),
    successful AS (SELECT * FROM current WHERE outcome = 'SUCCESS'),
    days AS (SELECT generate_series(${start}::timestamp, ${end}::timestamp - interval '1 millisecond', interval '1 day') AS date),
    trend AS (
      SELECT d.date, count(s.id)::int AS count, COALESCE(sum(s.amount), 0)::text AS "volumeCents"
      FROM days d LEFT JOIN successful s ON s.created >= d.date AND s.created < d.date + interval '1 day'
      GROUP BY d.date ORDER BY d.date
    ),
    country_totals AS (SELECT country AS name, count(*)::int AS count, sum(amount)::text AS "volumeCents" FROM successful GROUP BY country ORDER BY sum(amount) DESC, country LIMIT 10),
    product_totals AS (SELECT product AS name, count(*)::int AS count, sum(amount)::text AS "volumeCents" FROM successful GROUP BY product ORDER BY sum(amount) DESC, product),
    operator_totals AS (SELECT operator AS name, count(*)::int AS count, sum(amount)::text AS "volumeCents" FROM successful GROUP BY operator ORDER BY sum(amount) DESC, operator LIMIT 10),
    recent AS (SELECT id, created, status, outcome, country, product, operator, amount::text AS "amountCents" FROM current ORDER BY created DESC, id LIMIT 10)
    SELECT jsonb_build_object(
      'clients', jsonb_build_object(
        'total', (SELECT count(*) FROM customers),
        'new', (SELECT count(*) FROM customers WHERE created >= ${start}),
        'today', (SELECT count(*) FROM customers WHERE created >= date_trunc('day', ${end}::timestamp) AND created < ${end}),
        'week', (SELECT count(*) FROM customers WHERE created >= date_trunc('week', ${end}::timestamp) AND created < ${end}),
        'month', (SELECT count(*) FROM customers WHERE created >= date_trunc('month', ${end}::timestamp) AND created < ${end}),
        'year', (SELECT count(*) FROM customers WHERE created >= date_trunc('year', ${end}::timestamp) AND created < ${end}),
        'guest', (SELECT count(*) FROM customers WHERE guest),
        'registered', (SELECT count(*) FROM customers WHERE NOT guest),
        'active', (SELECT count(DISTINCT customer) FROM current)),
      'transactions', jsonb_build_object(
        'total', (SELECT count(*) FROM current),
        'successful', (SELECT count(*) FROM successful),
        'pending', (SELECT count(*) FROM current WHERE outcome = 'PENDING'),
        'failed', (SELECT count(*) FROM current WHERE outcome = 'FAILED'),
        'reversed', (SELECT count(*) FROM current WHERE outcome = 'REVERSED')),
      'volumeCents', (SELECT COALESCE(sum(amount), 0)::text FROM successful),
      'feeRevenueCents', (SELECT COALESCE(sum(fee), 0)::text FROM successful),
      'unattributedFeeCount', (SELECT count(*) FROM successful WHERE fee IS NULL),
      'previousVolumeCents', (SELECT COALESCE(sum(amount), 0)::text FROM records WHERE created < ${start} AND outcome = 'SUCCESS'),
      'averageCents', (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE round(avg(amount))::text END FROM successful),
      'successRate', (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE round(100.0 * count(*) FILTER (WHERE outcome = 'SUCCESS') / count(*), 2) END FROM current),
      'trend', (SELECT COALESCE(jsonb_agg(trend), '[]'::jsonb) FROM trend),
      'countries', (SELECT COALESCE(jsonb_agg(country_totals), '[]'::jsonb) FROM country_totals),
      'products', (SELECT COALESCE(jsonb_agg(product_totals), '[]'::jsonb) FROM product_totals),
      'operators', (SELECT COALESCE(jsonb_agg(operator_totals), '[]'::jsonb) FROM operator_totals),
      'recent', (SELECT COALESCE(jsonb_agg(recent), '[]'::jsonb) FROM recent)
    ) AS data`;
}

export function salesPerformance(current: string, previous: string) {
  const now = BigInt(current); const before = BigInt(previous);
  if (now === 0n) return 'LOW';
  if (before === 0n) return 'NO_BASELINE';
  return now * 100n < before * 80n ? 'LOW' : now * 100n > before * 120n ? 'HIGH' : 'MEDIUM';
}

export async function readAdminAnalytics(
  execute: (query: Prisma.Sql) => Promise<{ data: Record<string, unknown> }[]>,
  domain: AnalyticsDomain, window: AnalyticsWindow,
) {
  const [row] = await execute(analyticsQuery(domain, window));
  if (!row) throw new Error('ANALYTICS_UNAVAILABLE');
  const data = row.data;
  return {
    ...data, domain, currency: 'USD', timezone: 'UTC', mode: window.mode,
    start: window.start.toISOString(), end: window.end.toISOString(),
    previousStart: window.previousStart.toISOString(), generatedAt: new Date().toISOString(),
    performance: salesPerformance(String(data.volumeCents), String(data.previousVolumeCents)),
    subscriptions: { available: false, reason: 'NO_SUBSCRIPTION_RECORDS' },
    internetPlans: { available: false, reason: 'NO_DISTINCT_CATALOG_CLASSIFICATION' },
  };
}
