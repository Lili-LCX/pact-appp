/* PACT — front (vanilla JS). API: window.PACT_API (config.js) pour l'app native, sinon même origine. */
const API = (window.PACT_API || '').replace(/\/$/, '');
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',') + ' €';
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DAYS_FULL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

const S = { token: localStorage.getItem('pact_token'), user: null, config: {}, view: 'agenda', weekOffset: 0, selected: ymd(new Date()),
  pacts: [], stats: null, history: [], sport: 'Musculation', createDate: null, authMode: 'login', busy: false, now: null };

/* ---------- utilitaires ---------- */
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function mondayOf(d) { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(0, 0, 0, 0); return x; }
function weekDays() { const m = mondayOf(new Date()); m.setDate(m.getDate() + S.weekOffset * 7); return [...Array(7)].map((_, i) => { const d = new Date(m); d.setDate(m.getDate() + i); return d; }); }
function isoWeek(d) { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); }
function nowStr() { const d = new Date(); return ymd(d) + ' ' + d.toTimeString().slice(0, 5); }
function startMs(p) { return new Date(`${p.date}T${p.time}:00`).getTime(); }

function toast(text) {
  $('toastText').textContent = text; $('toast').classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => $('toast').classList.add('hidden'), 3200);
}
function setBusy(btn, on, label) { if (!btn) return; btn.disabled = on; if (label) btn.dataset.l = btn.dataset.l || btn.textContent; btn.textContent = on ? '…' : (btn.dataset.l || btn.textContent); }

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json', 'X-TZ-Offset': String(new Date().getTimezoneOffset()) };
  if (S.token) headers.Authorization = 'Bearer ' + S.token;
  let res;
  try { res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined }); }
  catch { throw new Error('Connexion au serveur impossible. Vérifie ta connexion.'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.token && path !== '/api/login') { logout(true); throw new Error('Session expirée, reconnecte-toi.'); }
  if (!res.ok) throw new Error(data.error || 'Erreur inattendue.');
  return data;
}

function setSession(token, user) { S.token = token; S.user = user; localStorage.setItem('pact_token', token); }
function logout(silent) {
  S.token = null; S.user = null; localStorage.removeItem('pact_token'); S.authMode = 'login';
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  showAuth(); if (!silent) toast('Déconnecté');
}

/* ---------- AUTH ---------- */
const inputCls = 'w-full bg-[#0B0D13] border border-white/10 rounded-xl px-3.5 py-3 text-sm text-white font-medium placeholder:text-slate-600';
const field = (id, label, type = 'text', ph = '', extra = '') => `<div><label class="text-xs font-semibold text-slate-300 block mb-1.5">${label}</label><input id="${id}" type="${type}" placeholder="${ph}" ${extra} class="${inputCls}" /></div>`;

function showRoot(html) { $('boot').classList.add('hidden'); const r = $('root'); r.classList.remove('hidden'); r.innerHTML = html; }

function authShell(inner) {
  return `<div class="flex-1 overflow-y-auto no-scrollbar px-6 lg:px-12 safe-top pb-6 flex flex-col fade">
    <div class="flex items-center gap-1.5 mb-1 w-full max-w-md mx-auto"><span class="text-3xl font-extrabold tracking-tight text-white">PACT</span><span class="w-2.5 h-2.5 rounded-full bg-[#00E5FF] shadow-[0_0_8px_#00E5FF]"></span></div>
    <p class="text-xs text-slate-400 font-medium mb-7 w-full max-w-md mx-auto">L'engagement sportif</p>
    <div class="my-auto w-full max-w-md mx-auto">${inner}</div></div>`;
}

const googleSvg = '<svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.3-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.3-.4-3.9z"/></svg>';
const appleSvg = '<svg width="16" height="16" viewBox="0 0 384 512" fill="currentColor"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>';

