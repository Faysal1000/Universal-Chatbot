import { LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router';

import { useCurrentSession, useSignOut } from '@/features/session/api/sessionQueries';
import { withBasePath } from '@/shared/basePath';
import { joinClassNames } from '@/shared/lib/classNames';
import { useToast } from '@/shared/ui/toastContext';

import { HealthStrip } from './HealthStrip';
import { NAVIGATION_GROUPS } from './navigation';
import { useTheme } from './useTheme';

function RailNavigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 pb-4">
      {NAVIGATION_GROUPS.map((group) => (
        <div key={group.label} className="border-t border-rail-rule pt-2.5 pb-1.5 first:border-t-0 first:pt-1">
          <p className="flex items-center gap-2 px-2 pb-1 text-xs font-semibold text-rail-text-strong">
            <group.icon aria-hidden="true" className="size-3.5 opacity-80" />
            {group.label}
          </p>
          <ul>
            {group.links.map((link) => (
              <li key={link.path}>
                <NavLink
                  to={link.path}
                  end={link.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    joinClassNames(
                      'relative block rounded py-1 pr-2 pl-7.5 text-sm transition-colors focus-visible:outline-rail-focus-ring pointer-coarse:py-2.5',
                      isActive
                        ? 'bg-rail-raised font-medium text-rail-text-strong before:absolute before:top-1 before:bottom-1 before:left-3 before:w-0.5 before:bg-accent'
                        : 'text-rail-text hover:bg-rail-raised/60 hover:text-rail-text-strong',
                    )
                  }
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function RailFooter() {
  const sessionQuery = useCurrentSession();
  const signOutMutation = useSignOut();
  const { showToast } = useToast();
  const handleSignOut = () => {
    signOutMutation.mutate(undefined, {
      onError: () => showToast('Signed out here; the server session could not be ended.', 'info'),
    });
  };
  return (
    <div className="flex items-center justify-between gap-2 border-t border-rail-rule px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs text-rail-text">Signed in as</p>
        <p className="truncate text-sm font-medium text-rail-text-strong">{sessionQuery.data?.username ?? '—'}</p>
      </div>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={signOutMutation.isPending}
        className="inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-sm text-rail-text hover:bg-rail-raised hover:text-rail-text-strong focus-visible:outline-rail-focus-ring disabled:opacity-50 pointer-coarse:py-3"
      >
        <LogOut aria-hidden="true" className="size-4" />
        Log out
      </button>
    </div>
  );
}

function Rail({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-rail">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <img src={withBasePath('/favicon.svg')} alt="" className="size-7 rounded ring-1 ring-rail-rule" />
        <div className="leading-tight">
          <p className="text-sm font-semibold text-rail-text-strong">Universal Chatbot</p>
          <p className="text-xs text-rail-text">Admin console</p>
        </div>
      </div>
      <RailNavigation onNavigate={onNavigate} />
      <RailFooter />
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${nextTheme} theme`}
      title={`Switch to ${nextTheme} theme`}
      className="inline-flex size-8 items-center justify-center rounded border border-border text-secondary hover:border-border-strong hover:text-primary pointer-coarse:size-11"
    >
      {theme === 'dark' ? (
        <Sun aria-hidden="true" className="size-4" />
      ) : (
        <Moon aria-hidden="true" className="size-4" />
      )}
    </button>
  );
}

const NAVIGATION_DRAWER_ID = 'navigation-drawer';

/** The rail as a modal drawer on small screens: native `<dialog>`, so Escape and focus trapping work. */
function NavigationDrawer({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const drawerReference = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const drawerElement = drawerReference.current;
    if (!drawerElement) return;
    if (isOpen && !drawerElement.open) drawerElement.showModal();
    if (!isOpen && drawerElement.open) drawerElement.close();
  }, [isOpen]);

  return (
    // Escape (onCancel) is the keyboard way out; closing on a backdrop click is a mouse convenience.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={drawerReference}
      id={NAVIGATION_DRAWER_ID}
      aria-label="Navigation"
      onCancel={(cancelEvent) => {
        cancelEvent.preventDefault();
        onClose();
      }}
      onClick={(clickEvent) => {
        if (clickEvent.target === drawerReference.current) onClose();
      }}
      className="m-0 h-full max-h-none w-64 max-w-[85vw] bg-rail p-0 lg:hidden"
    >
      {isOpen ? (
        <div className="relative h-full">
          <Rail onNavigate={onClose} />
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
            className="absolute top-3 right-2 inline-flex size-8 items-center justify-center rounded text-rail-text hover:text-rail-text-strong pointer-coarse:size-11"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}
    </dialog>
  );
}

/** Navy rail (a drawer on small screens), a top bar with every service's health, and the page. */
export function ConsoleLayout() {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-full">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 lg:block">
        <Rail />
      </aside>
      <NavigationDrawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-surface px-4 py-2 lg:px-6">
          <button
            type="button"
            aria-label="Open navigation"
            aria-expanded={isDrawerOpen}
            aria-controls={NAVIGATION_DRAWER_ID}
            onClick={() => setIsDrawerOpen(true)}
            className="inline-flex size-8 items-center justify-center rounded border border-border text-secondary lg:hidden pointer-coarse:size-11"
          >
            <Menu aria-hidden="true" className="size-4" />
          </button>
          <HealthStrip />
          <ThemeToggle />
        </header>
        <main id="main-content" className="min-w-0 flex-1 px-4 py-5 lg:px-6">
          <div className="mx-auto max-w-[1480px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
