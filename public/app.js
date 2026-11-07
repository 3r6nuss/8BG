'use strict';

const sections = {
  members: { label: 'Member', icon: 'M', fields: [['name', 'Name', true], ['member_number', 'Mitgliedsnummer'], ['status', 'Status', true], ['joined', 'Beitrittsdatum'], ['notes', 'Notizen']] },
  dues: { label: 'Abgaben', icon: '€', fields: [['member', 'Member', true], ['amount', 'Betrag', true], ['due_date', 'Fällig am'], ['status', 'Status', true], ['paid_date', 'Bezahlt am'], ['notes', 'Notizen']] },
  warehouse: { label: 'Lager', icon: 'L', fields: [['item', 'Artikel', true], ['category', 'Kategorie'], ['quantity', 'Menge', true], ['unit', 'Einheit', true], ['location', 'Lagerort'], ['notes', 'Notizen']] },
  safe: { label: 'Tresor', icon: 'T', fields: [['movement', 'Bewegung', true], ['amount', 'Betrag', true], ['date', 'Datum', true], ['reference', 'Referenz'], ['notes', 'Notizen']] },
  staff: { label: 'Zivis', icon: 'Z', fields: [['name', 'Name', true], ['assignment', 'Aufgabe'], ['status', 'Status', true], ['phone', 'Kontakt'], ['notes', 'Notizen']] },
  products: { label: 'Produkt-Preisliste', icon: 'P', fields: [['name', 'Produktname', true], ['category', 'Kategorie'], ['price', 'Preis'], ['unit', 'Einheit', true], ['stock', 'Eigener Bestand'], ['notes', 'Notizen']] },
  fams: { label: 'Kontakte: Fams', icon: 'F', fields: [['contact_name', 'Ansprechpartner', true], ['fam_name', 'Fam / Gruppe', true], ['role', 'Funktion'], ['discord', 'Discord / Kontakt'], ['phone', 'Telefon'], ['notes', 'Notizen']] },
  civilians: { label: 'Kontakte: Zivilisten', icon: 'K', fields: [['name', 'Name', true], ['role', 'Funktion'], ['phone', 'Telefon'], ['email', 'E-Mail'], ['notes', 'Notizen']] }
};

const app = document.querySelector('#app');
const state = { user: null, csrfToken: '', active: 'dashboard', rows: [], query: '' };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const roleNames = { owner: 'Inhaber', admin: 'Administrator', manager: 'Verwalter', staff: 'Mitarbeiter', reader: 'Leser' };

async function request(url, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (options.method && options.method !== 'GET' && state.csrfToken) headers['X-CSRF-Token'] = state.csrfToken;
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `Anfrage fehlgeschlagen (${response.status}).`);
  return payload;
}

function showMessage(message, type = 'error') {
  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  node.textContent = message;
  document.body.append(node);
  window.setTimeout(() => node.remove(), 4200);
}

