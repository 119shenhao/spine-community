import {now,stmt} from './core';

// Once per Worker isolate per hour, not once per pageview.
// Expired rate-limit records and old visitor records are safe to remove after
// their retention windows; both predicates have a supporting index.
let nextCleanupAt=0;
export function scheduleMaintenance(db:D1Database,ctx?:ExecutionContext):void{
 if(!ctx)return;
 const current=now();
 if(current<nextCleanupAt)return;
 nextCleanupAt=current+3600;
 ctx.waitUntil(db.batch([
   stmt(db,"DELETE FROM traffic_visitors WHERE day_utc<date('now','-2 days')"),
   stmt(db,'DELETE FROM rate_limits WHERE expires_at<?',current-86400)
 ]).catch(()=>{
   nextCleanupAt=now()+300; // Retriable; never block an ordinary request.
   console.warn('d1_maintenance_retry');
 }));
}
