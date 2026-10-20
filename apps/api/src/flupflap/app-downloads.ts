import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';

export const downloadQuery = z.object({ year: z.coerce.number().int().min(2020).max(2100).optional(),
  groupBy: z.enum(['day', 'week', 'month', 'year']).default('month') }).strict();
export const downloadImport = z.object({ platform: z.enum(['ANDROID', 'IOS']), report: z.string().min(1).max(100_000) }).strict();
export type DownloadPlatform = 'ANDROID' | 'IOS';
export type DownloadDay = { platform: DownloadPlatform; reportDate: Date; downloads: number; importedAt: Date };
const DAY = 86_400_000;
export function reportingDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}
function validDate(date: string, today: string) {
  if (!z.iso.date().safeParse(date).success || date < '2020-01-01' || date > today) throw new Error('INVALID_REPORT_DATE');
  return date;
}
function whole(value: string, signed = false) {
  if (!(signed ? /^-?\d+(?:\.0+)?$/ : /^\d+$/).test(value)) throw new Error('INVALID_DOWNLOAD_COUNT');
  const count = Number(value);
  if (!Number.isSafeInteger(count) || Math.abs(count) > 1_000_000_000) throw new Error('INVALID_DOWNLOAD_COUNT');
  return count;
}
/** Complete aggregate exports only. Raw reports and customer/device identifiers are not retained. */
export function parseDownloadReport(platform: DownloadPlatform, report: string, appId: string, now = new Date()) {
  if (!appId) throw new Error('STORE_APP_NOT_CONFIGURED');
  const clean = report.replace(/^\uFEFF/, '');
  let rows: Record<string, string>[];
  try {
    rows = parse(clean, { columns: (headers: string[]) => {
      if (new Set(headers).size !== headers.length) throw new Error('DUPLICATE_HEADERS');
      return headers;
    }, delimiter: platform === 'ANDROID' ? ',' : '\t', record_delimiter: ['\r\n', '\n', '\r'], bom: true,
    skip_empty_lines: true, trim: true, max_record_size: 100_000 });
  } catch { throw new Error('INVALID_STORE_REPORT'); }
  if (!rows.length || rows.length > 10_000) throw new Error('INVALID_STORE_REPORT');
  const headers = Object.keys(rows[0]!);
  const required = platform === 'ANDROID' ? ['Date', 'Package Name', 'Daily User Installs']
    : ['Begin Date', 'End Date', 'Apple Identifier', 'Product Type Identifier', 'Units', 'Device'];
  if (required.some(key => !headers.includes(key))) throw new Error('INVALID_STORE_REPORT_HEADERS');
  if (platform === 'ANDROID' && ['Device', 'Carrier', 'Language', 'Android OS Version', 'App Version Code'].some(key => headers.includes(key))) throw new Error('USE_PLAY_COUNTRY_REPORT');
  const totals = new Map<string, number>(), seen = new Set<string>();
  const today = reportingDate(now);
  for (const row of rows) {
    if (row[platform === 'ANDROID' ? 'Package Name' : 'Apple Identifier'] !== appId) continue;
    let date: string;
    if (platform === 'ANDROID') {
      date = validDate(row.Date!, today);
      const country = row.Country;
      if (country !== undefined && !/^[A-Z]{2}$/.test(country)) throw new Error('USE_COMPLETE_PLAY_COUNTRY_REPORT');
      const key = `${date}:${country ?? 'total'}`;
      if (seen.has(key)) throw new Error('DUPLICATE_REPORT_ROW');
      seen.add(key);
      totals.set(date, (totals.get(date) ?? 0) + whole(row['Daily User Installs']!));
    } else {
      const key = JSON.stringify(row);
      if (seen.has(key)) throw new Error('DUPLICATE_REPORT_ROW');
      seen.add(key);
      const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(row['Begin Date']!);
      if (!match || row['End Date'] !== row['Begin Date']) throw new Error('USE_DAILY_APPLE_REPORT');
      date = validDate(`${match[3]}-${match[1]}-${match[2]}`, today);
      const units = whole(row.Units!, true);
      const initial = ['1', '1F', '1T'].includes(row['Product Type Identifier']!) && ['iPhone', 'iPad', 'iPod touch'].includes(row.Device!);
      totals.set(date, (totals.get(date) ?? 0) + (initial ? Math.max(0, units) : 0));
    }
    if (!Number.isSafeInteger(totals.get(date)) || totals.get(date)! > 1_000_000_000) throw new Error('INVALID_DOWNLOAD_COUNT');
  }
  if (!totals.size || totals.size > 366) throw new Error('REPORT_APP_NOT_FOUND');
  return { hash: createHash('sha256').update(clean).digest('hex'), days: [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([date, downloads]) => ({ date, downloads })) };
}
export function summarizeDownloads(rows: DownloadDay[], input: { year?: number; groupBy: 'day' | 'week' | 'month' | 'year' }, now = new Date()) {
  const today = reportingDate(now), currentYear = Number(today.slice(0, 4));
  const year = input.year ?? currentYear;
  if (year > currentYear) throw new Error('FUTURE_REPORT_YEAR');
  const start = Date.parse(`${year}-01-01`), end = Math.min(Date.parse(`${year + 1}-01-01`), Date.parse(today) + DAY);
  const monday = (date: string) => {
    const d = new Date(date); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10);
  };
  const bucketKey = (date: string) => input.groupBy === 'day' ? date : input.groupBy === 'week' ? monday(date) : input.groupBy === 'month' ? date.slice(0, 7) : date.slice(0, 4);
  const series = new Map<string, { date: string; android: number | null; ios: number | null; reportedDays: { android: number; ios: number }; expectedDays: number }>();
  for (let time = start; time < end; time += DAY) {
    const key = bucketKey(new Date(time).toISOString().slice(0, 10));
    const bucket = series.get(key) ?? { date: key, android: null, ios: null, reportedDays: { android: 0, ios: 0 }, expectedDays: 0 };
    bucket.expectedDays++; series.set(key, bucket);
  }
  const platforms = (['ANDROID', 'IOS'] as const).map(platform => {
    const records = rows.filter(row => row.platform === platform);
    const data = new Map(records.map(row => [row.reportDate.toISOString().slice(0, 10), row.downloads]));
    const field = platform === 'ANDROID' ? 'android' : 'ios';
    for (const [date, count] of data) {
      if (date < `${year}-01-01` || Date.parse(date) >= end) continue;
      const bucket = series.get(bucketKey(date))!; bucket[field] = (bucket[field] ?? 0) + count; bucket.reportedDays[field]++;
    }
    const period = (from: string) => {
      const entries = [...data].filter(([date]) => date >= from && date <= today);
      return { count: entries.length ? entries.reduce((sum, [, count]) => sum + count, 0) : null,
        reportedDays: entries.length, expectedDays: Math.round((Date.parse(today) - Date.parse(from)) / DAY) + 1 };
    };
    return { platform, source: platform === 'ANDROID' ? 'Google Play: Daily User Installs' : 'App Store: first-time iOS app units',
      lastReportDate: [...data.keys()].sort().at(-1) ?? null,
      lastImportedAt: records.length ? new Date(Math.max(...records.map(row => row.importedAt.getTime()))).toISOString() : null,
      today: period(today), week: period(monday(today)), month: period(`${today.slice(0, 7)}-01`), year: period(`${currentYear}-01-01`) };
  });
  return { domain: 'FLUPFLAP', timezone: 'America/Los_Angeles', year, groupBy: input.groupBy, asOf: today,
    platforms, series: [...series.values()], collection: 'STORE_REPORT_IMPORT',
    note: 'Store downloads, not sign-ups or unique people across platforms. Missing days are unavailable, not zero. Counts may be partial.' };
}
