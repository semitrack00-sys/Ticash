import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { parseDownloadReport, summarizeDownloads, reportingDate } from '../src/flupflap/app-downloads.js';
import { createApp, resetStore } from '../src/app.js';
const now = new Date('2026-10-19T05:00:00Z'), appId = 'com.ticash.flupflap';
const google = 'Date,Package Name,Country,Daily User Installs\r\n2026-10-17,com.ticash.flupflap,US,3\r\n2026-10-17,com.ticash.flupflap,HT,2\r\n2026-10-18,com.ticash.flupflap,US,0';
const appleHeader = 'Begin Date\tEnd Date\tApple Identifier\tProduct Type Identifier\tUnits\tDevice\tTitle';
const apple = `${appleHeader}\n10/17/2026\t10/17/2026\t12345\t1F\t4.00\tiPhone\tFlupFlap\n10/17/2026\t10/17/2026\t12345\t3F\t9\tiPhone\tFlupFlap\n10/17/2026\t10/17/2026\t12345\t7F\t20\tiPhone\tFlupFlap\n10/17/2026\t10/17/2026\t12345\t1F\t10\tDesktop\tFlupFlap\n10/17/2026\t10/17/2026\t12345\t1F\t-1\tiPhone\tFlupFlap`;
describe('official store imports', () => {
  it('aggregates country rows and retains actual zero days', () => {
    expect(parseDownloadReport('ANDROID', '\uFEFF' + google, appId, now).days).toEqual([{ date: '2026-10-17', downloads: 5 }, { date: '2026-10-18', downloads: 0 }]);
    expect(parseDownloadReport('ANDROID', google, appId, now).hash).toHaveLength(64);
  });
  it('counts initial Apple downloads and excludes updates, redownloads and refunds', () => {
    expect(parseDownloadReport('IOS', apple, '12345', now).days).toEqual([{ date: '2026-10-17', downloads: 4 }]);
    expect(() => parseDownloadReport('IOS', apple, '', now)).toThrow('STORE_APP_NOT_CONFIGURED');
    expect(() => parseDownloadReport('IOS', apple.replaceAll('10/17/2026\t10/17/2026', '10/17/2026\t10/18/2026'), '12345', now)).toThrow('USE_DAILY_APPLE_REPORT');
  });
  it.each([
    [google + '\n2026-10-17,com.ticash.flupflap,US,3', 'DUPLICATE_REPORT_ROW'],
    [google.replace('US,3', 'ALL,3'), 'USE_COMPLETE_PLAY_COUNTRY_REPORT'],
    [google.replace('Country', 'Device'), 'USE_PLAY_COUNTRY_REPORT'],
    [google.replace('US,3', 'US,-1'), 'INVALID_DOWNLOAD_COUNT'],
    [google.replace('US,3', 'US,3.5'), 'INVALID_DOWNLOAD_COUNT'],
    [google.replaceAll('2026-10-17', '2026-10-20'), 'INVALID_REPORT_DATE'],
    [google.replaceAll('2026-10-17', '2026-02-30'), 'INVALID_REPORT_DATE'],
    ['Date,Package Name,Daily User Installs\n2026-10-17,other.app,10', 'REPORT_APP_NOT_FOUND'],
    ['Date,Package Name,Daily Device Installs\n2026-10-17,com.ticash.flupflap,10', 'INVALID_STORE_REPORT_HEADERS'],
  ])('rejects unsuitable reports: %s', (report, code) => expect(() => parseDownloadReport('ANDROID', report, appId, now)).toThrow(code));
});
const rows = [
  { platform: 'ANDROID' as const, reportDate: new Date('2026-10-17'), downloads: 5, importedAt: now },
  { platform: 'ANDROID' as const, reportDate: new Date('2026-10-18'), downloads: 0, importedAt: now },
  { platform: 'IOS' as const, reportDate: new Date('2026-10-17'), downloads: 4, importedAt: now },
];
describe('download report windows', () => {
  it('uses Pacific dates and Monday weeks with explicit partial coverage', () => {
    expect(reportingDate(now)).toBe('2026-10-18');
    const result = summarizeDownloads(rows, { year: 2026, groupBy: 'week' }, now);
    expect(result.platforms[0]).toMatchObject({ today: { count: 0, reportedDays: 1, expectedDays: 1 }, week: { count: 5, reportedDays: 2, expectedDays: 7 }, month: { count: 5, reportedDays: 2, expectedDays: 18 } });
    expect(result.platforms[1]?.today.count).toBeNull();
    expect(result.series.at(-1)).toMatchObject({ date: '2026-10-12', android: 5, ios: 4 });
  });
  it('distinguishes missing dates from zero and groups by month/year', () => {
    const result = summarizeDownloads(rows, { year: 2026, groupBy: 'day' }, now);
    expect(result.series.at(-1)).toMatchObject({ date: '2026-10-18', android: 0, ios: null });
    expect(result.series[0]?.android).toBeNull();
    expect(summarizeDownloads(rows, { year: 2026, groupBy: 'month' }, now).series.at(-1)).toMatchObject({ date: '2026-10', android: 5, ios: 4, expectedDays: 18 });
    expect(summarizeDownloads(rows, { year: 2026, groupBy: 'year' }, now).series).toHaveLength(1);
    expect(summarizeDownloads([], { groupBy: 'year' }, now).platforms[0]?.year.count).toBeNull();
    expect(() => summarizeDownloads([], { year: 2027, groupBy: 'day' }, now)).toThrow('FUTURE_REPORT_YEAR');
  });
  it('retains leap days and partial weeks on calendar-year boundaries', () => {
    const result = summarizeDownloads([], { year: 2024, groupBy: 'day' }, now);
    expect(result.series).toHaveLength(366);
    expect(result.series.some(day => day.date === '2024-02-29')).toBe(true);
    expect(summarizeDownloads([], { year: 2026, groupBy: 'week' }, now).series[0]?.date).toBe('2025-12-29');
  });
});
describe('download-report authorization', () => {
  beforeEach(resetStore);
  it('requires staff reports access and management permission for imports', async () => {
    const app = createApp(), path = '/api/admin/flupflap/downloads';
    await request(app).get(path).expect(401);
    await request(app).post(path + '/import').send({}).expect(401);
    const customer = await request(app).post('/api/auth/register').send({ email: 'downloads@example.test', password: 'correct-horse-42', firstName: 'Test', lastName: 'Downloads' }).expect(201);
    const auth = { Authorization: `Bearer ${customer.body.accessToken}` };
    await request(app).get(path).set(auth).expect(403);
    const staff = await request(app).post('/api/auth/login').send({ email: 'admin@ticash.local', password: 'AdminPass123!' }).expect(200);
    const admin = { Authorization: `Bearer ${staff.body.accessToken}` };
    await request(app).patch(`/api/admin/staff/${customer.body.user.id}/role`).set(admin).send({ role: 'READ_ONLY', reason: 'Verify store reporting permissions' }).expect(200);
    await request(app).get(path).set(auth).expect(503);
    await request(app).post(path + '/import').set(auth).send({ platform: 'ANDROID', report: google }).expect(403);
    await request(app).get(path + '?year=garbage').set(admin).expect(400);
    await request(app).post(path + '/import').set(admin).send({ platform: 'ANDROID', report: 'not a report' }).expect(400);
    const response = await request(app).get(path).set(admin).expect(503);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
