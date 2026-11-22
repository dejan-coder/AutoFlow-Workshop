import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, get, post, type Role, type User } from './api';
import { Field } from './components/Field';

interface AuthState {
  user: User;
  logout: () => Promise<void>;
  can: (...roles: Role[]) => boolean;
}
const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth utanför AuthGate');
  return ctx;
}

/** Visar inloggning (eller första-start) tills användaren är inloggad. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<{ setup_required: boolean; user: User | null } | null>(null);
  const refresh = () => get<{ setup_required: boolean; user: User | null }>('/api/auth/status').then(setStatus);

  useEffect(() => {
    refresh().catch(() => setStatus({ setup_required: false, user: null }));
    const onUnauthorized = () => setStatus((s) => (s ? { ...s, user: null } : s));
    addEventListener('af:unauthorized', onUnauthorized);
    return () => removeEventListener('af:unauthorized', onUnauthorized);
  }, []);

  if (!status) return <div className="auth-screen"><div className="auth-card">Laddar…</div></div>;
  if (!status.user) {
    return status.setup_required ? <SetupForm onDone={refresh} /> : <LoginForm onDone={refresh} />;
  }
  const user = status.user;
  const value: AuthState = {
    user,
    logout: async () => {
      await post('/api/auth/logout');
      setStatus({ setup_required: false, user: null });
      location.hash = '#/';
    },
    can: (...roles) => roles.includes(user.role),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function Brand() {
  return (
    <div className="auth-brand">
      <span className="logo">AF</span>
      <div>
        <strong>AutoFlow</strong>
        <small>Workshop</small>
      </div>
    </div>
  );
}

function LoginForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/api/auth/login', { email, password });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Något gick fel');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-screen">
      <form className="auth-card form" onSubmit={submit}>
        <Brand />
        <h1>Logga in</h1>
        <Field label="E-post"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required /></Field>
        <Field label="Lösenord"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>Logga in</button>
        <p className="muted small">Glömt lösenordet? Be verkstadens administratör att sätta ett nytt.</p>
      </form>
    </div>
  );
}

function SetupForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: '', email: '', password: '', password2: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setError('');
    if (f.password !== f.password2) return setErrors({ password2: 'Lösenorden är inte lika' });
    try {
      await post('/api/auth/setup', { name: f.name, email: f.email, password: f.password });
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setError(err.message);
      }
    }
  }
  return (
    <div className="auth-screen">
      <form className="auth-card form" onSubmit={submit}>
        <Brand />
        <h1>Välkommen!</h1>
        <p className="muted">Skapa verkstadens administratör. Fler användare lägger du till under Inställningar.</p>
        <Field label="Ditt namn" error={errors.name}><input value={f.name} onChange={set('name')} autoFocus required /></Field>
        <Field label="E-post" error={errors.email}><input type="email" value={f.email} onChange={set('email')} required /></Field>
        <Field label="Lösenord (minst 8 tecken)" error={errors.password}><input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} required /></Field>
        <Field label="Upprepa lösenord" error={errors.password2}><input type="password" autoComplete="new-password" value={f.password2} onChange={set('password2')} required /></Field>
        {error && <p className="error">{error}</p>}
        <button type="submit">Skapa och logga in</button>
      </form>
    </div>
  );
}