function showAuth({ setup = false, setupUnavailable = false } = {}) {
  state.user = null;
  state.csrfToken = '';
  app.className = 'auth-shell';
  const formMarkup = setupUnavailable ? '' : `
    <form id="auth-form" class="form-stack">
      ${setup ? '<label>Einrichtungsschlüssel<input name="setupKey" type="password" autocomplete="off" required></label>' : ''}
      <label>Benutzername<input name="username" minlength="3" maxlength="32" autocomplete="username" required></label>
      <label>Passwort<input name="password" type="password" minlength="${setup ? '12' : '1'}" autocomplete="${setup ? 'new-password' : 'current-password'}" required></label>
      ${setup ? '' : '<label class="remember-option"><input name="rememberMe" type="checkbox"><span>14 Tage angemeldet bleiben</span></label>'}
      <button class="button button-primary button-wide" type="submit">${setup ? 'Inhaber-Zugang erstellen' : 'Anmelden'}<span aria-hidden="true">→</span></button>
    </form>
    <p class="auth-foot">${setup ? 'Das Passwort muss mindestens 12 Zeichen lang sein.' : 'Zugriff nur für berechtigte Mitglieder.'}</p>`;
  app.innerHTML = `
    <section class="auth-card">
      <div class="brand-lockup"><span class="brand-mark">8</span><div><strong>8 BLOCK GRIMZ</strong><small>VERWALTUNGSPORTAL</small></div></div>
      <div class="auth-intro">
        <span class="eyebrow">${setup ? 'ERSTEINRICHTUNG' : 'INTERNER BEREICH'}</span>
        <h1>${setup ? 'Portal einrichten.' : 'Schön, dass du da bist.'}</h1>
        <p>${setup ? 'Lege den Inhaber-Zugang an, um das Portal zu starten.' : 'Melde dich mit deinem Zugang an.'}</p>
      </div>
      ${setupUnavailable ? '<div class="notice notice-error">Die Einrichtung ist noch offen, aber auf dem Server fehlt der SETUP_KEY. Bitte konfiguriere ihn und starte den Server neu.</div>' : ''}
      ${formMarkup}
    </section>
    <div class="auth-aside"><div class="orb orb-one"></div><div class="orb orb-two"></div><div class="aside-content"><span class="eyebrow">8BG · ORGANISIERT</span><h2>Alles im Blick.<br><em>Ein Team.</em></h2><p>Mitglieder, Lager und Abgaben zentral verwalten.</p></div><div class="aside-bottom">PRIVATES VERWALTUNGSPORTAL <span>•</span> 8 BLOCK GRIMZ</div></div>`;

  const authForm = document.querySelector('#auth-form');
  authForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      if (setup) {
        await request('/api/setup', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
        showMessage('Inhaber-Zugang erstellt. Du kannst dich jetzt anmelden.', 'success');
        showAuth();
      } else {
        const credentials = Object.fromEntries(form);
        credentials.rememberMe = form.get('rememberMe') === 'on';
        await request('/api/login', { method: 'POST', body: JSON.stringify(credentials) });
        await loadUser();
        await showDashboard();
      }
    } catch (error) {
      showMessage(error.message);
      button.disabled = false;
    }
  });
}

async function loadUser() {
  const result = await request('/api/me');
  state.user = result.user;
  state.csrfToken = result.csrfToken;
}

function canAccess(section) {
  return state.user?.role === 'owner' || state.user?.permissions.includes(section);
}

function canWrite(section) {
  return state.user?.role !== 'reader' && canAccess(section);
}

function shell() {
  app.className = 'app-shell';
  const navItems = [
    ['dashboard', 'Übersicht', '⌂'],
    ...Object.entries(sections).filter(([key]) => canAccess(key)).map(([key, value]) => [key, value.label, value.icon])
  ];
  if (['owner', 'admin'].includes(state.user.role)) navItems.push(['users', 'Benutzer', 'U'], ['audit', 'Änderungsprotokoll', '≡']);
  app.innerHTML = `
    <aside class="sidebar">
      <a class="brand-lockup sidebar-brand" href="#" data-page="dashboard"><span class="brand-mark">8</span><div><strong>8 BLOCK GRIMZ</strong><small>VERWALTUNG</small></div></a>
      <div class="nav-caption">MENÜ</div>
      <nav class="side-nav">${navItems.map(([key, label, icon]) => `<button class="nav-link ${state.active === key ? 'active' : ''}" data-page="${key}"><span class="nav-icon">${escapeHtml(icon)}</span><span>${escapeHtml(label)}</span>${state.active === key ? '<i></i>' : ''}</button>`).join('')}</nav>
      <div class="sidebar-footer"><div class="status-dot"></div><span>Portal aktiv</span><span class="version-tag">v1.0</span></div>
    </aside>
    <div class="workspace">
      <header class="topbar"><div class="breadcrumb"><span>8BG</span><b>/</b><strong>${escapeHtml(pageLabel(state.active))}</strong></div><div class="top-user"><div class="avatar">${escapeHtml(state.user.username.slice(0, 1).toUpperCase())}</div><div class="user-meta"><strong>${escapeHtml(state.user.username)}</strong><small>${escapeHtml(state.user.roleLabel || roleNames[state.user.role])}</small></div><button class="icon-button logout-button" title="Abmelden" aria-label="Abmelden" data-action="logout">↗</button></div></header>
      <main id="page-content" class="page-content"></main>
    </div>
    <div id="modal-root"></div>`;
  app.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', event => {
    event.preventDefault();
    state.active = button.dataset.page;
    state.query = '';
    shell();
    renderPage().catch(error => showMessage(error.message));
  }));
  app.querySelector('[data-action="logout"]').addEventListener('click', logout);
}

