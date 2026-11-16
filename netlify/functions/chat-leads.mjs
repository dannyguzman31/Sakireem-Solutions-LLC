import { createHash, timingSafeEqual } from "node:crypto";
import { createManager } from "../chat-manager.mjs";

export const config = {
  path: "/api/chat-leads",
  rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ["ip", "domain"] }
};
const digest = value => createHash("sha256").update(value).digest();
const result = (status, code) => Response.json({code}, {status, headers:{"Cache-Control":"no-store"}});
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
  const {bot, language, requestId, name, contact, project, confirmed} = payload ?? {};
  if (bot !== "sakireem" || !["en","es"].includes(language) || confirmed !== true ||
      typeof requestId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId) ||
      ![[name,100],[contact,254],[project,1000]].every(([value,max]) =>
        typeof value === "string" && value.trim().length > 0 && value.length <= max && !value.includes("\0")) ||
      !(validEmail(contact.trim()) || validPhone(contact.trim()))) return result(400,"invalid");
  try {
    const code = await createManager().lead({
      p_request:requestId, p_language:language, p_test:mode === "preview",
      p_name:name.trim(), p_contact:contact.trim(), p_project:project.trim()
    });
    if (code === "saved") return result(200,code);
    if (code === "conflict") return result(409,code);
    if (code === "paused") return result(403,code);
  } catch {
    console.error("Quote request could not be saved");
  }
  return result(503,"unavailable");
}
