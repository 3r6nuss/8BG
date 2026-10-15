import { useRef, useState, type FormEvent } from 'react';
import { ArrowDownLeft, Check, Info, Package, Plus, RotateCcw, Search, ShoppingBasket, UserRound } from 'lucide-react';
import { api, money } from './api';
import { Empty, ErrorBox, Spinner } from './components';
import type { Person, Product } from './types';

export function Calculator({ persons, products, onSaved, onNavigate }: {
  persons: Person[]; products: Product[]; onSaved: () => Promise<void>; onNavigate: (page: 'personen' | 'produkte') => void;
}) {
  const [personId, setPersonId] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [increments, setIncrements] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const activeProducts = products.filter(product => product.active);
  const activePersons = persons.filter(person => !person.archived);
  const selected = activeProducts.filter(product => Number(quantities[product.id] ?? 0) > 0);
  const valid = Object.values(quantities).every(value => value === '' || (/^\d+$/.test(value) && Number(value) <= 1_000_000));
  const total = valid ? selected.reduce((sum, product) => sum + Number(quantities[product.id]) * product.priceCents, 0) : 0;
  const count = valid ? selected.reduce((sum, product) => sum + Number(quantities[product.id]), 0) : 0;
  function reset() {
    setQuantities({}); setIncrements({}); setNotes(''); setError('');
    requestId.current = crypto.randomUUID();
  }
  function add(productId: string) {
    const raw = increments[productId] || '1';
    const previous = quantities[productId] || '0';
    const next = Number(previous) + Number(raw);
    if (!/^\d+$/.test(raw) || !/^\d+$/.test(previous) || Number(raw) < 1 || next > 1_000_000) {
      setError('Bitte ganze positive Mengen eingeben. Maximal 1.000.000 Einheiten pro Produkt.');
      return;
    }
    setError(''); setQuantities(values => ({ ...values, [productId]: String(next) }));
    setIncrements(values => ({ ...values, [productId]: '' }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setSuccess('');
    if (!personId || !selected.length || !valid) { setError('Bitte eine Person und mindestens ein Produkt mit gültiger Menge auswählen.'); return; }
    setBusy(true);
    try {
      const result = await api<{ id: string; totalCents: number }>('/purchases', {
        method: 'POST',
        body: JSON.stringify({
          personId, requestId: requestId.current, notes,
          items: selected.map(product => ({
            productId: product.id, quantity: Number(quantities[product.id]), unitPriceCents: product.priceCents,
          })),
        }),
      });
      reset(); setSuccess(`Ankauf #${result.id.slice(0, 8)} über ${money(result.totalCents)} wurde gespeichert.`);
      await onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : 'Der Ankauf konnte nicht gespeichert werden.'); }
    finally { setBusy(false); }
  }
  if (!activeProducts.length) return <section className="panel"><Empty icon={<Package size={30} />} title="Dein Sortiment wartet"
    text="Lege zuerst Produkte mit ihren Ankaufpreisen an. Danach kannst du hier direkt loslegen."
    action={<button className="button primary" onClick={() => onNavigate('produkte')}><Plus size={16} />Zu den Produkten</button>} /></section>;
  return <form onSubmit={submit}>
    {success && <div className="notice success" role="status"><Check size={18} />{success}</div>}
    {error && <ErrorBox message={error} />}
    <div className="calculator-layout"><section className="panel calculator-products">
      <div className="panel-heading"><div><span className="eyebrow">DEIN SORTIMENT</span><h2>Produkte auswählen <span className="count-badge">{activeProducts.length}</span></h2></div><div className="search compact"><Search size={16} /><input aria-label="Produkte suchen" placeholder="Produkt suchen …" value={search} onChange={event => setSearch(event.target.value)} /></div></div>
      <div className="table-scroll"><table className="purchase-table"><thead><tr><th>Produkt</th><th className="number">Ankauf / Stück</th><th>Menge + Addieren</th><th className="number">Summe</th></tr></thead>
        <tbody>{activeProducts.filter(product => product.name.toLowerCase().includes(search.toLowerCase())).map(product =>
          <tr key={product.id}><td><div className="product-label"><span className="product-icon"><Package size={18} /></span><strong>{product.name}</strong></div></td><td className="number muted">{money(product.priceCents)}</td>
            <td><div className="quantity-controls"><input type="number" min="0" max="1000000" step="1" aria-label={`Menge ${product.name}`} placeholder="0" value={quantities[product.id] ?? ''} disabled={busy} onChange={event => { setSuccess(''); setQuantities(values => ({ ...values, [product.id]: event.target.value })); }} />
              <input type="number" min="1" max="1000000" step="1" aria-label={`Zu ${product.name} addieren`} placeholder="+ Menge" disabled={busy} value={increments[product.id] ?? ''} onChange={event => setIncrements(values => ({ ...values, [product.id]: event.target.value }))} />
              <button className="icon-button add-button" type="button" aria-label={`Menge zu ${product.name} addieren`} disabled={busy} onClick={() => add(product.id)}><Plus size={16} /></button></div></td>
            <td className="number line-total">{valid && Number(quantities[product.id]) > 0 ? money(Number(quantities[product.id]) * product.priceCents) : '—'}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={2}>Gesamt</td><td>{count.toLocaleString('de-DE')} <span className="muted">Einheiten</span></td><td className="number">{money(total)}</td></tr></tfoot></table></div>
      <div className="table-note"><Info size={15} />Mengen direkt eintragen oder mit dem Plus-Button schrittweise addieren.</div>
    </section><aside className="panel checkout">
      <div className="checkout-heading"><span className="checkout-icon"><ShoppingBasket size={22} /></span><div><span className="eyebrow">ABSCHLUSS</span><h2>Neuer Ankauf</h2></div></div>
      <label>Von welcher Person? <span className="required">*</span><div className="select-icon"><UserRound size={16} /><select required disabled={busy} value={personId} onChange={event => setPersonId(event.target.value)}><option value="">Person auswählen</option>{activePersons.map(person => <option key={person.id} value={person.id}>{person.name}{person.phone ? ` · ${person.phone}` : ''}</option>)}</select></div></label>
      {!activePersons.length && <p className="inline-hint">Noch keine aktive Person. <button type="button" className="text-button" onClick={() => onNavigate('personen')}>Person anlegen</button></p>}
      <label>Notiz zum Ankauf<textarea rows={3} maxLength={2000} value={notes} disabled={busy} onChange={event => setNotes(event.target.value)} placeholder="Optional: z. B. Lieferung vom Hof" /></label>
      <div className="checkout-summary"><div><span>Produkte</span><strong>{selected.length}</strong></div><div><span>Gesamtmenge</span><strong>{count.toLocaleString('de-DE')}</strong></div><div className="grand-total"><span>Auszahlung</span><strong>{money(total)}</strong></div></div>
      <button className="button primary full" disabled={busy || !selected.length || !personId || !valid || total > 1_000_000_000_000}>{busy ? <Spinner /> : <ArrowDownLeft size={18} />}Ankauf speichern</button>
      <button className="button subtle full" type="button" disabled={busy} onClick={() => { reset(); setSuccess(''); }}><RotateCcw size={15} />Rechner zurücksetzen</button>
      <p className="checkout-footnote">Wird mit Person, Einzelpreisen und deinem Benutzernamen im Verlauf gespeichert.</p>
    </aside></div>
  </form>;
}
