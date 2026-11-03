import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIP, createLoginLimiter } from './limiter.mjs';
test('progressive cooldown isolates identifiers and distrusts forwarded IP by default',()=>{
 let time=1000;const limit=createLoginLimiter(()=>time);
 limit.failure('ip|attacker');assert.equal(limit.retryAfter('ip|attacker'),1);
 assert.equal(limit.retryAfter('ip|admin'),0);
 time+=1000;limit.failure('ip|attacker');assert.equal(limit.retryAfter('ip|attacker'),2);
 limit.success('ip|attacker');assert.equal(limit.retryAfter('ip|attacker'),0);
 const req={socket:{remoteAddress:'127.0.0.1'},headers:{'x-forwarded-for':'203.0.113.10'}};
 assert.equal(clientIP(req,{}),'127.0.0.1');
 assert.equal(clientIP(req,{TRUST_PROXY:'1'}),'203.0.113.10');
});
test('one address rotating identifiers is throttled after its free failures',()=>{
 let time=1000;const limit=createLoginLimiter(()=>time);
 for(let i=0;i<20;i++) limit.failure('203.0.113.7|user'+i);
 assert.equal(limit.retryAfter('203.0.113.7|another-new-user'),0);
 limit.failure('203.0.113.7|user20');
 assert.ok(limit.retryAfter('203.0.113.7|brand-new-user')>=1);
 assert.equal(limit.retryAfter('198.51.100.9|brand-new-user'),0);
});
test('failures spread over many addresses back off a single account, capped at 60 s',()=>{
 let time=1000;const limit=createLoginLimiter(()=>time);
 for(let i=0;i<60;i++) limit.failure('10.0.0.'+i+'|admin');
 const wait=limit.retryAfter('10.9.9.9|admin');
 assert.ok(wait>=1 && wait<=60);
 assert.equal(limit.retryAfter('10.9.9.9|someone-else'),0);
 time+=16*60*1000;assert.equal(limit.retryAfter('10.9.9.9|admin'),0);
});
test('flooding the tables cannot evict the backoff of a targeted account',()=>{
 let time=1000;const limit=createLoginLimiter(()=>time);
 limit.failure('1.1.1.1|admin');limit.failure('1.1.1.1|admin');
 for(let i=0;i<10050;i++) limit.failure('flood'+i+'|user'+i);
 assert.ok(limit.retryAfter('1.1.1.1|admin')>=1,'target keeps its backoff');
 assert.equal(limit.retryAfter('new-ip|new-user'),60,'untracked keys fail closed while full');
 time+=16*60*1000;assert.equal(limit.retryAfter('new-ip|new-user'),0,'recovers when the window expires');
});
