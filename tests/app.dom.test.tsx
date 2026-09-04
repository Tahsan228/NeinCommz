import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import { SessionProvider } from '../src/state/session';
import { DirectoryProvider } from '../src/state/directory';
import { ToastProvider } from '../src/state/toasts';

/**
 * A mount test, not a unit test. Typecheck and build both pass on a tree whose
 * providers are wired wrong or whose hooks run in the wrong order — this is
 * what actually proves the app comes up and the front door works.
 */
function renderApp() {
  return render(
    <SessionProvider>
      <DirectoryProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </DirectoryProvider>
    </SessionProvider>,
  );
}

afterEach(() => {
  // No globals:true, so Testing Library's automatic cleanup is not installed.
  cleanup();
  sessionStorage.clear();
});

describe('app shell', () => {
  it('mounts on the site gate', async () => {
    renderApp();
    expect(await screen.findByRole('heading', { name: 'NeinCommz' })).toBeTruthy();
    expect(screen.getByLabelText('Site password')).toBeTruthy();
  });

  it('rejects the wrong word and stays put', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByLabelText('Site password'), 'warm');
    await user.click(screen.getByRole('button', { name: 'Enter' }));

    expect(await screen.findByText('Not it.')).toBeTruthy();
    expect(screen.getByLabelText('Site password')).toBeTruthy();
  });

  it('opens the profile picker on the right word', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByLabelText('Site password'), 'cold');
    await user.click(screen.getByRole('button', { name: 'Enter' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: "Who's here?" })).toBeTruthy());
    expect(screen.getByText('Add profile')).toBeTruthy();
  });

  it('is case-insensitive about the word', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByLabelText('Site password'), 'COLD');
    await user.click(screen.getByRole('button', { name: 'Enter' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: "Who's here?" })).toBeTruthy());
  });

  it('asks for the word again on every fresh load', async () => {
    const user = userEvent.setup();
    const first = renderApp();
    await user.type(screen.getByLabelText('Site password'), 'cold');
    await user.click(screen.getByRole('button', { name: 'Enter' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: "Who's here?" })).toBeTruthy());
    first.unmount();

    // Nothing is persisted, so a reload lands back on the front door.
    renderApp();
    await waitFor(() => expect(screen.getByLabelText('Site password')).toBeTruthy());
    expect(screen.queryByRole('heading', { name: "Who's here?" })).toBeNull();
  });

  it('says so plainly when Supabase has not been configured', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByLabelText('Site password'), 'cold');
    await user.click(screen.getByRole('button', { name: 'Enter' }));

    expect(await screen.findByText(/Supabase is not configured yet/)).toBeTruthy();
  });
});
