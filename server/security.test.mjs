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
 // Seule origine externe : l'hôte des tuiles de la carte, et seulement pour les images.
 assert.deepEqual(headers['Content-Security-Policy'].match(/https?:\/\/[^\s;]+/g),['https://tile.openstreetmap.org']);
 assert.match(headers['Content-Security-Policy'],/img-src 'self' data: https:\/\/tile\.openstreetmap\.org;/);
 assert.doesNotMatch(headers['Content-Security-Policy'],/(?:script|connect|default)-src[^;]*https?:/);
 assert.match(headers['Permissions-Policy'],/geolocation=\(self\)/); // la case « Localiser l'appel » doit fonctionner sur le web
 assert.match(headers['Content-Security-Policy'],/script-src 'self' ;/);
 assert.match(headers['Content-Security-Policy'],/frame-ancestors 'none'/);
 assert.equal(headers['X-Content-Type-Options'],'nosniff');
 assert.equal(headers['Referrer-Policy'],'no-referrer');
});
test('hôte de tuiles : remplaçable par une adresse HTTPS valide, sinon OpenStreetMap',()=>{
 const csp=env=>{const h={};securityHeaders(env)({}, {setHeader:(k,v)=>h[k]=v},()=>{});return h['Content-Security-Policy'];};
 assert.match(csp({NODE_ENV:'production',MAP_TILE_HOST:'https://tiles.example.org'}),/img-src 'self' data: https:\/\/tiles\.example\.org;/);
 for(const bad of ['http://tiles.example.org','https://x.org/path','*','https://a.org; script-src *']) assert.match(csp({NODE_ENV:'production',MAP_TILE_HOST:bad}),/tile\.openstreetmap\.org/);
});
test('la politique de sécurité autorise exactement l’hôte des tuiles utilisé par la carte',async()=>{
 const { readFile } = await import('node:fs/promises');
 const config=await readFile(new URL('../utils/mapConfig.ts',import.meta.url),'utf8');
 const tileUrl=config.match(/url:\s*'(https:\/\/[^']+)'/)[1];
 const origin=new URL(tileUrl.replace(/\{[a-z]\}/g,'1')).origin;
 const headers={};
 securityHeaders({NODE_ENV:'production'})({}, {setHeader:(key,value)=>headers[key]=value},()=>{});
 assert.ok(headers['Content-Security-Policy'].includes(`img-src 'self' data: ${origin};`),`CSP doit autoriser ${origin}`);
});
