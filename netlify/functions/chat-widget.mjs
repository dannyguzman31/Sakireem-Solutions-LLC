import { createManager } from "../chat-manager.mjs";
import { acceptsLanguage, managedEnabled, validSite, validSlug, widgetTicket } from "../widget-access.mjs";

export const config = {
  path: "/api/chat-widget",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] }
};
const escape = value => String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const unavailable = (status, text = "Chat widget unavailable.") => new Response(text, {
  status, headers:{"Cache-Control":"no-store","Content-Type":"text/plain; charset=utf-8","Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'"}
});

function safeLink(value, fallback) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch {}
  return fallback;
}

export default async function showWidget(request) {
  if (request.method !== "GET") return unavailable(405);
  const params = new URL(request.url).searchParams;
  const bot = params.get("bot");
  const publicMode = params.get("preview") !== "hosted";
  if (!validSlug(bot)) return unavailable(404);
  if (!managedEnabled(publicMode)) return unavailable(503);
  try {
    const widget = await createManager().widget(bot);
    if (!widget || (publicMode && (!widget.is_live || !widget.enabled || !validSite(widget.site_origin)))) return unavailable(404);
    const requested = params.get("lang") === "es" ? "es" : "en";
    const language = !publicMode && !acceptsLanguage(widget,requested) ? null :
      widget.language_mode === "both" ? requested : widget.language_mode;
    if (!acceptsLanguage(widget,language)) return unavailable(404,"This preview language is disabled.");
    let origin = null;
    if (publicMode) {
      try { origin = new URL(request.headers.get("referer")).origin; } catch {}
      if (origin !== widget.site_origin || request.headers.get("sec-fetch-dest") !== "iframe") return unavailable(403);
    }
    const presentation = {
      name:widget.name,
      greeting:language === "es" ? widget.greeting_es : widget.greeting_en,
      link:safeLink(widget.contact_url,widget.site_origin),
      language,
      publicMode,
      ticket:publicMode ? widgetTicket(bot,language,origin,process.env.SUPABASE_SECRET_KEY.trim()) : null
    };
    const html = `<!doctype html><html lang="${language}"><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${escape(widget.name)}</title><link rel="stylesheet" href="/assets/chat/panel.css">
      <script src="/assets/chat/panel.js" defer></script></head>
      <body data-managed-widget="${escape(JSON.stringify(presentation))}">
      <header><h1 id="business"></h1><p id="preview"></p></header>
      <div id="messages" role="log" aria-live="polite"></div><div id="questions"></div>
      <form id="message-form" hidden>
        <input id="preview-code" type="password" maxlength="128" autocomplete="off" hidden>
        <input id="message" type="text" maxlength="350" required><button id="send" type="submit"></button>
      </form><nav id="actions"></nav></body></html>`;
    return new Response(html,{headers:{
      "Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow",
      "X-Content-Type-Options":"nosniff","Referrer-Policy":"same-origin",
      "Content-Security-Policy":`default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors ${origin || "'none'"}`
    }});
  } catch {
    console.error("Managed chat widget configuration unavailable");
    return unavailable(503);
  }
}
