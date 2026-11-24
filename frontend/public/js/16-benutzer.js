// ── BENUTZER ──────────────────────────────────────────────────
// „Wer ist dran?" — für die Nachvollziehbarkeit, nicht als Schutz
// (KONZEPT-BENUTZERVERWALTUNG.md). Allein (0–1 Personen) gibt es keine
// Auswahl. Ab zwei Personen fragt PLM beim Öffnen und, nach einer Pause, bei
// der nächsten Änderung: api() bekommt dann 401 bzw. 428 und fragt hier nach.

const ROLE_LABEL = { user: 'User', superuser: 'Superuser', admin: 'Admin' };
const ROLE_HINT = {
  user: _t('ändert, gibt nicht frei'),
  superuser: _t('ändert und gibt frei'),
  admin: _t('darf alles: Einstellungen, Personen, Stammdaten löschen, Sicherungen zurückspielen'),
};

// Funktion der Person: Freitext, die Liste schlägt nur vor. Dazu die schon vergebenen.
const JOB_TITLES = [_t('Entwicklungsingenieur'), _t('Konstrukteur'), _t('Technischer Zeichner'), _t('Projektleiter'),
  _t('Produktmanager'), _t('Fertigung'), _t('Qualitätssicherung'), _t('Einkauf'), _t('Geschäftsführung')];
function _jobTitleList(users) {
  const all = [...new Set([...JOB_TITLES, ...(users || []).map(u => u.job_title).filter(Boolean)])];
  return `<datalist id="job-titles">${all.map(t => `<option value="${esc(t)}">`).join('')}</datalist>`;
}
// Funktion klein unter dem Namen
const _jobLine = u => u?.job_title ? `<span class="user-job">${esc(u.job_title)}</span>` : '';

async function loadSession() {
  try { state.session = await api('/api/session'); } catch { state.session = null; }
  _renderUserChip();
  return state.session;
}

// Allein oder ohne Personen darf man alles — wie vor der Benutzerverwaltung
function currentRole() {
  const s = state.session;
  return !s || s.mode !== 'team' ? 'admin' : (s.user?.role || null);
}
function canRelease() { return ['superuser', 'admin'].includes(currentRole()); }
function isAdmin() { return currentRole() === 'admin'; }

function _renderUserChip() {
  _renderFeedbackButton();
  const el = document.getElementById('tb-user');
  if (!el) return;
  const s = state.session;
  if (!s || s.mode === 'none') { el.style.display = 'none'; return; }
  const u = s.user;
  el.style.display = '';
  el.style.borderColor = u?.color || '';
  el.innerHTML = u
    ? `${_avatar(u.name, 22, u.color)}<span class="tb-user-name">${esc(u.name)}</span>`
      + (s.mode === 'team' ? `<span class="tb-user-role">${esc(ROLE_LABEL[u.role] || u.role)}</span>` : '')
    : '<span class="tb-user-name">' + _t('Wer ist dran?') + '</span>';
  el.title = (u?.job_title ? u.job_title + ' — ' : '') + (s.mode === 'team' ? _t('Person wechseln') : _t('Personen verwalten'));
}

async function onUserChip() {
  if (state.session?.mode === 'team') return askWhoIsThere('switch');
  await gotoView('settings');
  _stTab('benutzer');
}

// Nach einem Wechsel ändern sich die Rechte — was davon abhängt, neu zeichnen
function _afterUserChange() {
  // Kein Admin mehr: ERP-Tab der Historie schliessen (Ansicht und Tab im Detail)
  if (!isAdmin() && state.view === 'erplog') return gotoView('changelog');
  if (!isAdmin() && document.querySelector('#od-log, #dd-log, #cd-log, #sd-log, #po-log')) closeDetail();
  if (state.view === 'erplog') renderChangelog('erp');
  else if (state.view === 'changelog') renderChangelog('plm');   // ERP-Tab ein- oder ausblenden
  else if (state.view === 'settings') renderSettings();
  else if (state.view === 'dashboard') renderDashboard();   // Rückmeldungen nur für Admins
  else if (state.item && document.getElementById('it-sheet')) renderItemDetail(state.item, state.activeRevId);
}