function pageLabel(key) {
  return key === 'dashboard' ? 'Übersicht' : key === 'users' ? 'Benutzer' : key === 'audit' ? 'Änderungsprotokoll' : sections[key]?.label || 'Portal';
}

async function showDashboard() {
  state.active = 'dashboard';
  shell();
  await renderPage();
}

async function renderPage() {
  if (state.active === 'dashboard') return renderDashboard();
  if (sections[state.active]) return renderSection(state.active);
  if (state.active === 'users') return renderUsers();
  if (state.active === 'audit') return renderAudit();
}

async function renderDashboard() {
  const { counts } = await request('/api/dashboard');
  const cards = Object.entries(sections).filter(([key]) => counts[key] !== undefined).map(([key, section]) => `
    <button class="stat-card" data-go="${key}">
      <span class="stat-icon">${escapeHtml(section.icon)}</span><span class="stat-label">${escapeHtml(section.label)}</span>
      <strong>${Number(counts[key]) || 0}</strong><span class="stat-foot">Einträge <span>→</span></span>
    </button>`).join('');
  document.querySelector('#page-content').innerHTML = `
    <div class="page-heading"><div><span class="eyebrow">DEIN ÜBERBLICK</span><h1>Willkommen zurück, ${escapeHtml(state.user.username)}.</h1><p>Hier ist der aktuelle Stand eurer Bereiche.</p></div><span class="date-pill">${new Intl.DateTimeFormat('de-DE', { dateStyle: 'long' }).format(new Date())}</span></div>
    ${counts.openDues !== undefined ? `<div class="highlight-card"><div class="highlight-icon">€</div><div><span>Offene Abgaben</span><strong>${Number(counts.openDues) || 0}</strong></div><button data-go="dues">Abgaben öffnen <span>→</span></button></div>` : ''}
    <div class="section-heading"><div><h2>Deine Bereiche</h2><p>Wähle einen Bereich, um die Einträge zu verwalten.</p></div></div>
    <div class="stats-grid">${cards || '<div class="empty-state">Dir wurden noch keine Bereiche zugewiesen.</div>'}</div>
    <div class="dashboard-note"><span class="note-mark">i</span><span>Deine Zugriffsrechte werden zentral verwaltet. Bei Fragen wende dich an einen Administrator.</span></div>`;
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => {
    state.active = button.dataset.go;
    shell();
    renderPage().catch(error => showMessage(error.message));
  }));
}

function prettyField(key, value) {
  if (value === '' || value === null || value === undefined) return '—';
  if (key === 'amount' || key === 'price') return `${escapeHtml(value)} €`;
  return escapeHtml(value);
}

async function renderSection(key) {
  const section = sections[key];
  state.rows = await request(`/api/data/${key}`);
  const query = state.query.trim().toLocaleLowerCase('de');
  const rows = state.rows.filter(row => !query || Object.values(row).some(value => String(value ?? '').toLocaleLowerCase('de').includes(query)));
  const write = canWrite(key);
  const tableHead = section.fields.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('');
  const tableRows = rows.map(row => `<tr>${section.fields.map(([field]) => `<td>${prettyField(field, row[field])}</td>`).join('')}
    <td class="row-actions">${write ? `<button class="text-button" data-edit="${row.id}">Bearbeiten</button><button class="text-button danger-text" data-delete="${row.id}">Löschen</button>` : '<span class="muted">Nur lesen</span>'}</td></tr>`).join('');
  document.querySelector('#page-content').innerHTML = `
    <div class="page-heading"><div><span class="eyebrow">VERWALTUNG</span><h1>${escapeHtml(section.label)}</h1><p>${state.rows.length} ${state.rows.length === 1 ? 'Eintrag' : 'Einträge'} in diesem Bereich</p></div>${write ? '<button class="button button-primary" data-action="add"><span>＋</span> Eintrag hinzufügen</button>' : ''}</div>
    <section class="data-panel"><div class="table-toolbar"><div><h2>Alle Einträge</h2><span class="muted">Zuletzt aktualisierte Einträge zuerst</span></div><label class="search-box"><span>⌕</span><input id="search" type="search" placeholder="Suchen …" value="${escapeHtml(state.query)}" aria-label="Einträge durchsuchen"></label></div>
    <div class="table-scroll">${rows.length ? `<table><thead><tr>${tableHead}<th class="actions-heading">Aktionen</th></tr></thead><tbody>${tableRows}</tbody></table>` : `<div class="empty-state"><span class="empty-icon">${escapeHtml(section.icon)}</span><strong>${query ? 'Keine passenden Einträge' : 'Noch keine Einträge'}</strong><p>${query ? 'Passe deinen Suchbegriff an.' : write ? 'Füge den ersten Eintrag für diesen Bereich hinzu.' : 'Hier wurden noch keine Einträge angelegt.'}</p>${write && !query ? '<button class="button button-secondary" data-action="add">Eintrag hinzufügen</button>' : ''}</div>`}</div></section>`;
  document.querySelector('#search').addEventListener('input', event => {
    state.query = event.target.value;
    renderSection(key).catch(error => showMessage(error.message));
    const input = document.querySelector('#search');
    input?.focus();
    input?.setSelectionRange(state.query.length, state.query.length);
  });
  document.querySelector('[data-action="add"]')?.addEventListener('click', () => openRecordModal(key));
  document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => {
    const row = state.rows.find(item => item.id === Number(button.dataset.edit));
    if (row) openRecordModal(key, row);
  }));
  document.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => deleteRecord(key, Number(button.dataset.delete))));
}

