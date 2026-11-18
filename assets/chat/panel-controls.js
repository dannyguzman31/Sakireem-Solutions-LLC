(() => {
  if (window.parent === window) return;
  const header = document.querySelector('header');
  const declaredOrigin = document.body.dataset.parentOrigin ||
    new URLSearchParams(location.search).get('parentOrigin');
  let parentOrigin;
  try {
    const candidate = new URL(declaredOrigin);
    if (!['https:', 'http:'].includes(candidate.protocol) || candidate.origin !== declaredOrigin) return;
    parentOrigin = candidate.origin;
    if (document.referrer && new URL(document.referrer).origin !== parentOrigin) return;
  } catch { return; }
  const send = (message) => window.parent.postMessage(message, parentOrigin);
  const spanish = document.documentElement.lang === 'es';
  const icons = {
    expand:'<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/>',
    shrink:'<path d="M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5"/>',
    close:'<path d="m6 6 12 12M18 6 6 18"/>'
  };
  function setIcon(button, icon) {
    button.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">${icons[icon]}</svg>`;
  }
  function control(label, icon, message) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-control';
    button.setAttribute('aria-label', label);
    button.title = label;
    setIcon(button, icon);
    button.addEventListener('click', () => send(message));
    return button;
  }
  let close;
  let resize;
  window.addEventListener('message', (event) => {
    if (event.origin !== parentOrigin || event.source !== window.parent) return;
    const {type,canResize,expanded,focus} = event.data || {};
    if (type !== 'sakireem-chat-controls' || typeof canResize !== 'boolean' ||
        typeof expanded !== 'boolean' || typeof focus !== 'boolean') return;
    if (!close) {
      resize = control(spanish ? 'Tamaño del chat' : 'Chat size', 'expand', 'sakireem-chat-resize');
      close = control(spanish ? 'Cerrar chat' : 'Close chat', 'close', 'sakireem-chat-close');
      resize.classList.add('panel-resize');
      header.classList.add('panel-header-with-controls');
      header.prepend(resize);
      header.append(close);
    }
    resize.hidden = !canResize;
    resize.setAttribute('aria-pressed', String(expanded));
    setIcon(resize, expanded ? 'shrink' : 'expand');
    resize.title = spanish
      ? (expanded ? 'Reducir chat' : 'Ampliar chat')
      : (expanded ? 'Shrink chat' : 'Expand chat');
    if (focus || (!canResize && document.activeElement === resize)) {
      (canResize ? resize : close).focus();
    }
    send('sakireem-chat-controls-ready');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) send('sakireem-chat-close');
  });
})();
