import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
const BASE_URL=(__ENV.BASE_URL||'').replace(/\/$/,'');
if(!BASE_URL) throw new Error('BASE_URL is required. Use staging/non-production unless explicitly approved.');
if(/ticash-api\.onrender\.com/i.test(BASE_URL)&&__ENV.ALLOW_PRODUCTION!=='YES') throw new Error('Production load testing is blocked.');
const errors=new Rate('capacity_errors');
const LEVELS=[25,500,1000,2500,5000,10000];
const requested=Number(__ENV.CAPACITY_LEVEL||10000);
if(!LEVELS.includes(requested)) throw new Error('CAPACITY_LEVEL must be one of 25, 500, 1000, 2500, 5000, 10000.');
const stages=[
  {duration:'1m',target:requested},
  {duration:'2m',target:requested},
  {duration:'1m',target:0},
];
export const options={
  discardResponseBodies:true,
  scenarios:{worldwide_ramp:{executor:'ramping-vus',startVUs:1,stages,gracefulRampDown:'30s'}},
  thresholds:{http_req_failed:['rate<0.01'],capacity_errors:['rate<0.01'],http_req_duration:['p(95)<1000','p(99)<2000']}
};
export default function(){
  const h=http.get(BASE_URL+'/api/health',{tags:{endpoint:'health'}});
  const ok=check(h,{'health 200':r=>r.status===200});
  errors.add(!ok);
  sleep(1);
}
