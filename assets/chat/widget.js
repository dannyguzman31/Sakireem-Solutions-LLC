(() => {
  const script = document.currentScript;
  const bot = script.dataset.bot;
  if (!bot || document.querySelector('sakireem-chat-widget')) return;

  const spanish = document.documentElement.lang.toLowerCase().startsWith('es');
  const language = spanish ? 'es' : 'en';
  const labels = spanish
    ? {open:'Abrir chat', close:'Minimizar chat', resize:'Tamaño del chat', panel:'Asistente de chat'}
    : {open:'Open chat', close:'Minimize chat', resize:'Chat size', panel:'Chat assistant'};
  const panelFile = script.dataset.chatMode === 'public' ? 'panel-public.html' : 'panel.html';
  const managed = script.dataset.chatMode === 'managed';
  const panelUrl = new URL(managed ? '/api/chat-widget' : panelFile, script.src);
  const options = new URLSearchParams({ bot, lang: language });
  if (script.dataset.preview === 'hosted') options.set('preview', 'hosted');
  panelUrl.search = options;

  const icons = {
    chat:'<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.6-3.2A7.5 7.5 0 1 1 20 11.5Z"/><path d="M9 11.5h6"/>',
    expand:'<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/>',
    shrink:'<path d="M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5"/>',
    close:'<path d="M5 12h14"/>'
  };
  function showIcon(button, name) {
    button.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
  }
  function iconButton(className, label, icon) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.setAttribute('aria-label', label);
    button.title = label;
    showIcon(button, icon);
    return button;
  }

  const host = document.createElement('sakireem-chat-widget');
  const root = host.attachShadow({ mode: 'open' });
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('widget.css?v=3', script.src);

  const launcher = iconButton('chat-launcher', labels.open, 'chat');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-controls', 'chat-window');

  const chatWindow = document.createElement('section');
  chatWindow.id = 'chat-window';
  chatWindow.className = 'chat-window';
  chatWindow.setAttribute('aria-label', labels.panel);
  chatWindow.hidden = true;

  const toolbar = document.createElement('div');
  toolbar.className = 'chat-toolbar';
  const resize = iconButton('chat-control', labels.resize, 'expand');
  resize.setAttribute('aria-pressed', 'false');
  resize.title = spanish ? 'Ampliar chat' : 'Expand chat';
  const close = iconButton('chat-control', labels.close, 'close');
  toolbar.append(resize, close);

  const panel = document.createElement('iframe');
  panel.id = 'chat-panel';
  panel.title = labels.panel;
  if (managed) panel.referrerPolicy = 'origin';
  chatWindow.append(toolbar, panel);

  const viewport = window.visualViewport;

  function fitVisibleViewport() {
    if (viewport.scale !== 1) return;
    chatWindow.style.setProperty('--chat-visible-top', `${viewport.offsetTop}px`);
    chatWindow.style.setProperty('--chat-visible-height', `${viewport.height}px`);
  }

  function setOpen(open) {
    if (open && !panel.hasAttribute('src')) panel.src = panelUrl.href;
    chatWindow.hidden = !open;
    launcher.hidden = open;
    launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      if (viewport) {
        fitVisibleViewport();
        viewport.addEventListener('resize', fitVisibleViewport);
        viewport.addEventListener('scroll', fitVisibleViewport);
      }
      const fullScreen = window.matchMedia?.('(max-width: 760px), (max-width: 950px) and (pointer: coarse)').matches;
      const firstControl = fullScreen ? close : resize;
      firstControl.focus();
    } else {
      viewport?.removeEventListener('resize', fitVisibleViewport);
      viewport?.removeEventListener('scroll', fitVisibleViewport);
      chatWindow.style.removeProperty('--chat-visible-top');
      chatWindow.style.removeProperty('--chat-visible-height');
      launcher.focus();
    }
  }

  launcher.addEventListener('click', () => setOpen(true));
  close.addEventListener('click', () => setOpen(false));
  resize.addEventListener('click', () => {
    const expanded = chatWindow.classList.toggle('chat-window-expanded');
    showIcon(resize, expanded ? 'shrink' : 'expand');
    resize.setAttribute('aria-pressed', String(expanded));
    resize.title = spanish
      ? (expanded ? 'Reducir chat' : 'Ampliar chat')
      : (expanded ? 'Shrink chat' : 'Expand chat');
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !chatWindow.hidden) {
      event.stopPropagation();
      setOpen(false);
    }
  });
  window.addEventListener('message', (event) => {
    if (
      !chatWindow.hidden &&
      event.origin === panelUrl.origin &&
      event.source === panel.contentWindow &&
      event.data === 'sakireem-chat-close'
    ) setOpen(false);
  });

  root.append(stylesheet);
  if (managed) {
    const theme = document.createElement('link');
    const themeUrl = new URL(panelUrl);
    themeUrl.search = new URLSearchParams({bot,asset:'launcher'});
    theme.rel = 'stylesheet';
    theme.referrerPolicy = 'origin';
    theme.href = themeUrl.href;
    root.append(theme);
  }
  root.append(chatWindow, launcher);
  document.body.append(host);
})();