// Kacheln in der Reihenfolge vom Server (zuletzt aktiv zuerst); beim
// Nachfragen steht die bisherige Person ganz vorne
function _whoTiles(users, currentId) {
  const list = currentId
    ? [...users.filter(u => u.id === currentId), ...users.filter(u => u.id !== currentId)]
    : users;
  return list.map(u => `<button type="button" class="who-tile${u.id === currentId ? ' current' : ''}" data-id="${u.id}"${
      /^#[0-9a-f]{6}$/i.test(u.color || '') ? ` style="--uc:${u.color}"` : ''}>
      ${_avatar(u.name, 44, u.color)}
      <span class="who-name">${esc(u.name)}</span>
      ${u.job_title ? `<span class="who-job">${esc(u.job_title)}</span>` : ''}
      <span class="who-role">${esc(ROLE_LABEL[u.role] || u.role)}${u.has_pin ? ' · PIN' : ''}</span>
    </button>`).join('');
}

// kind: 'select' beim Öffnen (ohne Abbrechen), 'confirm' nach einer Pause,
// 'switch' über den Namen oben. Liefert true, sobald jemand gewählt ist.
// Mehrere Anfragen, die gleichzeitig nachfragen, teilen sich ein Fenster.
let _whoPromise = null;
function askWhoIsThere(kind = 'select') {
  if (_whoPromise) return _whoPromise;
  _whoPromise = (async () => {
    const s = await loadSession();
    if (!s || s.mode !== 'team') return true;   // allein: nichts zu wählen
    return new Promise(resolve => _showWhoOverlay(kind, s, resolve));
  })().finally(() => { _whoPromise = null; });
  return _whoPromise;
}

function _showWhoOverlay(kind, s, done) {
  const cur = kind === 'select' ? null : (s.user?.id || null);
  const cancellable = kind !== 'select';
  const title = kind === 'confirm' && s.user ? _t('Weiter als {name}?', { name: esc(s.user.name) }) : _t('Wer ist dran?');
  const sub = kind === 'confirm'
    ? _t('Nach einer Pause kurz nachgefragt, damit die Änderung unter dem richtigen Namen steht.')
    : _t('Änderungen erscheinen in der Historie unter diesem Namen.');
  const ov = document.createElement('div');
  ov.className = 'who-overlay';
  ov.innerHTML = `<div class="who-card" role="dialog" aria-modal="true" aria-labelledby="who-title">
      <div class="who-title" id="who-title">${title}</div>
      <div class="who-sub">${sub}</div>
      <div class="who-grid">${_whoTiles(s.users, cur)}</div>
      <form class="who-pin" hidden>
        <label class="fl" for="who-pin-input"></label>
        <div style="display:flex;gap:8px">
          <input class="fi" id="who-pin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="12">
          <button class="btn btn-primary btn-sm" type="submit">OK</button>
        </div>
        <div class="who-err"></div>
      </form>
      ${cancellable ? '<div class="who-foot"><button type="button" class="btn btn-ghost btn-sm" data-cancel>' + _t('Abbrechen') + '</button></div>' : ''}
    </div>`;
  document.body.appendChild(ov);

  const onKey = e => { if (e.key === 'Escape' && cancellable) { e.preventDefault(); finish(false); } };
  const finish = ok => { ov.remove(); document.removeEventListener('keydown', onKey, true); done(ok); };
  document.addEventListener('keydown', onKey, true);
  ov.querySelector('[data-cancel]')?.addEventListener('click', () => finish(false));

  const pinForm = ov.querySelector('.who-pin');
  let picked = null;
  const showPin = (user, err) => {
    picked = user;
    pinForm.hidden = false;
    pinForm.querySelector('label').textContent = _t('PIN für {name}', { name: user.name });
    pinForm.querySelector('.who-err').textContent = err || '';
    const inp = pinForm.querySelector('input');
    inp.value = '';
    inp.focus();
  };
  // Direkt mit fetch: Ein falscher PIN soll hier stehen, nicht als Meldung unten
  const choose = async (user, pin) => {
    const r = await fetch(API + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PLM-Lang': LANG },
      body: JSON.stringify({ user_id: user.id, pin }) });
    const body = await r.json().catch(() => ({}));
    if (r.ok) { state.session = body; _renderUserChip(); finish(true); _afterUserChange(); return; }
    if (body.pin_required) return showPin(user, pin ? body.error : '');
    toast(body.error || _t('Auswahl fehlgeschlagen'), 'err');
  };
  ov.querySelectorAll('.who-tile').forEach(t => t.addEventListener('click', () => {
    const u = s.users.find(x => x.id === Number(t.dataset.id));
    ov.querySelectorAll('.who-tile').forEach(x => x.classList.toggle('picked', x === t));
    // Wer nach einer Pause nur weitermacht, braucht keine PIN — der Server entscheidet
    if (u.has_pin && u.id !== cur) showPin(u);
    else { pinForm.hidden = true; choose(u); }
  }));
  pinForm.addEventListener('submit', e => { e.preventDefault(); if (picked) choose(picked, pinForm.querySelector('input').value); });
  (ov.querySelector('.who-tile.current') || ov.querySelector('.who-tile'))?.focus();
}

