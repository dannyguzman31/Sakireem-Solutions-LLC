import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import showWidget from "../netlify/functions/chat-widget.mjs";
import chat from "../netlify/functions/chat.mjs";
import submitLead from "../netlify/functions/chat-leads.mjs";
import {ticketOrigin,widgetTicket} from "../netlify/widget-access.mjs";

test("managed panel, origin tickets, preview AI and managed lead routing", async () => {
  const endpoint="https://chat.example";
  const secret="sb_secret_test";
  const bot="client-beta";
  const origin="https://business.example";
  const originalEnv={...process.env};
  const originalFetch=globalThis.fetch;
  Object.assign(process.env,{
    CHAT_PUBLIC_ENABLED:"true",CHAT_MANAGER_MODE:"all",CHAT_PREVIEW_CODE:"code",
    SUPABASE_URL:"https://test.supabase.co",SUPABASE_SECRET_KEY:secret,OPENAI_API_KEY:"test-key"
  });
  let live=false;
  let calls=[];
  globalThis.fetch=async (url, opts) => {
    const args=JSON.parse(opts.body);
    calls.push([url.split("/").at(-1),args]);
    if (url.endsWith("/chat_widget_config")) return Response.json({
      name:'Client </title><script>x</script>',site_origin:origin,contact_url:"javascript:alert(1)",
      language_mode:"es",greeting_es:"Hola",is_live:live,enabled:live
    });
    if (url.endsWith("/chat_admit_widget")) return Response.json({allowed:true,conversation_id:randomUUID()});
    if (url.endsWith("/chat_submit_widget_lead")) return Response.json("saved");
    if (url.endsWith("/chat_knowledge")) return Response.json(null);
    if (url.endsWith("/chat_source_passages")) return Response.json([]);
    if (url.endsWith("/chat_finish_with_transcript")) return Response.json(true);
    if (url.endsWith("/responses")) return Response.json({output:[{type:"message",content:[{type:"output_text",text:"Hola"}]}]});
    throw new Error("Unexpected request " + url);
  };
  const panel=(preview="",host=origin)=>new Request(endpoint+`/api/chat-widget?bot=${bot}&lang=en${preview}`,{
    headers:{Referer:host+"/","Sec-Fetch-Dest":"iframe"}
  });
  const post=(path,payload,headers)=>new Request(endpoint+path,{method:"POST",headers:{
    Origin:endpoint,"Content-Type":"application/json","X-Chat-Managed":"1",...headers
  },body:JSON.stringify({bot,language:"es",requestId:randomUUID(),...payload})});
  try {
    assert.equal((await showWidget(panel())).status,404);
    assert.equal((await showWidget(panel("&preview=hosted"))).status,404);
    const preview=await showWidget(new Request(endpoint+`/api/chat-widget?bot=${bot}&lang=es&preview=hosted`));
    assert.equal(preview.status,200);
    assert.match(preview.headers.get("Content-Security-Policy"),/frame-ancestors 'none'/);
    assert.equal((await chat(post("/api/chat",{message:"Hola"},{}))).status,401);
    const answer=await chat(post("/api/chat",{message:"Hola"},{"X-Chat-Preview-Code":"code"}));
    assert.equal(answer.status,200);
    assert.ok(calls.some(([key,args])=>key==="chat_admit_widget" && args.p_mode==="preview" && args.p_origin===null));
    assert.match(calls.find(([key])=>key==="responses")[1].instructions,/Client/);

    live=true;
    assert.equal((await showWidget(panel("","https://wrong.example"))).status,403);
    assert.equal((await showWidget(new Request(endpoint+`/api/chat-widget?bot=${bot}&lang=es`))).status,403);
    const allowed=await showWidget(panel());
    assert.equal(allowed.status,200);
    assert.match(allowed.headers.get("Content-Security-Policy"),/frame-ancestors https:\/\/business\.example$/);
    const html=await allowed.text();
    assert.match(html,/<html lang="es">/);
    assert.match(html,/&lt;\/title&gt;&lt;script&gt;/);
    assert.equal(html.includes("javascript:"),false);
    assert.equal(html.includes(secret),false);
    const ticket=html.match(/&quot;ticket&quot;:&quot;([\w.-]+)&quot;/)[1];
    assert.equal(ticketOrigin(ticket,bot,"es",secret),origin);
    assert.equal(ticketOrigin(ticket,"other","es",secret),null);
    assert.equal(ticketOrigin(ticket,bot,"en",secret),null);
    assert.equal(ticketOrigin(widgetTicket(bot,"es",origin,secret,0),bot,"es",secret),null);
    const lead={name:"Client",contact:"client@example.com",project:"Estimate",confirmed:true};
    assert.equal((await submitLead(post("/api/chat-leads",lead,{"X-Chat-Mode":"public"}))).status,403);
    assert.equal((await submitLead(post("/api/chat-leads",lead,{"X-Chat-Mode":"public","X-Chat-Widget-Ticket":ticket}))).status,200);
    assert.ok(calls.some(([key,args])=>key==="chat_submit_widget_lead" && args.p_origin===origin && !args.p_test));
    assert.equal((await submitLead(post("/api/chat-leads",lead,{"X-Chat-Mode":"preview","X-Chat-Preview-Code":"code"}))).status,200);
    assert.ok(calls.some(([key,args])=>key==="chat_submit_widget_lead" && args.p_origin===null && args.p_test));
    process.env.CHAT_MANAGER_MODE="preview";
    assert.equal((await showWidget(panel())).status,503);
  } finally {
    globalThis.fetch=originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env,originalEnv);
  }
});
