export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function reply(res, status, data) {
  res.statusCode = status;
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}
export function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403,'Origine non autorisée.');
  if(req.headers.origin) {
    let host;
    try { host = new URL(req.headers.origin).host; } catch { throw new HttpError(403,'Origine non autorisée.'); }
    if(host !== req.headers.host) throw new HttpError(403,'Origine non autorisée.');
  }
}
export async function jsonBody(req, max = 8192) {
  if(!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415,'JSON requis.');
  let size = 0, chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if(size > max) throw new HttpError(413,'Requête trop volumineuse.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400,'JSON invalide.'); }
}
export function validate(fn) { try { return fn(); } catch { throw new HttpError(400,'Entrée invalide.'); } }
