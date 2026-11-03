/* PACT — front (vanilla JS). API: window.PACT_API (config.js) pour l'app native, sinon même origine. */
const API = (window.PACT_API || '').replace(/\/$/, '');
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',') + ' €';
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DAYS_FULL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

const S = { token: localStorage.getItem('pact_token'), user: null, config: {}, view: 'agenda', weekOffset: 0, selected: ymd(new Date()),
  pacts: [], extEvents: [], series: [], stats: null, history: [], sport: 'Musculation', createDate: null, createTime: null, createPlace: null,
  recMode: 'none', recDays: [0, 2, 4], recWeeks: 4,
  theme: localStorage.getItem('pact_theme') || 'auto',
  lang: localStorage.getItem('pact_lang') || 'fr',
  autoCal: localStorage.getItem('pact_autocal') !== '0',
  authMode: 'login', busy: false, now: null };

function tr(fr, en, es) {
  if (S.lang === 'en') return en || fr;
  if (S.lang === 'es') return es || en || fr;
  return fr;
}
function getDaysShort() {
  if (S.lang === 'en') return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  if (S.lang === 'es') return ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  return DAYS;
}
function applyTheme() {
  const mode = S.theme || 'auto';
  const sysLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const isLight = mode === 'light' || (mode === 'auto' && sysLight);
  document.documentElement.classList.toggle('theme-light', isLight);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isLight ? '#F8FAFC' : '#0B0D13');
}
applyTheme();
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => { if (S.theme === 'auto') applyTheme(); });
}

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
  clearInterval(reminderTimer);
  S.token = null; S.user = null; S.pacts = []; S.history = []; S.stats = null;
  localStorage.removeItem('pact_token'); S.authMode = 'landing';
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  showLanding(); if (!silent) toast('Déconnecté');
}

/* ---------- LANDING PAGE (PRÉSENTATION DU CONCEPT) ---------- */
function showLanding() {
  S.authMode = 'landing';
  showRoot(`
    <div class="flex-1 overflow-y-auto no-scrollbar px-6 lg:px-14 safe-top pb-14 fade">
      <div class="max-w-5xl mx-auto">
        <!-- BARRE SUPÉRIEURE -->
        <header class="flex justify-between items-center py-2 mb-10 lg:mb-14">
          <div>
            <div class="flex items-center gap-1.5">
              <span class="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">PACT</span>
              <span class="w-2.5 h-2.5 rounded-full bg-[#00E5FF] shadow-[0_0_8px_#00E5FF]"></span>
            </div>
            <p class="text-[11px] text-slate-400 font-medium">L'engagement sportif</p>
          </div>
          <div class="flex items-center gap-2.5">
            <button onclick="showAuth('login')" class="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-semibold text-slate-200 transition">Se connecter</button>
            <button onclick="showAuth('register')" class="px-4 py-2.5 rounded-xl btn-neon-cyan text-xs font-bold active:scale-[0.98] transition">S'inscrire</button>
          </div>
        </header>

        <!-- HERO + APERÇU CARTE -->
        <section class="grid lg:grid-cols-[1.15fr_0.85fr] gap-8 lg:gap-12 items-center mb-14">
          <div class="space-y-5">
            <span class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#00E5FF]/10 border border-[#00E5FF]/30 text-[#00E5FF] text-[11px] font-bold tracking-wide">
              ⚡ LE PACTE QUI TE FAIT PASSER À L'ACTION
            </span>
            <h1 class="text-3xl sm:text-5xl font-extrabold text-white tracking-tight leading-[1.12]">
              Ne négocie plus avec ta <span class="text-[#00E5FF]">discipline</span>.
            </h1>
            <p class="text-sm sm:text-base text-slate-300 leading-relaxed">
              Planifie tes entraînements, engage une mise de <strong class="text-white">1 € à 10 €</strong> et valide ta présence sur place par GPS.
              <span class="text-[#00E5FF] font-semibold">Tu viens t'entraîner ? Tu gardes 100 % de ta mise.</span>
              Tu manques ta séance ? Ta mise soutient une ONG et l'application.
            </p>
            <div class="flex flex-col sm:flex-row gap-3 pt-2">
              <button onclick="showAuth('register')" class="py-4 px-7 rounded-2xl text-sm font-extrabold btn-neon-cyan active:scale-[0.99] transition">
                Commencer et créer mon compte →
              </button>
              <button onclick="showAuth('login')" class="py-4 px-6 rounded-2xl text-sm font-semibold bg-[#131722] border border-white/15 hover:border-white/30 text-white transition">
                J'ai déjà un compte
              </button>
            </div>
            <div class="grid grid-cols-3 gap-3 pt-3 border-t border-white/10">
              <div><span class="text-lg sm:text-xl font-extrabold text-[#00E5FF] block">0 €</span><span class="text-[11px] text-slate-400">si tu tiens ton engagement</span></div>
              <div><span class="text-lg sm:text-xl font-extrabold text-white block">1 € – 10 €</span><span class="text-[11px] text-slate-400">mise libre par séance</span></div>
              <div><span class="text-lg sm:text-xl font-extrabold text-[#FF2A85] block">20 % ONG</span><span class="text-[11px] text-slate-400">reversés en cas d'absence</span></div>
            </div>
          </div>

          <!-- APERÇU VISUEL D'UNE SÉANCE PACT -->
          <div class="bg-[#131722] border rounded-3xl p-6 neon-border-cyan space-y-4">
            <div class="flex justify-between items-center">
              <span class="text-xs font-semibold text-[#00E5FF]">Mercredi • 19:00</span>
              <span class="text-xs font-bold px-3 py-1 rounded-full bg-[#FF2A85]/15 text-[#FF2A85] border border-[#FF2A85]/30">Mise : 5 €</span>
            </div>
            <div>
              <h3 class="text-2xl font-bold text-white tracking-tight">Musculation</h3>
              <p class="text-xs text-slate-400 font-medium mt-0.5">Lieu : Fitness Park</p>
            </div>
            <div class="bg-[#0B0D13] border border-[#00E5FF]/30 rounded-xl p-3 flex justify-between items-center">
              <span class="text-xs text-slate-300">📍 Position GPS Salle</span>
              <span class="text-xs text-[#00E5FF] font-semibold">Confirmée (15 m)</span>
            </div>
            <div class="py-3 px-4 rounded-2xl bg-[#00E5FF]/10 border border-[#00E5FF]/30 text-center">
              <span class="text-xs font-bold text-[#00E5FF]">✓ Séance validée — 5 € protégés (aucun débit)</span>
            </div>
            <p class="text-[11px] text-slate-400 text-center">Joker inclus : <strong class="text-slate-200">+20 min de retard sans pénalité</strong> en cas d'imprévu.</p>
          </div>
        </section>

        <!-- COMMENT ÇA MARCHE EN 3 ÉTAPES -->
        <section class="mb-14">
          <div class="text-center max-w-xl mx-auto mb-7">
            <h2 class="text-xl sm:text-2xl font-extrabold text-white">Comment fonctionne PACT ?</h2>
            <p class="text-xs sm:text-sm text-slate-400 mt-1">Trois étapes simples pour transformer tes bonnes résolutions en habitude durable.</p>
          </div>
          <div class="grid md:grid-cols-3 gap-4">
            <div class="bg-[#131722] border border-white/10 rounded-3xl p-6 space-y-2.5">
              <span class="w-9 h-9 rounded-xl bg-[#00E5FF]/15 border border-[#00E5FF]/30 text-[#00E5FF] font-extrabold text-sm flex items-center justify-center">1</span>
              <h3 class="text-base font-bold text-white">Planifie ta séance</h3>
              <p class="text-xs text-slate-400 leading-relaxed">Choisis ton activité (Musculation, Running, CrossFit, Boxe, Yoga…), le lieu, la date, l'heure et fixe ta mise entre <strong class="text-slate-200">1 € et 10 €</strong>.</p>
            </div>
            <div class="bg-[#131722] border border-white/10 rounded-3xl p-6 space-y-2.5">
              <span class="w-9 h-9 rounded-xl bg-[#00E5FF]/15 border border-[#00E5FF]/30 text-[#00E5FF] font-extrabold text-sm flex items-center justify-center">2</span>
              <h3 class="text-base font-bold text-white">Valide ta présence sur place</h3>
              <p class="text-xs text-slate-400 leading-relaxed">Rends-toi à ton entraînement et valide ta séance avec le GPS (ouverture 1 h avant et jusqu'à 60 min après l'heure prévue).</p>
            </div>
            <div class="bg-[#131722] border border-white/10 rounded-3xl p-6 space-y-2.5">
              <span class="w-9 h-9 rounded-xl bg-[#FF2A85]/15 border border-[#FF2A85]/30 text-[#FF2A85] font-extrabold text-sm flex items-center justify-center">3</span>
              <h3 class="text-base font-bold text-white">Protège ta mise ou aide une ONG</h3>
              <p class="text-xs text-slate-400 leading-relaxed">Si tu valides, <strong class="text-[#00E5FF]">tu ne paies rien</strong>. Si tu manques la séance, ta mise est débitée : <strong class="text-[#00E5FF]">20 % pour l'ONG de ton choix</strong> et <strong class="text-[#FF2A85]">80 % pour PACT</strong>.</p>
            </div>
          </div>
        </section>

        <!-- IMPACT ASSOCIATIF & CALL TO ACTION FINAL -->
        <section class="bg-[#131722] border rounded-3xl p-6 sm:p-8 neon-border-pink flex flex-col md:flex-row items-center justify-between gap-6">
          <div class="space-y-2 text-center md:text-left">
            <span class="text-xs font-bold text-[#FF2A85] uppercase tracking-wider block">Engagement solidaire</span>
            <h2 class="text-xl sm:text-2xl font-extrabold text-white">Prêt à signer ton premier PACT ?</h2>
            <p class="text-xs text-slate-300 max-w-lg leading-relaxed">
              Soutiens l'association de ton choix (<strong class="text-white">UNICEF, WWF, Croix-Rouge, Médecins Sans Frontières</strong>) tout en construisant ta régularité sportive sur PC et mobile.
            </p>
          </div>
          <div class="flex flex-col sm:flex-row gap-3 w-full md:w-auto shrink-0">
            <button onclick="showAuth('register')" class="py-3.5 px-7 rounded-2xl text-xs sm:text-sm font-extrabold btn-neon-pink">
              S'inscrire gratuitement →
            </button>
            <button onclick="showAuth('login')" class="py-3.5 px-6 rounded-2xl text-xs sm:text-sm font-semibold bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10">
              Se connecter
            </button>
          </div>
        </section>
      </div>
    </div>
  `);
}

/* ---------- AUTH ---------- */
const inputCls = 'w-full bg-[#0B0D13] border border-white/10 rounded-xl px-3.5 py-3 text-sm text-white font-medium placeholder:text-slate-600';
const field = (id, label, type = 'text', ph = '', extra = '') => `<div><label class="text-xs font-semibold text-slate-300 block mb-1.5">${label}</label><input id="${id}" type="${type}" placeholder="${ph}" ${extra} class="${inputCls}" /></div>`;

