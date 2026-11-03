import { HttpError, jsonBody, reply, sameOrigin, validate } from './http.mjs';
import { object, text } from './validation.mjs';
import { hasPersonalData, PERSONAL_DATA_MESSAGE } from './privacy.mjs';
export function createChatMiddleware({getUser,provider,services,now=Date.now}) {
 const quotas=new Map();
 return async(req,res,next)=>{
  const url=new URL(req.url,'http://local');
  if(url.pathname!=='/api/chat') return next();
  try {
   const user=await getUser(req);
   if(!user || !['admin','chauffeur'].includes(user.role)) throw new HttpError(401,'Connexion requise.');
   if(req.method!=='POST') throw new HttpError(405,'Méthode non autorisée.');
   if(url.search) throw new HttpError(400,'Paramètres non autorisés.');
   sameOrigin(req);
   const body=await jsonBody(req,8192);
   const input=validate(()=>{
    object(body,['message','includeServices']);
    if(typeof body.includeServices!=='boolean') throw new Error('boolean');
    return {message:text(body.message,2000),includeServices:body.includeServices};
   });
   if(hasPersonalData(input.message)) throw new HttpError(400,PERSONAL_DATA_MESSAGE);
   for(const [key,value] of quotas) if(value.reset<=now()) quotas.delete(key);
   const quota=quotas.get(user.id) || {count:0,reset:now()+60000};
   if(quota.count>=10) {res.setHeader('Retry-After',String(Math.ceil((quota.reset-now())/1000)));throw new HttpError(429,'Limite de 10 demandes par minute atteinte.');}
   if(quotas.size>=5000 && !quotas.has(user.id)) throw new HttpError(503,'Serveur occupé.');
   quota.count++;quotas.set(user.id,quota);
   const rows=input.includeServices ? await services.list(user) : [];
   const visible=rows.filter(s=>user.role==='admin'||s.driver_email===user.email);
   return reply(res,200,{response:await provider.complete(input.message,visible)});
  } catch(error) { reply(res,error.status || 500,{error:error.status ? error.message : 'Erreur interne.'}); }
 };
}
