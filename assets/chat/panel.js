const params = new URLSearchParams(location.search);
const language = params.get("lang") === "es" ? "es" : "en";
document.documentElement.lang = language;

const translations = {
  en: {
    preview: "Preview · FAQ replies",
    ai: "Preview · AI replies",
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
const aiEnabled = ["localhost", "127.0.0.1"].includes(location.hostname) && location.port === "8000";
const history = [];
messages.setAttribute("aria-label", copy.conversation);
actions.setAttribute("aria-label", copy.contact);
field.placeholder = copy.placeholder;
field.setAttribute("aria-label", copy.placeholder);
send.textContent = copy.send;
document.getElementById("preview").textContent = aiEnabled ? copy.ai : copy.preview;

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

  document.title = bot.name;
  document.getElementById("business").textContent = bot.name;
  document.body.style.setProperty("--accent", bot.accent);
  appendMessage(content.welcome);

  for (const faq of content.faqs) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = faq.question;
    button.addEventListener("click", () => {
      appendMessage(faq.question, true);
      appendMessage(faq.answer);
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
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bot: id, language, message: question, history: history.slice(-4) })
        });
        if (!response.ok) throw new Error("Model request failed");
        const { reply } = await response.json();
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