function showRoot(html) { $('boot').classList.add('hidden'); const r = $('root'); r.classList.remove('hidden'); r.innerHTML = html; }

function authShell(inner) {
  return `<div class="flex-1 overflow-y-auto no-scrollbar px-6 lg:px-12 safe-top pb-6 flex flex-col fade">
    <div class="flex items-center justify-between mb-1 w-full max-w-md mx-auto">
      <button onclick="showLanding()" class="flex items-center gap-1.5 text-left">
        <span class="text-3xl font-extrabold tracking-tight text-white">PACT</span>
        <span class="w-2.5 h-2.5 rounded-full bg-[#00E5FF] shadow-[0_0_8px_#00E5FF]"></span>
      </button>
      <button onclick="showLanding()" class="text-xs font-semibold text-slate-400 hover:text-[#00E5FF] transition">← Présentation du concept</button>
    </div>
    <p class="text-xs text-slate-400 font-medium mb-7 w-full max-w-md mx-auto">L'engagement sportif</p>
    <div class="my-auto w-full max-w-md mx-auto">${inner}</div></div>`;
}

const googleSvg = '<svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.3-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.3-.4-3.9z"/></svg>';

const GENDERS = ['Homme', 'Femme', 'Autre', 'Ne pas préciser'];
const GOALS = ['Remise en forme', 'Prise de masse / Force', 'Perte de poids / Cardio', 'Performance & Compétition'];
const selectField = (id, label, opts, cur = '') => `<div><label class="text-xs font-semibold text-slate-300 block mb-1.5">${label}</label><select id="${id}" required class="${inputCls}"><option value="" disabled ${cur ? '' : 'selected'}>Choisir…</option>${opts.map((o) => `<option value="${esc(o)}" ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;

