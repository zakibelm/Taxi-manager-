import test from 'node:test';
import assert from 'node:assert/strict';
import { privateFiles } from './files.mjs';
test('private path variants are rejected before filesystem access',()=>{
 for(const url of ['/admin-auth.local?raw','/@fs/C:/project/admin-auth.local','/admin-auth.local?raw??','/admin-auth.local%5c','/%61dmin-auth.local','/.env.production','/.env','/.git/config','/server/auth.mjs']) {
  let next=false; const res={statusCode:200,end(){}};
  privateFiles({url},res,()=>{next=true;});
  assert.equal(res.statusCode,403,url);assert.equal(next,false,url);
 }
 let next=false; privateFiles({url:'/assets/app.js'},{statusCode:200,end(){}},()=>{next=true;}); assert.equal(next,true);
});
