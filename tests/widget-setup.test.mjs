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
  let enabled=false;
  let contact="javascript:alert(1)";
  let languageMode="es";
  let brand={};
  let calls=[];
  globalThis.fetch=async (url, opts) => {
    const args=JSON.parse(opts.body);
    calls.push([url.split("/").at(-1),args]);
    if (url.endsWith("/chat_widget_config")) return Response.json({
      name:'Client </title><script>x</script>',site_origin:origin,contact_url:contact,
      language_mode:languageMode,greeting_es:"Hola",is_live:live,enabled,...brand
    });
    if (url.endsWith("/chat_admit_widget")) return Response.json({allowed:true,conversation_id:randomUUID()});
    if (url.endsWith("/chat_submit_widget_intake")) return Response.json("saved");
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
    const draft=await showWidget(panel());
    assert.equal(draft.status,200);
    assert.match(draft.headers.get("Content-Security-Policy"),/frame-ancestors https:\/\/business\.example$/);
    const draftHtml=await draft.text();
    assert.match(draftHtml,/El chat está desactivado/);
    assert.doesNotMatch(draftHtml,/<script|<form|<nav id="actions"|"ticket"|data-managed-widget/);
    assert.equal((await showWidget(panel("","https://wrong.example"))).status,403);
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
    contact="https://business.example/contact?via=chat&lang=es";
    const paused=await showWidget(panel());
    const pausedHtml=await paused.text();
    assert.equal(paused.status,200);
    assert.match(pausedHtml,/El chat está desactivado/);
    assert.ok(pausedHtml.includes('href="https://business.example/contact?via=chat&amp;lang=es"'));
    languageMode="both";
    assert.match(await (await showWidget(panel())).text(),/The chat is currently disabled/);
    languageMode="es";
    enabled=true;
    contact="javascript:alert(1)";
    assert.equal((await showWidget(panel("","https://wrong.example"))).status,403);
    assert.equal((await showWidget(new Request(endpoint+`/api/chat-widget?bot=${bot}&lang=es`))).status,403);
    brand={brand_accent:'#f0bd4a',brand_logo_url:'https://images.example/logo.png?x=1&y=2'};
    const allowed=await showWidget(panel());
    assert.equal(allowed.status,200);
    assert.match(allowed.headers.get("Content-Security-Policy"),/frame-ancestors https:\/\/business\.example$/);
    const html=await allowed.text();
    const themeNonce=html.match(/<style nonce="([^"]+)"/)[1];
    assert.ok(allowed.headers.get("Content-Security-Policy").includes(`'nonce-${themeNonce}'`));
    assert.match(allowed.headers.get("Content-Security-Policy"),/img-src https:\/\/images\.example;/);
    assert.match(html,/--accent:#f0bd4a;--brand-on-accent:#000/);
    assert.match(html,/logo\.png\?x=1&amp;y=2/);
    assert.match(html,/Con tecnología de Sakireem/);
    brand={brand_badge_hidden:true,brand_logo_url:'https://evil.example;bad/logo',brand_accent:'#fff;bad'};
    const agency=await showWidget(panel());
    assert.doesNotMatch(agency.headers.get("Content-Security-Policy"),/img-src|nonce-/);
    assert.doesNotMatch(await agency.text(),/brand-credit|evil\.example|<style nonce/);

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
    assert.ok(calls.some(([key,args])=>key==="chat_submit_widget_intake" && args.p_origin===origin && !args.p_test));
    assert.equal((await submitLead(post("/api/chat-leads",lead,{"X-Chat-Mode":"preview","X-Chat-Preview-Code":"code"}))).status,200);
    assert.ok(calls.some(([key,args])=>key==="chat_submit_widget_intake" && args.p_origin===null && args.p_test));
    process.env.CHAT_MANAGER_MODE="preview";
    assert.equal((await showWidget(panel())).status,503);
  } finally {
    globalThis.fetch=originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env,originalEnv);
  }
});
