const crypto = require("crypto");
const tls = require("tls");
const net = require("net");

const SITE_ID = process.env.PACT_SITE_ID || process.env.SITE_ID || "aefb4b28-19ef-4f30-bab4-0d6aebe59bcf";
const BLOBS_TOKEN = process.env.PACT_BLOBS_TOKEN || "";
const SECRET = process.env.SECRET_KEY || crypto.createHash("sha256").update(SITE_ID + ":pact-secret").digest("hex");
const ENV_GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const ENV_RESEND_KEY = process.env.RESEND_API_KEY || "";
const ENV_BREVO_KEY = process.env.BREVO_API_KEY || "";
const ENV_SMTP_HOST = process.env.SMTP_HOST || "";
const ENV_SMTP_PORT = parseInt(process.env.SMTP_PORT || "465", 10);
const ENV_SMTP_USER = process.env.SMTP_USER || "";
const ENV_SMTP_PASS = process.env.SMTP_PASS || "";
const ENV_SMTP_FROM = process.env.SMTP_FROM || "";

const NGOS = ["UNICEF", "WWF", "Croix-Rouge", "MSF"];
const SPORTS = ["Musculation", "Running", "CrossFit", "Boxe", "Yoga", "Natation", "Vélo", "Autre"];
const GRACE_MIN = 60;
const OPEN_BEFORE_MIN = 60;
const DELAY_MIN = 20;

const BLOB_URL = `https://api.netlify.com/api/v1/blobs/${SITE_ID}/site:pact/db.json`;

async function loadDb() {
  try {
    const res = await fetch(BLOB_URL, { headers: { Authorization: `Bearer ${BLOBS_TOKEN}` } });
    if (!res.ok) return { users: [], pacts: [], tokens: [], settings: {}, nextUserId: 1, nextPactId: 1 };
    const data = await res.json();
    return {
      users: data.users || [],
      pacts: data.pacts || [],
      tokens: data.tokens || [],
      settings: data.settings || {},
      nextUserId: data.nextUserId || 1,
      nextPactId: data.nextPactId || 1,
    };
  } catch {
    return { users: [], pacts: [], tokens: [], settings: {}, nextUserId: 1, nextPactId: 1 };
  }
}

