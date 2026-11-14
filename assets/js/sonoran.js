const navigationToggle = document.querySelector('.sonoran-toggle');
const navigationLinks = document.getElementById('primary-navigation');

function setNavigationOpen(open) {
  navigationToggle.setAttribute('aria-expanded', String(open));
  navigationLinks.classList.toggle('is-open', open);
}

navigationToggle.addEventListener('click', () => {
  setNavigationOpen(navigationToggle.getAttribute('aria-expanded') === 'false');
});

navigationLinks.addEventListener('click', (event) => {
  if (event.target.closest('a')) setNavigationOpen(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && navigationToggle.getAttribute('aria-expanded') === 'true') {
    setNavigationOpen(false);
    navigationToggle.focus();
  }
});

const previewButton = document.querySelector('[data-site-preview]');
previewButton?.addEventListener('click', () => {
  const viewport = document.getElementById(previewButton.getAttribute('aria-controls'));
  const existingFrame = viewport.querySelector('iframe');
  if (existingFrame) {
    existingFrame.focus();
    return;
  }

  const frame = document.createElement('iframe');
  frame.title = previewButton.dataset.previewTitle;
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.src = previewButton.dataset.sitePreview;
  viewport.append(frame);
  frame.focus();
});
