import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import App from './App.tsx';
import { ErrorBoundary } from './shell/ErrorBoundary';

// Register service worker for PWA
registerSW({ immediate: true });

/*
 * Filet de dernier recours.
 *
 * La limite utile est celle posée autour des écrans, dans la coque : elle
 * garde la navigation debout. Celle-ci couvre ce qui se casse au-dessus —
 * store, panier, routeur — là où plus aucune coque ne peut survivre. Elle ne
 * répare pas grand-chose, mais elle transforme un écran blanc muet en une
 * page qui dit ce qui s'est passé et que rien n'est effacé. Au comptoir, la
 * différence entre les deux est celle entre « la tablette est morte » et
 * « je recharge et je reprends ».
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary zone="application">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
