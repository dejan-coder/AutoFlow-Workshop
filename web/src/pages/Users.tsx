import { useState, type FormEvent } from 'react';
import { get, patch, post, ROLE_LABELS, type Mechanic, type Role, type User } from '../api';
import { ErrorText, useAction, useLoad } from '../components/common';
import { Field } from '../components/Field';
import { useAuth } from '../auth';

export function UsersAdmin() {
  const { user: me } = useAuth();
  const { data, reload } = useLoad(() => get<{ items: User[] }>('/api/users'), []);
  const { data: mechanics } = useLoad(() => get<{ items: Mechanic[] }>('/api/mechanics'), []);
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'mechanic' as Role, mechanic_id: '' });
  const [resetFor, setResetFor] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const action = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  function create(e: FormEvent) {
    e.preventDefault();
    action.run(async () => {
      await post('/api/users', { ...f, mechanic_id: f.mechanic_id ? Number(f.mechanic_id) : null });
      setF({ name: '', email: '', password: '', role: 'mechanic', mechanic_id: '' });
      reload();
    });
  }

  return (
    <section className="card">
      <h2>Användare</h2>
      <p className="muted">
        Mekaniker ser tidbok, arbetsordrar, kunder, fordon och lager. Kontor ser även offerter, fakturor, rapporter och bokföring.
        Administratör kan dessutom hantera användare och inställningar.
      </p>
      <table>
        <thead><tr><th>Namn</th><th>E-post</th><th>Roll</th><th>Senast inloggad</th><th /></tr></thead>
        <tbody>
          {data?.items.map((u) => (
            <tr key={u.id} className={u.active ? '' : 'muted'}>
              <td>{u.name}{u.id === me.id && <span className="muted"> (du)</span>}</td>
              <td>{u.email}</td>
              <td>
                <select value={u.role} disabled={u.id === me.id} onChange={(e) => action.run(async () => { await patch(`/api/users/${u.id}`, { role: e.target.value }); reload(); })}>
                  {Object.entries(ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </td>
              <td>{u.last_login_at ? new Date(u.last_login_at).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' }) : 'Aldrig'}</td>
              <td className="num nowrap">
                <button className="link" onClick={() => { setResetFor(u); setNewPassword(''); }}>Nytt lösenord</button>{' '}
                {u.id !== me.id && (
                  <button className="link" onClick={() => action.run(async () => { await patch(`/api/users/${u.id}`, { active: !u.active }); reload(); })}>
                    {u.active ? 'Stäng av' : 'Aktivera'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {resetFor && (
        <form className="add-line" onSubmit={(e) => { e.preventDefault(); action.run(async () => { await patch(`/api/users/${resetFor.id}`, { password: newPassword }); setResetFor(null); }); }}>
          <span>Nytt lösenord för {resetFor.name}:</span>
          <input className="grow" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Minst 8 tecken" />
          <button type="submit">Spara</button>
          <button type="button" className="ghost" onClick={() => setResetFor(null)}>Avbryt</button>
        </form>
      )}
      <h3>Lägg till användare</h3>
      <form className="form" onSubmit={create}>
        <div className="row">
          <Field label="Namn"><input value={f.name} onChange={set('name')} /></Field>
          <Field label="E-post"><input type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Lösenord (minst 8 tecken)"><input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
          <Field label="Roll">
            <select value={f.role} onChange={set('role')}>
              {Object.entries(ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          {f.role === 'mechanic' && (
            <Field label="Är mekaniker i tidboken">
              <select value={f.mechanic_id} onChange={set('mechanic_id')}>
                <option value="">Ingen koppling</option>
                {mechanics?.items.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
          )}
        </div>
        <ErrorText error={action.error} />
        <div className="actions"><button type="submit" disabled={action.busy || !f.email || !f.name}>Lägg till användare</button></div>
      </form>
    </section>
  );
}

export function MyAccount() {
  const { user } = useAuth();
  const [f, setF] = useState({ current_password: '', new_password: '', repeat: '' });
  const [done, setDone] = useState(false);
  const action = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <header className="page-head"><h1>Mitt konto</h1></header>
      <section className="card">
        <dl className="facts">
          <dt>Namn</dt><dd>{user.name}</dd>
          <dt>E-post</dt><dd>{user.email}</dd>
          <dt>Roll</dt><dd>{ROLE_LABELS[user.role]}</dd>
        </dl>
      </section>
      <section className="card">
        <h2>Byt lösenord</h2>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          setDone(false);
          action.run(async () => {
            if (f.new_password !== f.repeat) throw new Error('Lösenorden är inte lika');
            await post('/api/auth/password', { current_password: f.current_password, new_password: f.new_password });
            setF({ current_password: '', new_password: '', repeat: '' });
            setDone(true);
          });
        }}>
          <div className="row">
            <Field label="Nuvarande lösenord"><input type="password" autoComplete="current-password" value={f.current_password} onChange={set('current_password')} /></Field>
            <Field label="Nytt lösenord"><input type="password" autoComplete="new-password" value={f.new_password} onChange={set('new_password')} /></Field>
            <Field label="Upprepa nytt lösenord"><input type="password" autoComplete="new-password" value={f.repeat} onChange={set('repeat')} /></Field>
          </div>
          <ErrorText error={action.error} />
          {done && <p className="ok">Lösenordet är bytt. Andra enheter har loggats ut.</p>}
          <div className="actions"><button type="submit" disabled={action.busy}>Byt lösenord</button></div>
        </form>
      </section>
    </>
  );
}
