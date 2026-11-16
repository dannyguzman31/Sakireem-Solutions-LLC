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

  if ((id === "sakireem" && (publicMode || hosted)) || (id === "hvac-arizona-valley" && hosted)) addQuoteForm(id);

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

function addQuoteForm(bot) {
  const labels = language === "es" ? {
    title:"Solicitar una cotización en el chat", name:"Nombre", contact:"Correo electrónico o teléfono",
    project:"Cuéntanos sobre tu proyecto", consent:"Acepto que la empresa me contacte sobre esta solicitud.",
    close:"Cerrar", send:"Enviar solicitud", sent:"Recibimos tu solicitud. Gracias.",
    test:"Vista previa: esta solicitud se marcará como prueba.",
    invalid:"Revisa tus datos. Ingresa un correo o teléfono válido.",
    code:"Ingresa el código correcto en el chat y vuelve a intentarlo.",
    retry:"No pudimos confirmar el envío. Intenta de nuevo o usa el enlace de contacto del chat."
  } : {
    title:"Request a quote in chat", name:"Name", contact:"Email or phone",
    project:"Tell us about your project", consent:"I agree that the business may contact me about this request.",
    close:"Close", send:"Send request", sent:"We received your request. Thank you.",
    test:"Preview: this request will be marked as a test.",
    invalid:"Check your details. Enter a valid email or phone number.",
    code:"Enter the correct preview code in the chat and try again.",
    retry:"We couldn’t confirm your submission. Try again or use the chat’s contact link."
  };
  const button = document.createElement("button");
  button.type = "button";
  button.className = "quote-open";
  button.textContent = labels.title;
  actions.prepend(button);

  const dialog = document.createElement("dialog");
  dialog.className = "quote-dialog";
  dialog.setAttribute("aria-labelledby","quote-title");
  dialog.innerHTML = `<form>
    <h2 id="quote-title">${labels.title}</h2>
    ${hosted ? `<p>${labels.test}</p>` : ""}
    <label>${labels.name}<input name="name" autocomplete="name" maxlength="100" required></label>
    <label>${labels.contact}<input name="contact" maxlength="254" required></label>
    <label>${labels.project}<textarea name="project" rows="3" maxlength="1000" required></textarea></label>
    <label class="quote-consent"><input name="confirmed" type="checkbox" required> ${labels.consent}</label>
    <p role="status" aria-live="polite"></p>
    <div class="quote-buttons"><button type="button">${labels.close}</button><button type="submit">${labels.send}</button></div>
  </form>`;
  document.body.append(dialog);
  const quote = dialog.querySelector("form");
  const controls = [...quote.elements];
  const close = quote.querySelector('[type="button"]');
  const status = quote.querySelector('[role="status"]');
  let sending = false;
  let previousBody, requestId;
  button.onclick = () => dialog.showModal();
  close.onclick = () => dialog.close();
  dialog.oncancel = event => { if (sending) event.preventDefault(); };
  quote.onsubmit = async event => {
    event.preventDefault();
    if (sending) return;
    const data = new FormData(quote);
    const body = {
      bot, language, name:data.get("name").trim(), contact:data.get("contact").trim(),
      project:data.get("project").trim(), confirmed:data.has("confirmed")
    };
    const serialized = JSON.stringify(body);
    if (serialized !== previousBody) requestId = crypto.randomUUID();
    previousBody = serialized;
    sending = true;
    controls.forEach(control => control.disabled = true);
    status.textContent = "";
    try {
      const headers = {"Content-Type":"application/json","X-Chat-Mode":publicMode ? "public" : "preview"};
      if (hosted) headers["X-Chat-Preview-Code"] = previewCode || codeField.value.trim();
      const response = await fetch("/api/chat-leads", {
        method:"POST", headers, body:JSON.stringify({...body,requestId}),
        signal:AbortSignal.timeout(12000)
      });
      if (response.ok && (await response.json()).code === "saved") {
        quote.reset();
        previousBody = undefined;
        status.textContent = labels.sent;
        appendMessage(labels.sent);
      } else {
        status.textContent = response.status === 401 ? labels.code : response.status === 400 ? labels.invalid : labels.retry;
      }
    } catch {
      status.textContent = labels.retry;
    } finally {
      sending = false;
      controls.forEach(control => control.disabled = false);
    }
  };
}