function openModal(title, content, onSubmit) {
  const root = document.querySelector('#modal-root');
  root.innerHTML = `<div class="modal-backdrop" data-dismiss><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><div><span class="eyebrow">8 BLOCK GRIMZ</span><h2 id="modal-title">${escapeHtml(title)}</h2></div><button class="icon-button" data-dismiss aria-label="Schließen">×</button></header>${content}</section></div>`;
  const roleSelect = root.querySelector('select[name="role"]');
  if (roleSelect) {
    let previousPermissions = null;
    const permissionInputs = [...root.querySelectorAll('input[name="permissions"]')];
    const updatePermissions = () => {
      if (roleSelect.value === 'admin') {
        if (previousPermissions === null) previousPermissions = permissionInputs.filter(input => input.checked).map(input => input.value);
        permissionInputs.forEach(input => { input.checked = true; input.disabled = true; });
      } else {
        if (previousPermissions !== null) {
          permissionInputs.forEach(input => { input.checked = previousPermissions.includes(input.value); });
          previousPermissions = null;
        }
        permissionInputs.forEach(input => { input.disabled = false; });
      }
    };
    roleSelect.addEventListener('change', updatePermissions);
    updatePermissions();
  }
  root.querySelectorAll('[data-dismiss]').forEach(node => node.addEventListener('click', event => {
    if (event.target === node || node.matches('button')) root.innerHTML = '';
  }));
  root.querySelector('form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await onSubmit(new FormData(event.currentTarget));
      root.innerHTML = '';
    } catch (error) {
      showMessage(error.message);
      button.disabled = false;
    }
  });
}

function openRecordModal(key, row = null) {
  const section = sections[key];
  const fields = section.fields.map(([name, label, required]) => {
    const value = row?.[name] ?? '';
    const numeric = ['amount', 'price', 'quantity', 'stock'].includes(name);
    const multiline = name === 'notes';
    const input = multiline
      ? `<textarea name="${name}" rows="3" maxlength="2000">${escapeHtml(value)}</textarea>`
      : `<input name="${name}" ${numeric ? 'inputmode="decimal"' : ''} value="${escapeHtml(value)}" maxlength="2000" ${required ? 'required' : ''}>`;
    return `<label>${escapeHtml(label)}${required ? '<span class="required-mark"> *</span>' : ''}${input}</label>`;
  }).join('');
  openModal(row ? 'Eintrag bearbeiten' : 'Neuer Eintrag', `<form class="form-stack modal-form"><div class="form-grid">${fields}</div><footer class="modal-actions"><button type="button" class="button button-quiet" data-dismiss>Abbrechen</button><button class="button button-primary" type="submit">${row ? 'Änderungen speichern' : 'Eintrag erstellen'}</button></footer></form>`, async form => {
    const method = row ? 'PUT' : 'POST';
    await request(`/api/data/${key}${row ? `/${row.id}` : ''}`, { method, body: JSON.stringify(Object.fromEntries(form)) });
    showMessage(row ? 'Eintrag aktualisiert.' : 'Eintrag hinzugefügt.', 'success');
    await renderSection(key);
  });
}

