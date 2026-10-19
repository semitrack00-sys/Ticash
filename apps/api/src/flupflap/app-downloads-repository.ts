import type { PrismaClient } from '@prisma/client';
import type { DownloadPlatform, parseDownloadReport } from './app-downloads.js';
export async function storeDownloadReport(db: PrismaClient, platform: DownloadPlatform, appId: string,
  report: ReturnType<typeof parseDownloadReport>, actorId?: string) {
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'flupflap-downloads:' + platform + ':' + appId}))`;
    for (const day of report.days) {
      const reportDate = new Date(day.date);
      await tx.flupFlapAppDownloadDaily.upsert({ where: { platform_appId_reportDate: { platform, appId, reportDate } },
        create: { platform, appId, reportDate, downloads: day.downloads, reportHash: report.hash },
        update: { downloads: day.downloads, reportHash: report.hash, importedAt: new Date() } });
    }
    await tx.auditLog.create({ data: { userId: actorId, action: 'FLUPFLAP_DOWNLOAD_REPORT_IMPORTED', entity: 'FlupFlapAppDownloadDaily',
      metadata: { platform, appId, reportHash: report.hash, reportedDays: report.days.length } } });
  }, { timeout: 15_000 });
}
