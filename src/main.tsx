import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { SessionProvider } from './state/session';
import { DirectoryProvider } from './state/directory';
import { RoomsProvider } from './state/rooms';
import { ToastProvider } from './state/toasts';

import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <DirectoryProvider>
        <RoomsProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </RoomsProvider>
      </DirectoryProvider>
    </SessionProvider>
  </StrictMode>,
);
