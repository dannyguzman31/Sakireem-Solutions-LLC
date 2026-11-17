import { managedEnabled, ticketOrigin, validSlug } from "../widget-access.mjs";
import { createHash, timingSafeEqual } from "node:crypto";
import { createManager, requestIdentity } from "../chat-manager.mjs";

export const config = {
  path: "/api/chat-leads",
  rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ["ip", "domain"] }
};
const digest = value => createHash("sha256").update(value).digest();
const result = (status, code) => Response.json({code}, {status, headers:{"Cache-Control":"no-store"}});
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isText = (value,max) => typeof value === "string" && value.length <= max && !value.includes("\0");
const validPhone = value => /^\+?[\d(). -]+$/.test(value) && /^\d{7,15}$/.test(value.replace(/\D/g,""));

export default async function submitLead(request) {
  if (request.method !== "POST") return result(405,"method");
  if (request.headers.get("Origin") !== new URL(request.url).origin) return result(403,"origin");
  const mode = request.headers.get("X-Chat-Mode");
  if (mode === "public") {
    if (process.env.CHAT_PUBLIC_ENABLED !== "true") return result(503,"unavailable");
  } else if (mode === "preview") {
    const code = process.env.CHAT_PREVIEW_CODE?.trim();
    if (!code || !timingSafeEqual(digest(code),digest(request.headers.get("X-Chat-Preview-Code") || ""))) {
      return result(401,"preview_code");
    }
  } else return result(400,"invalid");

  let payload;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request.body) {
      size += chunk.byteLength;
      if (size > 8192) return result(413,"invalid");
      chunks.push(chunk);
    }
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return result(400,"invalid");
  }
  const {bot, language, requestId, name, contact, project, confirmed, kind = "quote",
    phone = "", address = "", preferredTime = ""} = payload ?? {};
  const managed = request.headers.get("X-Chat-Managed") === "1";
  if (!validSlug(bot) || (!managed && bot !== "sakireem" && !(mode === "preview" && bot === "hvac-arizona-valley")) ||
      !["en","es"].includes(language) || confirmed !== true ||
      typeof requestId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId) ||
      !isText(name,100) || !name.trim() || !isText(project,1000) || !project.trim() ||
      !isText(contact,254) || !isText(phone,50) || !isText(address,350) || !isText(preferredTime,160) ||
      !["quote","service_visit"].includes(kind)) return result(400,"invalid");
  const cleanContact = contact.trim();
  const cleanPhone = phone.trim();
  const intake = {p_kind:kind,p_phone:cleanPhone || null,p_address:address.trim() || null,
    p_preferred_time:preferredTime.trim() || null};
  if ((!managed && (kind !== "quote" || intake.p_phone || intake.p_address || intake.p_preferred_time)) ||
      (!cleanContact && !cleanPhone) ||
      (cleanContact && !(validEmail(cleanContact) || validPhone(cleanContact))) ||
      (cleanPhone && !validPhone(cleanPhone))) return result(400,"invalid");
  let widgetAccess;
  if (managed) {
    const publicMode = mode === "public";
    if (!managedEnabled(publicMode)) return result(503,"unavailable");
    const origin = publicMode ? ticketOrigin(request.headers.get("X-Chat-Widget-Ticket"),bot,language,process.env.SUPABASE_SECRET_KEY?.trim()) : null;
    if (publicMode && !origin) return result(403,"widget_access");
    widgetAccess = {origin};
  }
  try {
    let conversationId = null;
    try { ({conversationId} = requestIdentity({requestId,conversationId:payload.conversationId})); }
    catch { /* The quote can still be saved without a transcript link. */ }
    const code = await createManager().lead({
      p_bot:bot, p_request:requestId, p_session:conversationId, p_language:language, p_test:mode === "preview",
      p_name:name.trim(), p_contact:cleanContact || null, p_project:project.trim(),
      ...(managed ? intake : {})
    },widgetAccess);
    if (code === "saved") return result(200,code);
    if (code === "conflict") return result(409,code);
    if (code === "invalid") return result(400,code);
    if (code === "paused") return result(403,code);
  } catch {
    console.error("Quote request could not be saved");
  }
  return result(503,"unavailable");
}
