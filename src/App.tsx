import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Archive, ArrowDownLeft, ArrowUpRight, CalendarDays, ChevronRight, CircleHelp, Eye, LayoutGrid, LogOut, Menu, Package, Pencil, Phone, Plus, ReceiptText, RefreshCw, Search, Settings2, ShieldCheck, ShoppingBasket, Trash2, UsersRound, X } from 'lucide-react';
import { api, ApiError, date, initials, money, setCsrfToken } from './api';
import { Auth, Confirm, Empty, ErrorBox, PersonDetails, PersonEditor, ProductEditor, Spinner } from './components';
import { Calculator } from './Calculator';
import { History } from './History';
import { Settings } from './Settings';
import type { Person, Product, Session, Stats } from './types';

type Page = 'personen' | 'ankauf' | 'produkte' | 'verlauf' | 'einstellungen';
const pages: { id: Page; title: string; label: string; description: string; icon: ReactNode }[] = [
  { id: 'personen', title: 'Personalakten', label: 'Personen', description: 'Die richtigen Kontakte. Alle Informationen an einem Ort.', icon: <UsersRound size={19} /> },
  { id: 'ankauf', title: 'An- & Verkauf', label: 'Handel', description: 'Richtung auswählen, Produkte addieren und die Buchung zuordnen.', icon: <ShoppingBasket size={19} /> },
  { id: 'produkte', title: 'Produktverwaltung', label: 'Produkte', description: 'Dein Sortiment mit getrennten Ankaufs- und Verkaufspreisen.', icon: <Package size={19} /> },
  { id: 'verlauf', title: 'Buchungsverlauf', label: 'Verlauf', description: 'Alle An- und Verkäufe, sauber nach Richtung getrennt.', icon: <ReceiptText size={19} /> },
  { id: 'einstellungen', title: 'Einstellungen', label: 'Einstellungen', description: 'Dein Konto und die Zugänge für dein Team.', icon: <Settings2 size={19} /> },
];
function currentPage(): Page { return pages.find(page => page.id === window.location.hash.slice(1))?.id ?? 'personen'; }

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setBooting(true); setBootError('');
    async function load() {
      const status = await api<{ needsSetup: boolean }>('/auth/status');
      if (!current) return;
      setNeedsSetup(status.needsSetup);
      if (!status.needsSetup) {
        try {
          const result = await api<Session>('/auth/me');
          if (current) { setCsrfToken(result.csrfToken); setSession(result); }
        } catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error; }
      }
    }
    load().catch(error => { if (current) setBootError(error instanceof Error ? error.message : 'Die Anwendung konnte nicht geladen werden.'); })
      .finally(() => { if (current) setBooting(false); });
    return () => { current = false; };
  }, [retry]);
  useEffect(() => {
    function expired() { setSession(null); setCsrfToken(''); }
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);
  if (booting) return <div className="boot-screen"><div className="brand-mark">8</div><Spinner /><span>Dein Kontor wird vorbereitet …</span></div>;
  if (bootError) return <div className="boot-screen"><ErrorBox message={bootError} /><button className="button primary" onClick={() => setRetry(value => value + 1)}><RefreshCw size={16} />Erneut versuchen</button></div>;
  if (!session) return <Auth needsSetup={needsSetup} onLogin={result => { setSession(result); setNeedsSetup(false); }} />;
  return <Workspace session={session} onLogout={() => { setSession(null); setCsrfToken(''); }} />;
}

