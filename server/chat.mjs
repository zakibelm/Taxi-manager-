import { HttpError, jsonBody, reply, sameOrigin, validate } from './http.mjs';
import { object, text } from './validation.mjs';
import { hasPersonalData, PERSONAL_DATA_MESSAGE } from './privacy.mjs';
export function createChatMiddleware({getUser,provider,services,companies,now=Date.now}) {
 const quotas=new Map();
 return async(req,res,next)=>{
  const url=new URL(req.url,'http://local');
  if(url.pathname!=='/api/chat' && url.pathname!=='/api/chat/models') return next();
  try {
   const user=await getUser(req);
   if(!user || !['admin','chauffeur'].includes(user.role)) throw new HttpError(401,'Connexion requise.');
   if(url.pathname==='/api/chat/models'){
    if(req.method!=='GET') throw new HttpError(405,'Méthode non autorisée.');
    return reply(res,200,provider.models?provider.models():{models:[],default:null});
   }
   if(req.method!=='POST') throw new HttpError(405,'Méthode non autorisée.');
   if(url.search) throw new HttpError(400,'Paramètres non autorisés.');
   sameOrigin(req);
   const body=await jsonBody(req,8192);
   const input=validate(()=>{
    object(body,['message','includeServices','model']);
    if(typeof body.includeServices!=='boolean') throw new Error('boolean');
    return {message:text(body.message,2000),includeServices:body.includeServices,model:body.model===undefined?undefined:text(body.model,80)};
   });
   if(hasPersonalData(input.message)) throw new HttpError(400,PERSONAL_DATA_MESSAGE);
   for(const [key,value] of quotas) if(value.reset<=now()) quotas.delete(key);
   const quota=quotas.get(user.id) || {count:0,reset:now()+60000};
   if(quota.count>=10) {res.setHeader('Retry-After',String(Math.ceil((quota.reset-now())/1000)));throw new HttpError(429,'Limite de 10 demandes par minute atteinte.');}
   if(quotas.size>=5000 && !quotas.has(user.id)) throw new HttpError(503,'Serveur occupé.');
   quota.count++;quotas.set(user.id,quota);
   const rows=input.includeServices ? await services.list(user) : [];
   const visible=rows.filter(s=>user.role==='admin'||s.driver_email===user.email);
   // Prévisions de la compagnie (membres approuvés qui partagent, minimum 3 chauffeurs) : réservées aux chauffeurs qui ont demandé leurs statistiques.
   const company=input.includeServices && companies && user.role==='chauffeur' ? await companies.digest(user).catch(()=>null) : null;
   return reply(res,200,{response:await provider.complete(input.message,visible,input.model,{zonesCompagnie:company})});
  } catch(error) { reply(res,error.status || 500,{error:error.status ? error.message : 'Erreur interne.'}); }
 };
}
