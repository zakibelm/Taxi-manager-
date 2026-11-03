import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionCookie, securityHeaders } from './security.mjs';
test('secure session cookie in production and on forwarded HTTPS, including logout',()=>{
 const req={socket:{},headers:{}};
 assert.match(sessionCookie(req,'token',60,{NODE_ENV:'production'}),/; Secure$/);
 assert.match(sessionCookie({...req,headers:{'x-forwarded-proto':'https'}},'',0,{}),/Max-Age=0; Secure$/);
 assert.doesNotMatch(sessionCookie(req,'token',60,{NODE_ENV:'development'}),/; Secure/);
});
test('security headers prohibit framing, MIME sniffing and referrer disclosure',()=>{
 const headers={}; let called=false;
 securityHeaders({NODE_ENV:'production'})({}, {setHeader:(key,value)=>headers[key]=value},()=>{called=true;});
 assert.equal(called,true);
 assert.doesNotMatch(headers['Content-Security-Policy'],/https?:\/\//);
 assert.match(headers['Content-Security-Policy'],/script-src 'self' ;/);
 assert.match(headers['Content-Security-Policy'],/frame-ancestors 'none'/);
 assert.equal(headers['X-Content-Type-Options'],'nosniff');
 assert.equal(headers['Referrer-Policy'],'no-referrer');
});
