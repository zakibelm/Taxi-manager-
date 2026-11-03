export function sessionCookie(req, value, age, env = process.env) {
 const secure=env.NODE_ENV === 'production' || req.socket.encrypted || req.headers['x-forwarded-proto']?.split(',')[0].trim() === 'https';
 return `taxi_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`;
}
export function securityHeaders(env = process.env) {
 return (req,res,next) => {
  const dev=env.NODE_ENV !== 'production';
  res.setHeader('Content-Security-Policy',[
   "default-src 'self'", `script-src 'self' ${dev ? "'unsafe-inline' " : ''}`,
   "style-src 'self' 'unsafe-inline'", "font-src 'self'", "img-src 'self' data:",
   `connect-src 'self'${dev ? ' ws://127.0.0.1:* ws://localhost:*' : ''}`,
   "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"
  ].join('; '));
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if(env.NODE_ENV==='production') res.setHeader('Strict-Transport-Security','max-age=31536000');
  next();
 };
}
