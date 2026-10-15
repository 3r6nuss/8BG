import { useEffect, useState, type FormEvent } from 'react';
import { Check, KeyRound, Plus, ShieldCheck, UsersRound } from 'lucide-react';
import { api, setCsrfToken } from './api';
import { ErrorBox, Modal, Spinner } from './components';
import type { User } from './types';

export function Settings({ user }: { user: User }) {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<User | 'new' | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (user.role !== 'admin') return;
    let current = true;
    api<User[]>('/users').then(result => { if (current) setUsers(result); })
      .catch(error => { if (current) setError(error instanceof Error ? error.message : 'Benutzer konnten nicht geladen werden.'); });
    return () => { current = false; };
  }, [user.role, revision]);
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      if (form.get('password') !== form.get('confirmation')) throw new Error('Die neuen Passwörter stimmen nicht überein.');
      const result = await api<{ csrfToken: string }>('/auth/password', {
        method: 'PUT', body: JSON.stringify({ currentPassword: form.get('currentPassword'), password: form.get('password') }),
      });
      setCsrfToken(result.csrfToken); formElement.reset(); setSuccess('Passwort geändert. Andere Sitzungen wurden abgemeldet.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Passwort konnte nicht geändert werden.'); }
    finally { setBusy(false); }
  }
  return <div className="settings-layout">
    <section className="panel"><div className="panel-heading"><div><span className="eyebrow">DEIN ZUGANG</span><h2><KeyRound size={20} />Sicherheit</h2></div><span className="tag">{user.role === 'admin' ? 'Administrator' : 'Mitarbeiter'}</span></div>
      <form className="settings-form" onSubmit={changePassword}><p className="muted">Angemeldet als <strong>{user.username}</strong>. Verwende ein eigenes, sicheres Passwort.</p>
        <label>Bisheriges Passwort<input name="currentPassword" type="password" required autoComplete="current-password" maxLength={128} /></label>
        <label>Neues Passwort<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" placeholder="Mindestens 12 Zeichen" /></label>
        <label>Neues Passwort wiederholen<input name="confirmation" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
        {error && <ErrorBox message={error} />}{success && <div className="notice success" role="status"><Check size={16} />{success}</div>}
        <button className="button primary" disabled={busy}>{busy ? <Spinner /> : <ShieldCheck size={16} />}Passwort ändern</button>
      </form></section>
    <section className="panel"><div className="panel-heading"><div><span className="eyebrow">ZUSAMMEN ARBEITEN</span><h2><UsersRound size={20} />Team & Zugänge</h2></div>{user.role === 'admin' && <button className="button primary small" onClick={() => setEditor('new')}><Plus size={16} />Neuer Zugang</button>}</div>
      {user.role === 'admin' ? <><div className="team-list">{users.map(member => <div className="team-row" key={member.id}><div><strong>{member.username}{member.id === user.id && <span className="muted"> (du)</span>}</strong><span className="cell-sub">{member.role === 'admin' ? 'Administrator' : 'Mitarbeiter'}</span></div>{member.id !== user.id && <button className="button subtle small" onClick={() => setEditor(member)}><KeyRound size={14} />Passwort setzen</button>}</div>)}</div><p className="panel-footnote">Administratoren verwalten Produkte und Zugänge. Alle Teammitglieder können Personen und Ankäufe erfassen. Ein Passwort-Reset beendet alle Sitzungen des betroffenen Zugangs.</p></> :
        <p className="panel-footnote">Neue Zugänge werden von einem Administrator erstellt. Du kannst Personen und Ankäufe verwalten und Produktpreise einsehen.</p>}
    </section>
    {editor && <UserEditor user={editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setRevision(value => value + 1); }} />}
  </div>;
}

function UserEditor({ user, onClose, onSaved }: { user: User | 'new'; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      await api(user === 'new' ? '/users' : `/users/${user.id}/reset-password`, {
        method: 'POST', body: JSON.stringify(Object.fromEntries(form)),
      });
      onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : 'Zugang konnte nicht gespeichert werden.'); }
    finally { setBusy(false); }
  }
  return <Modal title={user === 'new' ? 'Neuen Zugang erstellen' : `Passwort für ${user.username}`} subtitle="Zugangsdaten nur über einen sicheren Kanal weitergeben." onClose={onClose} busy={busy}>
    <form onSubmit={submit}><div className="modal-body">{user === 'new' && <><label>Benutzername<input name="username" required minLength={3} maxLength={40} pattern="[a-zA-Z0-9_.\-]+" autoComplete="off" /></label><label>Rolle<select name="role"><option value="member">Mitarbeiter</option><option value="admin">Administrator</option></select></label></>}
      <label>{user === 'new' ? 'Passwort' : 'Neues Passwort'}<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
      {error && <ErrorBox message={error} />}</div><div className="modal-footer"><span /><button className="button primary" disabled={busy}>{busy ? <Spinner /> : <Check size={16} />}Speichern</button></div></form>
  </Modal>;
}
