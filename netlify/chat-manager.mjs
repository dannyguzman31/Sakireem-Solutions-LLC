import {createHash, randomUUID} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function enforcementEnabled(publicMode, env=process.env) {
 const mode=env.CHAT_MANAGER_MODE || 'off';
 if(!['off','preview','all'].includes(mode))throw new Error('Invalid manager mode');
 return mode==='all'||(mode==='preview'&&!publicMode);
}
export function requestIdentity(payload){
 if(payload.requestId!==undefined&&(typeof payload.requestId!=="string"||!UUID.test(payload.requestId)))throw new Error('Invalid request ID');
 if(payload.conversationId!==undefined&&payload.conversationId!==null&&(typeof payload.conversationId!=="string"||!UUID.test(payload.conversationId)))throw new Error('Invalid conversation ID');
 return {requestId:payload.requestId||randomUUID(),conversationId:payload.conversationId||null};
}
export function createManager({env=process.env,fetchImpl=fetch}={}){
 const url=env.SUPABASE_URL?.trim(),key=env.SUPABASE_SECRET_KEY?.trim();
 if(!url||!key?.startsWith('sb_secret_'))throw new Error('Manager configuration missing');
 const parsed=new URL(url);
 if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.supabase.co')||parsed.pathname!=='/')throw new Error('Invalid Supabase project URL');
 async function rpc(name,body){
  const response=await fetchImpl(`${parsed.origin}/rest/v1/rpc/${name}`,{
   method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(7000)
  });
  if(!response.ok)throw new Error(`Manager database request failed (${response.status})`);
  return response.json();
 }
 return {
  admit:({bot,mode,conversationId,requestId,language,message,history})=>rpc('chat_admit',{
   p_bot:bot,p_mode:mode,p_session:conversationId,p_request:requestId,
   p_fingerprint:createHash('sha256').update(JSON.stringify({bot,mode,conversationId,language,message,history})).digest('hex')
  }),
  knowledge:(bot,language)=>rpc('chat_knowledge',{p_bot:bot,p_language:language}),
  passages:(bot,question)=>rpc('chat_source_passages',{p_bot:bot,p_question:question}),
  lead:(values)=>rpc('chat_submit_linked_lead',values),
  finish:(requestId,reply,usage={},question=null,language=null)=>rpc('chat_finish_with_transcript',{
   p_question:question,p_language:language,
   p_request:requestId,p_state:reply?'succeeded':'failed',p_reply:reply||null,
   p_input_tokens:Number.isSafeInteger(usage.input_tokens)?usage.input_tokens:0,
   p_output_tokens:Number.isSafeInteger(usage.output_tokens)?usage.output_tokens:0
  })
 };
}
export const statusFor = code => ({bot_paused:403,monthly_limit:429,conversation_limit:429,request_pending:409,request_failed:502,invalid_request:400,invalid_session:400,unknown_bot:404}[code]||503);
