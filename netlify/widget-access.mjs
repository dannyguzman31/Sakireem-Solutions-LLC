import {createHmac,timingSafeEqual} from "node:crypto";

export const validSlug = value => typeof value === "string" && value.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const sitePattern = /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const validSite = value => typeof value === "string" && value.length <= 261 && sitePattern.test(value);
export const acceptsLanguage = (widget, language) => ["en","es"].includes(language) &&
  (widget?.language_mode === "both" || widget?.language_mode === language);
export const managedEnabled = (publicMode, env = process.env) =>
  publicMode ? env.CHAT_MANAGER_MODE === "all" && env.CHAT_PUBLIC_ENABLED === "true"
    : ["all","preview"].includes(env.CHAT_MANAGER_MODE);

function sign(body, secret) {
  return createHmac("sha256",secret).update("sakireem-widget:v1:").update(body).digest("base64url");
}

export function widgetTicket(bot, language, origin, secret, now = Date.now()) {
  const body = Buffer.from(JSON.stringify([bot,language,origin,now + 12 * 3600000])).toString("base64url");
  return body + "." + sign(body,secret);
}

export function ticketOrigin(ticket, bot, language, secret, now = Date.now()) {
  if (!secret || typeof ticket !== "string" || ticket.length > 900 || !/^[\w-]+\.[\w-]{43}$/.test(ticket)) return null;
  const [body,signature] = ticket.split(".");
  if (!timingSafeEqual(Buffer.from(signature),Buffer.from(sign(body,secret)))) return null;
  try {
    const [slug,lang,origin,expires] = JSON.parse(Buffer.from(body,"base64url").toString("utf8"));
    return slug === bot && lang === language && validSite(origin) && Number.isSafeInteger(expires) && expires > now ? origin : null;
  } catch {
    return null;
  }
}