async function saveDb(db) {
  await fetch(BLOB_URL, {
    method: "PUT",
    headers: { Authorization: `Bearer ${BLOBS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(db),
  });
}

function b64u(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64d(str) {
  str = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64");
}
function escHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function hashPw(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const h = crypto.pbkdf2Sync(pw, salt, 100000, 32, "sha256").toString("hex");
  return `${salt}$${h}`;
}
function checkPw(pw, stored) {
  if (!stored || !stored.includes("$")) return false;
  const [salt] = stored.split("$");
  const a = Buffer.from(hashPw(pw, salt));
  const b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function makeSession(uid) {
  const payload = b64u(JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + 60 * 86400 }));
  const sig = b64u(crypto.createHmac("sha256", SECRET).update(payload).digest());
  return `${payload}.${sig}`;
}
function readSession(tok) {
  try {
    const [payload, sig] = (tok || "").split(".");
    const good = b64u(crypto.createHmac("sha256", SECRET).update(payload).digest());
    if (sig !== good) return null;
    const d = JSON.parse(b64d(payload).toString("utf8"));
    return d.exp > Date.now() / 1000 ? d.uid : null;
  } catch {
    return null;
  }
}

function makeCalToken(uid) {
  const sig = b64u(crypto.createHmac("sha256", SECRET).update(`cal:${uid}`).digest()).slice(0, 20);
  return `${uid}-${sig}`;
}
function readCalToken(tok) {
  const m = String(tok || "").replace(/\.ics$/i, "").match(/^(\d+)-([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const uid = parseInt(m[1], 10);
  const expected = b64u(crypto.createHmac("sha256", SECRET).update(`cal:${uid}`).digest()).slice(0, 20);
  return m[2] === expected ? uid : null;
}

function icsEscape(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function buildIcsFeed(user, pacts) {
  const calName = `PACT — ${icsEscape(user.firstName || user.name || "Agenda")}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PACT//Engagement Sportif//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `NAME:${calName}`,
    `X-WR-CALNAME:${calName}`,
    "X-WR-CALDESC:Synchronisation automatique de tes séances PACT",
    "X-WR-TIMEZONE:Europe/Paris",
    "REFRESH-INTERVAL;VALUE=DURATION:PT5M",
    "X-PUBLISHED-TTL:PT5M",
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Paris",
    "X-LIC-LOCATION:Europe/Paris",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "TZNAME:CEST",
    "DTSTART:19700329T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "TZNAME:CET",
    "DTSTART:19701025T030000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
  const nowStamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  for (const p of pacts) {
    const dtStart = `${p.date.replace(/-/g, "")}T${p.time.replace(":", "")}00`;
    const [hh, mm] = p.time.split(":").map(Number);
    const endH = String((hh + 1) % 24).padStart(2, "0");
    const dtEnd = `${p.date.replace(/-/g, "")}T${endH}${String(mm).padStart(2, "0")}00`;
    const statusLabel = p.status === "done" ? "✓ Validée" : p.status === "failed" ? "✗ Manquée" : `Mise ${p.stake} €`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:pact-${p.id}-${user.id}@pact-application.netlify.app`,
      `DTSTAMP:${nowStamp}`,
      `LAST-MODIFIED:${nowStamp}`,
      "SEQUENCE:0",
      `DTSTART;TZID=Europe/Paris:${dtStart}`,
      `DTEND;TZID=Europe/Paris:${dtEnd}`,
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      `SUMMARY:${icsEscape(`PACT • ${p.sport} (${statusLabel})`)}`,
      `LOCATION:${icsEscape(p.place || "Séance PACT")}`,
      `DESCRIPTION:${icsEscape(`Engagement sportif PACT — Mise : ${p.stake} € (20% ${user.ngo || "UNICEF"} / 80% PACT). Valide ta présence sur l'application PACT.`)}`,
      "BEGIN:VALARM",
      "TRIGGER:-PT30M",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsEscape(`PACT : ${p.sport} dans 30 min (${p.stake} € en jeu)`)}`,
      "END:VALARM",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

function parseIcsText(rawText, sourceName = "Calendrier") {
  const unfolded = String(rawText || "").replace(/\r?\n[ \t]/g, "");
  const blocks = unfolded.split(/BEGIN:VEVENT/i).slice(1);
  const events = [];
  const minDate = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const maxDate = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const dayMap = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };

  for (const blk of blocks) {
    const body = blk.split(/END:VEVENT/i)[0] || "";
    const lines = body.split(/\r?\n/);
    let summary = "", location = "", dtStartRaw = "", rrule = "", uid = "";
    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const keyPart = line.slice(0, idx).toUpperCase();
      const val = line.slice(idx + 1).trim();
      const prop = keyPart.split(";")[0];
      if (prop === "SUMMARY") summary = val.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/g, " ");
      else if (prop === "LOCATION") location = val.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/g, " ");
      else if (prop === "DTSTART") dtStartRaw = val;
      else if (prop === "RRULE") rrule = val.toUpperCase();
      else if (prop === "UID") uid = val;
    }
    if (!dtStartRaw || !summary) continue;
    const m = dtStartRaw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
    if (!m) continue;
    const baseDate = `${m[1]}-${m[2]}-${m[3]}`;
    const time = m[4] && m[5] ? `${m[4]}:${m[5]}` : "09:00";

    const pushEv = (dStr, suffix = "") => {
      if (dStr >= minDate && dStr <= maxDate) {
        events.push({
          id: `${uid || summary}-${dStr}-${time}${suffix}`.slice(0, 80),
          title: summary.slice(0, 80),
          place: location.slice(0, 100),
          date: dStr,
          time,
          source: sourceName,
        });
      }
    };

    if (rrule.includes("FREQ=DAILY")) {
      const startObj = new Date(`${baseDate}T00:00:00Z`);
      for (let i = 0; i < 60; i++) {
        const cur = new Date(startObj.getTime() + i * 86400000);
        pushEv(cur.toISOString().slice(0, 10), `-d${i}`);
      }
    } else if (rrule.includes("FREQ=WEEKLY")) {
      const byDayMatch = rrule.match(/BYDAY=([A-Z,]+)/);
      const startObj = new Date(`${baseDate}T00:00:00Z`);
      const startDow = (startObj.getUTCDay() + 6) % 7;
      const allowedDays = byDayMatch
        ? byDayMatch[1].split(",").map(( code ) => dayMap[code.slice(-2)]).filter((x) => x !== undefined)
        : [startDow];
      for (let i = 0; i < 60; i++) {
        const cur = new Date(startObj.getTime() + i * 86400000);
        const dow = (cur.getUTCDay() + 6) % 7;
        if (allowedDays.includes(dow)) pushEv(cur.toISOString().slice(0, 10), `-w${i}`);
      }
    } else {
      pushEv(baseDate);
    }
  }
  return events.slice(0, 300);
}

function newToken(db, uid, kind, hours) {
  const raw = b64u(crypto.randomBytes(24));
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  db.tokens = db.tokens.filter((t) => !(t.user_id === uid && t.kind === kind) && t.expires > Date.now() / 1000);
  db.tokens.push({ hash, user_id: uid, kind, expires: Math.floor(Date.now() / 1000) + hours * 3600 });
  return raw;
}
function useToken(db, raw, kind) {
  const hash = crypto.createHash("sha256").update(String(raw || "")).digest("hex");
  const idx = db.tokens.findIndex((t) => t.hash === hash && t.kind === kind);
  if (idx === -1) return null;
  const tok = db.tokens[idx];
  db.tokens.splice(idx, 1);
  return tok.expires >= Date.now() / 1000 ? tok.user_id : null;
}

function mailHtml({ name, email, title, text, btn, link, kind }) {
  const greeting = name ? `Salut ${escHtml(name)} 👋` : "Bienvenue sur PACT 👋";
  const badge = kind === "reset" ? "SÉCURITÉ DU COMPTE" : "CONFIRMATION D'INSCRIPTION";
  return `<!DOCTYPE html><html lang="fr"><body style="margin:0;padding:0;background:#06070A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
<div style="background:radial-gradient(circle at 50% 0%,rgba(0,229,255,.12),rgba(255,42,133,.06) 40%,#0B0D13 75%);padding:36px 16px">
  <div style="max-width:480px;margin:0 auto;background:#131722;border:1px solid rgba(0,229,255,.4);border-radius:28px;padding:32px 28px;color:#F8FAFC;box-shadow:0 12px 40px rgba(0,229,255,.12)">
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,.08);padding-bottom:18px;margin-bottom:24px">
      <div>
        <span style="font-size:26px;font-weight:800;letter-spacing:-0.5px;color:#FFFFFF">PACT</span>
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#00E5FF;margin-left:4px;box-shadow:0 0 8px #00E5FF"></span>
        <div style="font-size:11px;color:#94A3B8;margin-top:2px">L'engagement sportif</div>
      </div>
      <span style="font-size:10px;font-weight:700;padding:5px 10px;border-radius:99px;background:rgba(0,229,255,.12);color:#00E5FF;border:1px solid rgba(0,229,255,.3)">${badge}</span>
    </div>
    <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#00E5FF">${greeting}</p>
    <h1 style="margin:0 0 14px;font-size:22px;font-weight:800;color:#FFFFFF;line-height:1.3">${escHtml(title)}</h1>
    <p style="margin:0 0 18px;color:#CBD5E1;line-height:1.65;font-size:14px">${escHtml(text)}</p>
    <div style="background:#0B0D13;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:14px 16px;margin-bottom:24px">
      <div style="font-size:11px;color:#64748B;margin-bottom:4px">Compte associé</div>
      <div style="font-size:13px;font-weight:700;color:#F8FAFC">${escHtml(email)}</div>
      ${name ? `<div style="font-size:12px;color:#94A3B8;margin-top:2px">Athlète : <strong style="color:#00E5FF">${escHtml(name)}</strong></div>` : ""}
    </div>
    <div style="text-align:center;margin:28px 0">
      <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#00E5FF 0%,#00B8D4 100%);color:#06070A;padding:15px 28px;border-radius:16px;font-weight:800;text-decoration:none;font-size:14px;box-shadow:0 4px 18px rgba(0,229,255,.35)">${escHtml(btn)}</a>
    </div>
    <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:12px 14px;margin-top:22px;font-size:12px;color:#94A3B8;line-height:1.5">
      <strong style="color:#FFFFFF">Rappel PACT :</strong> planifie tes séances, valide ta présence sur place pour protéger ta mise. En cas d'absence : <span style="color:#00E5FF;font-weight:600">20 % pour l'ONG de ton choix</span> et <span style="color:#FF2A85;font-weight:600">80 % pour PACT</span>.
    </div>
    <p style="margin:20px 0 0;color:#64748B;font-size:11px;line-height:1.5">Si le bouton ne s'ouvre pas, copie ce lien dans ton navigateur :<br><a href="${link}" style="color:#00E5FF;word-break:break-all">${link}</a></p>
  </div>
</div></body></html>`;
}

function sendSmtp({ host, port, user, pass, from, to, subject, html }) {
  return new Promise((resolve) => {
    let sock = null;
    const timer = setTimeout(() => { try { sock && sock.destroy(); } catch {} resolve(false); }, 10000);
    const done = (ok) => { clearTimeout(timer); try { sock && sock.end(); } catch {} resolve(ok); };

    const fromAddr = (from.match(/<([^>]+)>/) || [null, from])[1].trim();
    const msg = [
      `From: ${from}`,
      `To: <${to}>`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(html).toString("base64").replace(/(.{76})/g, "$1\r\n"),
      "",
    ].join("\r\n");

    const steps = [
      (line) => /^220/.test(line) ? `EHLO pact.app` : null,
      (line) => /^250/.test(line) ? `AUTH LOGIN` : null,
      (line) => /^334/.test(line) ? Buffer.from(user).toString("base64") : null,
      (line) => /^334/.test(line) ? Buffer.from(pass).toString("base64") : null,
      (line) => /^235/.test(line) ? `MAIL FROM:<${fromAddr}>` : null,
      (line) => /^250/.test(line) ? `RCPT TO:<${to}>` : null,
      (line) => /^250/.test(line) ? `DATA` : null,
      (line) => /^354/.test(line) ? `${msg}\r\n.` : null,
      (line) => { if (/^250/.test(line)) { done(true); return "QUIT"; } done(false); return null; },
    ];
    let step = 0, buf = "";

    const onData = (chunk) => {
      buf += chunk.toString("utf8");
      const lines = buf.split("\r\n");
      buf = lines.pop();
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        if (/^\d{3} /.test(line) && step < steps.length) {
          const cmd = steps[step++](line);
          if (cmd === null) return done(false);
          sock.write(cmd + "\r\n");
        }
      }
    };

    try {
      sock = tls.connect({ host, port: port || 465, servername: host }, () => {});
      sock.on("data", onData);
      sock.on("error", () => done(false));
    } catch {
      done(false);
    }
  });
}