function Workspace({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [page, setPage] = useState<Page>(currentPage);
  const [menuOpen, setMenuOpen] = useState(false);
  const [persons, setPersons] = useState<Person[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stats, setStats] = useState<Stats>({
    persons: 0, products: 0, purchases: 0, totalCents: 0,
    purchaseCount: 0, saleCount: 0, purchaseTotalCents: 0, saleTotalCents: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [personEditor, setPersonEditor] = useState<Person | 'new' | null>(null);
  const [details, setDetails] = useState<Person | null>(null);
  const [productEditor, setProductEditor] = useState<Product | 'new' | null>(null);
  const [deletePerson, setDeletePerson] = useState<Person | null>(null);
  const admin = session.user.role === 'admin';
  const activePage = pages.find(item => item.id === page)!;
  const reload = useCallback(async () => {
    const [newPersons, newProducts, newStats] = await Promise.all([
      api<Person[]>('/persons'), api<Product[]>('/products'), api<Stats>('/stats'),
    ]);
    setPersons(newPersons); setProducts(newProducts); setStats(newStats); setError('');
    setRevision(value => value + 1);
  }, []);
  useEffect(() => {
    reload().catch(error => setError(error instanceof Error ? error.message : 'Daten konnten nicht geladen werden.'))
      .finally(() => setLoading(false));
  }, [reload]);
  useEffect(() => {
    const navigate = () => { setPage(currentPage()); setSearch(''); setMenuOpen(false); };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  function navigate(nextPage: Page) { window.location.hash = nextPage; setMenuOpen(false); }
  async function refreshAfterSave() {
    try { await reload(); }
    catch (error) {
      setError(`Die Änderung wurde gespeichert, aber die Ansicht konnte nicht aktualisiert werden: ${error instanceof Error ? error.message : 'Unbekannter Fehler.'} Bitte erneut laden.`);
    }
  }
  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }); onLogout(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Abmelden fehlgeschlagen.'); }
  }
  const filteredPersons = persons.filter(person => Boolean(person.archived) === showArchived
    && `${person.name} ${person.phone} ${person.notes}`.toLocaleLowerCase('de').includes(search.toLocaleLowerCase('de')));
  const filteredProducts = products.filter(product => product.name.toLowerCase().includes(search.toLowerCase()));
  return <div className="app-shell">
    {menuOpen && <button className="sidebar-backdrop" aria-label="Menü schließen" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <a className="brand" href="#personen"><div className="brand-mark">8</div><div><strong>8BG<span className="brand-dot">.</span></strong><span>HANDELSVERWALTUNG</span></div></a>
      <div className="sidebar-section-label">WORKSPACE</div>
      <nav aria-label="Hauptnavigation">{pages.map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)} aria-current={page === item.id ? 'page' : undefined}>
        {item.icon}<span>{item.label}</span>{item.id === 'personen' && <span className="nav-count">{stats.persons}</span>}{item.id === 'ankauf' && <span className="nav-new">AN / VERKAUF</span>}
      </button>)}</nav>
      <div className="sidebar-tip"><span className="tip-icon"><ShieldCheck size={20} /></span><strong>Deine Daten bleiben bei dir.</strong><p>Ausweise werden lokal erkannt und sicher als WebP abgelegt.</p><span>Kein externer KI-Dienst <ArrowUpRight size={13} /></span></div>
      <div className="sidebar-bottom"><div className="user-avatar">{initials(session.user.username)}</div><div className="user-info"><strong>{session.user.username}</strong><span>{admin ? 'Administrator' : 'Mitarbeiter'}</span></div><button className="icon-button" aria-label="Abmelden" title="Abmelden" onClick={() => void logout()}><LogOut size={17} /></button></div>
    </aside>
    <div className="workspace"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Menü öffnen" onClick={() => setMenuOpen(true)}><Menu size={21} /></button><LayoutGrid size={16} /><span>Workspace</span><ChevronRight size={14} /><strong>{activePage.label}</strong></div><div className="topbar-right"><span className="system-status"><i />System bereit</span><span className="topbar-divider" /><span className="today">{new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}</span><div className="mini-avatar">{initials(session.user.username)}</div></div></header>
      <main className="main-content"><div className="page-heading"><div><span className="eyebrow">DEIN 8BG WORKSPACE</span><h1>{activePage.title}<span className="title-dot">.</span></h1><p>{activePage.description}</p></div>
        {page === 'personen' && <button className="button primary" onClick={() => setPersonEditor('new')}><Plus size={18} />Neue Person anlegen</button>}
        {page === 'produkte' && admin && <button className="button primary" onClick={() => setProductEditor('new')}><Plus size={18} />Produkt hinzufügen</button>}
      </div>
      {error && <div className="load-error"><ErrorBox message={error} /><button className="button subtle small" onClick={() => { setLoading(true); reload().catch(error => setError(error instanceof Error ? error.message : 'Laden fehlgeschlagen.')).finally(() => setLoading(false)); }}><RefreshCw size={15} />Erneut laden</button></div>}
      {page !== 'einstellungen' && <div className="stats-grid">
        <Stat label="Aktive Personen" value={stats.persons.toLocaleString('de-DE')} detail="In deiner Kartei" icon={<UsersRound size={21} />} />
        <Stat label="Produkte" value={stats.products.toLocaleString('de-DE')} detail="Im aktiven Sortiment" icon={<Package size={21} />} />
        <Stat label="Ankäufe · Auszahlungen" value={stats.purchaseCount.toLocaleString('de-DE')} detail={`Ausgezahlt: ${money(stats.purchaseTotalCents)}`} icon={<ArrowDownLeft size={21} />} />
        <Stat label="Verkäufe · Einnahmen" value={stats.saleCount.toLocaleString('de-DE')} detail={`Eingenommen: ${money(stats.saleTotalCents)}`} icon={<ArrowUpRight size={21} />} accent />
      </div>}
      {loading ? <div className="loading-inline"><Spinner />Daten werden geladen …</div> : <>
        {page === 'personen' && <><div className="section-toolbar"><div className="search"><Search size={17} /><input aria-label="Personen suchen" placeholder="Nach Name, Telefon oder Notiz suchen …" value={search} onChange={event => setSearch(event.target.value)} />{search && <button className="text-button" aria-label="Suche zurücksetzen" onClick={() => setSearch('')}><X size={15} /></button>}</div><div className="toolbar-right"><span className="results-count">{filteredPersons.length} Personen</span><select aria-label="Personenstatus" value={showArchived ? 'archived' : 'active'} onChange={event => setShowArchived(event.target.value === 'archived')}><option value="active">Aktive Personen</option><option value="archived">Archivierte Personen</option></select></div></div>
          {filteredPersons.length ? <div className="person-grid">{filteredPersons.map(person => <article className="person-card" key={person.id}>
            <div className="person-card-top"><div className="person-avatar">{initials(person.name)}</div><div className="person-card-title"><h3>{person.name}</h3><span className={`tag ${person.archived ? 'neutral' : ''}`}>{person.archived ? <Archive size={11} /> : <i />}{person.archived ? 'Archiviert' : 'Aktive Person'}</span></div><span className="person-number mono">#{person.id.slice(0, 4)}</span></div>
            <div className="person-contact"><div><Phone size={15} /><span>{person.phone || 'Keine Telefonnummer'}</span></div><div><CalendarDays size={15} /><span>{person.birthDate ? date(person.birthDate) : 'Kein Geburtsdatum'}</span></div></div>
            <div className="person-note">{person.notes || 'Noch keine Notizen hinterlegt.'}</div>
            <div className="person-card-footer"><button className="button subtle details-button" onClick={() => setDetails(person)}><Eye size={15} />Details ansehen</button><button className="icon-button" title="Person bearbeiten" aria-label={`${person.name} bearbeiten`} onClick={() => setPersonEditor(person)}><Pencil size={15} /></button>{admin && <button className="icon-button delete" title="Person löschen" aria-label={`${person.name} löschen`} onClick={() => setDeletePerson(person)}><Trash2 size={15} /></button>}</div>
          </article>)}</div> : <section className="panel"><Empty icon={<UsersRound size={32} />} title={search ? 'Keine passenden Personen' : showArchived ? 'Dein Archiv ist leer' : 'Hier beginnt deine Kartei'} text={search ? 'Versuche einen anderen Suchbegriff.' : showArchived ? 'Archivierte Personen erscheinen hier und bleiben im Ankaufverlauf erhalten.' : 'Lege deine erste Person an oder lade einen RP-Ausweis hoch. Die Daten werden automatisch zur Prüfung übernommen.'} action={!search && !showArchived ? <button className="button primary" onClick={() => setPersonEditor('new')}><Plus size={17} />Erste Person anlegen</button> : undefined} /></section>}
          <div className="section-bottom"><ShieldCheck size={14} />Personen und Ausweisbilder sind nur für angemeldete Teammitglieder sichtbar.</div>
        </>}
        {page === 'ankauf' && <Calculator persons={persons} products={products} onSaved={refreshAfterSave} onNavigate={navigate} />}
        {page === 'produkte' && <><div className="section-toolbar"><div className="search"><Search size={17} /><input aria-label="Produkte suchen" placeholder="Produkte durchsuchen …" value={search} onChange={event => setSearch(event.target.value)} /></div><span className="results-count">{products.length} Produkte insgesamt</span></div>
          <section className="panel">{filteredProducts.length ? <div className="table-scroll"><table><thead><tr><th>Produkt</th><th>Status</th><th className="number">Ankauf / Stück</th><th className="number">Verkauf / Stück</th>{admin && <th className="number">Aktion</th>}</tr></thead><tbody>{filteredProducts.map(product => <tr key={product.id}><td><div className="product-label"><span className="product-icon"><Package size={19} /></span><strong>{product.name}</strong></div></td><td><span className={`tag ${product.active ? '' : 'neutral'}`}>{product.active ? 'Aktiv' : 'Inaktiv'}</span></td><td className="number amount">{money(product.buyPriceCents)}</td><td className="number amount">{money(product.sellPriceCents)}</td>{admin && <td className="number"><button className="button subtle small" onClick={() => setProductEditor(product)}><Pencil size={14} />Bearbeiten</button></td>}</tr>)}</tbody></table></div> : <Empty icon={<Package size={30} />} title={search ? 'Keine passenden Produkte' : 'Platz für dein Sortiment'} text={search ? 'Versuche einen anderen Suchbegriff.' : admin ? 'Lege Produktnamen sowie getrennte Ankaufs- und Verkaufspreise an. Sie erscheinen anschließend direkt im Rechner.' : 'Ein Administrator kann hier neue Produkte und Preise hinterlegen.'} action={admin && !search ? <button className="button primary" onClick={() => setProductEditor('new')}><Plus size={17} />Erstes Produkt anlegen</button> : undefined} />}</section>
          <div className="section-bottom"><CircleHelp size={14} />Preisänderungen gelten nur für neue Buchungen. Inaktive Produkte bleiben im Verlauf erhalten.</div>
        </>}
        {page === 'verlauf' && <History revision={revision} />}
        {page === 'einstellungen' && <Settings user={session.user} />}
      </>}
      <footer className="workspace-footer"><span>8BG<span className="brand-dot">.</span> <span>Dein Handel. Organisiert.</span></span><span>Mit Überblick handeln.</span></footer>
      </main>
    </div>
    {personEditor && <PersonEditor person={personEditor === 'new' ? undefined : personEditor} onClose={() => setPersonEditor(null)} onSaved={refreshAfterSave} />}
    {details && <PersonDetails person={details} onClose={() => setDetails(null)} onEdit={() => { setPersonEditor(details); setDetails(null); }} />}
    {productEditor && <ProductEditor product={productEditor === 'new' ? undefined : productEditor} onClose={() => setProductEditor(null)} onSaved={refreshAfterSave} />}
    {deletePerson && <Confirm title="Person dauerhaft löschen?" text={`Die Akte von ${deletePerson.name} und ihr nicht anderweitig verwendetes Ausweisbild werden gelöscht. Bei vorhandenen Ankäufen ist nur eine Archivierung möglich.`} onClose={() => setDeletePerson(null)} onConfirm={async () => { await api(`/persons/${deletePerson.id}`, { method: 'DELETE' }); await refreshAfterSave(); }} />}
  </div>;
}

function Stat({ label, value, detail, icon, accent = false }: { label: string; value: string; detail: string; icon: ReactNode; accent?: boolean }) {
  return <div className={`stat-card ${accent ? 'accent' : ''}`}><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong className="stat-value">{value}</strong><div className="stat-detail">{accent && <span className="tiny-dot" />}{detail}</div></div>;
}
