import {isDashboardOrigin} from '../dashboard-origins.mjs';

// Public configuration only. No secrets, customer records, or usage are exposed.
export const config={path:'/api/chat-status'};
export default async function status(request){
 if(request.method!=='GET')return new Response(null,{status:405});
 const origin=request.headers.get('origin');
 const mode=process.env.CHAT_MANAGER_MODE||'off';
 const valid=['off','preview','all'].includes(mode);
 const configured=Boolean(process.env.SUPABASE_URL?.trim()&&process.env.SUPABASE_SECRET_KEY?.trim().startsWith('sb_secret_'));
 return Response.json({mode:valid?mode:'invalid',configured},{headers:{
  'Cache-Control':'no-store',
  ...(isDashboardOrigin(origin)?{'Access-Control-Allow-Origin':origin}:{}),
  'Vary':'Origin'
 }});
}