async function sendMail(settings, { to, name, subject, title, text, btn, link, kind }) {
  const html = mailHtml({ name, email: to, title, text, btn, link, kind });
  const brevoKey = ENV_BREVO_KEY || settings.brevoApiKey || "";
  const resendKey = ENV_RESEND_KEY || settings.resendApiKey || "";
  const smtpHost = ENV_SMTP_HOST || settings.smtpHost || "";
  const smtpPort = ENV_SMTP_PORT || parseInt(settings.smtpPort || "465", 10);
  const smtpUser = ENV_SMTP_USER || settings.smtpUser || "";
  const smtpPass = ENV_SMTP_PASS || settings.smtpPass || "";
  const senderEmail = ENV_SMTP_FROM || settings.smtpFrom || smtpUser || "no-reply@pact-sport.app";
  const smtpFrom = senderEmail.includes("<") ? senderEmail : `PACT No-Reply <${senderEmail}>`;

  if (brevoKey) {
    try {
      const r = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": brevoKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          sender: { name: "PACT — No-Reply", email: senderEmail.replace(/.*<([^>]+)>.*/, "$1") },
          to: [{ email: to, name: name || to }],
          subject,
          htmlContent: html,
        }),
      });
      if (r.ok) return { sent: true };
    } catch {}
  }
  if (smtpHost && smtpUser && smtpPass) {
    const ok = await sendSmtp({ host: smtpHost, port: smtpPort, user: smtpUser, pass: smtpPass, from: smtpFrom, to, subject, html });
    if (ok) return { sent: true };
  }
  if (resendKey) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "PACT No-Reply <onboarding@resend.dev>", to: [to], subject, html }),
      });
      if (r.ok) return { sent: true };
    } catch {}
  }
  return { sent: false };
}

function isProfileComplete(u) {
  return Boolean(u.firstName && u.lastName && u.age >= 13 && u.gender && u.phone && u.city);
}

function userJson(u) {
  const firstName = u.firstName || (u.name ? u.name.split(" ")[0] : "");
  const lastName = u.lastName || (u.name ? u.name.split(" ").slice(1).join(" ") : "");
  return {
    id: u.id,
    email: u.email,
    name: u.name || [firstName, lastName].filter(Boolean).join(" "),
    firstName,
    lastName,
    age: u.age || null,
    gender: u.gender || "",
    phone: u.phone || "",
    city: u.city || "",
    goal: u.goal || "Remise en forme",
    profileComplete: isProfileComplete({ ...u, firstName, lastName }),
    ngo: u.ngo || "UNICEF",
    hasPassword: Boolean(u.pw_hash),
    google: Boolean(u.google_sub),
    calToken: makeCalToken(u.id),
    extCalName: u.ext_cal_name || "",
    extCalUrl: u.ext_cal_url || "",
    extCount: Array.isArray(u.ext_events) ? u.ext_events.length : 0,
  };
}

