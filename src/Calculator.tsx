import { useRef, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, Info, Package, Plus, RotateCcw, Search, UserRound } from 'lucide-react';
import { api, money } from './api';
import { Empty, ErrorBox, Spinner } from './components';
import type { Direction, Person, Product } from './types';

export function Calculator({ persons, products, onSaved, onNavigate }: {
  persons: Person[]; products: Product[]; onSaved: () => Promise<void>; onNavigate: (page: 'personen' | 'produkte') => void;
}) {
  const [personId, setPersonId] = useState('');
  const [direction, setDirection] = useState<Direction>('buy');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [increments, setIncrements] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const activeProducts = products.filter(product => product.active);
  const activePersons = persons.filter(person => !person.archived);
  const standardPriceFor = (product: Product) => direction === 'buy' ? product.buyPriceCents : product.sellPriceCents;
  const priceInputFor = (product: Product) => prices[product.id] ?? (standardPriceFor(product) / 100).toFixed(2);
  function priceFor(product: Product): number | null {
    const value = priceInputFor(product).replace(',', '.');
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
    const cents = Math.round(Number(value) * 100);
    return Number.isSafeInteger(cents) && cents <= 100_000_000 ? cents : null;
  }
  const selected = activeProducts.filter(product => Number(quantities[product.id] ?? 0) > 0);
  const valid = Object.values(quantities).every(value => value === '' || (/^\d+$/.test(value) && Number(value) <= 1_000_000))
    && selected.every(product => priceFor(product) !== null);
  const total = valid ? selected.reduce((sum, product) => sum + Number(quantities[product.id]) * (priceFor(product) ?? 0), 0) : 0;
  const count = valid ? selected.reduce((sum, product) => sum + Number(quantities[product.id]), 0) : 0;
  function reset() {
    setQuantities({}); setIncrements({}); setPrices({}); setNotes(''); setError('');
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
    if (!personId || !selected.length || !valid) { setError('Bitte eine Person und mindestens ein Produkt mit gültiger Menge und Stückpreis (0 bis 1.000.000 $, maximal zwei Nachkommastellen) auswählen.'); return; }
    setBusy(true);
    try {
      const result = await api<{ id: string; totalCents: number }>('/purchases', {
        method: 'POST',
        body: JSON.stringify({
          direction, personId, requestId: requestId.current, notes,
          items: selected.map(product => ({
            productId: product.id, quantity: Number(quantities[product.id]), unitPriceCents: priceFor(product),
          })),
        }),
      });
      reset(); setSuccess(`${direction === 'buy' ? 'Ankauf' : 'Verkauf'} #${result.id.slice(0, 8)} über ${money(result.totalCents)} wurde gespeichert.`);
      await onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : 'Die Buchung konnte nicht gespeichert werden.'); }
    finally { setBusy(false); }
  }
  if (!activeProducts.length) return <section className="panel"><Empty icon={<Package size={30} />} title="Dein Sortiment wartet"
    text="Lege zuerst Produkte mit getrennten Ankaufs- und Verkaufspreisen an. Danach kannst du hier direkt loslegen."
    action={<button className="button primary" onClick={() => onNavigate('produkte')}><Plus size={16} />Zu den Produkten</button>} /></section>;
  return <form onSubmit={submit}>
    {success && <div className="notice success" role="status"><Check size={18} />{success}</div>}
    {error && <ErrorBox message={error} />}
    <div className="direction-switch" role="group" aria-label="Buchungsrichtung">
      <button type="button" disabled={busy} className={direction === 'buy' ? 'active buy' : ''} aria-pressed={direction === 'buy'}
        onClick={() => { setDirection('buy'); reset(); setSuccess(''); }}>
        <ArrowDownLeft size={17} /><span>Ankauf</span><small>Wir kaufen von der Person</small>
      </button>
      <button type="button" disabled={busy} className={direction === 'sell' ? 'active sell' : ''} aria-pressed={direction === 'sell'}
        onClick={() => { setDirection('sell'); reset(); setSuccess(''); }}>
        <ArrowUpRight size={17} /><span>Verkauf</span><small>Wir verkaufen an die Person</small>
      </button>
    </div>
    <div className="calculator-layout"><section className="panel calculator-products">
      <div className="panel-heading"><div><span className="eyebrow">DEIN SORTIMENT</span><h2>Produkte auswählen <span className="count-badge">{activeProducts.length}</span></h2></div><div className="search compact"><Search size={16} /><input aria-label="Produkte suchen" placeholder="Produkt suchen …" value={search} onChange={event => setSearch(event.target.value)} /></div></div>
      <div className="table-scroll"><table className="purchase-table"><thead><tr><th>Produkt</th><th className="number">{direction === 'buy' ? 'Ankauf / Stück' : 'Verkauf / Stück'}</th><th>Menge + Addieren</th><th className="number">Summe</th></tr></thead>
        <tbody>{activeProducts.filter(product => product.name.toLowerCase().includes(search.toLowerCase())).map(product =>
          <tr key={product.id}><td><div className="product-label"><span className="product-icon"><Package size={18} /></span><strong>{product.name}</strong></div></td><td className="number muted">
            <input className="unit-price-input" type="number" min="0" max="1000000" step="0.01"
              aria-label={`${direction === 'buy' ? 'Ankaufpreis' : 'Verkaufspreis'} ${product.name}`}
              required={Number(quantities[product.id]) > 0} disabled={busy} value={priceInputFor(product)}
              aria-invalid={Number(quantities[product.id]) > 0 && priceFor(product) === null}
              onChange={event => { setSuccess(''); setPrices(values => ({ ...values, [product.id]: event.target.value })); }} />
            <span className="cell-sub">Standard: {money(standardPriceFor(product))}</span>
          </td>
            <td><div className="quantity-controls"><input type="number" min="0" max="1000000" step="1" aria-label={`Menge ${product.name}`} placeholder="0" value={quantities[product.id] ?? ''} disabled={busy} onChange={event => { setSuccess(''); setQuantities(values => ({ ...values, [product.id]: event.target.value })); }} />
              <input type="number" min="1" max="1000000" step="1" aria-label={`Zu ${product.name} addieren`} placeholder="+ Menge" disabled={busy} value={increments[product.id] ?? ''} onChange={event => setIncrements(values => ({ ...values, [product.id]: event.target.value }))} />
              <button className="icon-button add-button" type="button" aria-label={`Menge zu ${product.name} addieren`} disabled={busy} onClick={() => add(product.id)}><Plus size={16} /></button></div></td>
            <td className="number line-total">{valid && Number(quantities[product.id]) > 0 ? money(Number(quantities[product.id]) * (priceFor(product) ?? 0)) : '—'}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={2}>Gesamt</td><td>{count.toLocaleString('de-DE')} <span className="muted">Einheiten</span></td><td className="number">{money(total)}</td></tr></tfoot></table></div>
      <div className="table-note"><Info size={15} />Stückpreise sind vorbelegt und für diese Buchung frei änderbar. Die Produktpreise bleiben unverändert. „Rechner zurücksetzen“ stellt die Standardpreise wieder her.</div>
    </section><aside className="panel checkout">
      <div className="checkout-heading"><span className="checkout-icon">{direction === 'buy' ? <ArrowDownLeft size={22} /> : <ArrowUpRight size={22} />}</span><div><span className="eyebrow">ABSCHLUSS</span><h2>Neuer {direction === 'buy' ? 'Ankauf' : 'Verkauf'}</h2></div></div>
      <label>{direction === 'buy' ? 'Von welcher Person?' : 'An welche Person?'} <span className="required">*</span><div className="select-icon"><UserRound size={16} /><select required disabled={busy} value={personId} onChange={event => setPersonId(event.target.value)}><option value="">Person auswählen</option>{activePersons.map(person => <option key={person.id} value={person.id}>{person.name}{person.phone ? ` · ${person.phone}` : ''}</option>)}</select></div></label>
      {!activePersons.length && <p className="inline-hint">Noch keine aktive Person. <button type="button" className="text-button" onClick={() => onNavigate('personen')}>Person anlegen</button></p>}
      <label>Notiz zum {direction === 'buy' ? 'Ankauf' : 'Verkauf'}<textarea rows={3} maxLength={2000} value={notes} disabled={busy} onChange={event => setNotes(event.target.value)} placeholder={direction === 'buy' ? 'Optional: z. B. Lieferung vom Hof' : 'Optional: z. B. Abholung im Lager'} /></label>
      <div className="checkout-summary"><div><span>Produkte</span><strong>{selected.length}</strong></div><div><span>Gesamtmenge</span><strong>{count.toLocaleString('de-DE')}</strong></div><div className="grand-total"><span>{direction === 'buy' ? 'Auszahlung' : 'Einnahme'}</span><strong>{money(total)}</strong></div></div>
      <button className="button primary full" disabled={busy || !selected.length || !personId || !valid || total > 1_000_000_000_000}>{busy ? <Spinner /> : direction === 'buy' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}{direction === 'buy' ? 'Ankauf speichern' : 'Verkauf speichern'}</button>
      <button className="button subtle full" type="button" disabled={busy} onClick={() => { reset(); setSuccess(''); }}><RotateCcw size={15} />Rechner zurücksetzen</button>
      <p className="checkout-footnote">Wird als {direction === 'buy' ? 'Auszahlung' : 'Einnahme'} mit Person, Preis und deinem Benutzernamen gespeichert.</p>
    </aside></div>
  </form>;
}