async function deleteRecord(key, id) {
  if (!window.confirm('Diesen Eintrag endgültig löschen?')) return;
  try {
    await request(`/api/data/${key}/${id}`, { method: 'DELETE' });
    showMessage('Eintrag gelöscht.', 'success');
    await renderSection(key);
  } catch (error) { showMessage(error.message); }
}

async function renderUsers() {
  const users = await request('/api/users');
  const permissionOptions = Object.entries(sections).map(([key, section]) => `<label class="check-option"><input type="checkbox" name="permissions" value="${key}"><span>${escapeHtml(section.label)}</span></label>`).join('');
  const rows = users.map(user => `<tr><td><div class="table-user"><span class="avatar avatar-small">${escapeHtml(user.username.slice(0, 1).toUpperCase())}</span><strong>${escapeHtml(user.username)}</strong></div></td><td><span class="role-pill role-${escapeHtml(user.role)}">${escapeHtml(user.roleLabel)}</span></td><td>${['owner', 'admin'].includes(user.role) ? '<span class="muted">Alle Bereiche</span>' : user.permissions.map(permission => escapeHtml(sections[permission]?.label || permission)).join(', ') || '<span class="muted">Keine</span>'}</td><td><span class="state-pill ${user.active ? 'state-active' : 'state-inactive'}">${user.active ? 'Aktiv' : 'Deaktiviert'}</span></td><td class="row-actions">${user.role !== 'owner' ? `<button class="text-button" data-user-edit="${user.id}">Verwalten</button><button class="text-button" data-user-password="${user.id}">Passwort</button>` : '<span class="muted">Kontoinhaber</span>'}</td></tr>`).join('');
  document.querySelector('#page-content').innerHTML = `
    <div class="page-heading"><div><span class="eyebrow">ZUGRIFF & ROLLEN</span><h1>Benutzer</h1><p>Verwalte Zugänge und lege fest, wer welche Bereiche sehen und bearbeiten darf.</p></div><button class="button button-primary" data-action="create-user"><span>＋</span> Benutzer anlegen</button></div>
    <section class="data-panel"><div class="table-toolbar"><div><h2>Alle Zugänge</h2><span class="muted">${users.length} Benutzer</span></div></div><div class="table-scroll"><table><thead><tr><th>Benutzer</th><th>Rolle</th><th>Bereichsrechte</th><th>Status</th><th class="actions-heading">Aktionen</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;

  document.querySelector('[data-action="create-user"]').addEventListener('click', () => openModal('Benutzer anlegen', `<form class="form-stack modal-form"><label>Benutzername<input name="username" minlength="3" maxlength="32" autocomplete="off" required></label><label>Startpasswort<input name="password" type="password" minlength="12" autocomplete="new-password" required><small>Mindestens 12 Zeichen.</small></label><label>Rolle<select name="role"><option value="staff">Mitarbeiter</option><option value="manager">Verwalter</option><option value="reader">Leser</option><option value="admin">Administrator – alle Rechte</option></select></label><fieldset class="permissions-field"><legend>Zugriff auf Bereiche</legend><div class="permission-grid">${permissionOptions}</div><small>Administratoren erhalten automatisch Zugriff auf alle Bereiche und die Benutzerverwaltung.</small></fieldset><footer class="modal-actions"><button type="button" class="button button-quiet" data-dismiss>Abbrechen</button><button class="button button-primary" type="submit">Zugang erstellen</button></footer></form>`, async form => {
    const data = Object.fromEntries(form);
    data.permissions = form.getAll('permissions');
    await request('/api/users', { method: 'POST', body: JSON.stringify(data) });
    showMessage('Benutzer angelegt.', 'success');
    await renderUsers();
  }));

  document.querySelectorAll('[data-user-edit]').forEach(button => button.addEventListener('click', () => {
    const user = users.find(item => item.id === Number(button.dataset.userEdit));
    openModal(`Zugang: ${user.username}`, `<form class="form-stack modal-form"><label>Rolle<select name="role"><option value="staff" ${user.role === 'staff' ? 'selected' : ''}>Mitarbeiter</option><option value="manager" ${user.role === 'manager' ? 'selected' : ''}>Verwalter</option><option value="reader" ${user.role === 'reader' ? 'selected' : ''}>Leser</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrator – alle Rechte</option></select></label><fieldset class="permissions-field"><legend>Zugriff auf Bereiche</legend><div class="permission-grid">${Object.entries(sections).map(([key, section]) => `<label class="check-option"><input type="checkbox" name="permissions" value="${key}" ${user.permissions.includes(key) ? 'checked' : ''}><span>${escapeHtml(section.label)}</span></label>`).join('')}</div><small>Administratoren erhalten automatisch Zugriff auf alle Bereiche und die Benutzerverwaltung.</small></fieldset><label class="check-option status-option"><input name="active" type="checkbox" ${user.active ? 'checked' : ''}><span>Zugang aktiv</span></label><footer class="modal-actions"><button type="button" class="button button-quiet" data-dismiss>Abbrechen</button><button class="button button-primary" type="submit">Änderungen speichern</button></footer></form>`, async form => {
      await request(`/api/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ role: form.get('role'), permissions: form.getAll('permissions'), active: form.has('active') }) });
      showMessage('Benutzer aktualisiert.', 'success');
      await renderUsers();
    });
  }));

  document.querySelectorAll('[data-user-password]').forEach(button => button.addEventListener('click', () => {
    const user = users.find(item => item.id === Number(button.dataset.userPassword));
    openModal(`Passwort zurücksetzen`, `<form class="form-stack modal-form"><p class="muted">Neues Passwort für <strong>${escapeHtml(user.username)}</strong></p><label>Neues Passwort<input name="password" type="password" minlength="12" autocomplete="new-password" required></label><footer class="modal-actions"><button type="button" class="button button-quiet" data-dismiss>Abbrechen</button><button class="button button-primary" type="submit">Passwort speichern</button></footer></form>`, async form => {
      await request(`/api/users/${user.id}/password`, { method: 'PUT', body: JSON.stringify({ password: form.get('password') }) });
      showMessage('Passwort zurückgesetzt.', 'success');
    });
  }));
}

