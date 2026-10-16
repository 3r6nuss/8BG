import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, ReceiptText, Search } from 'lucide-react';
import { api, money, timestamp } from './api';
import { Empty, ErrorBox, Modal, Spinner } from './components';
import type { PurchaseDetail, PurchasePage } from './types';

export function History({ revision }: { revision: number }) {
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState<'all' | 'buy' | 'sell'>('all');
  const [data, setData] = useState<PurchasePage | null>(null);
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true; setLoading(true); setError('');
    api<PurchasePage>(`/purchases?page=${page}&direction=${direction}`).then(result => { if (current) setData(result); })
      .catch(error => { if (current) setError(error instanceof Error ? error.message : 'Verlauf konnte nicht geladen werden.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [page, direction, revision, retry]);
  async function showDetail(id: string) {
    try { setDetail(await api<PurchaseDetail>(`/purchases/${id}`)); }
    catch (error) { setError(error instanceof Error ? error.message : 'Details konnten nicht geladen werden.'); }
  }
  const directionLabel = (value: string) => value === 'sell' ? 'Verkauf' : 'Ankauf';
  const amountLabel = direction === 'sell' ? 'Einnahme' : 'Auszahlung';
  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">LÜCKENLOS DOKUMENTIERT</span><h2>Buchungsverlauf <span className="count-badge">{data?.total ?? 0}</span></h2></div><div className="history-controls"><select aria-label="Buchungsart filtern" value={direction} onChange={event => { setPage(1); setDirection(event.target.value as 'all' | 'buy' | 'sell'); }}><option value="all">An- und Verkäufe</option><option value="buy">Nur Ankäufe</option><option value="sell">Nur Verkäufe</option></select><div className="search"><Search size={16} /><input aria-label="Aktuelle Verlaufsseite durchsuchen" placeholder="Diese Seite durchsuchen …" value={search} onChange={event => setSearch(event.target.value)} /></div></div></div>
    {error && <div className="modal-error"><ErrorBox message={error} /><button className="button subtle small" onClick={() => setRetry(value => value + 1)}>Erneut laden</button></div>}
    {loading ? <div className="loading-inline"><Spinner />Verlauf wird geladen …</div> : !data?.items.length ? <Empty icon={<ReceiptText size={30} />} title={direction === 'all' ? 'Noch keine Buchungen' : `Noch keine ${direction === 'buy' ? 'Ankäufe' : 'Verkäufe'}`} text={direction === 'all' ? 'Gespeicherte An- und Verkäufe erscheinen hier.' : `Gespeicherte ${direction === 'buy' ? 'Ankäufe' : 'Verkäufe'} erscheinen hier.`} /> :
      <><div className="table-scroll"><table><thead><tr><th>Art / Datum</th><th>Person</th><th>Erfasst von</th><th className="number">{direction === 'all' ? 'Betrag' : amountLabel}</th><th /></tr></thead><tbody>
        {data.items.filter(item => `${directionLabel(item.direction)} ${item.personName} ${item.createdBy} ${item.id}`.toLowerCase().includes(search.toLowerCase())).map(purchase => <tr key={purchase.id}>
          <td><span className={`tag transaction-tag ${purchase.direction}`}>{directionLabel(purchase.direction)}</span><span className="mono purchase-id">#{purchase.id.slice(0, 8)}</span><span className="cell-sub">{timestamp(purchase.createdAt)}</span></td><td><strong>{purchase.personName}</strong></td>
          <td><span className="user-pill">{purchase.createdBy}</span></td><td className="number amount">{money(purchase.totalCents)}</td><td><button className="icon-button" aria-label={`${directionLabel(purchase.direction)} ${purchase.id.slice(0, 8)} ansehen`} onClick={() => void showDetail(purchase.id)}><Eye size={17} /></button></td>
        </tr>)}</tbody></table></div><div className="pagination"><span>{data.total} {direction === 'all' ? 'Buchungen' : direction === 'buy' ? 'Ankäufe' : 'Verkäufe'} · Seite {page} von {Math.max(1, Math.ceil(data.total / data.pageSize))}</span><div className="button-row"><button className="icon-button" aria-label="Vorherige Seite" disabled={page === 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={18} /></button><button className="icon-button" aria-label="Nächste Seite" disabled={page * data.pageSize >= data.total} onClick={() => setPage(value => value + 1)}><ChevronRight size={18} /></button></div></div></>}
    {detail && <Modal title={`${directionLabel(detail.direction)} #${detail.id.slice(0, 8)}`} subtitle={timestamp(detail.createdAt)} onClose={() => setDetail(null)} wide>
      <div className="modal-body"><div className="receipt-meta"><div><span>Person</span><strong>{detail.personName}</strong></div><div><span>Erfasst von</span><strong>{detail.createdBy}</strong></div></div>
        <div className="table-scroll"><table><thead><tr><th>Produkt</th><th className="number">Einzelpreis</th><th className="number">Menge</th><th className="number">Summe</th></tr></thead><tbody>{detail.items.map(item => <tr key={item.productId}><td>{item.productName}</td><td className="number">{money(item.unitPriceCents)}</td><td className="number">{item.quantity}</td><td className="number">{money(item.totalCents)}</td></tr>)}</tbody><tfoot><tr><td colSpan={3}>{detail.direction === 'buy' ? 'Gesamtauszahlung' : 'Gesamteinnahme'}</td><td className="number">{money(detail.totalCents)}</td></tr></tfoot></table></div>
        {detail.notes && <p className="notes">{detail.notes}</p>}<p className="muted small-text">Namen und Preise entsprechen dem Stand zum Zeitpunkt dieses {directionLabel(detail.direction).toLowerCase()}s.</p></div>
    </Modal>}
  </section>;
}
