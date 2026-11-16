import { createHash, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { createManager, enforcementEnabled, requestIdentity, statusFor } from "../chat-manager.mjs";
import { reservePublicReply } from "../public-chat-budget.mjs";
import sakireem from "../../assets/chat/bots/sakireem.json" with { type: "json" };
import hvac from "../../assets/chat/bots/hvac-arizona-valley.json" with { type: "json" };

const bots = new Map([["sakireem", sakireem], ["hvac-arizona-valley", hvac]]);
const hash = (value) => createHash("sha256").update(value).digest();
const json = (status, data) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store" }
});

export const config = {
  path: "/api/chat",
  rateLimit: { windowLimit: 12, windowSize: 60, aggregateBy: ["ip", "domain"] }
};

export default async function chat(request) {
  if (request.method !== "POST") return json(405, { error: "Use POST" });
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return json(503, { error: "Chat setup incomplete" });

  const publicMode = request.headers.get("X-Chat-Mode") === "public";
  if (publicMode) {
    if (process.env.CHAT_PUBLIC_ENABLED !== "true") {
      return json(503, { error: "Public chat is disabled" });
    }
    if (request.headers.get("Origin") !== new URL(request.url).origin) {
      return json(403, { error: "Open the hosted chat panel" });
    }
  } else {
    const previewCode = process.env.CHAT_PREVIEW_CODE?.trim();
    if (!previewCode) return json(503, { error: "Preview setup incomplete" });
    const suppliedCode = request.headers.get("X-Chat-Preview-Code") || "";
    if (!timingSafeEqual(hash(suppliedCode), hash(previewCode))) {
      return json(401, { error: "Invalid preview code" });
    }
  }

  let payload;
  try {
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        return json(413, { error: "Request too large" });
      }
      chunks.push(value);
    }
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const { bot: id, language, message, history = [] } = payload ?? {};
  const bot = bots.get(id);
  if (!bot || (publicMode && id !== "sakireem")) {
    return json(404, { error: "Unknown bot" });
  }
  if (!["en", "es"].includes(language) || typeof message !== "string"
      || message.length > 350 || !message.trim() || !Array.isArray(history)
      || history.length > 4 || history.some((entry) =>
        !["user", "assistant"].includes(entry?.role)
        || typeof entry.content !== "string" || entry.content.length > 1200)) {
    return json(400, { error: "Invalid chat request" });
  }

  let manager, identity, admission;
  try {
    if (enforcementEnabled(publicMode)) {
      try { identity = requestIdentity(payload); }
      catch { return json(400, { error: "Invalid request identity", code: "invalid_request" }); }
      manager = createManager();
      admission = await manager.admit({bot:id,mode:publicMode ? "public" : "preview",...identity,language,message,history});
      if (!admission || typeof admission.allowed !== "boolean") throw new Error("Invalid admission result");
      if (!admission.allowed) return json(statusFor(admission.code), {error: "Chat request not admitted", code:admission.code, conversationId:admission.conversation_id});
      if (admission.replay) return json(200, {reply:admission.reply,conversationId:admission.conversation_id});
    }
  } catch {
    console.error("Chat manager admission unavailable");
    return json(503, {error:"Chat temporarily unavailable",code:"manager_unavailable"});
  }
  const finish = async (reply, usage) => {
    if (!manager) return;
    try { await manager.finish(identity.requestId, reply, usage); }
    catch { console.error("Chat manager completion record unavailable"); }
  };
  const failure = async (status, error, code) => {
    await finish(null);
    return json(status,{error,code,conversationId:admission?.conversation_id});
  };
  if (publicMode) {
    try {
      if (!await reservePublicReply(getStore("public-chat-budget"))) {
        return failure(429, "Daily chat limit reached", "daily_limit");
      }
    } catch {
      console.error("Could not reserve public chat capacity");
      return failure(503, "Chat temporarily unavailable", "budget_unavailable");
    }
  }

  const facts = bot[language].faqs.map((faq) => faq.answer).join("\n");
  const instructions = `You are the assistant for ${bot.name}.
Answer briefly in plain text in the visitor's language, defaulting to ${language === "es" ? "Spanish" : "English"}.
Use only the business facts below. If details are missing or the visitor wants a custom quote,
refer them to the contact link below the chat. Never invent services, guarantees, or prices.

Business facts:
${facts}`;

  try {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-6-luna",
        instructions,
        input: [...history.map(({ role, content }) => ({ role, content })),
          { role: "user", content: message.trim() }],
        reasoning: { effort: "none" },
        max_output_tokens: 250,
        store: false
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!upstream.ok) {
      console.error("OpenAI request failed", upstream.status, upstream.headers.get("x-request-id"));
      return failure(502, "Model request failed", "model_failed");
    }
    const data = await upstream.json();
    const reply = data.output.filter((item) => item.type === "message")
      .flatMap((item) => item.content)
      .filter((part) => part.type === "output_text")
      .map((part) => part.text).join("\n").trim();
    if (!reply) return failure(502, "Empty model response", "model_failed");
    await finish(reply, data.usage);
    return json(200, { reply, conversationId: admission?.conversation_id });
  } catch {
    console.error("OpenAI request could not be completed");
    return failure(502, "Model request failed", "model_failed");
  }
}
