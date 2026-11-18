import { randomBytes } from "node:crypto";
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

function accentTheme(value) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) return null;
  const channels = value.slice(1).match(/../g).map(channel => {
    const srgb = parseInt(channel,16)/255;
    return srgb <= .04045 ? srgb/12.92 : ((srgb+.055)/1.055)**2.4;
  });
  const luminance = channels[0]*.2126 + channels[1]*.7152 + channels[2]*.0722;
  return {accent:value,foreground:luminance > .179 ? "#000" : "#fff",link:luminance <= .179 ? value : "#15304a"};
}

function referringOrigin(request) {
  try { return new URL(request.headers.get("referer")).origin; }
  catch { return null; }
}

function launcherStyle(request, widget) {
  const theme = validSite(widget.site_origin) && referringOrigin(request) === widget.site_origin
    ? accentTheme(widget.brand_accent) : null;
  const css = theme ? `.chat-launcher{background:${theme.accent};color:${theme.foreground}}` : "";
  return new Response(css,{headers:{
    "Content-Type":"text/css; charset=utf-8","Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff","Cross-Origin-Resource-Policy":"cross-origin"
  }});
}

function panelBranding(widget, language) {
  const candidate = safeLink(widget.brand_logo_url, null);
  const origin = candidate ? new URL(candidate).origin : null;
  const imageSource = /^https:\/\/(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*$/i.test(origin) ? origin : null;
  const logo = imageSource ? candidate : null;
  const theme = accentTheme(widget.brand_accent);
  const nonce = theme ? randomBytes(16).toString("base64") : null;
  const style = theme ? `<style nonce="${nonce}">body.managed-panel{--accent:${theme.accent};--brand-on-accent:${theme.foreground};--brand-link:${theme.link}}</style>` : "";
  const logoMarkup = logo ? `<img src="${escape(logo)}" alt="" width="36" height="36" referrerpolicy="no-referrer">` : "";
  const badgeLabel = language === "es" ? "Con tecnología de Sakireem" : "Powered by Sakireem";
  const badge = widget.brand_badge_hidden === true ? "" :
    `<footer class="brand-credit"><a href="https://sakireemsolutions.com/" target="_blank" rel="noopener noreferrer">${badgeLabel}</a></footer>`;
  const head = `<link rel="stylesheet" href="/assets/chat/panel.css"><link rel="stylesheet" href="/assets/chat/branding.css">${style}`;
  return {head,logoMarkup,badge,nonce,imageSource};
}

function panelResponse(html, origin, active, branding, bookingEmbedUrl = null) {
  const bookingPolicy = bookingEmbedUrl
    ? ` frame-src ${new URL(bookingEmbedUrl).origin} https://app.acuityscheduling.com https://acuityscheduling.com;`
    : "";
  const chatPolicy = active ? " connect-src 'self';" : "";
  const styleNonce = branding.nonce ? ` 'nonce-${branding.nonce}'` : "";
  const imagePolicy = branding.imageSource ? ` img-src ${branding.imageSource};` : "";
  return new Response(html,{headers:{
    "Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow",
    "X-Content-Type-Options":"nosniff","Referrer-Policy":"same-origin",
    "Content-Security-Policy":`default-src 'none'; script-src 'self'; style-src 'self'${styleNonce};${imagePolicy}${chatPolicy}${bookingPolicy} base-uri 'none'; form-action 'none'; frame-ancestors ${origin || "'none'"}`
  }});
}

function pausedPanel(widget, language, origin, branding) {
  const spanish = language === "es";
  const message = spanish
    ? "El chat está desactivado por el momento."
    : "The chat is currently disabled.";
  const name = escape(widget.name);
  const html = `<!doctype html><html lang="${language}"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${name}</title>${branding.head}<script src="/assets/chat/panel-controls.js" defer></script></head><body class="managed-panel" data-parent-origin="${escape(origin)}">
    <header class="brand-header">${branding.logoMarkup}<div><h1>${name}</h1></div></header>
    <main id="messages"><p class="message">${message}</p></main>
    ${branding.badge}</body></html>`;
  return panelResponse(html, origin, false, branding);
}

export default async function showWidget(request) {
  if (request.method !== "GET") return unavailable(405);
  const params = new URL(request.url).searchParams;
  const bot = params.get("bot");
  const launcher = params.get("asset") === "launcher";
  const publicMode = launcher || params.get("preview") !== "hosted";
  if (!validSlug(bot)) return unavailable(404);
  if (!managedEnabled(publicMode)) return unavailable(503);
  try {
    const widget = await createManager().widget(bot);
    if (!widget || (publicMode && !validSite(widget.site_origin))) return unavailable(404);
    if (launcher) return launcherStyle(request,widget);
    const requested = params.get("lang") === "es" ? "es" : "en";
    const language = !publicMode && !acceptsLanguage(widget,requested) ? null :
      widget.language_mode === "both" ? requested : widget.language_mode;
    if (!acceptsLanguage(widget,language)) return unavailable(404,"This preview language is disabled.");
    let origin = null;
    if (publicMode) {
      origin = referringOrigin(request);
      if (origin !== widget.site_origin || request.headers.get("sec-fetch-dest") !== "iframe") return unavailable(403);
    }
    const branding = panelBranding(widget, language);
    if (publicMode && (!widget.is_live || !widget.enabled)) return pausedPanel(widget, language, origin, branding);
    const bookingUrl = safeLink(widget.booking_url, null);
    const bookingHost = bookingUrl ? new URL(bookingUrl).host : "";
    const bookingEmbedUrl = widget.booking_embed_enabled === true &&
      /^(?:([a-z0-9-]+\.)?acuityscheduling\.com|[a-z0-9-]+\.as\.me)$/.test(bookingHost)
      ? bookingUrl : null;
    const presentation = {
      name:widget.name,
      greeting:language === "es" ? widget.greeting_es : widget.greeting_en,
      language,
      publicMode,
      phoneMode:widget.phone_mode,
      addressMode:widget.address_mode,
      serviceVisit:widget.service_visit_enabled === true,
      quoteEnabled:widget.quote_button_enabled !== false,
      bookingUrl,
      bookingEmbedUrl,
      ticket:publicMode ? widgetTicket(bot,language,origin,process.env.SUPABASE_SECRET_KEY.trim()) : null
    };
    const html = `<!doctype html><html lang="${language}"><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${escape(widget.name)}</title>${branding.head}
      <script src="/assets/chat/panel.js" defer></script><script src="/assets/chat/panel-controls.js" defer></script></head>
      <body class="managed-panel" data-parent-origin="${escape(origin || "")}" data-managed-widget="${escape(JSON.stringify(presentation))}">
      <header class="brand-header">${branding.logoMarkup}<div><h1 id="business"></h1><p id="preview"></p></div></header>
      <div id="messages" role="log" aria-live="polite"></div><div id="questions"></div>
      <form id="message-form" hidden>
        <input id="preview-code" type="password" maxlength="128" autocomplete="off" hidden>
        <div class="composer"><input id="message" type="text" maxlength="350" required><button id="send" type="submit" hidden></button></div>
      </form><nav id="actions"></nav>${branding.badge}</body></html>`;
    return panelResponse(html, origin, true, branding, bookingEmbedUrl);
  } catch {
    console.error("Managed chat widget configuration unavailable");
    return unavailable(503);
  }
}
