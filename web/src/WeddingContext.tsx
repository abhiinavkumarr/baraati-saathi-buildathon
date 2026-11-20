import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiJson, clearStoredSession, readStoredSession, saveStoredSession, type StoredSession } from './api.ts';

export interface ListedWedding {
  slug: string;
  locked?: true;
  private: boolean;
  host_token?: string;
  couple?: string;
  first_date?: string | null;
  days?: number | null;
  city?: string;
  logo_url?: string | null;
  /** The shared read-only demo wedding (Meera & Rohan), shown to everyone. */
  demo?: true;
}

interface WeddingContextValue {
  session: StoredSession | null;
  weddings: ListedWedding[];
  loading: boolean;
  error: string;
  passcode: string;
  setPasscode: (p: string) => void;
  setSession: (s: StoredSession | null) => void;
  logout: () => void;
  refreshWeddings: (overridePasscode?: string, overrideSession?: StoredSession) => Promise<ListedWedding[]>;
  getTokenForSlug: (slug: string) => string;
  getWeddingBySlug: (slug: string) => ListedWedding | undefined;
}

const WeddingContext = createContext<WeddingContextValue | null>(null);

const PASSCODE_KEY = 'saathi:passcode';

export function askSaathi(prompt: string) {
  window.dispatchEvent(new CustomEvent('saathi:ask', { detail: { prompt } }));
}

export function notifySaathiChanged() {
  window.dispatchEvent(new CustomEvent('saathi:changed'));
}

export function WeddingProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<StoredSession | null>(() => readStoredSession());
  const [weddings, setWeddings] = useState<ListedWedding[]>([]);
  const [loading, setLoading] = useState(Boolean(readStoredSession()));
  const [error, setError] = useState('');
  const [passcode, setPasscodeState] = useState<string>(() => {
    try {
      return sessionStorage.getItem(PASSCODE_KEY) || '';
    } catch {
      return '';
    }
  });

  const setPasscode = useCallback((p: string) => {
    setPasscodeState(p);
    try {
      if (p) sessionStorage.setItem(PASSCODE_KEY, p);
      else sessionStorage.removeItem(PASSCODE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const setSession = useCallback((s: StoredSession | null) => {
    if (s) {
      saveStoredSession(s);
      setLoading(true);
    } else {
      clearStoredSession();
    }
    setSessionState(s);
    if (!s) {
      setWeddings([]);
      setPasscode('');
      setLoading(false);
    }
  }, [setPasscode]);

  const logout = useCallback(() => {
    setSession(null);
  }, [setSession]);

  const refreshWeddings = useCallback(async (overridePasscode?: string, overrideSession?: StoredSession): Promise<ListedWedding[]> => {
    const active = overrideSession ?? session ?? readStoredSession();
    if (!active) {
      setWeddings([]);
      setLoading(false);
      return [];
    }
    setLoading(true);
    setError('');
    try {
      const code = overridePasscode !== undefined ? overridePasscode : passcode;
      const r = await apiJson<{ user: { id: string; name: string }; weddings: ListedWedding[] }>(
        '/api/me/weddings',
        { headers: code ? { 'x-owner-passcode': code } : undefined },
        active.session,
      );
      setWeddings(r.weddings);
      return r.weddings;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not load your weddings.';
      if (/sign in/i.test(msg)) {
        setSession(null);
      } else {
        setError(msg);
      }
      return [];
    } finally {
      setLoading(false);
    }
  }, [session, passcode, setSession]);

  useEffect(() => {
    if (session) void refreshWeddings();
    else setLoading(false);
  }, [session, refreshWeddings]);

  const getWeddingBySlug = useCallback(
    (slug: string) => weddings.find((w) => w.slug === slug),
    [weddings],
  );

  const getTokenForSlug = useCallback(
    (slug: string) => {
      const fromList = weddings.find((w) => w.slug === slug)?.host_token;
      if (fromList) return fromList;
      // Fallback for legacy /h/:slug?t= redirects stored in localStorage during redirect.
      try {
        return localStorage.getItem(`host:${slug}`) || '';
      } catch {
        return '';
      }
    },
    [weddings],
  );

  const value = useMemo<WeddingContextValue>(
    () => ({
      session,
      weddings,
      loading,
      error,
      passcode,
      setPasscode,
      setSession,
      logout,
      refreshWeddings,
      getTokenForSlug,
      getWeddingBySlug,
    }),
    [session, weddings, loading, error, passcode, setPasscode, setSession, logout, refreshWeddings, getTokenForSlug, getWeddingBySlug],
  );

  return <WeddingContext.Provider value={value}>{children}</WeddingContext.Provider>;
}

export function useWedding(): WeddingContextValue {
  const ctx = useContext(WeddingContext);
  if (!ctx) throw new Error('useWedding must be used inside WeddingProvider');
  return ctx;
}
