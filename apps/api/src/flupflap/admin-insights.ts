import express, { type RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { analyticsWindow } from '../admin-analytics.js';
import { adminCountry, adminClientCountry } from '../admin-country.js';
import type { AdminPermission, AdminRequest } from '../admin-access.js';

export const insightMetrics = ['clients.total','clients.active','clients.new','clients.today','clients.week','clients.month','clients.year',
  'clients.guest','clients.registered','transactions.total','transactions.successful','transactions.pending','transactions.failed',
  'transactions.reversed','volume','fees','average','successRate'] as const;
const schema = z.object({metric:z.enum(insightMetrics).default('clients.total'),period:z.enum(['today','7d','30d','year','custom']).default('30d'),
  mode:z.enum(['live','test']).default('live'),start:z.iso.date().optional(),end:z.iso.date().optional(),asOf:z.iso.datetime({offset:true}).optional(),
  offset:z.coerce.number().int().min(0).max(1000000).default(0),q:z.string().trim().max(100).default(''),
  country:z.string().regex(/^(?:[A-Z]{2}|UNKNOWN)$/).optional()}).strict();
export function insightRequest(input:unknown, now=new Date()) {
  const query=schema.parse(input); const asOf=query.asOf?new Date(query.asOf):now;
  if(asOf>now || asOf<new Date('2020-01-01'))throw new Error('INVALID_INSIGHT_PERIOD');
  const window=analyticsWindow({period:query.period,mode:query.mode,...(query.start?{start:query.start}:{}),...(query.end?{end:query.end}:{})},asOf);
  return {...query,window,kind:query.metric.startsWith('clients.')?'CLIENTS' as const:'TRANSACTIONS' as const};
}
export type InsightRequest=ReturnType<typeof insightRequest>;

/** Read-only, bound SQL. Counts, countries and one page share a single snapshot. */
export function insightQuery(request:InsightRequest, includeCustomerDetails:boolean) {
  const {window,metric,kind,country,q,offset}=request; const {start,end,mode}=window;
  const clientFilter = metric==='clients.active'?Prisma.sql`EXISTS(SELECT 1 FROM records r WHERE r.customer=c.id AND r.created>=${start})`:
    metric==='clients.new'?Prisma.sql`c.created>=${start}`:
    metric==='clients.today'?Prisma.sql`c.created>=date_trunc('day',${end}::timestamp)`:
    metric==='clients.week'?Prisma.sql`c.created>=date_trunc('week',${end}::timestamp)`:
    metric==='clients.month'?Prisma.sql`c.created>=date_trunc('month',${end}::timestamp)`:
    metric==='clients.year'?Prisma.sql`c.created>=date_trunc('year',${end}::timestamp)`:
    metric==='clients.guest'?Prisma.sql`c.guest`:metric==='clients.registered'?Prisma.sql`NOT c.guest`:Prisma.sql`true`;
  const outcome=metric==='transactions.successful'||['volume','fees','average'].includes(metric)?Prisma.sql`r.outcome='SUCCESS'`:
    metric==='transactions.failed'?Prisma.sql`r.outcome='FAILED'`:metric==='transactions.pending'?Prisma.sql`r.outcome='PENDING'`:
    metric==='transactions.reversed'?Prisma.sql`r.outcome='REVERSED'`:Prisma.sql`true`;
  const pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  const customerJson=Prisma.sql`jsonb_build_object('id',c.id,'firstName',c."firstName",'lastName',c."lastName",'email',c.email,'phone',c.phone,
    'countryCode',c.country,'phoneCountryCode',NULLIF(${adminCountry(Prisma.sql`c."phoneCountryCode"`)},'UNKNOWN'),
    'profileCountryCode',NULLIF(${adminCountry(Prisma.sql`c."countryCode"`)},'UNKNOWN'),
    'countrySource',CASE WHEN ${adminCountry(Prisma.sql`c."phoneCountryCode"`)} <> 'UNKNOWN' THEN 'PHONE_NUMBER' WHEN c.country <> 'UNKNOWN' THEN 'SAVED_PROFILE' ELSE 'UNKNOWN' END,'guest',c.guest,'status',c.status,'rechargeRestricted',c."rechargeRestricted",'createdAt',c.created,
    'lastLoginAt',c."lastLoginAt",'emailVerified',c."emailVerifiedAt" IS NOT NULL,'phoneVerified',c."phoneVerifiedAt" IS NOT NULL)`;
  const selected=kind==='CLIENTS'?Prisma.sql`
    SELECT c.id,c.created,c.country,${customerJson} || jsonb_build_object(
      'transactionCount',(SELECT count(*) FROM records r WHERE r.customer=c.id),
      'successfulCount',(SELECT count(*) FROM records r WHERE r.customer=c.id AND r.outcome='SUCCESS'),
      'spentCents',(SELECT COALESCE(sum(r.total),0)::text FROM records r WHERE r.customer=c.id AND r.outcome='SUCCESS')) AS detail,
      concat_ws(' ',c.id,c."firstName",c."lastName",c.email,c.phone) AS search,c.phone AS phone_search
    FROM customers c WHERE ${clientFilter}`:Prisma.sql`
    SELECT r.id,r.created,r.country,jsonb_build_object('id',r.id,'customerId',r.customer,'createdAt',r.created,'status',r.status,
      'paymentStatus',r.payment,'outcome',r.outcome,'countryCode',r.country,'operator',r.operator,'product',r.product,'kind',r.kind,
      'amountCents',r.amount::text,'feeCents',r.fee::text,'totalCents',r.total::text,'deliveredValue',r.delivered,'deliveredCurrency',r.currency,
      'deliveredAt',r."deliveredAt",'failedAt',r."failedAt",'refundedAt',r."refundedAt",'failureCode',r."failureCode",
      'paymentRecoveryCode',r."paymentRecoveryCode",'paymentProvider',r."paymentProvider",'provider',r.provider,
      'recipientPhone',CASE WHEN ${includeCustomerDetails} THEN r.recipient ELSE NULL END,
      'customer',CASE WHEN ${includeCustomerDetails} AND c.id IS NOT NULL THEN ${customerJson} ELSE NULL END) AS detail,
      concat_ws(' ',r.id,r.operator,r.product,r.status,CASE WHEN ${includeCustomerDetails} THEN concat_ws(' ',c."firstName",c."lastName",c.email,c.phone,r.recipient) ELSE '' END) AS search,
      CASE WHEN ${includeCustomerDetails} THEN concat_ws(' ',c.phone,r.recipient) ELSE '' END AS phone_search
    FROM records r LEFT JOIN customers c ON c.id=r.customer WHERE r.created>=${start} AND ${outcome}`;
  return Prisma.sql`WITH customers AS (
    SELECT c.*,c."createdAt" AS created,c."guestExpiresAt" IS NOT NULL AS guest,
      ${adminClientCountry(Prisma.sql`c."phoneCountryCode"`, Prisma.sql`c."countryCode"`)} AS country
    FROM "FlupFlapCustomer" c WHERE c."createdAt"<${end}
  ),records AS (
    SELECT t.id,t."flupFlapCustomerId" AS customer,t."createdAt" AS created,t.status::text AS status,t."paymentStatus"::text AS payment,
      CASE WHEN t.status='REFUNDED' OR t."paymentStatus" IN ('REFUNDED','VOIDED') THEN 'REVERSED'
        WHEN t.status='FAILED' OR t."paymentStatus"='FAILED' THEN 'FAILED'
        WHEN t.status='DELIVERED' AND t."paymentStatus"='CAPTURED' THEN 'SUCCESS' ELSE 'PENDING' END AS outcome,
      (t."providerAmount"*100)::numeric(38,0) AS amount,(t."feeUsd"*100)::numeric(38,0) AS fee,(t."totalChargeUsd"*100)::numeric(38,0) AS total,
      ${adminCountry(Prisma.sql`t."countryCode"`)} AS country,
      t."operatorName" AS operator,t."productName" AS product,t.kind::text AS kind,t."recipientPhone" AS recipient,
      t."deliveredValue" AS delivered,t."deliveredCurrency" AS currency,t."deliveredAt",t."failedAt",t."refundedAt",t."failureCode",t."paymentRecoveryCode",
      t."paymentProvider"::text AS "paymentProvider",t.provider::text AS provider
    FROM "MobileTopUpTransaction" t WHERE t."flupFlapCustomerId" IS NOT NULL AND t."userId" IS NULL AND t."testMode"=${mode==='test'}
      AND t."paymentEnvironment"::text=${mode==='test'?'SANDBOX':'PRODUCTION'} AND t."rechargeEnvironment"::text=${mode==='test'?'SANDBOX':'PRODUCTION'}
      AND t."providerCurrency"='USD' AND t."createdAt"<${end}
  ),selected AS (${selected}),filtered AS (SELECT * FROM selected WHERE (${country??null}::text IS NULL OR country=${country??null}) AND
    (search ILIKE ${pattern} OR (${q.replace(/\D/g,'').length>=3} AND regexp_replace(coalesce(phone_search,''),'[^0-9]','','g') LIKE ${'%'+q.replace(/\D/g,'')+'%'}))),
  page AS (SELECT detail FROM filtered ORDER BY created DESC,id DESC OFFSET ${offset} LIMIT 25),
  countries AS (SELECT country AS code,count(*)::int AS total FROM selected GROUP BY country ORDER BY count(*) DESC,country)
  SELECT jsonb_build_object('rows',(SELECT COALESCE(jsonb_agg(detail),'[]'::jsonb) FROM page),'total',(SELECT count(*) FROM filtered),
    'overallTotal',(SELECT count(*) FROM selected),'countries',(SELECT COALESCE(jsonb_agg(countries),'[]'::jsonb) FROM countries),
    'metricValue',${metric==='volume'?Prisma.sql`(SELECT COALESCE(sum((detail->>'amountCents')::numeric),0)::text FROM filtered)`:
      metric==='fees'?Prisma.sql`(SELECT COALESCE(sum((detail->>'feeCents')::numeric),0)::text FROM filtered)`:
      metric==='average'?Prisma.sql`(SELECT round(avg((detail->>'amountCents')::numeric))::text FROM filtered)`:
      metric==='successRate'?Prisma.sql`(SELECT CASE WHEN count(*)=0 THEN NULL ELSE round(100.0*count(*) FILTER(WHERE detail->>'outcome'='SUCCESS')/count(*),2)::text END FROM filtered)`:
      Prisma.sql`(SELECT count(*)::text FROM filtered)`}) AS data`;
}

export async function readInsights(execute:(sql:Prisma.Sql)=>Promise<{data:Record<string,unknown>}[]>,request:InsightRequest,customerDetails:boolean) {
  const [row]=await execute(insightQuery(request,customerDetails)); if(!row)throw new Error('INSIGHTS_UNAVAILABLE');
  const names=new Intl.DisplayNames(['en'],{type:'region'});
  const countries=(row.data.countries as {code:string;total:number}[]).map(c=>({...c,name:c.code==='UNKNOWN'?'Unknown / not recorded':names.of(c.code)??c.code}));
  const countryName=(code:unknown)=>typeof code==='string' && code!=='UNKNOWN' ? names.of(code)??code : null;
  const decorate=(c:Record<string,unknown>)=>({...c,countryName:countryName(c.countryCode),phoneCountryName:countryName(c.phoneCountryCode),profileCountryName:countryName(c.profileCountryCode)});
  const rows=(row.data.rows as Record<string,unknown>[]).map(r=>request.kind==='CLIENTS'?decorate(r):({...r,customer:r.customer?decorate(r.customer as Record<string,unknown>):null}));
  const total=Number(row.data.total);
  return {...row.data,rows,countries,domain:'FLUPFLAP',kind:request.kind,metric:request.metric,mode:request.mode,
    start:request.window.start.toISOString(),end:request.window.end.toISOString(),asOf:request.asOf??request.window.end.toISOString(),
    offset:request.offset,limit:25,nextOffset:request.offset+25<total?request.offset+25:null};
}

export function createInsightsRouter(options:{authenticate:RequestHandler;permission:(p:AdminPermission)=>RequestHandler;
  execute?: (sql:Prisma.Sql)=>Promise<{data:Record<string,unknown>}[]>}) {
  const router=express.Router();
  for(const [path,directory] of [['/analytics/details',false],['/customer-directory',true]] as const) {
    router.get(path,options.authenticate,options.permission('recharge.view'),...(directory?[]:[options.permission('recharge.reports')]),async(req:AdminRequest,res,next)=>{
      res.set('Cache-Control','no-store');
      let parsed:InsightRequest;
      try { parsed=insightRequest(directory?{...req.query,metric:'clients.total'}:req.query); } catch {res.status(400).json({code:'INVALID_INSIGHT_QUERY'});return;}
      const needed=parsed.kind==='CLIENTS'?'recharge.customers.view':'recharge.transactions.view';
      options.permission(needed)(req,res,async(error?:unknown)=>{
        if(error){next(error);return;}
        if(!options.execute){res.status(503).json({code:'INSIGHTS_UNAVAILABLE'});return;}
        try {res.json(await readInsights(options.execute,parsed,req.permissions?.includes('recharge.customers.view')===true));}
        catch {res.status(503).json({code:'INSIGHTS_UNAVAILABLE'});}
      });
    });
  }
  return router;
}