function localNow(tzOffsetMin) {
  return new Date(Date.now() - tzOffsetMin * 60000);
}
function fmtDt(d) {
  return d.toISOString().slice(0, 16).replace("T", " ");
}
function parseLocal(date, time) {
  return new Date(`${date}T${time}:00Z`);
}

function resolveExpired(db, user, tz) {
  const now = localNow(tz);
  let changed = false;
  for (const p of db.pacts) {
    if (p.user_id === user.id && p.status === "pending") {
      const end = new Date(parseLocal(p.date, p.time).getTime() + GRACE_MIN * 60000);
      if (now > end) {
        p.status = "failed";
        p.auto = 1;
        p.ngo = user.ngo || "UNICEF";
        p.resolved_at = Math.floor(Date.now() / 1000);
        changed = true;
      }
    }
  }
  return changed;
}

function computeStats(db, uid) {
  const up = db.pacts.filter((p) => p.user_id === uid);
  let saved = 0, doneCount = 0, lost = 0, failedCount = 0;
  const byNgo = {};
  for (const p of up) {
    if (p.status === "done") {
      saved += p.stake;
      doneCount++;
    } else if (p.status === "failed") {
      lost += p.stake;
      failedCount++;
      const n = p.ngo || "UNICEF";
      byNgo[n] = Math.round(((byNgo[n] || 0) + p.stake * 0.2) * 100) / 100;
    }
  }
  const closed = up.filter((p) => p.status !== "pending").sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  let streak = 0;
  for (const p of closed) {
    if (p.status !== "done") break;
    streak++;
  }
  return {
    saved,
    doneCount,
    lost,
    failedCount,
    ngoAmount: Math.round(lost * 0.2 * 100) / 100,
    pactAmount: Math.round(lost * 0.8 * 100) / 100,
    byNgo,
    streak,
  };
}

function socialUpsert(db, sub, email, name, givenName, familyName) {
  let u = db.users.find((x) => x.google_sub === sub);
  if (!u && email) {
    u = db.users.find((x) => x.email === email);
    if (u) {
      u.google_sub = sub;
      u.verified = 1;
    }
  }
  const parts = String(name || "").trim().split(/\s+/);
  const fName = givenName || parts[0] || "";
  const lName = familyName || parts.slice(1).join(" ") || "";
  if (!u) {
    u = {
      id: db.nextUserId++,
      email: email || `google_${sub.slice(0, 8)}@pact.app`,
      firstName: fName,
      lastName: lName,
      name: [fName, lName].filter(Boolean).join(" ") || (email ? email.split("@")[0] : "Athlète"),
      age: null,
      gender: "",
      phone: "",
      city: "",
      goal: "Remise en forme",
      pw_hash: "",
      verified: 1,
      google_sub: sub,
      ngo: "UNICEF",
      created_at: Math.floor(Date.now() / 1000),
    };
    db.users.push(u);
  }
  return u;
}

