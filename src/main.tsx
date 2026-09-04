import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { SessionProvider } from './state/session';
import { DirectoryProvider } from './state/directory';
import { ToastProvider } from './state/toasts';

import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <DirectoryProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </DirectoryProvider>
    </SessionProvider>
  </StrictMode>,
);
