const params = new URLSearchParams(location.search);
const managed = document.body.dataset.managedWidget ? JSON.parse(document.body.dataset.managedWidget) : null;
const language = (managed?.language || params.get("lang")) === "es" ? "es" : "en";
document.documentElement.lang = language;

const translations = {
  en: {
    preview: "Preview · FAQ replies",
    ai: "Preview · AI replies",
    live: "AI assistant",
    limit: "Chat is busy right now. Please try later or contact the business through its website.",
    paused: "This assistant is currently paused. Please contact the business through its website.",
    monthly: "This assistant has reached its monthly conversation allowance. Please contact the business through its website.",
    conversationLimit: "This conversation has reached its message limit. Please contact the business through its website.",
    pending: "Your previous request is still processing. Please try again shortly.",
    code: "Preview access code",
    invalidCode: "Enter the correct preview access code and try again.",
    failed: "I couldn’t get an AI reply. Try again or contact the business through its website.",
    unavailable: "This chat preview is unavailable.",
    fallback: "I don’t have an answer for that question. Please contact the business through its website.",
    welcome: name => `Hello, welcome to ${name}.`,
    offerHelp: "How can I assist you today?",
    typing: "Assistant is typing.",
    justNow: "Just now",
    placeholder: "Type a question",
    send: "Send",
    conversation: "Conversation",
    contact: "Contact options"
  },
  es: {
    preview: "Vista previa · Preguntas frecuentes",
    ai: "Vista previa · Respuestas con IA",
    live: "Asistente con IA",
    limit: "El chat está ocupado. Intenta más tarde o comunícate con la empresa a través de su sitio web.",
    paused: "Este asistente está pausado. Comunícate con la empresa a través de su sitio web.",
    monthly: "Este asistente alcanzó su límite mensual de conversaciones. Comunícate con la empresa a través de su sitio web.",
    conversationLimit: "Esta conversación alcanzó su límite de mensajes. Comunícate con la empresa a través de su sitio web.",
    pending: "Tu solicitud anterior sigue en proceso. Intenta de nuevo en un momento.",
    code: "Código de acceso a la vista previa",
    invalidCode: "Verifica el código de acceso e inténtalo de nuevo.",
    failed: "No pude obtener una respuesta de la IA. Intenta de nuevo o comunícate con la empresa a través de su sitio web.",
    unavailable: "Esta vista previa del chat no está disponible.",
    fallback: "No tengo una respuesta para esa pregunta. Comunícate con la empresa a través de su sitio web.",
    welcome: name => `Hola, te damos la bienvenida a ${name}.`,
    offerHelp: "¿En qué puedo ayudarte hoy?",
    typing: "El asistente está escribiendo.",
    justNow: "Ahora mismo",
    placeholder: "Escribe una pregunta",
    send: "Enviar",
    conversation: "Conversación",
    contact: "Opciones de contacto"
  }
};

const copy = translations[language];
const messages = document.getElementById("messages");
const actions = document.getElementById("actions");
const form = document.getElementById("message-form");
const field = document.getElementById("message");
const send = document.getElementById("send");
const publicMode = managed?.publicMode ?? location.pathname.endsWith("/panel-public.html");
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
send.setAttribute("aria-label", copy.send);
send.title = copy.send;
send.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>';
function syncSendButton() {
  send.hidden = !field.value.trim();
}
field.addEventListener("input", syncSendButton);
syncSendButton();
document.getElementById("preview").textContent = publicMode ? copy.live : (aiEnabled ? copy.ai : copy.preview);

function messageBubble(text, visitor = false) {
  const bubble = document.createElement("p");
  bubble.className = visitor ? "message visitor" : "message";
  bubble.textContent = text;
  return bubble;
}

function appendMessage(text, visitor = false) {
  messages.append(messageBubble(text, visitor));
  messages.scrollTop = messages.scrollHeight;
}

const relativeTime = new Intl.RelativeTimeFormat(language, {numeric:"always"});
const exactTime = new Intl.DateTimeFormat(language, {dateStyle:"medium",timeStyle:"short"});
let timestampTimer;

function updateTimestamp(timestamp, now) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(timestamp.dateTime)) / 60000));
  const text = minutes < 1 ? copy.justNow
    : minutes < 60 ? relativeTime.format(-minutes, "minute")
    : minutes < 1440 ? relativeTime.format(-Math.floor(minutes / 60), "hour")
    : relativeTime.format(-Math.floor(minutes / 1440), "day");
  if (timestamp.textContent !== text) timestamp.textContent = text;
}

