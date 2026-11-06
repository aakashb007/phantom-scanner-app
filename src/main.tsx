import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Keep the installed app up to date: check for a new version when the app starts and every time it
// comes back to the screen, and reload into the new version as soon as it is ready.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller; // no reload on the very first install
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    window.location.reload();
  });
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateSW(true);
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => reg.update().catch(() => {});
      check();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      setInterval(check, 30 * 60 * 1000);
    },
  });
}

createRoot(document.getElementById('root')!).render(<App />);