function showAuth(mode) {
  S.authMode = mode || S.authMode;
  const m = S.authMode;
  const params = new URLSearchParams(location.search);
  let body = '';
  if (m === 'login' || m === 'register') {
    body = `
      <h1 class="text-2xl font-bold text-white mb-1">${m === 'login' ? 'Content de te revoir' : 'Crée ton compte'}</h1>
      <p class="text-xs text-slate-400 mb-5">${m === 'login' ? 'Connecte-toi pour retrouver tes séances.' : 'Renseigne tes informations. Un e-mail de confirmation te sera envoyé.'}</p>
      <div class="space-y-2.5 mb-4">
        <div id="gBtn" class="flex justify-center min-h-[44px]"></div>
      </div>
      <div class="flex items-center gap-3 mb-4"><span class="flex-1 h-px bg-white/10"></span><span class="text-[11px] text-slate-500">ou par e-mail</span><span class="flex-1 h-px bg-white/10"></span></div>
      <form onsubmit="return submitAuth(event)" class="space-y-3">
        ${m === 'register' ? `
          <div class="grid grid-cols-2 gap-3">
            ${field('fFirst', 'Prénom', 'text', 'Ton prénom', 'autocomplete="given-name" required')}
            ${field('fLast', 'Nom', 'text', 'Ton nom', 'autocomplete="family-name" required')}
          </div>
          <div class="grid grid-cols-2 gap-3">
            ${field('fAge', 'Âge', 'number', 'ex. 24', 'min="13" max="100" required')}
            ${selectField('fGender', 'Genre', GENDERS)}
          </div>
          <div class="grid grid-cols-2 gap-3">
            ${field('fPhone', 'Téléphone', 'tel', '06 12 34 56 78', 'autocomplete="tel" required')}
            ${field('fCity', 'Ville', 'text', 'ex. Lyon', 'autocomplete="address-level2" required')}
          </div>
          ${selectField('fGoal', 'Objectif sportif', GOALS, 'Remise en forme')}
        ` : ''}
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
      <p class="text-xs text-slate-400 mb-5">Reçois un e-mail personnalisé pour en choisir un nouveau.</p>
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
    const isVerify = S.sentKind === 'verify';
    const uName = S.sentName || '';
    body = `<div class="space-y-4">
      <div class="bg-[#131722] border rounded-3xl p-6 neon-border-cyan text-center space-y-4">
        <div class="w-14 h-14 rounded-2xl bg-[#00E5FF]/10 border border-[#00E5FF]/30 flex items-center justify-center mx-auto text-2xl">✉️</div>
        <h1 class="text-xl font-bold text-white">Vérifie ta boîte mail${uName ? ', ' + esc(uName) : ''}</h1>
        <p class="text-xs text-slate-300 leading-relaxed">
          ${isVerify
            ? `Un e-mail de confirmation d'inscription t'a été envoyé par <b>no-reply</b> à l'adresse :`
            : `Un e-mail de réinitialisation t'a été envoyé par <b>no-reply</b> à l'adresse :`}
          <br><span class="text-[#00E5FF] font-bold text-sm block mt-1.5">${esc(S.sentTo || '')}</span>
        </p>
        <div class="bg-[#0B0D13] border border-white/10 rounded-2xl p-4 text-left space-y-1.5">
          <p class="text-xs text-slate-300 font-semibold">📌 Étape obligatoire :</p>
          <p class="text-[11px] text-slate-400 leading-relaxed">Ouvre ta messagerie (vérifie aussi tes spams / indésirables) et clique sur le lien contenu dans l'e-mail pour valider ton compte. Tu ne peux pas valider ton inscription sans cliquer sur le lien reçu par mail.</p>
        </div>
        ${isVerify ? `<button onclick="resendMail()" class="text-xs text-[#00E5FF] font-semibold hover:underline">Je n'ai rien reçu — Renvoyer l'e-mail</button>` : ''}
      </div>
      <button onclick="showAuth('login')" class="block mx-auto text-xs text-slate-400">← Retour à la connexion</button>
    </div>`;
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
      const firstName = $('fFirst').value.trim();
      const lastName = $('fLast').value.trim();
      const age = parseInt($('fAge').value, 10);
      const gender = $('fGender').value;
      const phone = $('fPhone').value.trim();
      const city = $('fCity').value.trim();
      const goal = $('fGoal').value;
      const fullName = `${firstName} ${lastName}`.trim();
      if (S.identityEnabled) {
        const ir = await fetch('/.netlify/identity/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, data: { full_name: fullName, first_name: firstName, last_name: lastName, age, gender, phone, city, goal } }),
        });
        if (!ir.ok) {
          const err = await ir.json().catch(() => ({}));
          throw new Error(err.msg || err.error_description || 'Impossible de créer ce compte.');
        }
      }
      const r = await api('POST', '/api/register', { email, password, firstName, lastName, age, gender, phone, city, goal });
      Object.assign(S, { sentTo: email, sentName: r.userName || firstName, sentKind: 'verify', devLink: null, mailSent: true });
      showAuth('sent');
    } else if (m === 'forgot') {
      const r = await api('POST', '/api/forgot', { email });
      Object.assign(S, { sentTo: email, sentName: r.userName || '', sentKind: 'reset', devLink: r.devLink, mailSent: r.sent });
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
  try { const r = await api('POST', '/api/resend', { email: S.sentTo }); S.devLink = r.devLink; S.mailSent = r.sent; toast(r.sent ? 'E-mail envoyé dans ta boîte !' : 'E-mail régénéré'); showAuth('sent'); } catch (e) { toast(e.message); }
}

function openMailConfigModal() {
  openModal(`<div class="bg-[#131722] border border-white/15 rounded-3xl p-6 w-full max-w-md space-y-4 fade">
    <div class="flex justify-between items-center border-b border-white/10 pb-3">
      <span class="text-sm font-bold text-white">✉️ Envoi d'e-mails personnalisés (SMTP)</span>
      <button onclick="closeModal()" class="text-xs text-slate-400 hover:text-white font-semibold">Fermer</button>
    </div>
    <p class="text-[11px] text-slate-300 leading-relaxed">Pour que chaque inscrit reçoive automatiquement l'e-mail personnalisé dans sa vraie boîte mail (Gmail, Outlook, etc.), renseigne un compte Gmail expéditeur et son <a href="https://myaccount.google.com/apppasswords" target="_blank" class="text-[#00E5FF] underline">mot de passe d'application Google</a> :</p>
    <form onsubmit="return saveMailConfig(event)" class="space-y-3">
      ${field('smtpHost', 'Serveur SMTP', 'text', 'smtp.gmail.com', 'value="smtp.gmail.com" required')}
      ${field('smtpUser', 'Adresse e-mail expéditrice', 'email', 'ton.adresse@gmail.com', 'required')}
      ${field('smtpPass', 'Mot de passe d\'application (16 caractères)', 'password', 'xxxx xxxx xxxx xxxx', 'required')}
      <button id="mailCfgBtn" class="w-full py-3.5 rounded-2xl text-xs font-bold btn-neon-cyan">Enregistrer et envoyer l'e-mail</button>
    </form>
  </div>`);
}

async function saveMailConfig(ev) {
  ev.preventDefault();
  const btn = $('mailCfgBtn'); setBusy(btn, true, 1);
  try {
    const r = await api('POST', '/api/config/oauth', {
      smtpHost: $('smtpHost').value.trim(),
      smtpUser: $('smtpUser').value.trim(),
      smtpPass: $('smtpPass').value.trim(),
    });
    S.config.mailConfigured = r.mailConfigured;
    closeModal();
    if (S.sentTo && S.sentKind === 'verify') await resendMail();
    else toast('Configuration e-mail enregistrée !');
  } catch (e) { toast(e.message); setBusy(btn, false); }
  return false;
}

/* --- Google OAuth Redirect --- */
function loadScript(src) { return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
async function initGoogleButton() {
  const holder = $('gBtn'); if (!holder) return;
  holder.innerHTML = `<button type="button" onclick="googleLogin()" class="w-full py-3 rounded-xl bg-[#131722] border border-white/15 hover:border-white/30 text-white text-sm font-semibold flex items-center justify-center gap-2 active:scale-[0.99] transition">${googleSvg} Continuer avec Google</button>`;
}

function googleLogin() {
  if (S.identityGoogle) {
    location.href = `${location.origin}/.netlify/identity/authorize?provider=google`;
    return;
  }
  if (S.config.googleClientId) {
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', S.config.googleClientId);
    u.searchParams.set('redirect_uri', location.origin);
    u.searchParams.set('response_type', 'token id_token');
    u.searchParams.set('scope', 'openid email profile');
    u.searchParams.set('nonce', Math.random().toString(36).slice(2));
    u.searchParams.set('prompt', 'select_account');
    location.href = u.toString();
    return;
  }
  openOAuthConfigModal();
}

function openOAuthConfigModal() {
  openModal(`<div class="bg-[#131722] border border-white/15 rounded-3xl p-6 w-full max-w-md space-y-4 fade">
    <div class="flex justify-between items-center border-b border-white/10 pb-3">
      <div class="flex items-center gap-2 text-sm font-bold text-white">${googleSvg}<span>Activer la redirection Google</span></div>
      <button onclick="closeModal()" class="text-xs text-slate-400 hover:text-white font-semibold">Fermer</button>
    </div>
    <div class="bg-[#0B0D13] border border-[#00E5FF]/30 rounded-2xl p-3.5 space-y-2">
      <span class="text-xs font-bold text-[#00E5FF] block">Option 1 (en 2 clics, sans Google Cloud) :</span>
      <p class="text-[11px] text-slate-300 leading-relaxed">Active <b>Netlify Identity</b> sur ton projet Netlify puis ajoute le fournisseur <b>Google (Default configuration)</b> :</p>
      <a href="https://app.netlify.com/projects/pact-application/identity" target="_blank" rel="noopener" class="block text-center py-2.5 px-3 rounded-xl btn-neon-cyan text-xs font-bold">Ouvrir Netlify Identity ↗</a>
    </div>
    <form onsubmit="return saveOAuthConfig(event)" class="space-y-3">
      <span class="text-xs font-bold text-slate-200 block">Option 2 : ID Client OAuth Google</span>
      <p class="text-[11px] text-slate-400 leading-relaxed">Crée un ID client OAuth Web sur <a href="https://console.cloud.google.com/apis/credentials" target="_blank" class="text-[#00E5FF] underline">Google Cloud Console</a> avec l'URI de redirection <code class="text-white">${esc(location.origin)}</code> :</p>
      ${field('oauthCid', 'GOOGLE_CLIENT_ID', 'text', 'xxxx.apps.googleusercontent.com', 'required')}
      <button id="oauthSaveBtn" class="w-full py-3.5 rounded-2xl text-xs font-bold btn-neon-cyan">Enregistrer et rediriger vers Google →</button>
    </form>
  </div>`);
}

async function saveOAuthConfig(ev) {
  ev.preventDefault();
  const btn = $('oauthSaveBtn'), val = $('oauthCid').value.trim();
  setBusy(btn, true, 1);
  try {
    const r = await api('POST', '/api/config/oauth', { googleClientId: val });
    S.config.googleClientId = r.googleClientId;
    closeModal();
    googleLogin();
  } catch (e) { toast(e.message); setBusy(btn, false); }
  return false;
}

/* ---------- APP & ONBOARDING OBLIGATOIRE (ex. Google) ---------- */
function showOnboarding() {
  const u = S.user || {};
  showRoot(authShell(`
    <div class="bg-[#131722] border rounded-3xl p-6 neon-border-cyan space-y-4">
      <div>
        <span class="text-[10px] font-bold uppercase tracking-wider text-[#00E5FF] block">Étape finale obligatoire</span>
        <h1 class="text-xl font-bold text-white mt-0.5">Complète ton profil PACT</h1>
        <p class="text-xs text-slate-400 mt-1">Renseigne tes informations personnelles pour finaliser ton inscription (${esc(u.email)}).</p>
      </div>
      <form onsubmit="return submitOnboarding(event)" class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          ${field('obFirst', 'Prénom', 'text', 'Ton prénom', `value="${esc(u.firstName || '')}" required`)}
          ${field('obLast', 'Nom', 'text', 'Ton nom', `value="${esc(u.lastName || '')}" required`)}
        </div>
        <div class="grid grid-cols-2 gap-3">
          ${field('obAge', 'Âge', 'number', 'ex. 24', `min="13" max="100" value="${u.age || ''}" required`)}
          ${selectField('obGender', 'Genre', GENDERS, u.gender || '')}
        </div>
        <div class="grid grid-cols-2 gap-3">
          ${field('obPhone', 'Téléphone', 'tel', '06 12 34 56 78', `value="${esc(u.phone || '')}" required`)}
          ${field('obCity', 'Ville', 'text', 'ex. Lyon', `value="${esc(u.city || '')}" required`)}
        </div>
        ${selectField('obGoal', 'Objectif sportif', GOALS, u.goal || 'Remise en forme')}
        <p id="obErr" class="hidden text-xs text-[#FF2A85] font-semibold"></p>
        <button id="obBtn" class="w-full py-3.5 rounded-2xl text-sm font-bold btn-neon-cyan">Valider et accéder à PACT →</button>
      </form>
      <button onclick="logout()" class="block mx-auto text-xs text-slate-500 hover:text-slate-300">Se déconnecter</button>
    </div>
  `));
}

async function submitOnboarding(ev) {
  ev.preventDefault();
  const btn = $('obBtn'); setBusy(btn, true, 1);
  try {
    const r = await api('PATCH', '/api/me', {
      firstName: $('obFirst').value.trim(),
      lastName: $('obLast').value.trim(),
      age: parseInt($('obAge').value, 10),
      gender: $('obGender').value,
      phone: $('obPhone').value.trim(),
      city: $('obCity').value.trim(),
      goal: $('obGoal').value,
    });
    S.user = r.user;
    toast('Profil complété ! Bienvenue sur PACT 🎉');
    await enterApp();
  } catch (e) {
    const err = $('obErr'); if (err) { err.textContent = e.message; err.classList.remove('hidden'); }
    setBusy(btn, false);
  }
  return false;
}

async function enterApp() {
  if (!S.user.profileComplete) {
    showOnboarding();
    return;
  }
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
    S.pacts = w.pacts; S.extEvents = w.extEvents || []; S.series = w.series || [];
    S.stats = w.stats; S.history = h.pacts; S.now = w.now;
    renderView(); $('savedCounter') && ($('savedCounter').textContent = Math.round(S.stats.saved * 100) / 100 + ' €');
  } catch (e) { toast(e.message); }
}

const ADMIN_EMAILS = ['eliottlcx@gmail.com', 'mariecomer158@gmail.com'];
function isAdminUser() {
  return Boolean(S.user && ADMIN_EMAILS.includes(String(S.user.email || '').trim().toLowerCase()));
}

function renderShell() {
  const initials = ((S.user.firstName?.[0] || S.user.name?.[0] || 'P') + (S.user.lastName?.[0] || '')).toUpperCase();
  const colsCls = isAdminUser() ? 'grid-cols-4' : 'grid-cols-3';
  showRoot(`<div class="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[250px_1fr] lg:grid-rows-[auto_minmax(0,1fr)]">
    <header class="safe-top px-6 lg:px-10 pb-4 lg:col-start-2 lg:row-start-1 flex justify-between items-center z-10 gap-3">
      <div><div class="flex items-center gap-1.5"><span class="text-2xl font-extrabold tracking-tight text-white">PACT</span><span class="w-2 h-2 rounded-full bg-[#00E5FF] shadow-[0_0_8px_#00E5FF]"></span></div>
      <p class="text-xs text-slate-400 font-medium">${tr('Salut', 'Hi', 'Hola')} ${esc(S.user.firstName || S.user.name.split(' ')[0])} 👋</p></div>
      <div class="flex items-center gap-2.5">
        <div class="text-right bg-[#131722] border border-white/10 px-3.5 py-2 rounded-2xl"><span class="text-[10px] text-slate-400 font-medium block">${tr('Mises protégées', 'Protected stakes', 'Apuestas protegidas')}</span><span id="savedCounter" class="text-sm font-bold text-[#00E5FF]">— €</span></div>
        <button id="hdrProfileBtn" onclick="setView('profile')" title="${tr('Options de profil', 'Profile options', 'Opciones de perfil')}" class="flex items-center gap-2 bg-[#131722] border border-white/15 hover:border-[#00E5FF]/50 px-3 py-2 rounded-2xl transition">
          <span class="w-7 h-7 rounded-xl bg-[#00E5FF]/15 border border-[#00E5FF]/40 text-[#00E5FF] text-xs font-extrabold flex items-center justify-center">${esc(initials)}</span>
          <span class="text-xs font-semibold text-slate-200 hidden sm:inline">${tr('Profil', 'Profile', 'Perfil')}</span>
        </button>
      </div>
    </header>
    <main id="main" class="flex-1 min-h-0 overflow-y-auto no-scrollbar px-6 lg:px-10 py-3 lg:pb-10 lg:col-start-2 lg:row-start-2"></main>
    <nav id="nav" class="bg-[#0B0D13]/95 border-t border-white/10 px-4 sm:px-6 pt-3 safe-bottom grid ${colsCls} gap-2 lg:flex lg:flex-col lg:justify-start lg:border-t-0 lg:border-r lg:p-6 lg:pt-28 lg:gap-2 lg:col-start-1 lg:row-start-1 lg:row-span-2 lg:row-end-3"></nav></div>`);
  renderNav();
}

function renderNav() {
  const tabs = [['agenda', tr('Agenda', 'Schedule', 'Agenda')], ['create', tr('+ Séance', '+ Session', '+ Sesión')], ['impact', tr('Impact', 'Impact', 'Impacto')]];
  if (isAdminUser()) tabs.push(['admin', '⚙️ Admin']);
  $('nav').innerHTML = tabs.map(([k, l]) => `<button onclick="setView('${k}')" class="py-3 lg:py-3 lg:px-4 lg:text-left lg:text-sm rounded-xl text-xs font-semibold border transition ${S.view === k ? 'border-[#00E5FF]/50 text-[#00E5FF] bg-[#00E5FF]/10' : 'border-white/10 text-slate-400 hover:text-white'}">${l}</button>`).join('');
  const hdrBtn = $('hdrProfileBtn');
  if (hdrBtn) {
    hdrBtn.className = `flex items-center gap-2 bg-[#131722] border px-3 py-2 rounded-2xl transition ${(S.view === 'profile' || S.view === 'settings') ? 'border-[#00E5FF] bg-[#00E5FF]/10' : 'border-white/15 hover:border-[#00E5FF]/50'}`;
  }
}

function setView(v) { S.view = v; renderNav(); renderView(); $('main').scrollTop = 0; if (v === 'impact') refresh(); }
function renderView() { if (!$('main')) return; ({ agenda: viewAgenda, create: viewCreate, impact: viewImpact, profile: viewProfile, settings: viewSettings, admin: viewAdmin })[S.view]?.(); }

/* --- Agenda --- */
function viewAgenda() {
  const wd = weekDays(), today = ymd(new Date());
  const sel = S.selected, selDate = parseYmd(sel);
  const daysShort = getDaysShort();
  const bar = wd.map((d, i) => {
    const k = ymd(d), list = S.pacts.filter((p) => p.date === k);
    let dot = 'bg-slate-700';
    if (list.length) dot = list.some((p) => p.status === 'pending') ? 'bg-white' : list.every((p) => p.status === 'done') ? 'bg-[#00E5FF] shadow-[0_0_6px_#00E5FF]' : 'bg-[#FF2A85] shadow-[0_0_6px_#FF2A85]';
    return `<button onclick="selectDay('${k}')" class="py-2.5 rounded-2xl border transition flex flex-col items-center ${k === sel ? 'border-[#00E5FF] bg-[#00E5FF]/10 text-white' : 'border-white/5 bg-[#131722] text-slate-400'}">
      <span class="text-[10px] font-medium">${daysShort[i]}</span><span class="text-xs font-bold mt-0.5 ${k === today ? 'text-[#00E5FF]' : ''}">${String(d.getDate()).padStart(2, '0')}</span><span class="w-1.5 h-1.5 rounded-full mt-1.5 ${dot}"></span></button>`;
  }).join('');
  const list = S.pacts.filter((p) => p.date === sel);
  const dayIdx = (selDate.getDay() + 6) % 7;
  const cards = list.length ? list.map(pactCard).join('') : `
    <div class="bg-[#131722] border border-white/10 rounded-3xl p-6">
      <div class="flex justify-between items-center mb-4"><span class="text-xs font-semibold text-slate-400">${DAYS_FULL[dayIdx]} • ${tr('Repos', 'Rest', 'Descanso')}</span><span class="text-xs px-3 py-1 rounded-full bg-white/5 text-slate-400 border border-white/10">${tr('Aucune mise', 'No stake', 'Sin apuesta')}</span></div>
      <h2 class="text-2xl font-bold text-white">${tr('Jour de repos', 'Rest day', 'Día de descanso')}</h2><p class="text-xs text-slate-400 mt-1">${tr('Aucun entraînement PACT prévu ce jour', 'No PACT workout scheduled today', 'Ningún entrenamiento PACT previsto hoy')}</p>
      <button onclick="openCreateForDay('${sel}')" class="w-full mt-6 py-3.5 rounded-2xl text-xs font-semibold border border-[#00E5FF]/50 text-[#00E5FF] hover:bg-[#00E5FF]/10 transition">${tr('+ Ajouter une séance ce jour', '+ Add a session on this day', '+ Añadir una sesión este día')}</button></div>`;
  $('main').innerHTML = `<div class="space-y-5 fade">
    <div><div class="flex justify-between items-center mb-3">
      <button onclick="shiftWeek(-1)" class="w-8 h-8 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-sm hover:text-white transition">‹</button>
      <div class="text-center"><span class="text-xs font-semibold text-slate-300 block">${MONTHS[wd[0].getMonth()]}${wd[0].getMonth() !== wd[6].getMonth() ? ' / ' + MONTHS[wd[6].getMonth()] : ''} ${wd[6].getFullYear()}</span><span class="text-[11px] font-medium text-slate-500">${tr('Semaine', 'Week', 'Semana')} ${isoWeek(wd[0])}${S.weekOffset === 0 ? ' • ' + tr('en cours', 'current', 'actual') : ''}</span></div>
      <button onclick="shiftWeek(1)" class="w-8 h-8 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-sm hover:text-white transition">›</button>
      </div>
      <div class="grid grid-cols-7 gap-1.5">${bar}</div></div>
    ${cards}
    <div class="bg-[#131722]/70 border border-white/5 rounded-2xl p-4"><p class="text-xs text-slate-400 leading-relaxed"><strong class="text-white font-semibold">${tr('Fonctionnement :', 'How it works:', 'Funcionamiento:')}</strong> ${tr(`valide ta séance pour conserver ta mise (ouverture 1 h avant, jusqu'à ${S.config.graceMin || 60} min après l'heure). Sinon, elle est débitée`, `validate your session to keep your stake (opens 1h before, up to ${S.config.graceMin || 60} min after). Otherwise it is charged`, `valida tu sesión para conservar tu apuesta (abre 1h antes, hasta ${S.config.graceMin || 60} min después). Si no, se cobra`)} (<span class="text-[#00E5FF]">20 % ${tr('pour une ONG', 'to an NGO', 'para una ONG')}</span>, <span class="text-[#FF2A85]">80 % ${tr('pour PACT', 'for PACT', 'para PACT')}</span>).</p></div></div>`;
}

function pactCard(p) {
  const d = parseYmd(p.date), dayName = DAYS_FULL[(d.getDay() + 6) % 7];
  const start = startMs(p), now = Date.now(), open = now >= start - (S.config.openBeforeMin || 60) * 60000;
  const failed = p.status === 'failed', done = p.status === 'done';
  const badge = done ? [`${p.stake} € ${tr('protégés', 'saved', 'protegidos')}`, 'bg-[#00E5FF]/15 text-[#00E5FF] border-[#00E5FF]/30'] : failed ? [`${tr('Perdu', 'Lost', 'Perdido')} : -${p.stake} €`, 'bg-[#FF2A85]/15 text-[#FF2A85] border-[#FF2A85]/30'] : [`${tr('Mise', 'Stake', 'Apuesta')} : ${p.stake} €`, 'bg-[#FF2A85]/15 text-[#FF2A85] border-[#FF2A85]/30'];
  const recBadge = p.series_id ? `<span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#00E5FF]/10 border border-[#00E5FF]/30 text-[#00E5FF] ml-2">🔁 ${esc(p.recurrence_label || tr('Récurrent', 'Recurring', 'Recurrente'))}</span>` : '';
  let actions = '';
  if (p.status === 'pending') {
    const canCancel = now <= start - (S.config.openBeforeMin || 60) * 60000;
    actions = `<button onclick="openValidation(${p.id})" ${open ? '' : 'disabled'} class="w-full py-3.5 rounded-2xl text-xs font-bold btn-neon-cyan active:scale-[0.99] transition">${open ? tr('Valider ma séance', 'Validate my session', 'Validar mi sesión') : `${tr('Validation dès', 'Validation from', 'Validación desde')} ${new Date(start - 3600000).toTimeString().slice(0, 5)}`}</button>
      <div class="grid grid-cols-2 gap-2.5 pt-1">
        <button onclick="delayPact(${p.id})" ${p.delayed ? 'disabled' : ''} class="py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 text-xs font-semibold hover:bg-white/10 transition">${p.delayed ? tr('Retard utilisé', 'Delay used', 'Retraso usado') : tr('Retard +20 min', 'Delay +20 min', 'Retraso +20 min')}</button>
        <button onclick="missPact(${p.id})" class="py-2.5 rounded-xl bg-[#FF2A85]/10 border border-[#FF2A85]/30 text-[#FF2A85] text-xs font-semibold hover:bg-[#FF2A85]/20 transition">${tr('Passer la séance', 'Skip session', 'Saltar sesión')}</button></div>
      ${canCancel ? (p.series_id
        ? `<div class="flex justify-center gap-4 pt-1 text-[11px]"><button onclick="deletePact(${p.id})" class="text-slate-500 hover:text-slate-300">${tr('Annuler ce jour', 'Cancel today', 'Cancelar hoy')}</button><button onclick="deletePactSeries(${p.id})" class="text-[#FF2A85]/80 hover:text-[#FF2A85]">${tr('Arrêter la série', 'Stop series', 'Detener serie')}</button></div>`
        : `<button onclick="deletePact(${p.id})" class="w-full text-[11px] text-slate-500 hover:text-slate-300 pt-1">${tr('Annuler la séance (sans frais)', 'Cancel session (free)', 'Cancelar sesión (gratis)')}</button>`) : ''}`;
  } else if (done) {
    actions = `<div class="py-3 px-4 rounded-2xl bg-[#00E5FF]/10 border border-[#00E5FF]/30 text-center space-y-0.5"><span class="text-xs font-semibold text-[#00E5FF] block">${tr('Séance validée — Aucun débit', 'Session validated — No charge', 'Sesión validada — Sin cargo')}</span>${p.log_title ? `<span class="text-[11px] text-slate-300 block">${esc(p.log_title)}${p.log_detail ? ' • ' + esc(p.log_detail) : ''}</span>` : ''}</div>`;
  } else {
    actions = `<div class="py-3 px-4 rounded-2xl bg-[#FF2A85]/10 border border-[#FF2A85]/30 text-center space-y-0.5"><span class="text-xs font-semibold text-[#FF2A85] block">${p.auto ? tr('Séance non validée à temps', 'Session not validated in time', 'Sesión no validada a tiempo') : tr('Séance manquée', 'Missed session', 'Sesión perdida')} — ${tr('Mise débitée', 'Stake charged', 'Apuesta cobrada')}</span>
      <span class="text-[11px] text-slate-300 block">${eur(p.stake * 0.2)} ${tr('pour', 'for', 'para')} ${esc(p.ngo || S.user.ngo)} • ${eur(p.stake * 0.8)} ${tr('pour PACT', 'for PACT', 'para PACT')}</span></div>`;
  }
  return `<div class="bg-[#131722] border rounded-3xl p-6 transition-all ${failed ? 'neon-border-pink' : 'neon-border-cyan'}">
    <div class="flex justify-between items-center mb-4"><div class="flex items-center flex-wrap gap-y-1"><span class="text-xs font-semibold text-[#00E5FF]">${dayName} • ${p.time}${p.delayed ? ' (+20 min)' : ''}</span>${recBadge}</div><span class="text-xs font-bold px-3 py-1 rounded-full border ${badge[1]}">${badge[0]}</span></div>
    <h2 class="text-2xl font-bold text-white tracking-tight">${esc(p.sport)}</h2>
    <p class="text-xs text-slate-400 font-medium mt-1">${p.place ? tr('Lieu : ', 'Location: ', 'Lugar: ') + esc(p.place) : tr('Lieu non précisé', 'Location not specified', 'Lugar no especificado')}</p>
    <div class="mt-6 space-y-2.5">${actions}</div></div>`;
}

function selectDay(k) { S.selected = k; viewAgenda(); }
async function shiftWeek(n) {
  S.weekOffset += n; const wd = weekDays(); S.selected = ymd(S.weekOffset === 0 ? new Date() : wd[0]); await refresh();
}
function openCreateForDay(k, recMode = 'none') {
  S.createDate = k;
  S.recMode = recMode;
  setView('create');
}

/* --- Sous-page du Profil : Options de l'application (Thème, Langue & Lien ICS Calendrier Apple / Google Agenda) --- */
function getCalFeedUrls() {
  const tok = S.user?.calToken || '';
  const httpsUrl = `${location.origin}/api/calendar/${tok}.ics`;
  const webcalUrl = httpsUrl.replace(/^https?:\/\//i, 'webcal://');
  const gcalSubscribeUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`;
  return { tok, httpsUrl, webcalUrl, gcalSubscribeUrl };
}

function setAppTheme(t) {
  S.theme = t;
  localStorage.setItem('pact_theme', t);
  applyTheme();
  if (S.view === 'settings') viewSettings();
  toast(t === 'light' ? tr('Thème Clair activé ☀️', 'Light theme enabled ☀️', 'Tema claro activado ☀️') : t === 'dark' ? tr('Thème Sombre activé 🌑', 'Dark theme enabled 🌑', 'Tema oscuro activado 🌑') : tr('Thème automatique selon le téléphone 📱', 'Auto theme (system) 📱', 'Tema automático según el teléfono 📱'));
}

function setAppLang(l) {
  S.lang = l;
  localStorage.setItem('pact_lang', l);
  renderShell();
  renderView();
  toast(l === 'en' ? 'Language set to English 🇬🇧' : l === 'es' ? 'Idioma cambiado a Español 🇪🇸' : 'Langue définie sur Français 🇫🇷');
}

function viewSettings() {
  const { webcalUrl, gcalSubscribeUrl } = getCalFeedUrls();
  const themes = [
    ['dark', '🌑', tr('Noir (Sombre)', 'Black (Dark)', 'Negro (Oscuro)'), tr('Fond noir signature PACT', 'PACT signature dark background', 'Fondo negro PACT')],
    ['light', '☀️', tr('Blanc (Clair)', 'White (Light)', 'Blanco (Claro)'), tr('Fond blanc lumineux', 'Bright white background', 'Fondo blanco luminoso')],
    ['auto', '📱', tr('Automatique', 'Automatic', 'Automático'), tr('Selon le réglage du téléphone', 'Matches your phone settings', 'Según el ajuste del teléfono')]
  ];
  const langs = [
    ['fr', '🇫🇷', 'Français'],
    ['en', '🇬🇧', 'English'],
    ['es', '🇪🇸', 'Español']
  ];

  $('main').innerHTML = `<div class="space-y-5 fade">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-xl font-bold text-white">⚙️ ${tr("Options de l'application", 'Application Settings', 'Opciones de la aplicación')}</h2>
        <p class="text-xs text-slate-400 mt-0.5">${tr('Thème, langue et liaison automatique avec ton calendrier.', 'Theme, language, and automatic calendar link.', 'Tema, idioma y conexión automática con tu calendario.')}</p>
      </div>
      <button onclick="setView('profile')" class="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-slate-300 hover:text-white">← ${tr('Profil', 'Profile', 'Perfil')}</button>
    </div>

    <!-- 1. THÈME DE L'APPLICATION (NOIR / BLANC / AUTOMATIQUE) -->
    <div class="bg-[#131722] border border-white/10 rounded-3xl p-5 space-y-3">
      <div>
        <span class="text-xs font-bold uppercase tracking-wider text-[#00E5FF] block">🎨 ${tr("Thème de l'application", 'App Theme', 'Tema de la aplicación')}</span>
        <p class="text-[11px] text-slate-400 mt-0.5">${tr("Choisis entre le fond noir, le fond blanc ou l'adaptation automatique à ton téléphone.", 'Choose between dark mode, light mode, or automatic phone detection.', 'Elige entre fondo negro, fondo blanco o automático según tu teléfono.')}</p>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        ${themes.map(([key, icon, title, sub]) => `
          <button onclick="setAppTheme('${key}')" class="p-3.5 rounded-2xl border text-left transition ${S.theme === key ? 'border-[#00E5FF] bg-[#00E5FF]/10' : 'border-white/10 bg-[#0B0D13] hover:border-white/25'}">
            <div class="flex items-center justify-between mb-1">
              <span class="text-base">${icon}</span>
              ${S.theme === key ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#00E5FF]/20 text-[#00E5FF]">${tr('Actif', 'Active', 'Activo')}</span>` : ''}
            </div>
            <span class="text-xs font-bold text-white block">${title}</span>
            <span class="text-[11px] text-slate-400 block mt-0.5">${sub}</span>
          </button>`).join('')}
      </div>
    </div>

    <!-- 2. LANGUE DE L'APPLICATION -->
    <div class="bg-[#131722] border border-white/10 rounded-3xl p-5 space-y-3">
      <div>
        <span class="text-xs font-bold uppercase tracking-wider text-[#00E5FF] block">🌍 ${tr("Langue de l'application", 'App Language', 'Idioma de la aplicación')}</span>
        <p class="text-[11px] text-slate-400 mt-0.5">${tr("Change la langue d'affichage de PACT à tout moment.", 'Change the display language of PACT at any time.', 'Cambia el idioma de visualización de PACT en cualquier momento.')}</p>
      </div>
      <div class="grid grid-cols-3 gap-2.5">
        ${langs.map(([code, flag, label]) => `
          <button onclick="setAppLang('${code}')" class="py-3 px-3 rounded-2xl border text-xs font-bold flex items-center justify-center gap-2 transition ${S.lang === code ? 'border-[#00E5FF] bg-[#00E5FF]/10 text-[#00E5FF]' : 'border-white/10 bg-[#0B0D13] text-slate-300 hover:border-white/25'}">
            <span class="text-base">${flag}</span>
            <span>${label}</span>
          </button>`).join('')}
      </div>
    </div>

    <!-- 3. SYNCHRONISATION AUTOMATIQUE CALENDRIER (CALENDRIER APPLE / GOOGLE AGENDA) -->
    <div class="bg-[#131722] border border-[#00E5FF]/30 rounded-3xl p-5 space-y-4">
      <div>
        <span class="text-xs font-bold uppercase tracking-wider text-[#00E5FF] block">📅 ${tr('Relier mon agenda PACT à mon calendrier', 'Link my PACT schedule to my calendar', 'Vincular mi agenda PACT a mi calendario')}</span>
        <p class="text-[11px] text-slate-400 mt-0.5 leading-relaxed">${tr("Clique une seule fois sur ton calendrier ci-dessous pour le relier via ton flux ICS personnel. Toutes tes séances PACT s'y mettront ensuite toutes seules automatiquement.", 'Click your calendar once below to link it via your personal ICS feed. All your PACT sessions will then sync automatically.', 'Haz clic una sola vez en tu calendario abajo para vincularlo mediante tu enlace ICS personal. Todas tus sesiones PACT se sincronizarán solas.')}</p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <a href="${esc(webcalUrl)}" class="py-4 px-4 rounded-2xl btn-neon-cyan text-xs font-extrabold flex items-center justify-center gap-2.5 transition active:scale-[0.99] text-center">
          🍎 ${tr('Calendrier Apple', 'Apple Calendar', 'Calendario Apple')}
        </a>
        <a href="${esc(gcalSubscribeUrl)}" target="_blank" rel="noopener" class="py-4 px-4 rounded-2xl bg-[#0B0D13] border border-[#00E5FF]/50 hover:bg-[#00E5FF]/10 text-xs font-extrabold text-white flex items-center justify-center gap-2.5 transition active:scale-[0.99] text-center">
          📅 ${tr('Google Agenda', 'Google Calendar', 'Google Calendar')}
        </a>
      </div>
    </div>
  </div>`;
}

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
async function deletePactSeries(id) { try { await api('DELETE', `/api/pacts/${id}?scope=series`); toast('Série récurrente annulée'); await refresh(); } catch (e) { toast(e.message); } }

/* --- Création & Récurrence --- */
function viewCreate() {
  const date = S.createDate || S.selected, today = ymd(new Date());
  const timeVal = S.createTime || '19:00';
  const placeVal = S.createPlace || '';
  const sports = (S.config.sports || ['Musculation', 'Running', 'CrossFit', 'Boxe']);
  const recModes = [['none', tr('Une seule fois', 'Once', 'Una sola vez')], ['daily', tr('Tous les jours', 'Every day', 'Todos los días')], ['weekly', tr('Jours au choix', 'Selected days', 'Días a elegir')]];
  const weekOpts = [1, 2, 4, 8];
  const daysShort = getDaysShort();

  $('main').innerHTML = `<div class="space-y-5 fade"><div><h2 class="text-xl font-bold text-white">${tr('Nouvel entraînement', 'New workout', 'Nuevo entrenamiento')}</h2><p class="text-xs text-slate-400 mt-0.5">${tr('Planifie une séance unique ou une routine récurrente dans ton agenda.', 'Schedule a single session or a recurring routine in your calendar.', 'Planifica una sesión única o una rutina recurrente en tu agenda.')}</p></div>
    <div class="space-y-4 bg-[#131722] border border-white/10 rounded-3xl p-5">
      <div><label class="text-xs font-semibold text-slate-300 block mb-2">${tr('Activité', 'Activity', 'Actividad')}</label><div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
        ${sports.map((s) => `<button type="button" onclick="selectSport('${s}')" data-sport="${s}" class="sport-btn py-2.5 px-3 rounded-xl border text-xs font-semibold ${s === S.sport ? 'border-[#00E5FF] bg-[#00E5FF]/10 text-[#00E5FF]' : 'border-white/10 bg-white/5 text-slate-400'}">${s}</button>`).join('')}</div></div>
      ${field('inPlace', tr('Lieu', 'Location', 'Lugar'), 'text', 'ex. Fitness Park, Parc de la Tête d\'Or', `maxlength="120" value="${esc(placeVal)}"`)}
      <div class="grid grid-cols-2 gap-3">
        <div><label class="text-xs font-semibold text-slate-300 block mb-1.5">${tr('Date de début', 'Start date', 'Fecha de inicio')}</label><input id="inDate" type="date" min="${today}" value="${date < today ? today : date}" class="w-full bg-[#0B0D13] border border-white/10 rounded-xl px-3 py-2.5 text-xs font-semibold text-white" /></div>
        <div><label class="text-xs font-semibold text-slate-300 block mb-1.5">${tr('Heure', 'Time', 'Hora')}</label><input id="inTime" type="time" value="${esc(timeVal)}" class="w-full bg-[#0B0D13] border border-white/10 rounded-xl px-3 py-2.5 text-xs font-semibold text-white" /></div></div>

      <!-- RÉCURRENCE DANS L'AGENDA -->
      <div class="pt-3 border-t border-white/10 space-y-3">
        <div class="flex items-center justify-between">
          <label class="text-xs font-semibold text-slate-300">🔁 ${tr("Récurrence dans l'agenda", 'Recurrence in schedule', 'Recurrencia en la agenda')}</label>
          <span class="text-[11px] text-[#00E5FF] font-semibold" id="recHint">${S.recMode === 'daily' ? tr('Tous les jours à cette heure', 'Every day at this time', 'Todos los días a esta hora') : S.recMode === 'weekly' ? tr('Chaque semaine aux jours choisis', 'Weekly on selected days', 'Cada semana en los días elegidos') : tr('Séance unique', 'Single session', 'Sesión única')}</span>
        </div>
        <div class="grid grid-cols-3 gap-2">
          ${recModes.map(([m, lbl]) => `<button type="button" onclick="selectRecMode('${m}')" data-rmode="${m}" class="rec-mode-btn py-2.5 px-2 rounded-xl border text-xs font-semibold transition ${S.recMode === m ? 'border-[#00E5FF] bg-[#00E5FF]/10 text-[#00E5FF]' : 'border-white/10 bg-[#0B0D13] text-slate-400'}">${lbl}</button>`).join('')}
        </div>

        <div id="recDaysBox" class="${S.recMode === 'weekly' ? '' : 'hidden'} space-y-1.5">
          <label class="text-[11px] text-slate-400 block">${tr("Jours d'entraînement :", 'Training days:', 'Días de entrenamiento:')}</label>
          <div class="grid grid-cols-7 gap-1.5">
            ${daysShort.map((d, idx) => `<button type="button" onclick="toggleRecDay(${idx})" data-rday="${idx}" class="rec-day-btn py-2 rounded-xl border text-xs font-bold transition ${S.recDays.includes(idx) ? 'border-[#00E5FF] bg-[#00E5FF]/15 text-[#00E5FF]' : 'border-white/10 bg-[#0B0D13] text-slate-400'}">${d}</button>`).join('')}
          </div>
        </div>

        <div id="recWeeksBox" class="${S.recMode === 'none' ? 'hidden' : ''} space-y-1.5">
          <label class="text-[11px] text-slate-400 block">${tr('Durée de la récurrence :', 'Recurrence duration:', 'Duración de la recurrencia:')}</label>
          <div class="grid grid-cols-4 gap-2">
            ${weekOpts.map((w) => `<button type="button" onclick="selectRecWeeks(${w})" data-rweek="${w}" class="rec-week-btn py-2 rounded-xl border text-xs font-semibold transition ${S.recWeeks === w ? 'border-[#00E5FF] bg-[#00E5FF]/10 text-[#00E5FF]' : 'border-white/10 bg-[#0B0D13] text-slate-400'}">${w} ${tr('sem.', 'wk.', 'sem.')}</button>`).join('')}
          </div>
        </div>
      </div>

      <div class="pt-3 border-t border-white/10"><div class="flex justify-between items-center mb-2"><span class="text-xs font-semibold text-slate-300">${tr('Mise engagée par séance (1 € à 10 €)', 'Stake per session (1 € to 10 €)', 'Apuesta por sesión (1 € a 10 €)')}</span><span id="stakeDisplay" class="text-base font-extrabold text-[#FF2A85]">5 €</span></div>
        <input id="inStake" type="range" min="1" max="10" value="5" oninput="updateStake(this.value)" class="w-full" />
        <div class="flex justify-between text-[11px] text-slate-400 mt-2"><span>${tr('Si séance manquée :', 'If session missed:', 'Si pierdes la sesión:')}</span><span id="splitDisplay" class="text-slate-200 font-semibold">1,00 € ONG • 4,00 € PACT</span></div></div>
      <button id="saveBtn" onclick="saveNewPact()" class="w-full py-3.5 rounded-2xl text-xs font-bold btn-neon-pink mt-2">${tr("Enregistrer dans l'agenda", 'Save to schedule', 'Guardar en la agenda')}</button></div></div>`;
  S.createDate = null; S.createTime = null; S.createPlace = null;
}

function selectRecMode(m) {
  S.recMode = m;
  document.querySelectorAll('.rec-mode-btn').forEach((b) => {
    b.className = 'rec-mode-btn py-2.5 px-2 rounded-xl border text-xs font-semibold transition ' + (b.dataset.rmode === m ? 'border-[#00E5FF] bg-[#00E5FF]/10 text-[#00E5FF]' : 'border-white/10 bg-[#0B0D13] text-slate-400');
  });
  $('recDaysBox')?.classList.toggle('hidden', m !== 'weekly');
  $('recWeeksBox')?.classList.toggle('hidden', m === 'none');
  if ($('recHint')) $('recHint').textContent = m === 'daily' ? tr('Tous les jours à cette heure', 'Every day at this time', 'Todos los días a esta hora') : m === 'weekly' ? tr('Chaque semaine aux jours choisis', 'Weekly on selected days', 'Cada semana en los días elegidos') : tr('Séance unique', 'Single session', 'Sesión única');
}

function toggleRecDay(idx) {
  if (S.recDays.includes(idx)) {
    if (S.recDays.length > 1) S.recDays = S.recDays.filter((x) => x !== idx);
  } else {
    S.recDays = [...S.recDays, idx].sort((a, b) => a - b);
  }
  document.querySelectorAll('.rec-day-btn').forEach((b) => {
    const d = parseInt(b.dataset.rday, 10);
    b.className = 'rec-day-btn py-2 rounded-xl border text-xs font-bold transition ' + (S.recDays.includes(d) ? 'border-[#00E5FF] bg-[#00E5FF]/15 text-[#00E5FF]' : 'border-white/10 bg-[#0B0D13] text-slate-400');
  });
}

function selectRecWeeks(w) {
  S.recWeeks = w;
  document.querySelectorAll('.rec-week-btn').forEach((b) => {
    const bw = parseInt(b.dataset.rweek, 10);
    b.className = 'rec-week-btn py-2 rounded-xl border text-xs font-semibold transition ' + (bw === w ? 'border-[#00E5FF] bg-[#00E5FF]/10 text-[#00E5FF]' : 'border-white/10 bg-[#0B0D13] text-slate-400');
  });
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
    const recurrence = { mode: S.recMode, days: S.recDays, weeks: S.recWeeks };
    const r = await api('POST', '/api/pacts', { sport: S.sport, place: $('inPlace').value, date, time, stake: parseInt($('inStake').value, 10), recurrence });
    const d = parseYmd(r.pact.date), mon = mondayOf(new Date());
    S.weekOffset = Math.round((mondayOf(d) - mon) / (7 * 864e5)); S.selected = r.pact.date;
    S.recMode = 'none';
    S.view = 'agenda'; renderNav(); await refresh();
    toast(r.createdCount > 1 ? `🔁 ${r.createdCount} séances programmées (${r.pact.sport})` : `Séance programmée : ${r.pact.sport} (${r.pact.stake} €)`);
  } catch (e) { toast(e.message); setBusy(btn, false); }
}

/* --- Impact --- */
function viewImpact() {
  const st = S.stats || { saved: 0, lost: 0, ngoAmount: 0, pactAmount: 0, byNgo: {}, streak: 0, doneCount: 0, failedCount: 0 };
  const hist = S.history.filter((p) => p.status !== 'pending').sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 8);
  const byNgo = Object.entries(st.byNgo);
  $('main').innerHTML = `<div class="space-y-5 fade"><div><h2 class="text-xl font-bold text-white">${tr('Bilan & Répartition', 'Impact & Breakdown', 'Balance y Reparto')}</h2><p class="text-xs text-slate-400 mt-0.5">${tr('Suivi de tes mises et reversements associatifs.', 'Track your stakes and charity donations.', 'Seguimiento de tus apuestas y donaciones.')}</p></div>
    <div class="grid grid-cols-2 gap-3">
      <div class="bg-[#131722] border border-[#00E5FF]/30 rounded-2xl p-4"><span class="text-xs text-slate-400 font-medium block">${tr('Mises protégées', 'Protected stakes', 'Apuestas protegidas')}</span><span class="text-2xl font-extrabold text-[#00E5FF] mt-1 block">${eur(st.saved)}</span><span class="text-[11px] text-slate-500">${st.doneCount} ${tr('séance(s)', 'session(s)', 'sesión(es)')}</span></div>
      <div class="bg-[#131722] border border-[#FF2A85]/30 rounded-2xl p-4"><span class="text-xs text-slate-400 font-medium block">${tr('Mises perdues', 'Lost stakes', 'Apuestas perdidas')}</span><span class="text-2xl font-extrabold text-[#FF2A85] mt-1 block">${eur(st.lost)}</span><span class="text-[11px] text-slate-500">${st.failedCount} ${tr('séance(s)', 'session(s)', 'sesión(es)')}</span></div></div>
    <div class="bg-[#131722] border border-white/10 rounded-2xl p-4 flex items-center justify-between"><span class="text-xs text-slate-300 font-semibold">🔥 ${tr('Série en cours', 'Current streak', 'Racha actual')}</span><span class="text-lg font-extrabold text-white">${st.streak}</span></div>
    <div class="bg-[#131722] border border-white/10 rounded-3xl p-5 space-y-4">
      <div class="flex justify-between items-center border-b border-white/10 pb-3"><div><span class="text-xs font-bold text-[#00E5FF] block">20 % Association</span><span class="text-[11px] text-slate-400">${tr('Reversé aux ONG sélectionnées', 'Donated to selected NGOs', 'Donado a las ONG seleccionadas')}</span></div><span class="text-sm font-bold text-white">${eur(st.ngoAmount)}</span></div>
      ${byNgo.map(([n, v]) => `<div class="flex justify-between text-[11px] text-slate-400 -mt-2"><span>${esc(n)}</span><span class="text-slate-200">${eur(v)}</span></div>`).join('')}
      <div class="flex justify-between items-center"><div><span class="text-xs font-bold text-[#FF2A85] block">80 % PACT</span><span class="text-[11px] text-slate-400">${tr("Fonctionnement de l'application", 'App operations', 'Funcionamiento de la aplicación')}</span></div><span class="text-sm font-bold text-white">${eur(st.pactAmount)}</span></div></div>
    <div><label class="text-xs font-semibold text-slate-300 block mb-2">${tr('Association soutenue (20 %)', 'Supported charity (20%)', 'Asociación apoyada (20%)')}</label><div class="grid grid-cols-2 gap-2">
      ${(S.config.ngos || []).map((n) => `<button onclick="chooseNgo('${n}')" class="py-2.5 px-3 rounded-xl border text-xs font-semibold transition ${n === S.user.ngo ? 'border-[#00E5FF] bg-[#00E5FF]/10 text-[#00E5FF]' : 'border-white/10 bg-[#131722] text-slate-400'}">${n}</button>`).join('')}</div></div>
    <div><label class="text-xs font-semibold text-slate-300 block mb-2">${tr('Historique', 'History', 'Historial')}</label><div class="space-y-2">
      ${hist.length ? hist.map((p) => `<div class="bg-[#131722] border border-white/5 rounded-xl px-4 py-3 flex justify-between items-center"><div><span class="text-xs font-semibold text-white block">${esc(p.sport)}</span><span class="text-[11px] text-slate-500">${parseYmd(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} • ${p.time}</span></div>
        <span class="text-xs font-bold ${p.status === 'done' ? 'text-[#00E5FF]' : 'text-[#FF2A85]'}">${p.status === 'done' ? '✓ ' + p.stake + ' €' : '−' + p.stake + ' €'}</span></div>`).join('') : `<p class="text-xs text-slate-500">${tr("Aucune séance clôturée pour l'instant.", 'No completed sessions yet.', 'Ninguna sesión cerrada por ahora.')}</p>`}</div></div></div>`;
}
async function chooseNgo(n) { try { const r = await api('PATCH', '/api/me', { ngo: n }); S.user = r.user; toast(`Association sélectionnée : ${n}`); viewImpact(); } catch (e) { toast(e.message); } }

/* --- Profil & Options --- */
function viewProfile() {
  const u = S.user, notif = 'Notification' in window ? Notification.permission : 'unsupported';
  const prov = [u.hasPassword && 'E-mail', u.google && 'Google'].filter(Boolean).join(' • ');
  const optBtn = (icon, title, sub, fn, accent = 'border-white/10 hover:border-[#00E5FF]/40') => `
    <button onclick="${fn}" class="w-full text-left bg-[#131722] border ${accent} rounded-2xl p-4 flex items-center justify-between gap-3 transition active:scale-[0.99]">
      <div class="flex items-center gap-3.5 min-w-0">
        <span class="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-base shrink-0">${icon}</span>
        <div class="min-w-0">
          <span class="text-xs sm:text-sm font-bold text-white block truncate">${title}</span>
          <span class="text-[11px] text-slate-400 block truncate mt-0.5">${sub}</span>
        </div>
      </div>
      <span class="text-slate-400 text-sm font-bold shrink-0">›</span>
    </button>`;

  $('main').innerHTML = `<div class="space-y-4 fade">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-xl font-bold text-white">${tr('Mon Profil & Options', 'My Profile & Options', 'Mi Perfil y Opciones')}</h2>
        <p class="text-xs text-slate-400 mt-0.5">${esc(u.email)} • ${prov}</p>
      </div>
      <button onclick="setView('agenda')" class="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-slate-300 hover:text-white">← ${tr('Retour', 'Back', 'Volver')}</button>
    </div>

    <!-- Résumé de la fiche utilisateur -->
    <div class="bg-[#131722] border border-[#00E5FF]/30 rounded-3xl p-5 space-y-3">
      <div class="flex items-center justify-between">
        <div>
          <span class="text-base font-extrabold text-white block">${esc(u.firstName || '')} ${esc(u.lastName || u.name || '')}</span>
          <span class="text-xs text-[#00E5FF] font-semibold">${esc(u.goal || 'Remise en forme')} • ONG : ${esc(u.ngo || 'UNICEF')}</span>
        </div>
        <button onclick="openEditProfileModal()" class="px-3 py-1.5 rounded-xl btn-neon-cyan text-xs font-bold">${tr('Modifier', 'Edit', 'Editar')}</button>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-white/10 text-[11px]">
        <div class="bg-[#0B0D13] rounded-xl p-2.5"><span class="text-slate-500 block">${tr('Âge', 'Age', 'Edad')}</span><span class="text-white font-semibold">${u.age ? u.age + ' ans' : 'Non renseigné'}</span></div>
        <div class="bg-[#0B0D13] rounded-xl p-2.5"><span class="text-slate-500 block">${tr('Genre', 'Gender', 'Género')}</span><span class="text-white font-semibold">${esc(u.gender || 'Non renseigné')}</span></div>
        <div class="bg-[#0B0D13] rounded-xl p-2.5"><span class="text-slate-500 block">${tr('Ville', 'City', 'Ciudad')}</span><span class="text-white font-semibold">${esc(u.city || 'Non renseignée')}</span></div>
        <div class="bg-[#0B0D13] rounded-xl p-2.5"><span class="text-slate-500 block">${tr('Téléphone', 'Phone', 'Teléfono')}</span><span class="text-white font-semibold">${esc(u.phone || 'Non renseigné')}</span></div>
      </div>
    </div>

    <!-- Liste des options de profil -->
    <div class="space-y-2.5">
      <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1 block">${tr('Options du compte & application', 'Account & App Options', 'Opciones de cuenta y aplicación')}</span>
      ${optBtn('⚙️', tr("Options de l'application (Thème, Langue & Calendrier)", 'App Settings (Theme, Language & Calendar)', 'Opciones de la aplicación (Tema, Idioma y Calendario)'), tr('Fond noir/blanc/auto, langue et synchronisation iPhone / Google Calendar', 'Dark/light/auto mode, language and iPhone / Google Calendar sync', 'Modo oscuro/claro/auto, idioma y calendario'), "setView('settings')", 'border-[#00E5FF]/30 hover:border-[#00E5FF]')}
      ${optBtn('✏️', tr('Modifier mes informations personnelles', 'Edit personal information', 'Modificar mi información personal'), 'Prénom, nom, âge, genre, téléphone, ville, objectif sportif', 'openEditProfileModal()')}
      ${optBtn('🔒', u.hasPassword ? 'Mot de passe & Sécurité' : 'Définir un mot de passe', 'Modifier ton mot de passe de connexion', 'openPasswordModal()')}
      ${optBtn('🔔', 'Rappels de séance & Notifications', notif === 'granted' ? 'Notifications activées (30 min avant séance)' : 'Activer les notifications et installer l\'app', 'openNotifsModal()')}
    </div>

    <div class="pt-2 space-y-2">
      <button onclick="logout()" class="w-full py-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-semibold text-slate-200 transition">${tr('Se déconnecter', 'Log out', 'Cerrar sesión')}</button>
      <button onclick="deleteAccount()" class="w-full py-2.5 rounded-2xl bg-[#FF2A85]/10 border border-[#FF2A85]/30 hover:bg-[#FF2A85]/20 text-xs font-semibold text-[#FF2A85] transition">${tr('Supprimer mon compte et tout mon historique', 'Delete my account and all history', 'Eliminar mi cuenta y todo mi historial')}</button>
    </div>
  </div>`;
}

function openEditProfileModal() {
  const u = S.user || {};
  openModal(`<div class="bg-[#131722] border border-[#00E5FF]/50 rounded-3xl p-6 w-full max-w-md space-y-4 neon-border-cyan fade max-h-[90vh] overflow-y-auto">
    <div class="flex justify-between items-center border-b border-white/10 pb-3">
      <span class="text-sm font-bold text-white">✏️ Modifier mes informations</span>
      <button onclick="closeModal()" class="text-xs text-slate-400 hover:text-white font-semibold">Fermer</button>
    </div>
    <div class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        ${field('pFirst', 'Prénom', 'text', '', `value="${esc(u.firstName || '')}" maxlength="40"`)}
        ${field('pLast', 'Nom', 'text', '', `value="${esc(u.lastName || '')}" maxlength="40"`)}
      </div>
      <div class="grid grid-cols-2 gap-3">
        ${field('pAge', 'Âge', 'number', '', `min="13" max="100" value="${u.age || ''}"`)}
        ${selectField('pGender', 'Genre', GENDERS, u.gender || '')}
      </div>
      <div class="grid grid-cols-2 gap-3">
        ${field('pPhone', 'Téléphone', 'tel', '', `value="${esc(u.phone || '')}" maxlength="25"`)}
        ${field('pCity', 'Ville', 'text', '', `value="${esc(u.city || '')}" maxlength="60"`)}
      </div>
      ${selectField('pGoal', 'Objectif sportif', GOALS, u.goal || 'Remise en forme')}
      <button onclick="saveName()" class="w-full py-3.5 rounded-2xl btn-neon-cyan text-xs font-bold">Enregistrer mes informations</button>
    </div>
  </div>`);
}

function openPasswordModal() {
  const u = S.user || {};
  openModal(`<div class="bg-[#131722] border border-white/15 rounded-3xl p-6 w-full max-w-sm space-y-4 fade">
    <div class="flex justify-between items-center border-b border-white/10 pb-3">
      <span class="text-sm font-bold text-white">🔒 ${u.hasPassword ? 'Changer de mot de passe' : 'Définir un mot de passe'}</span>
      <button onclick="closeModal()" class="text-xs text-slate-400 hover:text-white font-semibold">Fermer</button>
    </div>
    <div class="space-y-3">
      ${u.hasPassword ? field('pCur', 'Mot de passe actuel', 'password', '', 'autocomplete="current-password"') : ''}
      ${field('pNew', 'Nouveau mot de passe', 'password', '8 caractères minimum', 'autocomplete="new-password"')}
      <button onclick="savePass()" class="w-full py-3.5 rounded-2xl btn-neon-cyan text-xs font-bold">Mettre à jour</button>
    </div>
  </div>`);
}

function openNotifsModal() {
  const notif = 'Notification' in window ? Notification.permission : 'unsupported';
  openModal(`<div class="bg-[#131722] border border-white/15 rounded-3xl p-6 w-full max-w-sm space-y-4 fade">
    <div class="flex justify-between items-center border-b border-white/10 pb-3">
      <span class="text-sm font-bold text-white">🔔 Rappels & Application</span>
      <button onclick="closeModal()" class="text-xs text-slate-400 hover:text-white font-semibold">Fermer</button>
    </div>
    <p class="text-xs text-slate-400 leading-relaxed">Reçois une notification 30 minutes avant chacune de tes séances programmées.</p>
    <button onclick="enableNotifs()" ${notif === 'granted' || notif === 'unsupported' ? 'disabled' : ''} class="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-slate-200">${notif === 'granted' ? '✓ Rappels déjà activés' : notif === 'denied' ? 'Bloqués dans le navigateur' : 'Activer les notifications'}</button>
    ${deferredInstall ? `<button onclick="installApp()" class="w-full py-3 rounded-xl btn-neon-pink text-xs font-bold">Installer l'application sur l'écran d'accueil</button>` : ''}
  </div>`);
}

/* --- Onglet Interface Administrateur (réservé à eliottlcx@gmail.com) --- */
let studyUsersCache = [];
async function viewAdmin() {
  if (!isAdminUser()) { setView('agenda'); return; }
  $('main').innerHTML = `<div class="space-y-5 fade">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <span class="text-[10px] font-extrabold uppercase tracking-wider text-[#00E5FF] block">Accès réservé • ${esc(S.user.email)}</span>
        <h2 class="text-xl font-bold text-white">⚙️ Interface Administrateur</h2>
        <p class="text-xs text-slate-400 mt-0.5">Gestion des démonstrations et export des données du projet d'étude.</p>
      </div>
      <button onclick="loadStudyUsers()" class="px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-semibold text-slate-200 transition">↻ Actualiser</button>
    </div>

    <!-- BLOC MODE DÉMONSTRATION : VIDER L'HISTORIQUE DU COMPTE -->
    <div class="bg-[#131722] border border-[#FF2A85]/40 rounded-3xl p-5 space-y-3 neon-border-pink">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="space-y-1">
          <span class="text-xs font-extrabold text-[#FF2A85] uppercase tracking-wider block">🎬 Mode Démonstration</span>
          <h3 class="text-base font-bold text-white">Réinitialiser l'historique de mon compte</h3>
          <p class="text-xs text-slate-400 leading-relaxed">Supprime toutes les séances programmées, l'historique et remet les compteurs (<strong class="text-slate-200">Mises protégées, Mises perdues, Série</strong>) à zéro tout en conservant ton profil actif pour tes démonstrations.</p>
        </div>
        <button id="demoResetBtn" onclick="resetMyHistoryDemo()" class="py-3 px-5 rounded-2xl btn-neon-pink text-xs font-extrabold shrink-0 active:scale-[0.99] transition">
          🧹 Vider mon historique (Démo)
        </button>
      </div>
    </div>

    <!-- COMPTEURS GLOBAUX DE L'ÉTUDE -->
    <div class="grid grid-cols-3 gap-3">
      <div class="bg-[#131722] border border-white/10 rounded-2xl p-4">
        <span class="text-[11px] text-slate-400 font-medium block">Inscrits</span>
        <span id="admCountUsers" class="text-2xl font-extrabold text-white mt-1 block">—</span>
      </div>
      <div class="bg-[#131722] border border-[#00E5FF]/30 rounded-2xl p-4">
        <span class="text-[11px] text-slate-400 font-medium block">Séances créées</span>
        <span id="admCountPacts" class="text-2xl font-extrabold text-[#00E5FF] mt-1 block">—</span>
      </div>
      <div class="bg-[#131722] border border-[#FF2A85]/30 rounded-2xl p-4">
        <span class="text-[11px] text-slate-400 font-medium block">Mises protégées</span>
        <span id="admTotalSaved" class="text-2xl font-extrabold text-[#00E5FF] mt-1 block">—</span>
      </div>
    </div>

    <!-- LISTE & EXPORT DES INSCRITS (PROJET D'ÉTUDE) -->
    <div class="bg-[#131722] border border-[#00E5FF]/30 rounded-3xl p-5 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="text-sm font-bold text-white">📊 Base des utilisateurs inscrits (Projet d'étude)</h3>
          <p class="text-[11px] text-slate-400">Tu peux exporter les profils ou vider l'historique d'un compte pour une démo.</p>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="exportStudyCSV()" class="px-3.5 py-2 rounded-xl btn-neon-cyan text-xs font-bold">⬇ Exporter CSV (Excel)</button>
          <button onclick="exportStudyJSON()" class="px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-semibold text-slate-200">⬇ JSON</button>
        </div>
      </div>
      <div id="studyTableWrap" class="overflow-x-auto bg-[#0B0D13] border border-white/10 rounded-2xl p-3 text-xs text-slate-300">
        Chargement des inscrits…
      </div>
    </div>
  </div>`;
  await loadStudyUsers();
}

async function resetMyHistoryDemo() {
  const btn = $('demoResetBtn');
  setBusy(btn, true, 1);
  try {
    const r = await api('DELETE', '/api/me/history');
    localStorage.removeItem('pact_reminded');
    await refresh();
    toast(`Mode Démo prêt : ${r.removed || 0} séance(s) effacée(s), compteurs remis à 0 € ✨`);
    if (S.view === 'admin') await loadStudyUsers();
  } catch (e) {
    toast(e.message);
  }
  setBusy(btn, false);
}

async function clearUserHistoryAdmin(id, name) {
  try {
    const r = await api('DELETE', `/api/admin/users/${id}/history`);
    if (S.user && S.user.id === id) {
      localStorage.removeItem('pact_reminded');
      await refresh();
    }
    toast(`Historique de ${name || 'l\'utilisateur'} vidé (${r.removed || 0} séance(s))`);
    await loadStudyUsers();
  } catch (e) {
    toast(e.message);
  }
}

async function loadStudyUsers() {
  const wrap = $('studyTableWrap'); if (!wrap) return;
  try {
    const data = await api('GET', '/api/admin/users');
    studyUsersCache = data.users || [];
    const totalSaved = studyUsersCache.reduce((s, u) => s + (u.savedAmount || 0), 0);
    if ($('admCountUsers')) $('admCountUsers').textContent = String(studyUsersCache.length);
    if ($('admCountPacts')) $('admCountPacts').textContent = String(data.totalPacts ?? 0);
    if ($('admTotalSaved')) $('admTotalSaved').textContent = eur(totalSaved);

    if (!studyUsersCache.length) {
      wrap.innerHTML = `<p class="text-center text-slate-500 py-6">Aucun utilisateur inscrit pour le moment.</p>`;
      return;
    }
    wrap.innerHTML = `
      <table class="w-full text-left border-collapse text-[11px]">
        <thead>
          <tr class="border-b border-white/10 text-slate-400">
            <th class="py-2 pr-3">Nom / Prénom</th>
            <th class="py-2 pr-3">E-mail</th>
            <th class="py-2 pr-3">Âge / Genre</th>
            <th class="py-2 pr-3">Tél / Ville</th>
            <th class="py-2 pr-3">Objectif / ONG</th>
            <th class="py-2 pr-3">Séances</th>
            <th class="py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-white/5">
          ${studyUsersCache.map((u) => `
            <tr>
              <td class="py-2.5 pr-3 font-semibold text-white">${esc(u.firstName)} ${esc(u.lastName)}<span class="block text-[10px] text-slate-500">${esc(u.provider)} ${u.verified ? '• Vérifié' : '• En attente'}</span></td>
              <td class="py-2.5 pr-3 text-slate-300">${esc(u.email)}</td>
              <td class="py-2.5 pr-3">${u.age ? u.age + ' ans' : '—'}<span class="block text-slate-500">${esc(u.gender || '—')}</span></td>
              <td class="py-2.5 pr-3">${esc(u.phone || '—')}<span class="block text-slate-500">${esc(u.city || '—')}</span></td>
              <td class="py-2.5 pr-3 text-[#00E5FF]">${esc(u.goal || '—')}<span class="block text-slate-400">ONG: ${esc(u.ngo || '—')}</span></td>
              <td class="py-2.5 pr-3">${u.pactsCount} séance(s)<span class="block text-[10px] text-slate-400">✓ ${u.savedAmount} € / −${u.lostAmount} €</span></td>
              <td class="py-2.5 text-right whitespace-nowrap space-x-2">
                <button onclick="clearUserHistoryAdmin(${u.id}, '${esc(u.firstName)}')" class="px-2 py-1 rounded-lg bg-[#00E5FF]/10 border border-[#00E5FF]/30 text-[#00E5FF] hover:bg-[#00E5FF]/20 font-semibold">🧹 Vider hist.</button>
                <button onclick="deleteStudyUser(${u.id})" class="px-2 py-1 rounded-lg bg-[#FF2A85]/10 border border-[#FF2A85]/30 text-[#FF2A85] hover:bg-[#FF2A85]/20 font-semibold">🗑 Suppr.</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    wrap.innerHTML = `<p class="text-[#FF2A85] text-xs py-4 text-center">${esc(e.message)}</p>`;
  }
}

function exportStudyCSV() {
  if (!studyUsersCache.length) return toast('Aucune donnée à exporter.');
  const cols = ['id', 'firstName', 'lastName', 'email', 'age', 'gender', 'phone', 'city', 'goal', 'ngo', 'provider', 'verified', 'pactsCount', 'doneCount', 'failedCount', 'savedAmount', 'lostAmount', 'createdAt'];
  const headers = ['ID', 'Prénom', 'Nom', 'Email', 'Âge', 'Genre', 'Téléphone', 'Ville', 'Objectif sportif', 'ONG', 'Méthode', 'Vérifié', 'Séances totales', 'Séances validées', 'Séances manquées', 'Mises protégées (€)', 'Mises perdues (€)', 'Date inscription'];
  const csvRows = [
    headers.join(';'),
    ...studyUsersCache.map((u) => cols.map((c) => `"${String(u[c] ?? '').replace(/"/g, '""')}"`).join(';')),
  ];
  const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pact-inscrits-etude-${ymd(new Date())}.csv`;
  a.click();
  toast('Export CSV téléchargé !');
}

function exportStudyJSON() {
  if (!studyUsersCache.length) return toast('Aucune donnée à exporter.');
  const blob = new Blob([JSON.stringify(studyUsersCache, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pact-inscrits-etude-${ymd(new Date())}.json`;
  a.click();
  toast('Export JSON téléchargé !');
}

async function deleteStudyUser(id) {
  try {
    await api('DELETE', `/api/admin/users/${id}`);
    toast('Compte et historique supprimés sur Netlify');
    if (S.user && S.user.id === id) { closeModal(); logout(true); return; }
    await loadStudyUsers();
  } catch (e) { toast(e.message); }
}

async function saveName() {
  try {
    const r = await api('PATCH', '/api/me', {
      firstName: $('pFirst').value.trim(),
      lastName: $('pLast').value.trim(),
      age: parseInt($('pAge').value, 10),
      gender: $('pGender').value,
      phone: $('pPhone').value.trim(),
      city: $('pCity').value.trim(),
      goal: $('pGoal').value,
    });
    S.user = r.user; closeModal(); toast('Informations mises à jour ✓'); renderShell(); renderView();
    if (S.stats && $('savedCounter')) $('savedCounter').textContent = Math.round(S.stats.saved * 100) / 100 + ' €';
  } catch (e) { toast(e.message); }
}
async function savePass() { try { await api('POST', '/api/me/password', { current: $('pCur')?.value, password: $('pNew').value }); closeModal(); toast('Mot de passe mis à jour ✓'); S.user.hasPassword = true; viewProfile(); } catch (e) { toast(e.message); } }
function deleteAccount() {
  openModal(`<div class="bg-[#131722] border border-[#FF2A85]/50 rounded-3xl p-6 w-full max-w-sm space-y-4 neon-border-pink"><h3 class="text-base font-bold text-white">Supprimer définitivement le compte ?</h3><p class="text-xs text-slate-400 leading-relaxed">Ton profil, toutes tes séances, ton historique et tes données stockées sur l'application et sur Netlify seront intégralement supprimés.</p>
    <div class="grid grid-cols-2 gap-2.5"><button onclick="closeModal()" class="py-3 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-slate-300">Annuler</button><button id="delAccBtn" onclick="doDelete()" class="py-3 rounded-xl btn-neon-pink text-xs font-bold">Tout supprimer</button></div></div>`);
}
async function doDelete() {
  const btn = $('delAccBtn'); setBusy(btn, true, 1);
  try {
    await api('DELETE', '/api/me');
    localStorage.removeItem('pact_token');
    localStorage.removeItem('pact_reminded');
    localStorage.removeItem('pact_v1');
    closeModal();
    logout(true);
    toast('Compte et historique supprimés de l\'app et de Netlify');
  } catch (e) { toast(e.message); setBusy(btn, false); }
}

/* --- rappels & PWA --- */
async function enableNotifs() { if (!('Notification' in window)) return; await Notification.requestPermission(); closeModal(); viewProfile(); }
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
  try {
    const ir = await fetch('/.netlify/identity/settings');
    if (ir.ok) {
      const idCfg = await ir.json();
      S.identityEnabled = true;
      S.identityGoogle = Boolean(idCfg?.external?.google);
    }
  } catch {}

  const params = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));

  // Confirmation d'e-mail via Netlify Identity (#confirmation_token=...)
  if (hashParams.get('confirmation_token')) {
    const confTok = hashParams.get('confirmation_token');
    history.replaceState(null, '', location.pathname);
    try {
      const vr = await fetch('/.netlify/identity/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: confTok, type: 'signup' }),
      });
      if (vr.ok) {
        const vData = await vr.json();
        const d = await api('POST', '/api/identity', { access_token: vData.access_token });
        setSession(d.token, d.user);
        setTimeout(() => toast('✓ E-mail confirmé ! Bienvenue sur PACT 🎉'), 300);
        return enterApp();
      }
    } catch {}
  }

  if (params.get('session_token')) {
    S.token = params.get('session_token');
    localStorage.setItem('pact_token', S.token);
    const wasVerified = params.get('verified') === '1';
    history.replaceState(null, '', location.pathname);
    if (wasVerified) setTimeout(() => toast('✓ Inscription confirmée ! Bienvenue sur PACT 🎉'), 300);
  }
  if (params.get('oauth_error')) {
    history.replaceState(null, '', location.pathname);
    setTimeout(() => toast('La connexion OAuth a échoué ou a été annulée.'), 200);
  }

  // Retour de redirection Google OAuth (#id_token=... ou #access_token=...) ou Netlify Identity
  if (hashParams.get('id_token') || hashParams.get('access_token')) {
    const idTok = hashParams.get('id_token');
    const accTok = hashParams.get('access_token');
    history.replaceState(null, '', location.pathname);
    try {
      const d = idTok
        ? await api('POST', '/api/google', { credential: idTok, access_token: accTok })
        : (S.identityGoogle
            ? await api('POST', '/api/identity', { access_token: accTok })
            : await api('POST', '/api/google', { access_token: accTok }));
      setSession(d.token, d.user);
      return enterApp();
    } catch (e) {
      setTimeout(() => toast(e.message), 200);
    }
  }

  if (params.get('reset')) { S.resetToken = params.get('reset'); return showAuth('reset'); }
  if (params.get('verified')) return showAuth('login');
  if (S.token) {
    try { const r = await api('GET', '/api/me'); S.user = r.user; return enterApp(); } catch { /* retombe sur landing */ }
  }
  showLanding();
})();