exports.handler = async (event, context) => {
  const method = event.httpMethod;
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-TZ-Offset, X-Admin-Key", "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS" }, body: "" };
  }

  const rawPath = (event.path || "").replace(/^\/\.netlify\/functions\/api/, "/api");
  const path = rawPath.startsWith("/api") ? rawPath : "/api" + rawPath;
  const qs = event.queryStringParameters || {};
  const headers = event.headers || {};
  const tz = parseInt(headers["x-tz-offset"] || headers["X-TZ-Offset"] || "0", 10) || 0;
  const proto = headers["x-forwarded-proto"] || "https";
  const host = headers["x-forwarded-host"] || headers["host"] || "pact-application.netlify.app";
  const baseUrl = `${proto}://${host}`;

  const reply = (statusCode, obj) => ({
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(obj),
  });

  const db = await loadDb();
  const googleClientId = ENV_GOOGLE_CLIENT_ID || db.settings.googleClientId || "";
  const mailConfigured = Boolean(
    ENV_RESEND_KEY || db.settings.resendApiKey || ((ENV_SMTP_HOST || db.settings.smtpHost) && (ENV_SMTP_USER || db.settings.smtpUser))
  );

  if (method === "GET" && path === "/api/config") {
    return reply(200, {
      googleClientId,
      mailConfigured,
      ngos: NGOS,
      sports: SPORTS,
      graceMin: GRACE_MIN,
      openBeforeMin: OPEN_BEFORE_MIN,
    });
  }

  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
    } catch {
      return reply(400, { error: "Requête JSON invalide." });
    }
  }

  if (method === "POST" && path === "/api/config/oauth") {
    if (body.googleClientId !== undefined) db.settings.googleClientId = String(body.googleClientId).trim();
    if (body.smtpUser !== undefined) {
      db.settings.smtpHost = String(body.smtpHost || "smtp.gmail.com").trim();
      db.settings.smtpPort = "465";
      db.settings.smtpUser = String(body.smtpUser).trim();
      db.settings.smtpPass = String(body.smtpPass || "").replace(/\s+/g, "");
    }
    if (body.resendApiKey !== undefined) {
      db.settings.resendApiKey = String(body.resendApiKey).trim();
    }
    await saveDb(db);
    return reply(200, {
      ok: true,
      googleClientId: ENV_GOOGLE_CLIENT_ID || db.settings.googleClientId || "",
      mailConfigured: Boolean(ENV_RESEND_KEY || db.settings.resendApiKey || ((ENV_SMTP_HOST || db.settings.smtpHost) && (ENV_SMTP_USER || db.settings.smtpUser))),
    });
  }

  if (method === "POST" && path === "/api/identity") {
    const accessToken = String(body.access_token || "");
    if (!accessToken) return reply(400, { error: "Jeton manquant." });
    try {
      const r = await fetch(`${baseUrl}/.netlify/identity/user`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) return reply(401, { error: "Session Netlify Identity invalide." });
      const info = await r.json();
      const email = String(info.email || "").toLowerCase();
      const name = info.user_metadata?.full_name || info.user_metadata?.name || (email ? email.split("@")[0] : "Athlète");
      const u = socialUpsert(db, info.id || email, email, name);
      await saveDb(db);
      return reply(200, { token: makeSession(u.id), user: userJson(u) });
    } catch {
      return reply(401, { error: "Impossible de vérifier le compte." });
    }
  }

  if (method === "GET" && path === "/api/verify") {
    const uid = useToken(db, qs.token || "", "verify");
    if (uid) {
      const u = db.users.find((x) => x.id === uid);
      if (u) {
        u.verified = 1;
        await saveDb(db);
        const sess = makeSession(u.id);
        return { statusCode: 302, headers: { Location: `/?verified=1&session_token=${encodeURIComponent(sess)}` }, body: "" };
      }
    }
    return { statusCode: 302, headers: { Location: "/?verified=0" }, body: "" };
  }

  if (method === "POST" && path === "/api/register") {
    const email = String(body.email || "").trim().toLowerCase();
    const pw = String(body.password || "");
    const firstName = String(body.firstName || body.name || "").trim().slice(0, 40);
    const lastName = String(body.lastName || "").trim().slice(0, 40);
    const age = parseInt(body.age, 10);
    const gender = String(body.gender || "").trim().slice(0, 30);
    const phone = String(body.phone || "").trim().slice(0, 25);
    const city = String(body.city || "").trim().slice(0, 60);
    const goal = String(body.goal || "Remise en forme").trim().slice(0, 60);
    const fullName = [firstName, lastName].filter(Boolean).join(" ");

    if (!firstName || !lastName) return reply(400, { error: "Indique ton prénom et ton nom." });
    if (isNaN(age) || age < 13 || age > 100) return reply(400, { error: "Indique un âge valide (13 à 100 ans)." });
    if (!gender) return reply(400, { error: "Sélectionne ton genre." });
    if (!phone || phone.length < 6) return reply(400, { error: "Indique ton numéro de téléphone." });
    if (!city) return reply(400, { error: "Indique ta ville." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return reply(400, { error: "Adresse e-mail invalide." });
    if (pw.length < 8) return reply(400, { error: "Le mot de passe doit faire au moins 8 caractères." });

    let u = db.users.find((x) => x.email === email);
    if (u && u.verified) return reply(409, { error: "Un compte existe déjà avec cet e-mail." });
    if (u) {
      Object.assign(u, { pw_hash: hashPw(pw), firstName, lastName, name: fullName, age, gender, phone, city, goal });
    } else {
      u = {
        id: db.nextUserId++,
        email,
        firstName,
        lastName,
        name: fullName,
        age,
        gender,
        phone,
        city,
        goal,
        pw_hash: hashPw(pw),
        verified: 0,
        google_sub: "",
        ngo: "UNICEF",
        created_at: Math.floor(Date.now() / 1000),
      };
      db.users.push(u);
    }
    const link = `${baseUrl}/api/verify?token=${newToken(db, u.id, "verify", 48)}`;
    await saveDb(db);
    const mail = await sendMail(db.settings, {
      to: email,
      name: firstName,
      subject: `${firstName}, confirme ton inscription sur PACT`,
      title: `Confirme ton inscription, ${firstName} !`,
      text: `Ton compte PACT (${fullName}, ${age} ans — ${city}) est presque prêt. Clique sur le bouton ci-dessous pour confirmer ton adresse ${email} et commencer à programmer tes entraînements.`,
      btn: "Confirmer mon inscription",
      link,
      kind: "verify",
    });
    return reply(200, { ok: true, sent: mail.sent, userName: firstName });
  }

  if (method === "POST" && path === "/api/resend") {
    const email = String(body.email || "").trim().toLowerCase();
    const u = db.users.find((x) => x.email === email);
    let link = null, sent = false;
    if (u && !u.verified) {
      link = `${baseUrl}/api/verify?token=${newToken(db, u.id, "verify", 48)}`;
      await saveDb(db);
      const mail = await sendMail(db.settings, {
        to: email,
        name: u.name,
        subject: `${u.name}, confirme ton inscription sur PACT`,
        title: `Confirme ton inscription, ${u.name} !`,
        text: `Clique sur le bouton ci-dessous pour confirmer ton adresse ${email} et activer ton compte PACT.`,
        btn: "Confirmer mon inscription",
        link,
        kind: "verify",
      });
      sent = mail.sent;
    }
    return reply(200, { ok: true, sent, devLink: link, userName: u ? u.name : "" });
  }

  if (method === "POST" && path === "/api/login") {
    const email = String(body.email || "").trim().toLowerCase();
    const pw = String(body.password || "");
    const u = db.users.find((x) => x.email === email);
    if (!u || !checkPw(pw, u.pw_hash)) return reply(401, { error: "E-mail ou mot de passe incorrect." });
    if (!u.verified) return reply(403, { error: "Confirme d'abord ton adresse e-mail." });
    return reply(200, { token: makeSession(u.id), user: userJson(u) });
  }

  if (method === "POST" && path === "/api/forgot") {
    const email = String(body.email || "").trim().toLowerCase();
    const u = db.users.find((x) => x.email === email);
    let link = null, sent = false;
    if (u) {
      link = `${baseUrl}/?reset=${newToken(db, u.id, "reset", 1)}`;
      await saveDb(db);
      const mail = await sendMail(db.settings, {
        to: email,
        name: u.name,
        subject: `${u.name}, réinitialise ton mot de passe PACT`,
        title: "Réinitialisation du mot de passe",
        text: `Tu as demandé à modifier le mot de passe de ton compte PACT (${email}). Clique ci-dessous pour en choisir un nouveau.`,
        btn: "Choisir un nouveau mot de passe",
        link,
        kind: "reset",
      });
      sent = mail.sent;
    }
    return reply(200, { ok: true, sent, devLink: link, userName: u ? u.name : "" });
  }

  if (method === "POST" && path === "/api/reset") {
    const pw = String(body.password || "");
    if (pw.length < 8) return reply(400, { error: "Le mot de passe doit faire au moins 8 caractères." });
    const uid = useToken(db, body.token || "", "reset");
    if (!uid) return reply(400, { error: "Lien invalide ou expiré." });
    const u = db.users.find((x) => x.id === uid);
    if (!u) return reply(400, { error: "Utilisateur introuvable." });
    u.pw_hash = hashPw(pw);
    u.verified = 1;
    await saveDb(db);
    return reply(200, { ok: true });
  }

  if (method === "POST" && path === "/api/google") {
    let sub = "", email = "", name = "";
    if (body.credential) {
      const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(body.credential));
      if (!r.ok) return reply(401, { error: "Jeton Google invalide." });
      const info = await r.json();
      if (googleClientId && info.aud !== googleClientId) return reply(401, { error: "Jeton Google non reconnu." });
      sub = info.sub;
      email = (info.email || "").toLowerCase();
      name = info.name || "";
    } else if (body.access_token) {
      const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${body.access_token}` },
      });
      if (!r.ok) return reply(401, { error: "Jeton Google invalide." });
      const info = await r.json();
      sub = info.sub;
      email = (info.email || "").toLowerCase();
      name = info.name || "";
    } else {
      return reply(400, { error: "Jeton OAuth Google manquant." });
    }
    const u = socialUpsert(db, sub, email, name);
    await saveDb(db);
    return reply(200, { token: makeSession(u.id), user: userJson(u) });
  }

  // Authenticated routes
  const auth = headers["authorization"] || headers["Authorization"] || "";
  const uid = auth.startsWith("Bearer ") ? readSession(auth.slice(7)) : null;
  const user = uid ? db.users.find((x) => x.id === uid) : null;

  // Admin / Study Export routes (strictly reserved for eliottlcx@gmail.com)
  const isAdmin = Boolean(user && String(user.email || "").toLowerCase() === "eliottlcx@gmail.com");

  if (path === "/api/admin/users" && method === "GET") {
    if (!isAdmin) return reply(403, { error: "Accès réservé au compte administrateur (eliottlcx@gmail.com)." });
    const rows = db.users.map((u) => {
      const st = computeStats(db, u.id);
      const totalPacts = db.pacts.filter((p) => p.user_id === u.id).length;
      const provider = [u.pw_hash && "E-mail", u.google_sub && "Google"].filter(Boolean).join(" + ") || "E-mail";
      return {
        ...userJson(u),
        provider,
        verified: Boolean(u.verified),
        createdAt: u.created_at ? new Date(u.created_at * 1000).toISOString() : "",
        totalPacts,
        pactsCount: totalPacts,
        doneCount: st.doneCount,
        failedCount: st.failedCount,
        saved: st.saved,
        savedAmount: st.saved,
        lost: st.lost,
        lostAmount: st.lost,
      };
    });
    return reply(200, { users: rows, totalUsers: rows.length, totalPacts: db.pacts.length });
  }

  const adminClearMatch = path.match(/^\/api\/admin\/users\/(\d+)\/history$/);
  if (adminClearMatch && method === "DELETE") {
    if (!isAdmin) return reply(403, { error: "Non autorisé." });
    const targetId = parseInt(adminClearMatch[1], 10);
    const removed = db.pacts.filter((p) => p.user_id === targetId).length;
    db.pacts = db.pacts.filter((p) => p.user_id !== targetId);
    await saveDb(db);
    return reply(200, { ok: true, removed });
  }

  const adminDelMatch = path.match(/^\/api\/admin\/users\/(\d+)$/);
  if (adminDelMatch && method === "DELETE") {
    if (!isAdmin) return reply(403, { error: "Non autorisé." });
    const targetId = parseInt(adminDelMatch[1], 10);
    db.pacts = db.pacts.filter((p) => p.user_id !== targetId);
    db.tokens = db.tokens.filter((t) => t.user_id !== targetId);
    db.users = db.users.filter((x) => x.id !== targetId);
    await saveDb(db);
    return reply(200, { ok: true });
  }

  // Public iCal feed subscription & direct .ics event export for Apple Calendar / Google Calendar (GET /api/calendar/:token.ics)
  const calFeedMatch = path.match(/^\/api\/calendar\/([A-Za-z0-9_-]+?)(?:\.ics)?$/);
  if (calFeedMatch && (method === "GET" || method === "HEAD") && !["import", "external", "refresh"].includes(calFeedMatch[1])) {
    const calUid = readCalToken(calFeedMatch[1]);
    const calUser = calUid ? db.users.find((x) => x.id === calUid) : null;
    if (!calUser) return reply(404, { error: "Calendrier introuvable." });
    const userPacts = db.pacts.filter((p) => p.user_id === calUser.id);
    const icsBody = buildIcsFeed(calUser, userPacts);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      },
      body: method === "HEAD" ? "" : icsBody,
    };
  }

  if (!user) return reply(401, { error: "Non connecté." });

  if (method === "DELETE" && path === "/api/me/history") {
    const removed = db.pacts.filter((p) => p.user_id === user.id).length;
    db.pacts = db.pacts.filter((p) => p.user_id !== user.id);
    await saveDb(db);
    return reply(200, { ok: true, removed });
  }

  // Connexion / Extraction d'un Google Calendar ou Apple Calendar externe (.ics URL ou fichier .ics)
  if (method === "POST" && path === "/api/calendar/import") {
    const sourceName = String(body.sourceName || "Calendrier externe").trim().slice(0, 40);
    let rawIcs = String(body.icsText || "");
    let calUrl = String(body.url || "").trim();
    if (calUrl) {
      const fetchUrl = calUrl.replace(/^webcals?:\/\//i, "https://");
      if (!/^https?:\/\//i.test(fetchUrl)) {
        return reply(400, { error: "Lien de calendrier invalide (utilise un lien https:// ou webcal://)." });
      }
      try {
        const r = await fetch(fetchUrl, { headers: { "User-Agent": "PACT-Calendar-Sync/1.0" } });
        if (!r.ok) return reply(400, { error: "Impossible de lire ce lien de calendrier (vérifie que l'adresse iCal est publique ou secrète)." });
        rawIcs = await r.text();
      } catch {
        return reply(400, { error: "Impossible de récupérer le calendrier depuis cette adresse." });
      }
    }
    if (!rawIcs || !rawIcs.includes("BEGIN:VCALENDAR")) {
      return reply(400, { error: "Le contenu fourni n'est pas un agenda iCal (.ics) valide." });
    }
    const extracted = parseIcsText(rawIcs, sourceName);
    user.ext_cal_name = sourceName;
    if (calUrl) user.ext_cal_url = calUrl;
    user.ext_events = extracted;
    await saveDb(db);
    return reply(200, { ok: true, importedCount: extracted.length, user: userJson(user), extEvents: extracted });
  }

  if (method === "DELETE" && path === "/api/calendar/external") {
    user.ext_cal_name = "";
    user.ext_cal_url = "";
    user.ext_events = [];
    await saveDb(db);
    return reply(200, { ok: true, user: userJson(user) });
  }

  if (method === "GET" && path === "/api/me") return reply(200, { user: userJson(user) });

  if (method === "PATCH" && path === "/api/me") {
    if (body.firstName !== undefined) user.firstName = String(body.firstName).trim().slice(0, 40);
    if (body.lastName !== undefined) user.lastName = String(body.lastName).trim().slice(0, 40);
    if (body.firstName !== undefined || body.lastName !== undefined) {
      user.name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.name;
    } else if (body.name !== undefined) {
      user.name = String(body.name).trim().slice(0, 60) || user.name;
    }
    if (body.age !== undefined) {
      const age = parseInt(body.age, 10);
      if (isNaN(age) || age < 13 || age > 100) return reply(400, { error: "Indique un âge valide (13 à 100 ans)." });
      user.age = age;
    }
    if (body.gender !== undefined) user.gender = String(body.gender).trim().slice(0, 30);
    if (body.phone !== undefined) user.phone = String(body.phone).trim().slice(0, 25);
    if (body.city !== undefined) user.city = String(body.city).trim().slice(0, 60);
    if (body.goal !== undefined) user.goal = String(body.goal).trim().slice(0, 60);
    if (body.ngo !== undefined) {
      if (!NGOS.includes(body.ngo)) return reply(400, { error: "Association inconnue." });
      user.ngo = body.ngo;
    }
    await saveDb(db);
    return reply(200, { user: userJson(user) });
  }

  if (method === "POST" && path === "/api/me/password") {
    const pw = String(body.password || "");
    if (pw.length < 8) return reply(400, { error: "Le mot de passe doit faire au moins 8 caractères." });
    if (user.pw_hash && !checkPw(String(body.current || ""), user.pw_hash)) return reply(403, { error: "Mot de passe actuel incorrect." });
    user.pw_hash = hashPw(pw);
    await saveDb(db);
    return reply(200, { ok: true });
  }

  if (method === "DELETE" && path === "/api/me") {
    // 1. Supprimer sur Netlify Identity si présent
    try {
      const idCtx = context && context.clientContext && context.clientContext.identity;
      if (idCtx && idCtx.url && idCtx.token && user.google_sub) {
        await fetch(`${idCtx.url}/admin/users/${user.google_sub}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${idCtx.token}` },
        });
      }
    } catch {}
    // 2. Supprimer l'historique complet des séances, jetons et le compte dans Netlify Blobs
    db.pacts = db.pacts.filter((p) => p.user_id !== user.id);
    db.tokens = db.tokens.filter((t) => t.user_id !== user.id);
    db.users = db.users.filter((x) => x.id !== user.id);
    await saveDb(db);
    return reply(200, { ok: true, deletedUserId: user.id });
  }

  const expChanged = resolveExpired(db, user, tz);
  if (expChanged) await saveDb(db);

  if (method === "GET" && path === "/api/pacts") {
    const from = qs.from || "0000-01-01";
    const to = qs.to || "9999-12-31";
    const pacts = db.pacts
      .filter((p) => p.user_id === user.id && p.date >= from && p.date <= to)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const extEvents = (Array.isArray(user.ext_events) ? user.ext_events : [])
      .filter((e) => e.date >= from && e.date <= to)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    // Regrouper les séries récurrentes actives (séances en attente)
    const seriesMap = {};
    for (const p of db.pacts) {
      if (p.user_id === user.id && p.series_id && p.status === "pending") {
        if (!seriesMap[p.series_id]) {
          seriesMap[p.series_id] = {
            seriesId: p.series_id,
            sport: p.sport,
            place: p.place || "",
            time: p.time,
            stake: p.stake,
            label: p.recurrence_label || "Récurrent",
            remainingCount: 0,
          };
        }
        seriesMap[p.series_id].remainingCount++;
      }
    }
    return reply(200, {
      pacts,
      extEvents,
      series: Object.values(seriesMap),
      stats: computeStats(db, user.id),
      now: fmtDt(localNow(tz)),
    });
  }

  if (method === "GET" && path === "/api/stats") return reply(200, computeStats(db, user.id));

  const seriesDelMatch = path.match(/^\/api\/series\/([A-Za-z0-9_-]+)$/);
  if (seriesDelMatch && method === "DELETE") {
    const sid = seriesDelMatch[1];
    const before = db.pacts.length;
    db.pacts = db.pacts.filter((p) => !(p.user_id === user.id && p.series_id === sid && p.status === "pending"));
    const removed = before - db.pacts.length;
    await saveDb(db);
    return reply(200, { ok: true, removed, stats: computeStats(db, user.id) });
  }

  if (method === "POST" && path === "/api/pacts") {
    const sport = String(body.sport || "").trim();
    if (!SPORTS.includes(sport)) return reply(400, { error: "Activité invalide." });
    const date = String(body.date || "");
    const time = String(body.time || "");
    const stake = parseInt(body.stake, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || isNaN(stake)) return reply(400, { error: "Date, heure ou mise invalide." });
    if (stake < 1 || stake > 10) return reply(400, { error: "La mise doit être entre 1 € et 10 €." });

    const rec = body.recurrence || {};
    const recMode = ["daily", "weekly"].includes(rec.mode) ? rec.mode : "none";
    const weeks = Math.min(12, Math.max(1, parseInt(rec.weeks, 10) || 4));
    const dayLabels = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
    const now = localNow(tz);

    const targetDates = [];
    let recurrenceLabel = "";
    if (recMode === "none") {
      if (parseLocal(date, time) < now) return reply(400, { error: "Impossible de programmer une séance dans le passé." });
      targetDates.push(date);
    } else if (recMode === "daily") {
      recurrenceLabel = `Tous les jours (${weeks} sem.)`;
      const startObj = new Date(`${date}T00:00:00Z`);
      const totalDays = weeks * 7;
      for (let i = 0; i < totalDays; i++) {
        const dStr = new Date(startObj.getTime() + i * 86400000).toISOString().slice(0, 10);
        if (parseLocal(dStr, time) >= now) targetDates.push(dStr);
      }
    } else if (recMode === "weekly") {
      const startObj = new Date(`${date}T00:00:00Z`);
      const startDow = (startObj.getUTCDay() + 6) % 7;
      const days = Array.isArray(rec.days) && rec.days.length
        ? rec.days.map((d) => parseInt(d, 10)).filter((d) => d >= 0 && d <= 6)
        : [startDow];
      recurrenceLabel = `${days.map((d) => dayLabels[d]).join(", ")} (${weeks} sem.)`;
      const totalDays = weeks * 7;
      for (let i = 0; i < totalDays; i++) {
        const cur = new Date(startObj.getTime() + i * 86400000);
        const dow = (cur.getUTCDay() + 6) % 7;
        const dStr = cur.toISOString().slice(0, 10);
        if (days.includes(dow) && parseLocal(dStr, time) >= now) targetDates.push(dStr);
      }
    }

    if (!targetDates.length) {
      return reply(400, { error: "Aucune date future valide pour cette récurrence." });
    }

    const seriesId = targetDates.length > 1 ? `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}` : null;
    const placeClean = String(body.place || "").trim().slice(0, 120);
    const created = [];
    for (const dStr of targetDates) {
      const pact = {
        id: db.nextPactId++,
        user_id: user.id,
        sport,
        place: placeClean,
        date: dStr,
        time,
        stake,
        status: "pending",
        delayed: 0,
        log_title: "",
        log_detail: "",
        lat: null,
        lng: null,
        ngo: null,
        auto: 0,
        series_id: seriesId,
        recurrence_label: recurrenceLabel,
        created_at: Math.floor(Date.now() / 1000),
        resolved_at: null,
      };
      db.pacts.push(pact);
      created.push(pact);
    }
    await saveDb(db);
    return reply(200, {
      pact: created[0],
      createdCount: created.length,
      createdIds: created.map((x) => x.id),
      calToken: makeCalToken(user.id),
      seriesId,
    });
  }

  const m = path.match(/^\/api\/pacts\/(\d+)(?:\/(checkin|delay|miss))?$/);
  if (m) {
    const pid = parseInt(m[1], 10);
    const action = m[2];
    const p = db.pacts.find((x) => x.id === pid && x.user_id === user.id);
    if (!p) return reply(404, { error: "Séance introuvable." });
    if (p.status !== "pending") return reply(409, { error: "Cette séance est déjà clôturée." });
    const now = localNow(tz);
    const start = parseLocal(p.date, p.time);

    if (action === "checkin" && method === "POST") {
      if (now < new Date(start.getTime() - OPEN_BEFORE_MIN * 60000)) {
        return reply(400, { error: `La validation s'ouvre ${OPEN_BEFORE_MIN} min avant la séance.` });
      }
      p.status = "done";
      p.log_title = String(body.title || "").slice(0, 120);
      p.log_detail = String(body.detail || "").slice(0, 240);
      p.lat = typeof body.lat === "number" ? body.lat : null;
      p.lng = typeof body.lng === "number" ? body.lng : null;
      p.resolved_at = Math.floor(Date.now() / 1000);
      await saveDb(db);
      return reply(200, { pact: p, stats: computeStats(db, user.id) });
    }
    if (action === "delay" && method === "POST") {
      if (p.delayed) return reply(409, { error: "Le délai de 20 minutes a déjà été utilisé." });
      const next = new Date(start.getTime() + DELAY_MIN * 60000);
      p.delayed = 1;
      p.date = next.toISOString().slice(0, 10);
      p.time = next.toISOString().slice(11, 16);
      await saveDb(db);
      return reply(200, { pact: p, stats: computeStats(db, user.id) });
    }
    if (action === "miss" && method === "POST") {
      p.status = "failed";
      p.ngo = user.ngo || "UNICEF";
      p.resolved_at = Math.floor(Date.now() / 1000);
      await saveDb(db);
      return reply(200, { pact: p, stats: computeStats(db, user.id) });
    }
    if (!action && method === "DELETE") {
      if (qs.scope === "series" && p.series_id) {
        db.pacts = db.pacts.filter((x) => !(x.user_id === user.id && x.series_id === p.series_id && x.status === "pending"));
        await saveDb(db);
        return reply(200, { ok: true, stats: computeStats(db, user.id) });
      }
      if (now > new Date(start.getTime() - OPEN_BEFORE_MIN * 60000)) {
        return reply(400, { error: "Trop tard pour annuler : la séance démarre dans moins d'1 h." });
      }
      db.pacts = db.pacts.filter((x) => x.id !== pid);
      await saveDb(db);
      return reply(200, { ok: true, stats: computeStats(db, user.id) });
    }
  }

  return reply(404, { error: "Route inconnue." });
};
