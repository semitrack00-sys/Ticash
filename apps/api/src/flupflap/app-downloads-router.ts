import express, { type RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { AdminPermission, AdminRequest } from '../admin-access.js';
import { downloadQuery, downloadImport, parseDownloadReport, summarizeDownloads, type DownloadPlatform } from './app-downloads.js';
import { storeDownloadReport } from './app-downloads-repository.js';
export function createAppDownloadsRouter(options: { db: PrismaClient; enabled: boolean; authenticate: RequestHandler; permission: (p: AdminPermission) => RequestHandler }) {
  const router = express.Router();
  router.use(options.authenticate, options.permission('admin.view'), options.permission('recharge.view'));
  const appId = (platform: DownloadPlatform) => platform === 'ANDROID' ? (process.env.FLUPFLAP_PLAY_PACKAGE_NAME?.trim() || 'com.ticash.flupflap') : (process.env.FLUPFLAP_APPLE_APP_ID?.trim() || '');
  router.get('/', options.permission('recharge.reports'), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const parsed = downloadQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ code: 'INVALID_DOWNLOAD_QUERY' });
    if (!options.enabled) return res.status(503).json({ code: 'DOWNLOAD_REPORTS_UNAVAILABLE' });
    try {
      const rows = await options.db.flupFlapAppDownloadDaily.findMany({ where: { OR: [
        { platform: 'ANDROID', appId: appId('ANDROID') }, ...(appId('IOS') ? [{ platform: 'IOS', appId: appId('IOS') }] : []),
      ] } });
      return res.json({ ...summarizeDownloads(rows.map(row => ({ ...row, platform: row.platform as DownloadPlatform })), parsed.data), iosConfigured: Boolean(appId('IOS')) });
    } catch (error) {
      const future = error instanceof Error && error.message === 'FUTURE_REPORT_YEAR';
      return res.status(future ? 400 : 503).json({ code: future ? 'FUTURE_REPORT_YEAR' : 'DOWNLOAD_REPORTS_UNAVAILABLE' });
    }
  });
  router.post('/import', options.permission('recharge.configuration.manage'), async (req: AdminRequest, res) => {
    res.set('Cache-Control', 'no-store');
    const parsed = downloadImport.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: 'INVALID_STORE_REPORT' });
    let report;
    try { report = parseDownloadReport(parsed.data.platform, parsed.data.report, appId(parsed.data.platform)); }
    catch (error) { return res.status(400).json({ code: error instanceof Error ? error.message : 'INVALID_STORE_REPORT' }); }
    if (!options.enabled) return res.status(503).json({ code: 'DOWNLOAD_REPORTS_UNAVAILABLE' });
    try {
      await storeDownloadReport(options.db, parsed.data.platform, appId(parsed.data.platform), report, req.userId);
      return res.json({ importedDays: report.days.length, platform: parsed.data.platform });
    } catch { return res.status(503).json({ code: 'DOWNLOAD_REPORT_IMPORT_FAILED' }); }
  });
  return router;
}
