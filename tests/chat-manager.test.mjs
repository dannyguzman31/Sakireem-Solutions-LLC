import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {enforcementEnabled,requestIdentity,createManager} from '../netlify/chat-manager.mjs';
import chat from '../netlify/functions/chat.mjs';
test('rollout modes and malformed identities',()=>{
 assert.equal(enforcementEnabled(true,{CHAT_MANAGER_MODE:'preview'}),false);
 assert.equal(enforcementEnabled(false,{CHAT_MANAGER_MODE:'preview'}),true);
 assert.equal(enforcementEnabled(true,{CHAT_MANAGER_MODE:'all'}),true);
 assert.equal(enforcementEnabled(true,{}),false);
 assert.throws(()=>enforcementEnabled(true,{CHAT_MANAGER_MODE:'typo'}));
 assert.throws(()=>requestIdentity({conversationId:'bad'}));
 assert.throws(()=>requestIdentity({requestId:[randomUUID()]}));
 assert.ok(requestIdentity({}).requestId);
 assert.throws(()=>createManager({env:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_publishable_test'}}));
});
test('backend admission gates OpenAI, records results, handles replay and database failure',async()=>{
 const originalFetch=globalThis.fetch,originalEnv={...process.env};
 Object.assign(process.env,{OPENAI_API_KEY:'test-only',CHAT_PREVIEW_CODE:'test-code',CHAT_PUBLIC_ENABLED:'true',CHAT_MANAGER_MODE:'preview',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test'});
 let calls=[],decision={allowed:true,replay:false,conversation_id:randomUUID()}, failDB=false,failModel=false;
 globalThis.fetch=async(url,options)=>{
  calls.push({url,body:JSON.parse(options.body),headers:options.headers});
  if(url.endsWith('/chat_admit'))return failDB?new Response('{}',{status:503}):Response.json(decision);
  if(url.endsWith('/chat_knowledge'))return Response.json('Approved knowledge');
  if(url.endsWith('/chat_source_passages'))return Response.json([{title:'Source',passage:'Test published excerpt'}]);
  if(url.endsWith('/chat_finish'))return Response.json(true);
  if(url==='https://api.openai.com/v1/responses')return failModel?new Response('{}',{status:502}):Response.json({output:[{type:'message',content:[{type:'output_text',text:'Test answer'}]}],usage:{input_tokens:12,output_tokens:4}});
  throw new Error('Unexpected test fetch');
 };
 const request=(publicMode=false)=>new Request('https://chat.example/api/chat',{method:'POST',headers:{'Content-Type':'application/json',...(publicMode?{'X-Chat-Mode':'public',Origin:'https://chat.example'}:{'X-Chat-Preview-Code':'test-code'})},body:JSON.stringify({bot:'sakireem',language:'en',message:'Hello',history:[],requestId:randomUUID()})});
 try{
  let response=await chat(request());assert.equal(response.status,200);assert.equal((await response.json()).reply,'Test answer');
  assert.equal(calls.at(-1).body.p_state,'succeeded');assert.equal(calls.at(-1).body.p_input_tokens,12);
  assert.match(calls.find(call=>call.url.includes('api.openai.com')).body.instructions,/Approved knowledge/);
  assert.match(calls.find(call=>call.url.includes('api.openai.com')).body.instructions,/Test published excerpt/);
  assert.equal(calls[0].headers.apikey,'sb_secret_test');assert.equal(calls[0].body.p_mode,'preview');
  calls=[];decision={allowed:false,code:'bot_paused'};response=await chat(request());assert.equal(response.status,403);assert.equal(calls.length,1);
  process.env.CHAT_MANAGER_MODE='all';calls=[];response=await chat(request(true));assert.equal(response.status,403);assert.equal(calls.length,1);assert.equal(calls[0].body.p_mode,'public');
  decision={allowed:false,code:'monthly_limit'};response=await chat(request());assert.equal(response.status,429);
  decision={allowed:true,replay:true,reply:'Replayed',conversation_id:randomUUID()};calls=[];response=await chat(request());assert.equal((await response.json()).reply,'Replayed');assert.equal(calls.length,1);
  failDB=true;calls=[];response=await chat(request());assert.equal(response.status,503);assert.equal(calls.length,1);failDB=false;
  decision={allowed:true,replay:false,conversation_id:randomUUID()};failModel=true;calls=[];response=await chat(request());assert.equal(response.status,502);assert.equal(calls.at(-1).body.p_state,'failed');
 }finally{globalThis.fetch=originalFetch;for(const key of Object.keys(process.env))if(!(key in originalEnv))delete process.env[key];Object.assign(process.env,originalEnv);}
});