function showAuth(mode) {
  S.authMode = mode || S.authMode;
  const m = S.authMode;
  const params = new URLSearchParams(location.search);
  let body = '';
  if (m === 'login' || m === 'register') {
    body = `
      <h1 class="text-2xl font-bold text-white mb-1">${m === 'login' ? 'Content de te revoir' : 'Crée ton compte'}</h1>
      <p class="text-xs text-slate-400 mb-5">${m === 'login' ? 'Connecte-toi pour retrouver tes séances.' : 'Un e-mail de confirmation te sera envoyé.'}</p>
      <div class="space-y-2.5 mb-4">
        <div id="gBtn" class="flex justify-center min-h-[44px]"></div>
        <button onclick="appleLogin()" class="w-full py-3 rounded-xl bg-white text-black text-sm font-semibold flex items-center justify-center gap-2 active:scale-[0.99]">${appleSvg} Continuer avec Apple</button>
      </div>
      <div class="flex items-center gap-3 mb-4"><span class="flex-1 h-px bg-white/10"></span><span class="text-[11px] text-slate-500">ou par e-mail</span><span class="flex-1 h-px bg-white/10"></span></div>
      <form onsubmit="return submitAuth(event)" class="space-y-3">
        ${m === 'register' ? field('fName', 'Prénom', 'text', 'Ton prénom', 'autocomplete="given-name" required') : ''}
        ${field('fEmail', 'E-mail', 'email', 'toi@exemple.com', 'autocomplete="email" required')}
        ${field('fPass', 'Mot de passe', 'password', m === 'register' ? '8 caractères minimum' : '••••••••', `autocomplete="${m === 'login' ? 'current-password' : 'new-password'}" required minlength="${m === 'register' ? 8 : 1}"`)}
        ${m === 'login' ? '<div class="text-right"><button type="button" onclick="showAuth(\'forgot\')" class="text-[11px] text-[#00E5FF] font-semibold">Mot de passe oublié ?</button></div>' : ''}
        <p id="authErr" class="hidden text-xs text-[#FF2A85] font-semibold"></p>
        <button id="authBtn" class="w-full py-3.5 rounded-2xl text-sm font-bold btn-neon-cyan active:scale-[0.99] transition">${m === 'login' ? 'Se connecter' : 'Créer mon compte'}</button>
      </form>
      <p class="text-center text-xs text-slate-400 mt-5">${m === 'login' ? 'Pas encore de compte ?' : 'Déjà inscrit ?'}
        <button onclick="showAuth('${m === 'login' ? 'register' : 'login'}')" class="text-[#00E5FF] font-semibold">${m === 'login' ? "S'inscrire" : 'Se connecter'}</button></p>`;
  } else if (m === 'forgot') {
    body = `<h1 class="text-2xl font-bold text-white mb-1">Mot de passe oublié</h1>
      <p class="text-xs text-slate-400 mb-5">Reçois un lien pour en choisir un nouveau.</p>
      <form onsubmit="return submitAuth(event)" class="space-y-3">${field('fEmail', 'E-mail', 'email', 'toi@exemple.com', 'required')}
        <p id="authErr" class="hidden text-xs text-[#FF2A85] font-semibold"></p>
        <button id="authBtn" class="w-full py-3.5 rounded-2xl text-sm font-bold btn-neon-cyan">Envoyer le lien</button></form>
      <button onclick="showAuth('login')" class="block mx-auto text-xs text-slate-400 mt-5">← Retour</button>`;
  } else if (m === 'reset') {
    body = `<h1 class="text-2xl font-bold text-white mb-1">Nouveau mot de passe</h1>
      <p class="text-xs text-slate-400 mb-5">Choisis un mot de passe d'au moins 8 caractères.</p>
      <form onsubmit="return submitAuth(event)" class="space-y-3">${field('fPass', 'Mot de passe', 'password', '8 caractères minimum', 'autocomplete="new-password" required minlength="8"')}
        <p id="authErr" class="hidden text-xs text-[#FF2A85] font-semibold"></p>
        <button id="authBtn" class="w-full py-3.5 rounded-2xl text-sm font-bold btn-neon-cyan">Enregistrer</button></form>`;
  } else if (m === 'sent') {
    body = `<div class="bg-[#131722] border rounded-3xl p-6 neon-border-cyan text-center space-y-3">
      <div class="text-4xl">✉️</div><h1 class="text-xl font-bold text-white">Vérifie ta boîte mail</h1>
      <p class="text-xs text-slate-400 leading-relaxed">${esc(S.sentText || 'Un e-mail a été envoyé.')}<br><span class="text-white font-semibold">${esc(S.sentTo || '')}</span></p>
      ${S.devLink ? `<a href="${esc(S.devLink)}" class="block text-[11px] text-[#FF2A85] font-semibold border border-[#FF2A85]/30 rounded-xl p-2 break-all">Mode dev (SMTP non configuré) : ouvrir le lien</a>` : ''}
      ${S.sentKind === 'verify' ? `<button onclick="resendMail()" class="text-xs text-[#00E5FF] font-semibold">Renvoyer l'e-mail</button>` : ''}
      <button onclick="showAuth('login')" class="block mx-auto text-xs text-slate-400 pt-1">← Retour à la connexion</button></div>`;
  }
  if (params.get('verified') && m === 'login') {
    body = `<div class="mb-4 p-3 rounded-xl text-xs font-semibold ${params.get('verified') === '1' ? 'bg-[#00E5FF]/10 border border-[#00E5FF]/30 text-[#00E5FF]' : 'bg-[#FF2A85]/10 border border-[#FF2A85]/30 text-[#FF2A85]'}">${params.get('verified') === '1' ? '✓ E-mail confirmé, tu peux te connecter.' : 'Lien de confirmation invalide ou expiré.'}</div>` + body;
    history.replaceState(null, '', location.pathname);
  }
  showRoot(authShell(body));
  if (m === 'login' || m === 'register') initGoogleButton();
}

function authError(msg) { const e = $('authErr'); if (e) { e.textContent = msg; e.classList.remove('hidden'); } }

async function submitAuth(ev) {
  ev.preventDefault();
  const m = S.authMode, btn = $('authBtn'); setBusy(btn, true, 1);
  const email = $('fEmail')?.value.trim(), password = $('fPass')?.value;
  try {
    if (m === 'login') { const r = await api('POST', '/api/login', { email, password }); setSession(r.token, r.user); await enterApp(); }
    else if (m === 'register') {
      const r = await api('POST', '/api/register', { email, password, name: $('fName').value });
      Object.assign(S, { sentTo: email, sentKind: 'verify', devLink: r.devLink, sentText: 'Clique sur le lien de confirmation envoyé à' });
      showAuth('sent');
    } else if (m === 'forgot') {
      const r = await api('POST', '/api/forgot', { email });
      Object.assign(S, { sentTo: email, sentKind: 'reset', devLink: r.devLink, sentText: 'Si un compte existe, un lien de réinitialisation a été envoyé à' });
      showAuth('sent');
    } else if (m === 'reset') {
      await api('POST', '/api/reset', { token: S.resetToken, password });
      history.replaceState(null, '', location.pathname); toast('Mot de passe modifié, connecte-toi.'); showAuth('login');
    }
  } catch (e) {
    authError(e.message);
    if (/Confirme d'abord/.test(e.message)) { S.sentTo = email; }
  } finally { setBusy($('authBtn'), false); }
  return false;
}

async function resendMail() {
  try { const r = await api('POST', '/api/resend', { email: S.sentTo }); S.devLink = r.devLink; toast('E-mail renvoyé'); showAuth('sent'); } catch (e) { toast(e.message); }
}

/* --- Google --- */
function loadScript(src) { return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
async function initGoogleButton() {
  const holder = $('gBtn'); if (!holder) return;
  if (!S.config.googleClientId) {
    holder.innerHTML = `<button onclick="toast('Google non configuré : renseigne GOOGLE_CLIENT_ID dans .env')" class="w-full py-3 rounded-xl bg-[#131722] border border-white/15 text-white text-sm font-semibold flex items-center justify-center gap-2">${googleSvg} Continuer avec Google</button>`;
    return;
  }
  try {
    await loadScript('https://accounts.google.com/gsi/client');
    google.accounts.id.initialize({ client_id: S.config.googleClientId, callback: async (r) => {
      try { const d = await api('POST', '/api/google', { credential: r.credential }); setSession(d.token, d.user); await enterApp(); } catch (e) { toast(e.message); } } });
    google.accounts.id.renderButton(holder, { theme: 'filled_black', size: 'large', shape: 'rectangular', text: 'continue_with', width: Math.min(holder.clientWidth || 340, 400), locale: 'fr' });
  } catch { holder.innerHTML = '<p class="text-xs text-slate-500">Google indisponible hors ligne.</p>'; }
}

/* --- Apple --- */
async function appleLogin() {
  if (!S.config.appleClientId) return toast('Apple non configuré : renseigne APPLE_CLIENT_ID dans .env');
  try {
    await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/fr_FR/appleid.auth.js');
    AppleID.auth.init({ clientId: S.config.appleClientId, scope: 'name email', redirectURI: S.config.appleRedirectUri, usePopup: true });
    const r = await AppleID.auth.signIn();
    const n = r.user?.name; const name = n ? [n.firstName, n.lastName].filter(Boolean).join(' ') : '';
    const d = await api('POST', '/api/apple', { id_token: r.authorization.id_token, name });
    setSession(d.token, d.user); await enterApp();
  } catch (e) { if (e && e.error === 'popup_closed_by_user') return; toast(e.message || 'Connexion Apple annulée'); }
}

/* ---------- APP ---------- */
async function enterApp() {
  S.view = 'agenda'; S.weekOffset = 0; S.selected = ymd(new Date());
  renderShell(); await refresh();
  startReminders();
}

async function refresh() {
  const wd = weekDays();
  try {
    const [w, h] = await Promise.all([
      api('GET', `/api/pacts?from=${ymd(wd[0])}&to=${ymd(wd[6])}`),
      api('GET', `/api/pacts?from=${ymd(new Date(Date.now() - 90 * 864e5))}&to=${ymd(new Date(Date.now() + 90 * 864e5))}`),
    ]);
    S.pacts = w.pacts; S.stats = w.stats; S.history = h.pacts; S.now = w.now;
    renderView(); $('savedCounter') && ($('savedCounter').textContent = Math.round(S.stats.saved * 100) / 100 + ' €');
  } catch (e) { toast(e.message); }
}

function renderShell() {
  showRoot(`<div class="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[250px_1fr] lg:grid-rows-[auto_minmax(0,1fr)]">
    <header class="safe-top px-6 lg:px-10 pb-4 lg:col-start-2 lg:row-start-1 flex justify-between items-center z-10">
      <div><div class="flex items-center gap-1.5"><span class="text-2xl font-extrabold tracking-tight text-white">PACT</span><span class="w-2 h-2 rounded-full bg-[#00E5FF] shadow-[0_0_8px_#00E5FF]"></span></div>
      <p class="text-xs text-slate-400 font-medium">Salut ${esc(S.user.name.split(' ')[0])} 👋</p></div>
      <div class="text-right bg-[#131722] border border-white/10 px-3.5 py-2 rounded-2xl"><span class="text-[10px] text-slate-400 font-medium block">Mises protégées</span><span id="savedCounter" class="text-sm font-bold text-[#00E5FF]">— €</span></div>
    </header>
    <main id="main" class="flex-1 min-h-0 overflow-y-auto no-scrollbar px-6 lg:px-10 py-3 lg:pb-10 lg:col-start-2 lg:row-start-2"></main>
    <nav id="nav" class="bg-[#0B0D13]/95 border-t border-white/10 px-4 pt-3 safe-bottom grid grid-cols-4 gap-2 lg:flex lg:flex-col lg:justify-start lg:border-t-0 lg:border-r lg:p-6 lg:pt-28 lg:gap-2 lg:col-start-1 lg:row-start-1 lg:row-span-2 lg:row-end-3"></nav></div>`);
  renderNav();
}

function renderNav() {
  const tabs = [['agenda', 'Agenda'], ['create', '+ Séance'], ['impact', 'Impact'], ['profile', 'Profil']];
  $('nav').innerHTML = tabs.map(([k, l]) => `<button onclick="setView('${k}')" class="py-2.5 lg:py-3 lg:px-4 lg:text-left lg:text-sm rounded-xl text-xs font-semibold border transition ${S.view === k ? 'border-[#00E5FF]/50 text-[#00E5FF] bg-[#00E5FF]/10' : 'border-white/10 text-slate-400 hover:text-white'}">${l}</button>`).join('');
}

function setView(v) { S.view = v; renderNav(); renderView(); $('main').scrollTop = 0; if (v === 'impact') refresh(); }
function renderView() { if (!$('main')) return; ({ agenda: viewAgenda, create: viewCreate, impact: viewImpact, profile: viewProfile })[S.view](); }

/* --- Agenda --- */
function viewAgenda() {
  const wd = weekDays(), today = ymd(new Date());
  const sel = S.selected, selDate = parseYmd(sel);
  const bar = wd.map((d, i) => {
    const k = ymd(d), list = S.pacts.filter((p) => p.date === k);
    let dot = 'bg-slate-700';
    if (list.length) dot = list.some((p) => p.status === 'pending') ? 'bg-white' : list.every((p) => p.status === 'done') ? 'bg-[#00E5FF] shadow-[0_0_6px_#00E5FF]' : 'bg-[#FF2A85] shadow-[0_0_6px_#FF2A85]';
    return `<button onclick="selectDay('${k}')" class="py-2.5 rounded-2xl border transition flex flex-col items-center ${k === sel ? 'border-[#00E5FF] bg-[#00E5FF]/10 text-white' : 'border-white/5 bg-[#131722] text-slate-400'}">
      <span class="text-[10px] font-medium">${DAYS[i]}</span><span class="text-xs font-bold mt-0.5 ${k === today ? 'text-[#00E5FF]' : ''}">${String(d.getDate()).padStart(2, '0')}</span><span class="w-1.5 h-1.5 rounded-full mt-1.5 ${dot}"></span></button>`;
  }).join('');
  const list = S.pacts.filter((p) => p.date === sel);
  const dayIdx = (selDate.getDay() + 6) % 7;
  const cards = list.length ? list.map(pactCard).join('') : `
    <div class="bg-[#131722] border border-white/10 rounded-3xl p-6">
      <div class="flex justify-between items-center mb-4"><span class="text-xs font-semibold text-slate-400">${DAYS_FULL[dayIdx]} • Repos</span><span class="text-xs px-3 py-1 rounded-full bg-white/5 text-slate-400 border border-white/10">Aucune mise</span></div>
      <h2 class="text-2xl font-bold text-white">Jour de repos</h2><p class="text-xs text-slate-400 mt-1">Aucun entraînement prévu ce jour</p>
      <button onclick="openCreateForDay('${sel}')" class="mt-6 w-full py-3.5 rounded-2xl text-xs font-semibold border border-[#00E5FF]/50 text-[#00E5FF] hover:bg-[#00E5FF]/10 transition">+ Ajouter une séance ce jour</button></div>`;
  $('main').innerHTML = `<div class="space-y-5 fade">
    <div><div class="flex justify-between items-center mb-3">
      <button onclick="shiftWeek(-1)" class="w-8 h-8 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-sm">‹</button>
      <div class="text-center"><span class="text-xs font-semibold text-slate-300 block">${MONTHS[wd[0].getMonth()]}${wd[0].getMonth() !== wd[6].getMonth() ? ' / ' + MONTHS[wd[6].getMonth()] : ''} ${wd[6].getFullYear()}</span><span class="text-[11px] font-medium text-slate-500">Semaine ${isoWeek(wd[0])}${S.weekOffset === 0 ? ' • en cours' : ''}</span></div>
      <button onclick="shiftWeek(1)" class="w-8 h-8 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-sm">›</button></div>
      <div class="grid grid-cols-7 gap-1.5">${bar}</div></div>
    ${cards}
    <div class="bg-[#131722]/70 border border-white/5 rounded-2xl p-4"><p class="text-xs text-slate-400 leading-relaxed"><strong class="text-white font-semibold">Fonctionnement :</strong> valide ta séance pour conserver ta mise (ouverture 1 h avant, jusqu'à ${S.config.graceMin || 60} min après l'heure). Sinon, elle est débitée (<span class="text-[#00E5FF]">20 % pour une ONG</span>, <span class="text-[#FF2A85]">80 % pour PACT</span>).</p></div></div>`;
}

function pactCard(p) {
  const d = parseYmd(p.date), dayName = DAYS_FULL[(d.getDay() + 6) % 7];
  const start = startMs(p), now = Date.now(), open = now >= start - (S.config.openBeforeMin || 60) * 60000;
  const failed = p.status === 'failed', done = p.status === 'done';
  const badge = done ? [`${p.stake} € protégés`, 'bg-[#00E5FF]/15 text-[#00E5FF] border-[#00E5FF]/30'] : failed ? [`Perdu : -${p.stake} €`, 'bg-[#FF2A85]/15 text-[#FF2A85] border-[#FF2A85]/30'] : [`Mise : ${p.stake} €`, 'bg-[#FF2A85]/15 text-[#FF2A85] border-[#FF2A85]/30'];
  let actions = '';
  if (p.status === 'pending') {
    const canCancel = now <= start - (S.config.openBeforeMin || 60) * 60000;
    actions = `<button onclick="openValidation(${p.id})" ${open ? '' : 'disabled'} class="w-full py-3.5 rounded-2xl text-xs font-bold btn-neon-cyan active:scale-[0.99] transition">${open ? 'Valider ma séance' : `Validation dès ${new Date(start - 3600000).toTimeString().slice(0, 5)}`}</button>
      <div class="grid grid-cols-2 gap-2.5 pt-1">
        <button onclick="delayPact(${p.id})" ${p.delayed ? 'disabled' : ''} class="py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 text-xs font-semibold hover:bg-white/10 transition">${p.delayed ? 'Retard utilisé' : 'Retard +20 min'}</button>
        <button onclick="missPact(${p.id})" class="py-2.5 rounded-xl bg-[#FF2A85]/10 border border-[#FF2A85]/30 text-[#FF2A85] text-xs font-semibold hover:bg-[#FF2A85]/20 transition">Passer la séance</button></div>
      ${canCancel ? `<button onclick="deletePact(${p.id})" class="w-full text-[11px] text-slate-500 hover:text-slate-300 pt-1">Annuler cette séance (sans frais)</button>` : ''}`;
  } else if (done) {
    actions = `<div class="py-3 px-4 rounded-2xl bg-[#00E5FF]/10 border border-[#00E5FF]/30 text-center space-y-0.5"><span class="text-xs font-semibold text-[#00E5FF] block">Séance validée — Aucun débit</span>${p.log_title ? `<span class="text-[11px] text-slate-300 block">${esc(p.log_title)}${p.log_detail ? ' • ' + esc(p.log_detail) : ''}</span>` : ''}</div>`;
  } else {
    actions = `<div class="py-3 px-4 rounded-2xl bg-[#FF2A85]/10 border border-[#FF2A85]/30 text-center space-y-0.5"><span class="text-xs font-semibold text-[#FF2A85] block">${p.auto ? 'Séance non validée à temps' : 'Séance manquée'} — Mise débitée</span>
      <span class="text-[11px] text-slate-300 block">${eur(p.stake * 0.2)} pour ${esc(p.ngo || S.user.ngo)} • ${eur(p.stake * 0.8)} pour PACT</span></div>`;
  }
  return `<div class="bg-[#131722] border rounded-3xl p-6 transition-all ${failed ? 'neon-border-pink' : 'neon-border-cyan'}">
    <div class="flex justify-between items-center mb-4"><span class="text-xs font-semibold text-[#00E5FF]">${dayName} • ${p.time}${p.delayed ? ' (+20 min)' : ''}</span><span class="text-xs font-bold px-3 py-1 rounded-full border ${badge[1]}">${badge[0]}</span></div>
    <h2 class="text-2xl font-bold text-white tracking-tight">${esc(p.sport)}</h2>
    <p class="text-xs text-slate-400 font-medium mt-1">${p.place ? 'Lieu : ' + esc(p.place) : 'Lieu non précisé'}</p>
    <div class="mt-6 space-y-2.5">${actions}</div></div>`;
}

function selectDay(k) { S.selected = k; viewAgenda(); }
async function shiftWeek(n) {
  S.weekOffset += n; const wd = weekDays(); S.selected = ymd(S.weekOffset === 0 ? new Date() : wd[0]); await refresh();
}
function openCreateForDay(k) { S.createDate = k; setView('create'); }

/* validation / actions */
function openModal(html) { $('modal').innerHTML = html; $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); $('modal').innerHTML = ''; }

function openValidation(id) {
  const p = S.pacts.find((x) => x.id === id); if (!p) return;
  S.gps = null;
  openModal(`<div class="bg-[#131722] border border-[#00E5FF]/50 rounded-3xl p-6 w-full max-w-sm space-y-4 neon-border-cyan fade">
    <div class="flex justify-between items-center border-b border-white/10 pb-3"><span class="text-sm font-bold text-white">Valider ma présence</span><button onclick="closeModal()" class="text-xs text-slate-400 hover:text-white font-semibold">Fermer</button></div>
    <div class="bg-[#0B0D13] border border-[#00E5FF]/30 rounded-xl p-3 flex justify-between items-center"><span class="text-xs text-slate-300">Position GPS</span><span id="gpsState" class="text-xs text-slate-400 font-semibold">Localisation…</span></div>
    ${field('logTitle', 'Séance / Muscles travaillés', 'text', p.sport === 'Running' ? 'ex. 10 km, sortie longue' : 'ex. Haut du corps / Pectoraux')}
    ${field('logDetail', 'Charges / Résumé', 'text', 'ex. 4 x 10 reps @ 80 kg')}
    <button id="ckBtn" onclick="confirmCheckin(${id})" class="w-full py-3.5 rounded-2xl text-xs font-bold btn-neon-cyan">Confirmer et protéger ma mise</button></div>`);
  if (!navigator.geolocation) { $('gpsState').textContent = 'Indisponible'; return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => { S.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude }; const e = $('gpsState'); if (e) { e.textContent = `Confirmée (±${Math.round(pos.coords.accuracy)} m)`; e.className = 'text-xs text-[#00E5FF] font-semibold'; } },
    () => { const e = $('gpsState'); if (e) { e.textContent = 'Non autorisée'; e.className = 'text-xs text-[#FF2A85] font-semibold'; } },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
}

async function confirmCheckin(id) {
  const btn = $('ckBtn'); setBusy(btn, true, 1);
  try {
    const r = await api('POST', `/api/pacts/${id}/checkin`, { title: $('logTitle').value, detail: $('logDetail').value, ...(S.gps || {}) });
    closeModal(); toast(`Séance validée • ${r.pact.stake} € protégés 🎉`); await refresh();
  } catch (e) { toast(e.message); setBusy(btn, false); }
}
async function delayPact(id) { try { const r = await api('POST', `/api/pacts/${id}/delay`); toast(`Horaire décalé à ${r.pact.time} sans pénalité`); await refresh(); } catch (e) { toast(e.message); } }
function missPact(id) {
  const p = S.pacts.find((x) => x.id === id);
  openModal(`<div class="bg-[#131722] border border-[#FF2A85]/50 rounded-3xl p-6 w-full max-w-sm space-y-4 neon-border-pink fade"><h3 class="text-base font-bold text-white">Passer la séance ?</h3>
    <p class="text-xs text-slate-400 leading-relaxed">Ta mise de <strong class="text-[#FF2A85]">${p.stake} €</strong> sera débitée : ${eur(p.stake * 0.2)} pour ${esc(S.user.ngo)}, ${eur(p.stake * 0.8)} pour PACT.</p>
    <div class="grid grid-cols-2 gap-2.5"><button onclick="closeModal()" class="py-3 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-slate-300">Retour</button>
    <button onclick="doMiss(${id})" class="py-3 rounded-xl btn-neon-pink text-xs font-bold">Confirmer</button></div></div>`);
}
async function doMiss(id) { try { await api('POST', `/api/pacts/${id}/miss`); closeModal(); toast('Séance manquée • mise débitée'); await refresh(); } catch (e) { toast(e.message); } }
async function deletePact(id) { try { await api('DELETE', `/api/pacts/${id}`); toast('Séance annulée'); await refresh(); } catch (e) { toast(e.message); } }

/* --- Création --- */
function viewCreate() {
  const date = S.createDate || S.selected, today = ymd(new Date());
  const sports = (S.config.sports || ['Musculation', 'Running', 'CrossFit', 'Boxe']);
  $('main').innerHTML = `<div class="space-y-5 fade"><div><h2 class="text-xl font-bold text-white">Nouvel entraînement</h2><p class="text-xs text-slate-400 mt-0.5">Planifie ta séance et fixe ton engagement.</p></div>
    <div class="space-y-4 bg-[#131722] border border-white/10 rounded-3xl p-5">
      <div><label class="text-xs font-semibold text-slate-300 block mb-2">Activité</label><div class="grid grid-cols-2 gap-2">
        ${sports.map((s) => `<button type="button" onclick="selectSport('${s}')" data-sport="${s}" class="sport-btn py-2.5 px-3 rounded-xl border text-xs font-semibold ${s === S.sport ? 'border-[#00E5FF] bg-[#00E5FF]/10 text-[#00E5FF]' : 'border-white/10 bg-white/5 text-slate-400'}">${s}</button>`).join('')}</div></div>
      ${field('inPlace', 'Lieu', 'text', 'ex. Fitness Park, Parc de la Tête d\'Or', 'maxlength="120"')}
      <div class="grid grid-cols-2 gap-3">
        <div><label class="text-xs font-semibold text-slate-300 block mb-1.5">Date</label><input id="inDate" type="date" min="${today}" value="${date < today ? today : date}" class="w-full bg-[#0B0D13] border border-white/10 rounded-xl px-3 py-2.5 text-xs font-semibold text-white" /></div>
        <div><label class="text-xs font-semibold text-slate-300 block mb-1.5">Heure</label><input id="inTime" type="time" value="19:00" class="w-full bg-[#0B0D13] border border-white/10 rounded-xl px-3 py-2.5 text-xs font-semibold text-white" /></div></div>
      <div class="pt-3 border-t border-white/10"><div class="flex justify-between items-center mb-2"><span class="text-xs font-semibold text-slate-300">Mise engagée (1 € à 10 €)</span><span id="stakeDisplay" class="text-base font-extrabold text-[#FF2A85]">5 €</span></div>
        <input id="inStake" type="range" min="1" max="10" value="5" oninput="updateStake(this.value)" class="w-full" />
        <div class="flex justify-between text-[11px] text-slate-400 mt-2"><span>Si séance manquée :</span><span id="splitDisplay" class="text-slate-200 font-semibold">1,00 € ONG • 4,00 € PACT</span></div></div>
      <button id="saveBtn" onclick="saveNewPact()" class="w-full py-3.5 rounded-2xl text-xs font-bold btn-neon-pink mt-2">Enregistrer la séance</button></div></div>`;
  S.createDate = null;
}
function selectSport(n) {
  S.sport = n;
  document.querySelectorAll('.sport-btn').forEach((b) => { b.className = 'sport-btn py-2.5 px-3 rounded-xl border text-xs font-semibold ' + (b.dataset.sport === n ? 'border-[#00E5FF] bg-[#00E5FF]/10 text-[#00E5FF]' : 'border-white/10 bg-white/5 text-slate-400'); });
}
function updateStake(v) { v = parseFloat(v); $('stakeDisplay').textContent = v + ' €'; $('splitDisplay').textContent = `${eur(v * 0.2).replace(' €', '')} € ONG • ${eur(v * 0.8).replace(' €', '')} € PACT`; }
async function saveNewPact() {
  const btn = $('saveBtn'); setBusy(btn, true, 1);
  try {
    const date = $('inDate').value, time = $('inTime').value;
    const r = await api('POST', '/api/pacts', { sport: S.sport, place: $('inPlace').value, date, time, stake: parseInt($('inStake').value, 10) });
    const d = parseYmd(date), mon = mondayOf(new Date());
    S.weekOffset = Math.round((mondayOf(d) - mon) / (7 * 864e5)); S.selected = date;
    S.view = 'agenda'; renderNav(); await refresh();
    toast(`Séance programmée : ${r.pact.sport} (${r.pact.stake} €)`);
  } catch (e) { toast(e.message); setBusy(btn, false); }
}

/* --- Impact --- */
function viewImpact() {
  const st = S.stats || { saved: 0, lost: 0, ngoAmount: 0, pactAmount: 0, byNgo: {}, streak: 0, doneCount: 0, failedCount: 0 };
  const hist = S.history.filter((p) => p.status !== 'pending').sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 8);
  const byNgo = Object.entries(st.byNgo);
  $('main').innerHTML = `<div class="space-y-5 fade"><div><h2 class="text-xl font-bold text-white">Bilan & Répartition</h2><p class="text-xs text-slate-400 mt-0.5">Suivi de tes mises et reversements associatifs.</p></div>
    <div class="grid grid-cols-2 gap-3">
      <div class="bg-[#131722] border border-[#00E5FF]/30 rounded-2xl p-4"><span class="text-xs text-slate-400 font-medium block">Mises protégées</span><span class="text-2xl font-extrabold text-[#00E5FF] mt-1 block">${eur(st.saved)}</span><span class="text-[11px] text-slate-500">${st.doneCount} séance(s)</span></div>
      <div class="bg-[#131722] border border-[#FF2A85]/30 rounded-2xl p-4"><span class="text-xs text-slate-400 font-medium block">Mises perdues</span><span class="text-2xl font-extrabold text-[#FF2A85] mt-1 block">${eur(st.lost)}</span><span class="text-[11px] text-slate-500">${st.failedCount} séance(s)</span></div></div>
    <div class="bg-[#131722] border border-white/10 rounded-2xl p-4 flex items-center justify-between"><span class="text-xs text-slate-300 font-semibold">🔥 Série en cours</span><span class="text-lg font-extrabold text-white">${st.streak}</span></div>
    <div class="bg-[#131722] border border-white/10 rounded-3xl p-5 space-y-4">
      <div class="flex justify-between items-center border-b border-white/10 pb-3"><div><span class="text-xs font-bold text-[#00E5FF] block">20 % Association</span><span class="text-[11px] text-slate-400">Reversé aux ONG sélectionnées</span></div><span class="text-sm font-bold text-white">${eur(st.ngoAmount)}</span></div>
      ${byNgo.map(([n, v]) => `<div class="flex justify-between text-[11px] text-slate-400 -mt-2"><span>${esc(n)}</span><span class="text-slate-200">${eur(v)}</span></div>`).join('')}
      <div class="flex justify-between items-center"><div><span class="text-xs font-bold text-[#FF2A85] block">80 % PACT</span><span class="text-[11px] text-slate-400">Fonctionnement de l'application</span></div><span class="text-sm font-bold text-white">${eur(st.pactAmount)}</span></div></div>
    <div><label class="text-xs font-semibold text-slate-300 block mb-2">Association soutenue (20 %)</label><div class="grid grid-cols-2 gap-2">
      ${(S.config.ngos || []).map((n) => `<button onclick="chooseNgo('${n}')" class="py-2.5 px-3 rounded-xl border text-xs font-semibold transition ${n === S.user.ngo ? 'border-[#00E5FF] bg-[#00E5FF]/10 text-[#00E5FF]' : 'border-white/10 bg-[#131722] text-slate-400'}">${n}</button>`).join('')}</div></div>
    <div><label class="text-xs font-semibold text-slate-300 block mb-2">Historique</label><div class="space-y-2">
      ${hist.length ? hist.map((p) => `<div class="bg-[#131722] border border-white/5 rounded-xl px-4 py-3 flex justify-between items-center"><div><span class="text-xs font-semibold text-white block">${esc(p.sport)}</span><span class="text-[11px] text-slate-500">${parseYmd(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} • ${p.time}</span></div>
        <span class="text-xs font-bold ${p.status === 'done' ? 'text-[#00E5FF]' : 'text-[#FF2A85]'}">${p.status === 'done' ? '✓ ' + p.stake + ' €' : '−' + p.stake + ' €'}</span></div>`).join('') : '<p class="text-xs text-slate-500">Aucune séance clôturée pour l\'instant.</p>'}</div></div></div>`;
}
async function chooseNgo(n) { try { const r = await api('PATCH', '/api/me', { ngo: n }); S.user = r.user; toast(`Association sélectionnée : ${n}`); viewImpact(); } catch (e) { toast(e.message); } }

/* --- Profil --- */
function viewProfile() {
  const u = S.user, notif = 'Notification' in window ? Notification.permission : 'unsupported';
  const prov = [u.hasPassword && 'E-mail', u.google && 'Google', u.apple && 'Apple'].filter(Boolean).join(' • ');
  const card = (t) => `<div class="bg-[#131722] border border-white/10 rounded-3xl p-5 space-y-3">${t}</div>`;
  $('main').innerHTML = `<div class="space-y-4 fade"><div><h2 class="text-xl font-bold text-white">Profil</h2><p class="text-xs text-slate-400 mt-0.5">${esc(u.email)} • ${prov}</p></div>
    ${card(`${field('pName', 'Prénom', 'text', '', `value="${esc(u.name)}" maxlength="60"`)}<button onclick="saveName()" class="w-full py-3 rounded-xl btn-neon-cyan text-xs font-bold">Enregistrer</button>`)}
    ${card(`<span class="text-xs font-semibold text-slate-300 block">Rappels de séance</span><p class="text-[11px] text-slate-400">Reçois une notification 30 min avant ta séance (app ouverte ou installée).</p>
      <button onclick="enableNotifs()" ${notif === 'granted' || notif === 'unsupported' ? 'disabled' : ''} class="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-slate-200">${notif === 'granted' ? '✓ Rappels activés' : notif === 'denied' ? 'Bloqués dans le navigateur' : 'Activer les rappels'}</button>`)}
    ${card(`<span class="text-xs font-semibold text-slate-300 block">${u.hasPassword ? 'Changer de mot de passe' : 'Définir un mot de passe'}</span>
      ${u.hasPassword ? field('pCur', 'Mot de passe actuel', 'password', '', 'autocomplete="current-password"') : ''}${field('pNew', 'Nouveau mot de passe', 'password', '8 caractères minimum', 'autocomplete="new-password"')}
      <button onclick="savePass()" class="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-slate-200">Mettre à jour</button>`)}
    <div id="installBox" class="hidden">${card(`<span class="text-xs font-semibold text-slate-300 block">Installer l'application</span><button onclick="installApp()" class="w-full py-3 rounded-xl btn-neon-pink text-xs font-bold">Ajouter à l'écran d'accueil</button>`)}</div>
    <button onclick="logout()" class="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-slate-200">Se déconnecter</button>
    <button onclick="deleteAccount()" class="w-full text-[11px] text-[#FF2A85]/80 py-2">Supprimer mon compte</button></div>`;
  if (deferredInstall) $('installBox').classList.remove('hidden');
}
async function saveName() { try { const r = await api('PATCH', '/api/me', { name: $('pName').value }); S.user = r.user; toast('Profil mis à jour'); renderShell(); renderView(); $('savedCounter').textContent = Math.round(S.stats.saved * 100) / 100 + ' €'; } catch (e) { toast(e.message); } }
async function savePass() { try { await api('POST', '/api/me/password', { current: $('pCur')?.value, password: $('pNew').value }); toast('Mot de passe mis à jour'); S.user.hasPassword = true; viewProfile(); } catch (e) { toast(e.message); } }
function deleteAccount() {
  openModal(`<div class="bg-[#131722] border border-[#FF2A85]/50 rounded-3xl p-6 w-full max-w-sm space-y-4 neon-border-pink"><h3 class="text-base font-bold text-white">Supprimer le compte ?</h3><p class="text-xs text-slate-400">Toutes tes séances et statistiques seront définitivement supprimées.</p>
    <div class="grid grid-cols-2 gap-2.5"><button onclick="closeModal()" class="py-3 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-slate-300">Annuler</button><button onclick="doDelete()" class="py-3 rounded-xl btn-neon-pink text-xs font-bold">Supprimer</button></div></div>`);
}
async function doDelete() { try { await api('DELETE', '/api/me'); closeModal(); logout(true); toast('Compte supprimé'); } catch (e) { toast(e.message); } }

/* --- rappels & PWA --- */
async function enableNotifs() { if (!('Notification' in window)) return; await Notification.requestPermission(); viewProfile(); }
let reminderTimer;
function startReminders() {
  clearInterval(reminderTimer);
  const check = () => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const sent = JSON.parse(localStorage.getItem('pact_reminded') || '[]');
    S.history.filter((p) => p.status === 'pending').forEach((p) => {
      const diff = startMs(p) - Date.now(), key = p.id + '@' + p.date + p.time;
      if (diff > 0 && diff <= 30 * 60000 && !sent.includes(key)) {
        new Notification(`PACT • ${p.sport} à ${p.time}`, { body: `Ta mise de ${p.stake} € est en jeu. Valide sur place !`, icon: '/icon-192.png' });
        sent.push(key); localStorage.setItem('pact_reminded', JSON.stringify(sent.slice(-50)));
      }
    });
  };
  reminderTimer = setInterval(() => { check(); if (S.user && S.view === 'agenda') refresh(); }, 60000); check();
}
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $('installBox')?.classList.remove('hidden'); });
async function installApp() { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('installBox')?.classList.add('hidden'); }
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.Capacitor) navigator.serviceWorker.register('/sw.js').catch(() => {});

/* ---------- démarrage ---------- */
(async function init() {
  try { S.config = await api('GET', '/api/config'); } catch (e) { S.config = {}; }
  const params = new URLSearchParams(location.search);
  if (params.get('reset')) { S.resetToken = params.get('reset'); return showAuth('reset'); }
  if (S.token) {
    try { const r = await api('GET', '/api/me'); S.user = r.user; return enterApp(); } catch { /* retombe sur login */ }
  }
  showAuth('login');
})();

