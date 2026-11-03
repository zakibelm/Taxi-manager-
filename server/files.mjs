export function privateFiles(req,res,next) {
 let url=req.url || '';
 try { for(let i=0;i<3;i++) url=decodeURIComponent(url); } catch { res.statusCode=400;return res.end(); }
 const normalized=url.replaceAll('\\','/').toLowerCase();
 // Avant Vite : les noms sensibles sont refusés sans aucune lecture disque.
 if(/(?:^|\/)(?:\.env[^/]*|\.git|server)(?:[/?#;:.\\]|$)/.test(normalized) || /(?:^|\/)[^/?]+\.local(?:[?/#]|$)/.test(normalized)) {
  res.statusCode=403; return res.end('Forbidden');
 }
 next();
}
