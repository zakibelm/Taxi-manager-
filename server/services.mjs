import { HttpError, jsonBody, reply, sameOrigin, validate } from './http.mjs';
import { serviceInput, serviceId, serviceTypes, canonicalType } from './validation.mjs';
export function createServicesMiddleware({ getUser, provider, env = process.env }) {
 return async (req,res,next) => {
  const url = new URL(req.url, 'http://local');
  if(url.pathname !== '/api/services' && !url.pathname.startsWith('/api/services/')) return next();
  try {
   const user = await getUser(req);
   if(!user || !['admin','chauffeur'].includes(user.role)) throw new HttpError(401,'Connexion requise.');
   if(url.search) throw new HttpError(400,'Paramètres non autorisés.');
   sameOrigin(req);
   if(req.method==='GET' && url.pathname==='/api/services') {
    const rows = await provider.list(user);
    return reply(res,200,{services:rows.filter(s=>user.role==='admin'||s.driver_email===user.email)});
   }
   if(req.method==='POST' && url.pathname==='/api/services') {
    const body = await jsonBody(req);
    // Type : un de la liste du serveur ou un nouveau type saisi via « Autre » (format contrôlé, « Autre » lui-même refusé).
    const {id,...input}=validate(()=>{ const v=serviceInput(body,false); return {...v,type:canonicalType(v.type,serviceTypes(env))}; });
    if(id) {
     // Renvoi d'une course déjà reçue (file hors ligne) : on rend l'existante au lieu de créer un doublon.
     const existing=(await provider.list(user)).find(s=>s.id===id);
     if(existing) {
      if(existing.driver_email!==user.email) throw new HttpError(409,'Identifiant déjà utilisé.');
      return reply(res,200,{service:existing});
     }
    }
    const service = await provider.create({...input,driver_email:user.email},id);
    return reply(res,201,{service});
   }
   if(req.method==='DELETE' && url.pathname.startsWith('/api/services/')) {
    const id=validate(()=>serviceId(url.pathname.slice('/api/services/'.length)));
    const rows=await provider.list(user);
    const service=rows.find(s=>s.id===id && (user.role==='admin'||s.driver_email===user.email));
    if(!service) throw new HttpError(404,'Course introuvable.');
    await provider.delete(id,service.driver_email);
    return reply(res,200,{success:true});
   }
   throw new HttpError(405,'Méthode non autorisée.');
  } catch(error) { reply(res,error.status || 500,error.status ? {error:error.message}:{error:'Erreur interne.'}); }
 };
}
