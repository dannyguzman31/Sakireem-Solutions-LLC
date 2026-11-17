(() => {
  const script = document.currentScript;
  const bot = script.dataset.bot;
  if (!bot || document.querySelector('sakireem-chat-widget')) return;

  const language = document.documentElement.lang.toLowerCase().startsWith('es')
    ? 'es'
    : 'en';
  const panelFile =
    script.dataset.chatMode === 'public' ? 'panel-public.html' : 'panel.html';
  const managed = script.dataset.chatMode === 'managed';
  const panelUrl = new URL(managed ? '/api/chat-widget' : panelFile, script.src);
  const options = new URLSearchParams({ bot, lang: language });
  if (script.dataset.preview === 'hosted') options.set('preview', 'hosted');
  panelUrl.search = options;

  const host = document.createElement('sakireem-chat-widget');
  const root = host.attachShadow({ mode: 'open' });
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('widget.css', script.src);

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = language === 'es' ? 'Abrir chat' : 'Open chat';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'chat-panel');

  const panel = document.createElement('iframe');
  panel.id = 'chat-panel';
  panel.title = language === 'es' ? 'Asistente de chat' : 'Chat assistant';
  panel.hidden = true;
  if (managed) panel.referrerPolicy = 'origin';

  function setOpen(open) {
    if (open && !panel.hasAttribute('src')) panel.src = panelUrl.href;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.textContent =
      language === 'es'
        ? open
          ? 'Cerrar chat'
          : 'Abrir chat'
        : open
          ? 'Close chat'
          : 'Open chat';
    if (!open) button.focus();
  }

  button.addEventListener('click', () => setOpen(panel.hidden));
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false);
  });
  window.addEventListener('message', (event) => {
    if (
      event.origin === panelUrl.origin &&
      event.source === panel.contentWindow &&
      event.data === 'sakireem-chat-close'
    ) {
      setOpen(false);
    }
  });

  root.append(stylesheet, panel, button);
  document.body.append(host);
})();
