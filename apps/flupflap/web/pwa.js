/* Installation is optional. Credentials and checkout capabilities stay out of storage. */
(() => {
  const install = document.getElementById('install');
  const button = document.getElementById('install-button');
  const copy = document.getElementById('install-copy');
  let prompt;
  let dismissed = false;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  addEventListener('flutter-first-frame', () => document.getElementById('startup').remove(), {once:true});
  const online = () => { document.getElementById('offline').hidden = navigator.onLine; };
  addEventListener('online', online); addEventListener('offline', online); online();
  addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); prompt = event;
    if (!standalone() && !dismissed) install.hidden = false;
  });
  button.addEventListener('click', async () => {
    if (!prompt) return;
    const current = prompt; prompt = null;
    await current.prompt(); await current.userChoice; install.hidden = true;
  });
  document.getElementById('install-dismiss').addEventListener('click', () => { dismissed = true; install.hidden = true; });
  addEventListener('appinstalled', () => { prompt = null; install.hidden = true; });
  if (!standalone() && /iPad|iPhone|iPod/.test(navigator.userAgent)) {
    copy.textContent = 'In Safari, tap Share → Add to Home Screen → Add.';
    button.hidden = true; install.hidden = false;
  }
  // Updates activate after existing tabs close, never force a checkout reload.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('pwa-worker.js', {scope:'./', updateViaCache:'none'}).catch(() => {});
  }
})();
