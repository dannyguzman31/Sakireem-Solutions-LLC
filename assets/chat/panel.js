const params = new URLSearchParams(location.search);
const language = params.get("lang") === "es" ? "es" : "en";
document.documentElement.lang = language;

const translations = {
  en: {
    preview: "Preview · FAQ replies",
    ai: "Preview · AI replies",
    live: "AI assistant",
    limit: "Chat is busy right now. Please try later or use the contact link below.",
    paused: "This assistant is currently paused. Please use the contact link below.",
    monthly: "This assistant has reached its monthly conversation allowance. Please use the contact link below.",
    conversationLimit: "This conversation has reached its message limit. Please use the contact link below.",
    pending: "Your previous request is still processing. Please try again shortly.",
    code: "Preview access code",
    invalidCode: "Enter the correct preview access code and try again.",
    failed: "I couldn’t get an AI reply. Try again or use the contact link below.",
    unavailable: "This chat preview is unavailable.",
    fallback: "I can answer the questions shown here. For anything else, please use the contact links below.",
    placeholder: "Type a question",
    send: "Send",
    conversation: "Conversation",
    contact: "Contact options"
  },
  es: {
    preview: "Vista previa · Preguntas frecuentes",
    ai: "Vista previa · Respuestas con IA",
    live: "Asistente con IA",
    limit: "El chat está ocupado. Intenta más tarde o usa el enlace de contacto.",
    paused: "Este asistente está pausado. Usa el enlace de contacto de abajo.",
    monthly: "Este asistente alcanzó su límite mensual de conversaciones. Usa el enlace de contacto de abajo.",
    conversationLimit: "Esta conversación alcanzó su límite de mensajes. Usa el enlace de contacto de abajo.",
    pending: "Tu solicitud anterior sigue en proceso. Intenta de nuevo en un momento.",
    code: "Código de acceso a la vista previa",
    invalidCode: "Verifica el código de acceso e inténtalo de nuevo.",
    failed: "No pude obtener una respuesta de la IA. Intenta de nuevo o usa el enlace de contacto.",
    unavailable: "Esta vista previa del chat no está disponible.",
    fallback: "Puedo responder las preguntas que aparecen aquí. Para otras consultas, usa los enlaces de contacto.",
    placeholder: "Escribe una pregunta",
    send: "Enviar",
    conversation: "Conversación",
    contact: "Opciones de contacto"
  }
};

const copy = translations[language];
const messages = document.getElementById("messages");
const questions = document.getElementById("questions");
const actions = document.getElementById("actions");
const form = document.getElementById("message-form");
const field = document.getElementById("message");
const send = document.getElementById("send");
const publicMode = location.pathname.endsWith("/panel-public.html");
const hosted = !publicMode && params.get("preview") === "hosted";
const aiEnabled = publicMode || hosted || (["localhost", "127.0.0.1"].includes(location.hostname) && location.port === "8000");
const codeField = document.getElementById("preview-code");
codeField.hidden = !hosted;
codeField.required = hosted;
codeField.placeholder = copy.code;
codeField.setAttribute("aria-label", copy.code);
let previewCode = "";
const history = [];
messages.setAttribute("aria-label", copy.conversation);
actions.setAttribute("aria-label", copy.contact);
field.placeholder = copy.placeholder;
field.setAttribute("aria-label", copy.placeholder);
send.textContent = copy.send;
document.getElementById("preview").textContent = publicMode ? copy.live : (aiEnabled ? copy.ai : copy.preview);

function appendMessage(text, visitor = false) {
  const message = document.createElement("p");
  message.className = visitor ? "message visitor" : "message";
  message.textContent = text;
  messages.append(message);
  messages.scrollTop = messages.scrollHeight;
}