function appendReply(text, typingBubble) {
  const turn = document.createElement("div");
  turn.className = "assistant-turn";
  const now = new Date();
  const timestamp = document.createElement("time");
  timestamp.className = "reply-time";
  timestamp.dateTime = now.toISOString();
  timestamp.title = exactTime.format(now);
  timestamp.setAttribute("aria-live", "off");
  updateTimestamp(timestamp, now.getTime());
  turn.append(messageBubble(text), timestamp);
  if (typingBubble) typingBubble.replaceWith(turn);
  else messages.append(turn);
  messages.scrollTop = messages.scrollHeight;
  timestampTimer ??= window.setInterval(() => {
    const now = Date.now();
    for (const stamp of messages.querySelectorAll(".reply-time")) updateTimestamp(stamp, now);
  }, 15000);
}

function showTyping() {
  const bubble = document.createElement("p");
  bubble.className = "message typing";
  bubble.setAttribute("aria-label", copy.typing);
  bubble.setAttribute("role", "status");
  bubble.innerHTML = '<span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span>';
  messages.append(bubble);
  messages.scrollTop = messages.scrollHeight;
  return bubble;
}

function normalize(text) {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

async function start() {
  const id = params.get("bot") || "";
  if (id.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error("Invalid bot ID");
  let bot = managed;
  if (!bot) {
    const response = await fetch(`bots/${id}.json`);
    if (!response.ok) throw new Error("Bot unavailable");
    bot = await response.json();
  }
  const content = managed ? {actions:[]} : bot[language];
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
  if (bot.accent) document.body.style.setProperty("--accent", bot.accent);
  appendMessage(managed?.greeting || copy.welcome(bot.name));
  if (!managed?.greeting) appendMessage(copy.offerHelp);
  let requestActions = actions;
  if (managed) {
    requestActions = document.createElement("div");
    requestActions.className = "request-actions";
    actions.prepend(requestActions);
  }
  const showQuote = managed ? managed.quoteEnabled !== false :
    (id === "sakireem" && (publicMode || hosted)) || (id === "hvac-arizona-valley" && hosted);
  if (showQuote) {
    addRequestForm(id, () => conversationId, requestActions);
  }
  if (managed?.serviceVisit) addRequestForm(id, () => conversationId, requestActions, "service_visit");

  if (managed?.bookingUrl) {
    const recordClick = () => {
      if (!publicMode || !managed.ticket || !globalThis.crypto?.randomUUID) return;
      fetch("/api/chat-booking-click", {
        method: "POST",
        headers: {"Content-Type":"application/json", "X-Chat-Widget-Ticket":managed.ticket},
        body: JSON.stringify({bot:id, language, id:crypto.randomUUID()}),
        keepalive: true
      }).catch(() => {});
    };
    const canEmbed = managed.bookingEmbedUrl && typeof HTMLDialogElement.prototype.showModal === "function";
    const booking = canEmbed ? document.createElement("button") : bookingLink();
    booking.className = "quote-open booking-link";
    booking.textContent = language === "es" ? "Agendar una cita" : "Book an appointment";
    if (canEmbed) {
      booking.type = "button";
      booking.setAttribute("aria-haspopup", "dialog");
      booking.addEventListener("click", () => {
        recordClick();
        openBookingScheduler(booking);
      });
    } else {
      booking.addEventListener("click", recordClick);
      booking.addEventListener("auxclick", event => {
        if (event.button === 1) recordClick();
      });
    }
    requestActions.append(booking);
  }
  actions.hidden = !requestActions.childElementCount && !content.actions.length;

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
    if (document.activeElement === send) field.focus();
    field.value = "";
    syncSendButton();
    if (aiEnabled) {
      send.disabled = true;
      form.setAttribute("aria-busy", "true");
      const bubble = showTyping();
      const showReply = (text) => appendReply(text, bubble);
      try {
        const headers = { "Content-Type": "application/json" };
        if (publicMode) headers["X-Chat-Mode"] = "public";
        addManagedHeaders(headers);
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
          syncSendButton();
          showReply(copy.invalidCode);
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
          showReply(explanation[result.code] || (response.status === 429 ? copy.limit : copy.failed));
          return;
        }
        const { reply } = result;
        if (hosted) {
          previewCode = headers["X-Chat-Preview-Code"];
          codeField.value = "";
          codeField.required = false;
          codeField.hidden = true;
        }
        if (typeof reply !== "string" || !reply.trim()) throw new Error("Empty reply");
        showReply(reply);
        history.push({ role: "user", content: question }, { role: "assistant", content: reply.slice(0, 1200) });
        if (history.length > 4) history.splice(0, history.length - 4);
      } catch {
        showReply(copy.failed);
      } finally {
        bubble.remove();
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
    appendReply(answered?.matches ? answered.faq.answer : copy.fallback);
  });
  form.hidden = false;
}

start().catch(() => appendMessage(copy.unavailable));

function addManagedHeaders(headers) {
  if (!managed) return;
  headers["X-Chat-Managed"] = "1";
  if (managed.ticket) headers["X-Chat-Widget-Ticket"] = managed.ticket;
}

function bookingLink() {
  const link = document.createElement("a");
  link.href = managed.bookingUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function openBookingScheduler(trigger) {
  let dialog = document.getElementById("booking-scheduler");
  if (!dialog) {
    const spanish = language === "es";
    dialog = document.createElement("dialog");
    dialog.id = "booking-scheduler";
    dialog.className = "booking-scheduler";
    dialog.setAttribute("aria-labelledby", "booking-scheduler-title");

    const heading = document.createElement("div");
    const title = document.createElement("h2");
    title.id = "booking-scheduler-title";
    title.textContent = spanish ? "Agendar una cita" : "Book an appointment";
    const back = document.createElement("button");
    back.type = "button";
    back.textContent = spanish ? "Volver al chat" : "Back to chat";
    back.onclick = () => dialog.close();

    const frame = document.createElement("iframe");
    frame.title = spanish ? "Agenda de citas de Acuity" : "Acuity appointment scheduling";
    frame.setAttribute("sandbox", "allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
    frame.referrerPolicy = "no-referrer";
    frame.src = managed.bookingEmbedUrl;

    const fallback = bookingLink();
    fallback.textContent = spanish ? "Abrir la agenda en otra pestaña" : "Open scheduler in a new tab";
    heading.append(title, back);
    dialog.append(heading, frame, fallback);
    dialog.addEventListener("close", () => trigger.focus());
    document.body.append(dialog);
  }
  dialog.showModal();
}

function addRequestForm(bot, getConversationId, requestActions, kind = "quote") {
  const visit = kind === "service_visit";
  const phoneMode = managed?.phoneMode;
  const addressMode = managed?.addressMode;
  const showPhone = phoneMode === "optional" || phoneMode === "required";
  const showAddress = addressMode === "optional" || addressMode === "required";
  const titleId = `request-title-${kind}`;
  const labels = language === "es" ? {
    title:visit ? "Solicitar una visita de servicio" : "Solicitar una cotización en el chat",
    name:"Nombre", contact:"Correo electrónico o teléfono", email:"Correo electrónico",
    phone:"Número de teléfono", address:"Dirección del servicio", time:"Día y horario preferidos",
    timeExample:"Por ejemplo, martes por la mañana (hora local del negocio)",
    visitNote:"La empresa se comunicará contigo para confirmar el horario.",
    project:"Cuéntanos sobre tu proyecto", consent:"Acepto que la empresa me contacte sobre esta solicitud.",
    close:"Cerrar", send:"Enviar solicitud", sent:visit ? "Recibimos tu solicitud. Nos comunicaremos contigo para confirmar." : "Recibimos tu solicitud. Gracias.",
    test:"Vista previa: esta solicitud se marcará como prueba.",
    invalid:"Revisa tus datos de contacto y completa los campos obligatorios.",
    code:"Ingresa el código correcto en el chat y vuelve a intentarlo.",
    retry:"No pudimos confirmar el envío. Intenta de nuevo o comunícate con la empresa a través de su sitio web."
  } : {
    title:visit ? "Request a service visit" : "Request a quote in chat",
    name:"Name", contact:"Email or phone", email:"Email address",
    phone:"Phone number", address:"Service address", time:"Preferred day and time",
    timeExample:"For example, Tuesday morning (business local time)",
    visitNote:"The business will contact you to confirm a time.",
    project:"Tell us about your project", consent:"I agree that the business may contact me about this request.",
    close:"Close", send:"Send request", sent:visit ? "Request received. We’ll contact you to confirm." : "We received your request. Thank you.",
    test:"Preview: this request will be marked as a test.",
    invalid:"Check your contact details and complete the required fields.",
    code:"Enter the correct preview code in the chat and try again.",
    retry:"We couldn’t confirm your submission. Try again or contact the business through its website."
  };
  const button = document.createElement("button");
  button.type = "button";
  button.className = "quote-open";
  button.textContent = !managed ? labels.title : language === "es"
    ? (visit ? "Solicitar visita" : "Pedir cotización")
    : (visit ? "Request a service visit" : "Request a quote");
  requestActions.prepend(button);

  const dialog = document.createElement("dialog");
  dialog.className = "quote-dialog";
  dialog.setAttribute("aria-labelledby",titleId);
  dialog.innerHTML = `<form>
    <h2 id="${titleId}">${labels.title}</h2>
    ${hosted ? `<p>${labels.test}</p>` : ""}
    <label>${labels.name}<input name="name" autocomplete="name" maxlength="100" required></label>
    ${visit ? `<p>${labels.visitNote}</p>` : ""}
    <label>${phoneMode ? labels.email : labels.contact}<input name="contact" ${phoneMode ? 'type="email" autocomplete="email"' : ""} maxlength="254" ${showPhone && phoneMode === "required" ? "" : "required"}></label>
    ${showPhone ? `<label>${labels.phone}<input name="phone" type="tel" autocomplete="tel" maxlength="50" ${phoneMode === "required" ? "required" : ""}></label>` : ""}
    ${showAddress ? `<label>${labels.address}<textarea name="address" autocomplete="street-address" rows="2" maxlength="350" ${addressMode === "required" ? "required" : ""}></textarea></label>` : ""}
    ${visit ? `<label>${labels.time}<input name="preferredTime" placeholder="${labels.timeExample}" maxlength="160" required></label>` : ""}
    <label>${labels.project}<textarea name="project" rows="3" maxlength="1000" required></textarea></label>
    <label class="quote-consent"><input name="confirmed" type="checkbox" required> ${labels.consent}</label>
    <p role="status" aria-live="polite"></p>
    <div class="quote-buttons"><button type="button">${labels.close}</button><button type="submit">${labels.send}</button></div>
  </form>`;
  document.body.append(dialog);
  const quote = dialog.querySelector("form");
  const controls = [...quote.elements];
  const syncContact = () => {
    if (phoneMode === "optional") quote.elements.contact.required = !quote.elements.phone.value.trim();
  };
  if (phoneMode === "optional") quote.elements.phone.addEventListener("input",syncContact);
  const close = quote.querySelector('[type="button"]');
  const status = quote.querySelector('[role="status"]');
  let sending = false;
  let previousBody, requestId, quoteConversationId;
  button.onclick = () => dialog.showModal();
  close.onclick = () => dialog.close();
  dialog.oncancel = event => { if (sending) event.preventDefault(); };
  quote.onsubmit = async event => {
    event.preventDefault();
    if (sending) return;
    const data = new FormData(quote);
    const body = {
      bot, language, name:data.get("name").trim(), contact:data.get("contact").trim(),
      project:data.get("project").trim(), confirmed:data.has("confirmed"),
      ...(managed ? {kind,phone:data.get("phone")?.trim() || "",address:data.get("address")?.trim() || "",
        preferredTime:data.get("preferredTime")?.trim() || ""} : {})
    };
    const serialized = JSON.stringify(body);
    if (serialized !== previousBody) {
      requestId = crypto.randomUUID();
      quoteConversationId = getConversationId();
    }
    previousBody = serialized;
    sending = true;
    controls.forEach(control => control.disabled = true);
    status.textContent = "";
    try {
      const headers = {"Content-Type":"application/json","X-Chat-Mode":publicMode ? "public" : "preview"};
      if (hosted) headers["X-Chat-Preview-Code"] = previewCode || codeField.value.trim();
      addManagedHeaders(headers);
      const response = await fetch("/api/chat-leads", {
        method:"POST", headers, body:JSON.stringify({...body,requestId,conversationId:quoteConversationId}),
        signal:AbortSignal.timeout(12000)
      });
      if (response.ok && (await response.json()).code === "saved") {
        quote.reset();
        syncContact();
        previousBody = undefined;
        status.textContent = labels.sent;
        appendReply(labels.sent);
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