// ── EINSTELLUNGEN → BENUTZER ──────────────────────────────────
let _usersCache = [];
async function _renderUsersSettings() {
  const box = document.getElementById('st-users-box');
  if (!box) return;
  const [users, s] = await Promise.all([api('/api/users').catch(() => []), loadSession()]);
  _usersCache = users;
  box.innerHTML = _usersPanel(users, s, isAdmin());
}

// Nur Admins verwalten Personen; alle anderen sehen die Liste ohne Knöpfe.
// Der letzte aktive Admin lässt sich weder deaktivieren noch herabstufen.
function _usersPanel(users, s, admin) {
  const mode = s?.mode || 'none';
  const active = users.filter(u => u.active);
  const inactive = users.filter(u => !u.active);
  const lastAdmin = u => u.role === 'admin' && active.filter(x => x.role === 'admin').length <= 1;
  const ONLY_ADMIN = _t('Es braucht immer mindestens einen aktiven Admin');
  const roleChip = u => `<span class="chip">${esc(ROLE_LABEL[u.role] || u.role)}</span>`;
  const roleSelect = u => lastAdmin(u)
    ? `<span title="${ONLY_ADMIN}" style="display:inline-flex"><select class="fs" style="width:auto" disabled><option>Admin</option></select></span>`
    : `<select class="fs" style="width:auto" onchange="_saveUser(${u.id}, { role: this.value })">
        ${['user', 'superuser', 'admin'].map(r => `<option value="${r}"${u.role === r ? ' selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}
      </select>`;
  const intro = {
    none: _t('Noch keine Personen. Trägst du deinen Namen ein, steht er in der Historie und bei Freigaben — sonst ändert sich nichts.'),
    single: _t('Allein: PLM fragt nicht, wer dran ist, alles läuft unter diesem Namen. Ab der zweiten Person fragt PLM beim Öffnen „Wer ist dran?“.'),
    team: _t('Team: PLM fragt beim Öffnen „Wer ist dran?“ und nach einer Pause bei der nächsten Änderung noch einmal kurz nach. Ein Klick auf den Namen oben wechselt die Person.'),
  }[mode];

  // Klick auf den Avatar wählt die Farbe — sie erscheint auf der Kachel bei „Wer ist dran?"
  const editRow = u => `<div class="user-row">
      <label class="user-color" title="${_t('Farbe ändern — erscheint auf der Kachel bei „Wer ist dran?“')}">${_avatar(u.name, 30, u.color)}
        <input type="color" value="${esc(u.color || '#9db4ff')}" onchange="_saveUser(${u.id}, { color: this.value })"></label>
      <input class="fi" style="flex:1;min-width:120px" value="${esc(u.name)}" onchange="_saveUser(${u.id}, { name: this.value })" aria-label="${_t('Name')}">
      <input class="fi" style="flex:1;min-width:140px;max-width:220px" list="job-titles" maxlength="60" value="${esc(u.job_title || '')}"
        placeholder="${_t('Funktion')}" onchange="_saveUser(${u.id}, { job_title: this.value })" aria-label="${_t('Funktion')}"
        title="${_t('Funktion der Person, z.B. Konstrukteur — aus der Liste oder frei')}">
      <span style="display:inline-flex;align-items:center;gap:4px;flex-shrink:0" title="${_t('Stundensatz dieser Person — leer: es gilt der Standard-Stundensatz')}">
        <input class="fi" type="number" min="0" step="1" style="width:90px" value="${u.hourly_rate ?? ''}"
          placeholder="${stdRate > 0 ? stdRate : _t('Satz')}" onchange="_saveUser(${u.id}, { hourly_rate: this.value })" aria-label="${_t('Stundensatz (CHF/h)')}">
        <span style="font-size:12px;color:var(--t3)">CHF/h</span></span>
      ${mode === 'team' ? roleSelect(u) : roleChip(u)}
      <button class="btn btn-ghost btn-sm" onclick="openUserTimeReport(${u.id})" title="${_t('Für welche Projekte und Aufträge diese Person wie viel gearbeitet hat')}">${_t('⏱ Zeiten')}</button>
      ${mode === 'team' ? (u.has_pin
        ? `<button class="btn btn-ghost btn-sm" onclick="_setUserPin(${u.id})">${_t('PIN ändern')}</button>
           <button class="btn btn-ghost btn-sm" onclick="_saveUser(${u.id}, { pin: null })">${_t('PIN entfernen')}</button>`
        : `<button class="btn btn-ghost btn-sm" onclick="_setUserPin(${u.id})">${_t('PIN setzen')}</button>`) : ''}
      ${mode !== 'team' ? '' : lastAdmin(u)
        ? `<span class="chip" title="${ONLY_ADMIN}">${_t('einziger Admin')}</span>`
        : `<button class="btn btn-ghost btn-sm" onclick="_saveUser(${u.id}, { active: false })" title="${_t('Bleibt in der Historie, steht aber nicht mehr zur Auswahl')}">${_t('Deaktivieren')}</button>`}
    </div>`;
  const stdRate = parseFloat(state.settings?.hourly_rate) || 0;
  const readRow = u => `<div class="user-row">${_avatar(u.name, 30, u.color)}<span style="flex:1;display:flex;flex-direction:column">${esc(u.name)}${_jobLine(u)}</span>${roleChip(u)}</div>`;
  const rows = active.map(admin ? editRow : readRow).join('');
  const noPin = mode === 'team' && admin && active.some(u => u.role === 'admin' && !u.has_pin);

  return `
    <div style="font-size:13px;color:var(--t3);margin-bottom:12px;line-height:1.55">${intro}</div>
    ${!admin ? '<div class="st-notice">' + _t('Personen verwalten dürfen nur Admins.') + '</div>' : ''}
    ${noPin ? `<div class="st-notice">${_t('Ohne PIN kann jede Person die Admin-Kachel wählen — und damit auch Personen verwalten. Wer das verhindern will, setzt beim Admin eine PIN.')}</div>` : ''}
    ${admin ? _jobTitleList(users) : ''}
    ${rows ? `<div style="display:flex;flex-direction:column;gap:6px">${rows}</div>` : ''}
    ${rows && admin ? '<div style="font-size:12px;color:var(--t4);margin-top:6px">' + _t('Klick auf den farbigen Kreis ändert die Farbe der Person.') + ' '
      + _t('Der Stundensatz gilt für die Zeiten der Person und ergibt die Entwicklungskosten im Datenblatt; leer = Standard-Stundensatz ({rate}).',
        { rate: stdRate > 0 ? fmtCHF(stdRate) + '/h' : _t('nicht gesetzt') }) + '</div>' : ''}
    ${admin && rows ? `<div style="font-size:12px;margin-top:4px"><a href="#" onclick="event.preventDefault();openUserTimeReport('none')" style="color:var(--t3)">${_t('Zeiten ohne Person anzeigen')}</a></div>` : ''}
    ${admin ? `<div class="user-row" style="margin-top:${rows ? '12px' : '0'}">
      <input class="fi" id="st-user-new" style="flex:1;min-width:120px" placeholder="${mode === 'none' ? _t('Dein Name') : _t('Name der neuen Person')}"
        onkeydown="if(event.key==='Enter')_addUser()">
      <input class="fi" id="st-user-new-job" style="flex:1;min-width:140px;max-width:220px" list="job-titles" maxlength="60"
        placeholder="${_t('Funktion (optional)')}" onkeydown="if(event.key==='Enter')_addUser()">
      ${mode !== 'none' ? `<select class="fs" id="st-user-new-role" style="width:auto">
        ${['user', 'superuser', 'admin'].map(r => `<option value="${r}">${ROLE_LABEL[r]}</option>`).join('')}</select>` : ''}
      <button class="btn btn-primary btn-sm" onclick="_addUser()">${mode === 'none' ? _t('Speichern') : _t('+ Person')}</button>
    </div>` : ''}
    ${inactive.length ? `<div class="sep-label" style="margin-top:20px">${_t('Deaktiviert')}</div>
      <div style="display:flex;flex-direction:column;gap:6px">${inactive.map(u => `<div class="user-row" style="opacity:.7">
        ${_avatar(u.name, 30, u.color)}<span style="flex:1">${esc(u.name)}</span>
        ${admin ? `<button class="btn btn-ghost btn-sm" onclick="_saveUser(${u.id}, { active: true })">${_t('Aktivieren')}</button>` : ''}</div>`).join('')}</div>` : ''}
    ${mode === 'team' ? `<div class="sep-label" style="margin-top:20px">${_t('Nachfragen nach einer Pause')}</div>
      <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2)">
        ${admin ? _t('Nach {input} Minuten ohne Aktivität bei der nächsten Änderung nachfragen (0 = nie)', { input: `<input class="fi" type="number" min="0" step="5" style="width:80px" value="${s.idle_minutes || 0}"
          onchange="_saveIdleMinutes(this.value)">` })
          : (s.idle_minutes ? _t('Nach {n} Minuten ohne Aktivität fragt PLM bei der nächsten Änderung nach.', { n: s.idle_minutes }) : _t('PLM fragt nach einer Pause nicht nach.'))}
      </div>` : ''}
    <div class="sep-label" style="margin-top:20px">${_t('Rollen')}</div>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:13px">
      ${['user', 'superuser', 'admin'].map(r => `<b style="color:var(--t1)">${ROLE_LABEL[r]}</b><span style="color:var(--t3)">${ROLE_HINT[r]}</span>`).join('')}
    </div>`;
}

async function _saveUser(id, patch) {
  try { await api(`/api/users/${id}`, 'PUT', patch); toast(_t('Gespeichert'), 'ok'); } catch {}
  await _renderUsersSettings();
}
async function _setUserPin(id) {
  const name = _usersCache.find(u => u.id === id)?.name || '';
  const pin = prompt(_t('PIN für {name} (4 bis 12 Zeichen):', { name }));
  if (pin === null) return;
  await _saveUser(id, { pin });
}
// Eigene PIN: neue zweimal eintippen, die bisherige zur Bestätigung
function openOwnPinModal(remove = false) {
  const has = !!state.session?.user?.has_pin;
  const pw = (id, label) => `<div class="fg"><label class="fl" for="${id}">${label}</label>
    <input class="fi" id="${id}" type="password" inputmode="numeric" autocomplete="off" maxlength="12"></div>`;
  _showDynModal(`<div class="modal" style="max-width:380px;width:95vw">
    <div class="modal-head"><div class="modal-title">${remove ? _t('PIN entfernen') : has ? _t('PIN ändern') : _t('PIN setzen')}</div></div>
    <form class="modal-body" id="own-pin-form" style="display:flex;flex-direction:column;gap:4px">
      <div style="font-size:13px;color:var(--t3);margin-bottom:8px;line-height:1.55">${remove
        ? _t('Ohne PIN kann jede Person an diesem Gerät deine Kachel wählen.')
        : _t('Die PIN wird abgefragt, wenn jemand zu dir wechselt — nicht, wenn du nach einer Pause weitermachst. 4 bis 12 Zeichen.')}</div>
      ${has ? pw('own-pin-cur', _t('Bisherige PIN')) : ''}
      ${remove ? '' : pw('own-pin-new', _t('Neue PIN')) + pw('own-pin-rep', _t('Neue PIN wiederholen'))}
      <div id="own-pin-err" style="font-size:13px;color:var(--red);min-height:18px"></div>
      <button type="submit" hidden></button>
    </form>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="_hideDynModal()">${_t('Abbrechen')}</button>
      <button class="btn ${remove ? 'btn-red' : 'btn-primary'}" onclick="_saveOwnPin(${remove})">${remove ? _t('Entfernen') : _t('Speichern')}</button>
    </div>
  </div>`);
  document.getElementById('own-pin-form').addEventListener('submit', e => { e.preventDefault(); _saveOwnPin(remove); });
  document.querySelector('#own-pin-form input')?.focus();
}
async function _saveOwnPin(remove) {
  const err = document.getElementById('own-pin-err');
  const pin = remove ? null : V('own-pin-new');
  if (!remove && pin !== V('own-pin-rep')) { err.textContent = _t('Die beiden PINs stimmen nicht überein'); return; }
  // Direkt mit fetch: Fehler gehören in den Dialog, nicht als Meldung unten
  const r = await fetch(API + '/api/session/pin', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-PLM-Lang': LANG },
    body: JSON.stringify({ pin, current_pin: document.getElementById('own-pin-cur')?.value }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { err.textContent = body.error || _t('Speichern fehlgeschlagen'); return; }
  _hideDynModal();
  toast(remove ? _t('PIN entfernt') : _t('PIN gespeichert'), 'ok');
  await loadSession();
  if (state.view === 'settings') renderSettings();
}

async function _addUser() {
  const name = V('st-user-new').trim();
  if (!name) return;
  try {
    await api('/api/users', 'POST', { name, role: V('st-user-new-role') || 'user', job_title: V('st-user-new-job').trim() });
    toast(_t('{name} angelegt', { name }), 'ok');
  } catch { return; }
  await _renderUsersSettings();
}
async function _saveIdleMinutes(v) {
  try { await api('/api/settings', 'PUT', { user_idle_minutes: String(Math.max(0, parseFloat(v) || 0)) }); toast(_t('Gespeichert'), 'ok'); } catch {}
  await loadSession();
}


// ── ZEITEN EINER PERSON ───────────────────────────────────────
// Für welche Projekte (und Teile) und Aufträge jemand wie viel gearbeitet hat.
// Nur für Admins; Kosten zum beim Erfassen festgehaltenen Satz.
let _tr = { id: null, preset: 'year', from: '', to: '', open: new Set() };
const _ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function _trRange(preset) {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth();
  return {
    month: [new Date(y, m, 1), new Date(y, m + 1, 0)],
    lastmonth: [new Date(y, m - 1, 1), new Date(y, m, 0)],
    year: [new Date(y, 0, 1), new Date(y, 11, 31)],
    lastyear: [new Date(y - 1, 0, 1), new Date(y - 1, 11, 31)],
    all: [null, null],
  }[preset]?.map(d => d ? _ymd(d) : '') || [_tr.from, _tr.to];
}
async function openUserTimeReport(id) {
  _tr = { id, preset: 'year', from: '', to: '', open: new Set() };
  [_tr.from, _tr.to] = _trRange('year');
  await _trLoad();
}
function _trPreset(p) { _tr.preset = p; [_tr.from, _tr.to] = _trRange(p); _tr.open.clear(); _trLoad(); }
function _trDates() { _tr.preset = 'custom'; _tr.from = V('tr-from'); _tr.to = V('tr-to'); _trLoad(); }
function _trToggle(key) { _tr.open.has(key) ? _tr.open.delete(key) : _tr.open.add(key); _trLoad(true); }
let _trData = null;
async function _trLoad(cached) {
  if (!cached || !_trData) {
    const q = new URLSearchParams({ ...(_tr.from && { from: _tr.from }), ...(_tr.to && { to: _tr.to }) });
    try { _trData = await api(`/api/users/${_tr.id}/time-report?${q}`); } catch { return; }
  }
  const scroll = document.querySelector('#dynModal .modal-body')?.scrollTop;
  _showDynModal(_trHtml(_trData));
  if (cached && scroll) document.querySelector('#dynModal .modal-body').scrollTop = scroll;
}

function _trHtml(d) {
  const u = d.user, t = d.total;
  const num = 'font-family:var(--mono);font-size:13px;text-align:right;white-space:nowrap';
  const cost = o => o.cost != null ? fmtCHF(o.cost) : '<span style="color:var(--t4)">—</span>';
  const bar = (h, color) => {
    const pct = t.hours > 0 ? Math.round(h / t.hours * 100) : 0;
    return `<div style="display:flex;align-items:center;gap:8px;min-width:100px">
      <div style="flex:1;height:6px;border-radius:3px;background:var(--bg3);overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${/^#[0-9a-f]{6}$/i.test(color || '') ? color : 'var(--blue)'}"></div></div>
      <span style="font-size:12px;color:var(--t3);width:34px;text-align:right">${pct}%</span></div>`;
  };
  const presets = [['month', _t('Dieser Monat')], ['lastmonth', _t('Letzter Monat')], ['year', _t('Dieses Jahr')],
    ['lastyear', _t('Letztes Jahr')], ['all', _t('Alles')]];
  const tile = (label, val, sub = '') => `<div style="flex:1;min-width:120px;background:var(--bg2);border:1px solid var(--line);border-radius:var(--r-sm);padding:10px 12px">
    <div style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.06em">${label}</div>
    <div style="font-size:18px;font-weight:600;font-family:var(--mono);margin-top:2px">${val}</div>
    ${sub ? `<div style="font-size:12px;color:var(--t4)">${sub}</div>` : ''}</div>`;

  // Gelöschtes bleibt mit Nummer und Name von damals, ohne Link
  const gone = `<span class="chip" style="margin-left:6px;color:var(--red);border-color:rgba(255,120,120,.35)" title="${_t('Gelöscht — die Zeiten bleiben als geleistete Arbeit erhalten')}">${_t('gelöscht')}</span>`;
  const projRows = d.projects.map((p, idx) => {
    const key = 'p' + idx, open = _tr.open.has(key);
    return `<tr style="cursor:pointer" onclick="_trToggle('${key}')">
        <td><span style="color:var(--t4);display:inline-block;width:12px">${open ? '▾' : '▸'}</span>
          ${p.color ? `<span style="width:9px;height:9px;border-radius:50%;background:${esc(p.color)};display:inline-block;margin-right:4px"></span>` : ''}
          <span style="font-family:var(--mono);font-size:12px;color:var(--t3)">${esc(p.number || '')}</span> ${esc(p.name || (p.deleted ? _t('Gelöschtes Projekt') : _t('Ohne Projekt')))}${p.deleted ? gone : ''}
          <span style="font-size:12px;color:var(--t4)">· ${_t('{n} Teile', { n: p.items.length })}</span></td>
        <td style="${num}">${_fmtDur(p.hours)}</td><td>${bar(p.hours, p.color)}</td><td style="${num}">${cost(p)}</td>
      </tr>${open ? p.items.map(i => `<tr style="background:var(--bg2)">
        <td style="padding-left:34px">${i.deleted
          ? `<span style="font-size:13px;color:var(--t3)">${esc(i.name || _t('Gelöschtes Teil'))}</span>${gone}`
          : `<span style="display:inline-flex;align-items:center;gap:6px;cursor:pointer" onclick="_hideDynModal();gotoPlmItem(${i.id})" title="${_t('Item öffnen')}">
          ${_itemChip(i.item_type, 14)}<span style="font-family:var(--mono);font-size:12px;color:var(--blue)">${esc(i.item_number)}</span>
          <span style="font-size:13px">${esc(i.name)}</span></span>`}
          <span style="font-size:12px;color:var(--t4)">· ${_t('zuletzt {date}', { date: fmtD(i.last) })}</span></td>
        <td style="${num}">${_fmtDur(i.hours)}</td><td></td><td style="${num}">${cost(i)}</td></tr>`).join('') : ''}`;
  }).join('');

  const orderRows = d.orders.map(o => `<tr${o.deleted ? '' : ` style="cursor:pointer" onclick="_hideDynModal();gotoView('orders');openOrderDetail(${o.id})" title="${_t('Auftrag öffnen')}"`}>
      <td>${o.deleted
        ? `<span style="color:var(--t3)">${esc(o.title || _t('Gelöschter Auftrag'))}</span>${gone}`
        : `<span style="font-family:var(--mono);font-size:12px;color:var(--blue)">${esc(o.number)}</span> ${esc(o.title || '')}`}</td>
      <td style="${num}">${_fmtDur(o.hours)}${o.billable_hours > 0 ? `<div style="font-size:12px;color:var(--green)">${_t('{time} verrechenbar', { time: _fmtDur(o.billable_hours) })}</div>` : ''}</td>
      <td>${bar(o.hours)}</td><td style="${num}">${cost(o)}</td></tr>`).join('');

  const maxM = Math.max(...d.months.map(m => m.hours), 0);
  const months = d.months.length > 1 ? `<div class="sep-label">${_t('Verlauf')}</div>
    <div style="display:flex;align-items:flex-end;gap:4px;height:80px;overflow-x:auto;padding-bottom:2px">
      ${d.months.map(m => `<div style="flex:1;min-width:26px;display:flex;flex-direction:column;align-items:center;gap:3px;height:100%;justify-content:flex-end" title="${esc(m.month)}: ${_fmtDur(m.hours)}">
        <div style="width:100%;max-width:28px;height:${Math.max(2, Math.round(m.hours / maxM * 58))}px;background:${/^#[0-9a-f]{6}$/i.test(u?.color || '') ? u.color : 'var(--blue)'};border-radius:3px 3px 0 0"></div>
        <span style="font-size:10px;color:var(--t4)">${esc(m.month.slice(5))}.${esc(m.month.slice(2, 4))}</span></div>`).join('')}
    </div>` : '';

  const head = tag => `<thead><tr><th>${tag}</th><th style="text-align:right">${_t('Stunden')}</th><th>${_t('Anteil')}</th><th style="text-align:right">${_t('Kosten')}</th></tr></thead>`;
  return `<div class="modal" style="max-width:780px;width:96vw">
    <div class="modal-head">
      <div class="modal-title" style="display:flex;align-items:center;gap:10px">
        ${u ? _avatar(u.name, 28, u.color) : ''}
        <span>${u ? _t('Zeiten von {name}', { name: esc(u.name) }) : _t('Zeiten ohne Person')}</span>
        ${u?.job_title ? `<span style="font-size:13px;font-weight:400;color:var(--t3)">${esc(u.job_title)}</span>` : ''}
      </div>
      <button class="btn btn-icon btn-ghost" onclick="_hideDynModal()">✕</button>
    </div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:12px;max-height:75vh;overflow-y:auto">
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
        ${presets.map(([k, l]) => `<button class="btn btn-sm ${_tr.preset === k ? 'btn-primary' : 'btn-ghost'}" onclick="_trPreset('${k}')">${l}</button>`).join('')}
        <span style="display:inline-flex;align-items:center;gap:4px;margin-left:auto">
          <input type="date" id="tr-from" class="fi" style="width:auto" value="${esc(_tr.from)}" onchange="_trDates()" aria-label="${_t('Von')}">
          <span style="color:var(--t4)">–</span>
          <input type="date" id="tr-to" class="fi" style="width:auto" value="${esc(_tr.to)}" onchange="_trDates()" aria-label="${_t('Bis')}">
        </span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${tile(_t('Stunden'), _fmtDur(t.hours), _t('{n} Einträge', { n: t.entries || 0 }))}
        ${tile(_t('Kosten'), t.cost != null ? fmtCHF(t.cost) : '—', t.unpriced_hours > 0 ? _t('{time} ohne Satz', { time: _fmtHours(t.unpriced_hours) }) : (d.hourly_rate ? _t('heute {rate}/h', { rate: fmtCHF(d.hourly_rate) }) : ''))}
        ${tile(_t('Projekte'), d.projects.length, _t('{n} Aufträge', { n: d.orders.length }))}
        ${t.billable_hours > 0 ? tile(_t('Verrechenbar'), _fmtDur(t.billable_hours)) : ''}
      </div>
      ${!t.hours ? `<div style="color:var(--t3);font-size:13px;padding:16px 0;text-align:center">${_t('Keine Zeiten in diesem Zeitraum')}</div>` : ''}
      ${months}
      ${d.projects.length ? `<div class="sep-label">${_t('Projekte (PLM)')}</div>
        <div class="tbl-wrap"><table>${head(_t('Projekt'))}<tbody>${projRows}</tbody></table></div>` : ''}
      ${d.orders.length ? `<div class="sep-label">${_t('Aufträge (ERP)')}</div>
        <div class="tbl-wrap"><table>${head(_t('Auftrag'))}<tbody>${orderRows}</tbody></table></div>` : ''}
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="_hideDynModal()">${_t('Schliessen')}</button></div>
  </div>`;
}
