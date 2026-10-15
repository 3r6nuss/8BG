import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, Check, ImagePlus, LoaderCircle, ShieldCheck, Trash2, X } from 'lucide-react';
import { api, date, setCsrfToken } from './api';
import type { Person, Product, Scan, Session } from './types';

export function Spinner() { return <LoaderCircle size={18} className="spin" aria-label="Wird geladen" />; }
export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{text}</p>{action}</div>;
}
export function Modal({ title, subtitle, children, onClose, wide = false, busy = false }: {
  title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean; busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className={`modal ${wide ? 'wide' : ''}`} aria-label={title}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      <button type="button" className="icon-button" aria-label="Schließen" disabled={busy} onClick={onClose}><X size={20} /></button>
    </div>{children}
  </dialog>;
}
export function ErrorBox({ message }: { message: string }) {
  return <div className="notice error" role="alert"><AlertCircle size={18} /><span>{message}</span></div>;
}

export function Auth({ needsSetup, onLogin }: { needsSetup: boolean; onLogin: (session: Session) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const session = await api<Session>(needsSetup ? '/auth/setup' : '/auth/login', {
        method: 'POST', body: JSON.stringify(Object.fromEntries(form)),
      });
      setCsrfToken(session.csrfToken); onLogin(session);
    } catch (error) { setError(error instanceof Error ? error.message : 'Anmeldung fehlgeschlagen.'); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><div className="auth-glow" /><div className="auth-card">
    <div className="brand-mark large">8</div><span className="eyebrow">8BG · HANDELSVERWALTUNG</span>
    <h1>{needsSetup ? 'Dein Kontor. Dein Überblick.' : 'Willkommen zurück.'}</h1>
    <p>{needsSetup ? 'Erstelle den ersten Administratorzugang und richte deine Handelsverwaltung ein.' : 'Melde dich an, um Personen und Ankäufe zu verwalten.'}</p>
    <form onSubmit={submit}>
      {needsSetup && <label>Einrichtungsschlüssel<input name="token" autoComplete="off" required placeholder="Aus dem Server-Terminal" /></label>}
      <label>Benutzername<input name="username" autoComplete="username" minLength={3} maxLength={40} pattern="[a-zA-Z0-9_.\-]+" required placeholder="Dein Benutzername" autoFocus /></label>
      <label>Passwort<input type="password" name="password" autoComplete={needsSetup ? 'new-password' : 'current-password'} minLength={12} maxLength={128} required placeholder="Mindestens 12 Zeichen" /></label>
      {error && <ErrorBox message={error} />}
      <button className="button primary full" disabled={busy}>{busy ? <Spinner /> : <ShieldCheck size={18} />}{needsSetup ? 'Administration einrichten' : 'Sicher anmelden'}</button>
    </form><div className="auth-footer"><ShieldCheck size={14} /> Zentrale Speicherung · Lokale Ausweiserkennung</div>
  </div><span className="auth-bottom">PERSONEN. PRODUKTE. ALLES IM BLICK.</span></main>;
}

export function PersonEditor({ person, onClose, onSaved }: {
  person?: Person; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(person?.name ?? '');
  const [birthDate, setBirthDate] = useState(person?.birthDate ?? '');
  const [phone, setPhone] = useState(person?.phone ?? '');
  const [notes, setNotes] = useState(person?.notes ?? '');
  const [archived, setArchived] = useState(Boolean(person?.archived));
  const [scanId, setScanId] = useState<string | null>(person?.scanId ?? null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const pendingScan = useRef<string | null>(null);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (pendingScan.current) { event.preventDefault(); }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  async function discardNewScan() {
    if (pendingScan.current) {
      await api(`/id-scans/${pendingScan.current}`, { method: 'DELETE' });
      pendingScan.current = null;
    }
  }
  async function close() {
    setBusy(true); setError('');
    try { await discardNewScan(); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Das Bild konnte nicht entfernt werden.'); }
    finally { setBusy(false); }
  }
  async function upload(file: File) {
    setBusy(true); setError('');
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error('Das Bild darf maximal 12 MB groß sein.');
      await discardNewScan();
      setScanId(person?.scanId ?? null); setScan(null);
      const body = new FormData(); body.append('image', file);
      const result = await api<Scan>('/id-scans', { method: 'POST', body });
      pendingScan.current = result.scanId;
      setScan(result); setScanId(result.scanId); setReviewed(false);
      if (result.fields.name) setName(result.fields.name);
      if (result.fields.birthDate) setBirthDate(result.fields.birthDate);
    } catch (error) { setError(error instanceof Error ? error.message : 'Upload fehlgeschlagen.'); }
    finally { setBusy(false); if (imageInput.current) imageInput.current.value = ''; }
  }
  async function removeImage() {
    setBusy(true); setError('');
    try { await discardNewScan(); setScanId(null); setScan(null); }
    catch (error) { setError(error instanceof Error ? error.message : 'Bild konnte nicht entfernt werden.'); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api(person ? `/persons/${person.id}` : '/persons', {
        method: person ? 'PUT' : 'POST',
        body: JSON.stringify({ name, birthDate, phone, notes, scanId, archived }),
      });
      pendingScan.current = null;
      setSaved(true);
      await onSaved();
      onClose();
    } catch (error) { setError(error instanceof Error ? error.message : 'Speichern fehlgeschlagen.'); }
    finally { setBusy(false); }
  }
  return <Modal title={saved ? 'Person gespeichert' : person ? 'Personalakte bearbeiten' : 'Neue Personalakte'}
    subtitle="Kontaktdaten und Ausweis an einem Ort." wide busy={busy} onClose={() => void close()}>
    {saved ? <div className="modal-body"><div className="notice"><Check size={18} />Die Person wurde gespeichert.</div>
      {error && <ErrorBox message={error} />}<button className="button primary" onClick={onClose}>Schließen</button></div> :
    <form onSubmit={submit}><div className="person-editor">
      <section className="upload-section"><span className="eyebrow">RP-AUSWEIS</span>
        {scanId ? <div className="id-preview"><img src={`/api/id-scans/${scanId}/image`} alt="Hochgeladener RP-Ausweis" />
          <button type="button" className="button subtle small" disabled={busy} onClick={() => void removeImage()}><Trash2 size={14} />Bild entfernen</button></div>
          : <button type="button" className="upload-area" disabled={busy} onClick={() => imageInput.current?.click()}>
            {busy ? <Spinner /> : <ImagePlus size={32} />}<strong>{busy ? 'Bild wird verarbeitet …' : 'Ausweis hochladen'}</strong><span>JPG, PNG oder WebP · bis 12 MB</span></button>}
        <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" className="visually-hidden"
          disabled={busy} aria-label="Ausweisbild auswählen" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
        {scanId && <button type="button" className="button subtle full" disabled={busy} onClick={() => imageInput.current?.click()}><ImagePlus size={16} />Anderes Bild auswählen</button>}
        <div className="privacy-note"><ShieldCheck size={18} /><p>Automatisch als <strong>WebP</strong> gespeichert. Texterkennung direkt auf deinem Server, ohne externen KI-Dienst.</p></div>
        {scan?.warning && <div className="notice warning">{scan.warning}</div>}
        {scan && <details><summary>Erkannten Text anzeigen</summary><pre className="ocr-text">{scan.text || 'Kein Text erkannt.'}</pre></details>}
      </section>
      <section className="person-fields">
        <label>Vor- und Nachname <span className="required">*</span><input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={100} required placeholder="z. B. Rikkard Bach" /></label>
        <div className="form-grid"><label>Geburtsdatum<input type="date" value={birthDate} max={new Date().toISOString().slice(0, 10)} onChange={event => setBirthDate(event.target.value)} /></label>
          <label>Telefonnummer<input type="tel" value={phone} maxLength={50} onChange={event => setPhone(event.target.value)} placeholder="z. B. 01982" /></label></div>
        <label>Notizen<textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={5000} rows={5} placeholder="Absprachen, Hinweise und weitere Informationen …" /></label>
        {person && <label className="checkbox"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />Person archivieren (kein neuer Ankauf möglich)</label>}
        {scan && <label className="checkbox review"><input type="checkbox" required checked={reviewed} onChange={event => setReviewed(event.target.checked)} />Ich habe die aus dem Ausweis übernommenen Daten geprüft und gegebenenfalls korrigiert.</label>}
      </section>
    </div>{error && <div className="modal-error"><ErrorBox message={error} /></div>}
    <div className="modal-footer"><span className="muted">* Pflichtfeld</span><div className="button-row">
      <button type="button" className="button subtle" disabled={busy} onClick={() => void close()}>Abbrechen</button>
      <button className="button primary" disabled={busy}>{busy ? <Spinner /> : <Check size={17} />}Person speichern</button></div></div></form>}
  </Modal>;
}

export function ProductEditor({ product, onClose, onSaved }: { product?: Product; onClose: () => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const rawPrice = String(form.get('price')).replace(',', '.');
    const priceCents = Math.round(Number(rawPrice) * 100);
    try {
      if (!/^\d+(?:\.\d{1,2})?$/.test(rawPrice) || !Number.isSafeInteger(priceCents)) throw new Error('Bitte einen gültigen Preis mit höchstens zwei Nachkommastellen eingeben.');
      await api(product ? `/products/${product.id}` : '/products', {
        method: product ? 'PUT' : 'POST',
        body: JSON.stringify({ name: form.get('name'), priceCents, active: form.get('active') === 'on' }),
      });
      await onSaved(); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : 'Speichern fehlgeschlagen.'); }
    finally { setBusy(false); }
  }
  return <Modal title={product ? 'Produkt bearbeiten' : 'Neues Produkt'} subtitle="Lege den Ankaufpreis pro Einheit fest." onClose={onClose} busy={busy}>
    <form onSubmit={submit}><div className="modal-body">
      <label>Produktname<input name="name" required maxLength={100} defaultValue={product?.name} placeholder="z. B. Weizen" /></label>
      <label>Ankaufpreis pro Einheit ($)<input name="price" type="number" min="0" max="1000000" step="0.01" required defaultValue={product ? (product.priceCents / 100).toFixed(2) : ''} placeholder="0,00" /></label>
      {product && <label className="checkbox"><input type="checkbox" name="active" defaultChecked={Boolean(product.active)} />Produkt ist für Ankäufe verfügbar</label>}
      <div className="notice">Bereits gespeicherte Ankäufe behalten ihre ursprünglichen Preise.</div>
      {error && <ErrorBox message={error} />}</div>
      <div className="modal-footer"><span /> <div className="button-row"><button type="button" className="button subtle" disabled={busy} onClick={onClose}>Abbrechen</button><button className="button primary" disabled={busy}>{busy ? <Spinner /> : <Check size={16} />}Speichern</button></div></div>
    </form>
  </Modal>;
}

export function PersonDetails({ person, onClose, onEdit }: { person: Person; onClose: () => void; onEdit: () => void }) {
  return <Modal title={person.name} subtitle={person.archived ? 'Archivierte Personalakte' : 'Personalakte'} onClose={onClose}>
    <div className="modal-body">
      {person.scanId && <a href={`/api/id-scans/${person.scanId}/image`} target="_blank" rel="noreferrer"><img className="detail-id" src={`/api/id-scans/${person.scanId}/image`} alt={`RP-Ausweis von ${person.name}`} /></a>}
      <dl className="detail-list"><div><dt>Geburtsdatum</dt><dd>{date(person.birthDate)}</dd></div><div><dt>Telefon</dt><dd>{person.phone || 'Nicht angegeben'}</dd></div><div><dt>Angelegt am</dt><dd>{date(person.createdAt)}</dd></div></dl>
      <label>Notizen</label><p className="notes">{person.notes || 'Noch keine Notizen hinterlegt.'}</p>
    </div><div className="modal-footer"><span className="muted mono">#{person.id.slice(0, 8)}</span><button className="button primary" onClick={onEdit}>Akte bearbeiten</button></div>
  </Modal>;
}

export function Confirm({ title, text, onClose, onConfirm }: { title: string; text: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    setBusy(true);
    try { await onConfirm(); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Aktion fehlgeschlagen.'); }
    finally { setBusy(false); }
  }
  return <Modal title={title} onClose={onClose} busy={busy}><div className="modal-body"><p>{text}</p>{error && <ErrorBox message={error} />}</div>
    <div className="modal-footer"><span /><div className="button-row"><button className="button subtle" disabled={busy} onClick={onClose}>Abbrechen</button><button className="button danger" disabled={busy} onClick={() => void confirm()}>{busy ? <Spinner /> : <Trash2 size={16} />}Löschen</button></div></div>
  </Modal>;
}
