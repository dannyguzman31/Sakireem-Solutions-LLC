(() => {
  const script = document.currentScript;
  const bot = script.dataset.bot;
  if (!bot || document.querySelector('sakireem-chat-widget')) return;

  const spanish = document.documentElement.lang.toLowerCase().startsWith('es');
  const language = spanish ? 'es' : 'en';
  const labels = spanish
    ? {open:'Abrir chat', close:'Cerrar chat', panel:'Asistente de chat'}
    : {open:'Open chat', close:'Close chat', panel:'Chat assistant'};
  const panelFile = script.dataset.chatMode === 'public' ? 'panel-public.html' : 'panel.html';
  const managed = script.dataset.chatMode === 'managed';
  const panelUrl = new URL(managed ? '/api/chat-widget' : panelFile, script.src);
  const options = new URLSearchParams({bot, lang:language, parentOrigin:location.origin});
  if (script.dataset.preview === 'hosted') options.set('preview', 'hosted');
  panelUrl.search = options;

  function iconButton(className, label, path) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
    return button;
  }

  const host = document.createElement('sakireem-chat-widget');
  const root = host.attachShadow({mode:'open'});
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('widget.css?v=4', script.src);

  const launcher = iconButton('chat-launcher', labels.open,
    '<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.6-3.2A7.5 7.5 0 1 1 20 11.5Z"/><path d="M9 11.5h6"/>');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-controls', 'chat-window');

  const chatWindow = document.createElement('section');
  chatWindow.id = 'chat-window';
  chatWindow.className = 'chat-window';
  chatWindow.setAttribute('aria-label', labels.panel);
  chatWindow.hidden = true;
  const fallbackClose = iconButton('chat-fallback-close', labels.close, '<path d="m6 6 12 12M18 6 6 18"/>');
  const panel = document.createElement('iframe');
  panel.id = 'chat-panel';
  panel.title = labels.panel;
  if (managed) panel.referrerPolicy = 'origin';
  chatWindow.append(panel, fallbackClose);

  const viewport = window.visualViewport;
  const mobile = window.matchMedia('(max-width: 760px), (max-width: 950px) and (pointer: coarse)');
  let controlsReady = false;
  let expanded = false;

  function sendControls(focus = false) {
    panel.contentWindow?.postMessage({
      type:'sakireem-chat-controls',
      canResize:!mobile.matches,
      expanded,
      focus
    }, panelUrl.origin);
  }

  function fitVisibleViewport() {
    if (viewport.scale !== 1) return;
    chatWindow.style.setProperty('--chat-visible-top', `${viewport.offsetTop}px`);
    chatWindow.style.setProperty('--chat-visible-height', `${viewport.height}px`);
  }

  function setOpen(open) {
    chatWindow.hidden = !open;
    launcher.hidden = open;
    launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      if (!panel.hasAttribute('src')) panel.src = panelUrl.href;
      if (viewport) {
        fitVisibleViewport();
        viewport.addEventListener('resize', fitVisibleViewport);
        viewport.addEventListener('scroll', fitVisibleViewport);
      }
      if (controlsReady) sendControls(true);
      else fallbackClose.focus();
    } else {
      viewport?.removeEventListener('resize', fitVisibleViewport);
      viewport?.removeEventListener('scroll', fitVisibleViewport);
      chatWindow.style.removeProperty('--chat-visible-top');
      chatWindow.style.removeProperty('--chat-visible-height');
      launcher.focus();
    }
  }

  launcher.addEventListener('click', () => setOpen(true));
  fallbackClose.addEventListener('click', () => setOpen(false));
  panel.addEventListener('load', () => {
    controlsReady = false;
    fallbackClose.hidden = false;
    if (!chatWindow.hidden) sendControls(root.activeElement === fallbackClose);
  });
  mobile.addEventListener('change', () => {
    if (controlsReady && !chatWindow.hidden) sendControls();
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !chatWindow.hidden) {
      event.stopPropagation();
      setOpen(false);
    }
  });
  window.addEventListener('message', (event) => {
    if (chatWindow.hidden || event.origin !== panelUrl.origin || event.source !== panel.contentWindow) return;
    if (event.data === 'sakireem-chat-controls-ready') {
      controlsReady = true;
      fallbackClose.hidden = true;
    } else if (event.data === 'sakireem-chat-close') {
      setOpen(false);
    } else if (event.data === 'sakireem-chat-resize' && controlsReady && !mobile.matches) {
      expanded = chatWindow.classList.toggle('chat-window-expanded');
      sendControls();
    }
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