async function renderAudit() {
  const entries = await request('/api/audit');
  document.querySelector('#page-content').innerHTML = `
    <div class="page-heading"><div><span class="eyebrow">NACHVOLLZIEHBARKEIT</span><h1>Änderungsprotokoll</h1><p>Die letzten Aktivitäten im Portal.</p></div></div>
    <section class="data-panel"><div class="table-toolbar"><div><h2>Letzte Aktivitäten</h2><span class="muted">Maximal 300 Einträge</span></div></div><div class="table-scroll">${entries.length ? `<table><thead><tr><th>Zeitpunkt</th><th>Benutzer</th><th>Aktion</th><th>Bereich</th><th>Details</th></tr></thead><tbody>${entries.map(entry => `<tr><td>${escapeHtml(new Date(`${entry.created_at.replace(' ', 'T')}Z`).toLocaleString('de-DE'))}</td><td>${escapeHtml(entry.username)}</td><td>${escapeHtml(entry.action)}</td><td>${escapeHtml(sections[entry.section]?.label || entry.section)}</td><td>${escapeHtml(entry.details || '—')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state"><strong>Noch keine Aktivitäten</strong><p>Änderungen werden hier protokolliert.</p></div>'}</div></section>`;
}

async function logout() {
  try { await request('/api/logout', { method: 'POST' }); }
  catch (error) { showMessage(error.message); }
  showAuth();
}

async function start() {
  try {
    const status = await request('/api/setup/status');
    if (status.setupRequired) return showAuth({ setup: true, setupUnavailable: !status.setupAvailable });
    showAuth();
  } catch (error) {
    app.className = 'auth-shell';
    app.innerHTML = `<section class="auth-card"><div class="brand-lockup"><span class="brand-mark">8</span><div><strong>8 BLOCK GRIMZ</strong><small>VERWALTUNGSPORTAL</small></div></div><div class="auth-intro"><span class="eyebrow">VERBINDUNG</span><h1>Portal nicht erreichbar.</h1><p>${escapeHtml(error.message)} Bitte prüfe, ob der Server läuft.</p></div><button class="button button-primary button-wide" data-retry>Erneut versuchen <span>↻</span></button></section>`;
    app.querySelector('[data-retry]').addEventListener('click', start);
  }
}

start();