function normalize(text) {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

async function start() {
  const id = params.get("bot") || "";
  if (!/^[a-z0-9-]{1,60}$/.test(id)) throw new Error("Invalid bot ID");
  const response = await fetch(`bots/${id}.json`);
  if (!response.ok) throw new Error("Bot unavailable");
  const bot = await response.json();
  const content = bot[language];
  const sessionKey = `sakireem-chat-session:${id}:${publicMode ? "public" : "preview"}`;
  let conversationId = null;
  try { conversationId = JSON.parse(sessionStorage.getItem(sessionKey) || "null")?.id || null; } catch {}
  function rememberSession(id) {
    if (!id) return;
    if (conversationId && conversationId !== id) history.length = 0;
    conversationId = id;
    try { sessionStorage.setItem(sessionKey, JSON.stringify({id})); } catch {}
  }

  document.title = bot.name;
  document.getElementById("business").textContent = bot.name;
  document.body.style.setProperty("--accent", bot.accent);
  appendMessage(content.welcome);

  for (const faq of content.faqs) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = faq.question;
    button.addEventListener("click", () => {
      if (aiEnabled) {
        if (send.disabled) return;
        field.value = faq.question;
        form.requestSubmit();
      } else {
        appendMessage(faq.question, true);
        appendMessage(faq.answer);
      }
    });
    questions.append(button);
  }

  for (const action of content.actions) {
    const url = new URL(action.url);
    if (url.protocol !== "https:") continue;
    const link = document.createElement("a");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = action.label;
    actions.append(link);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = field.value.trim();
    if (!question || send.disabled) return;
    appendMessage(question, true);
    field.value = "";
    if (aiEnabled) {
      send.disabled = true;
      form.setAttribute("aria-busy", "true");
      try {
        const headers = { "Content-Type": "application/json" };
        if (publicMode) headers["X-Chat-Mode"] = "public";
        if (hosted) headers["X-Chat-Preview-Code"] = previewCode || codeField.value.trim();
        const response = await fetch("/api/chat", {
          method: "POST",
          headers,
          body: JSON.stringify({ bot: id, language, message: question, history: history.slice(-4), conversationId, requestId: crypto.randomUUID() })
        });
        if (hosted && response.status === 401) {
          previewCode = "";
          codeField.value = "";
          codeField.required = true;
          codeField.hidden = false;
          field.value = question;
          appendMessage(copy.invalidCode);
          codeField.focus();
          return;
        }
        const result = await response.json();
        rememberSession(result.conversationId);
        if (result.code === "invalid_session") {
          conversationId = null;
          history.length = 0;
          try { sessionStorage.removeItem(sessionKey); } catch {}
        }
        if (!response.ok) {
          const explanation = {bot_paused:copy.paused,monthly_limit:copy.monthly,conversation_limit:copy.conversationLimit,request_pending:copy.pending};
          appendMessage(explanation[result.code] || (response.status === 429 ? copy.limit : copy.failed));
          return;
        }
        const { reply } = result;
        if (hosted) {
          previewCode = headers["X-Chat-Preview-Code"];
          codeField.value = "";
          codeField.required = false;
          codeField.hidden = true;
        }
        appendMessage(reply);
        history.push({ role: "user", content: question }, { role: "assistant", content: reply.slice(0, 1200) });
        if (history.length > 4) history.splice(0, history.length - 4);
      } catch {
        appendMessage(copy.failed);
      } finally {
        send.disabled = false;
        form.removeAttribute("aria-busy");
      }
      return;
    }
    const query = ` ${normalize(question)} `;
    const answered = content.faqs.map((faq) => ({
      faq,
      matches: faq.keywords.filter((keyword) => query.includes(` ${normalize(keyword)} `)).length
    })).sort((first, second) => second.matches - first.matches)[0];
    appendMessage(answered?.matches ? answered.faq.answer : copy.fallback);
  });
  form.hidden = false;
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.parent.postMessage("sakireem-chat-close", "*");
});
start().catch(() => appendMessage(copy.unavailable));
