#!/usr/bin/env python3
"""PACT — serveur (API + fichiers statiques). Aucune dépendance : Python 3.9+ uniquement.

Lancer :  python3 server.py      (config via .env, voir .env.example)
"""
import base64, hashlib, hmac, json, mimetypes, os, re, secrets, smtplib, sqlite3, ssl, sys, threading, time
import urllib.request, urllib.parse
from datetime import datetime, timedelta
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).parent.resolve()
PUBLIC = ROOT / "public"
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)


def load_env():
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env()
PORT = int(os.environ.get("PORT", "8000"))
HOST = os.environ.get("HOST", "0.0.0.0")
BASE_URL = os.environ.get("BASE_URL", f"http://localhost:{PORT}").rstrip("/")
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USER or "PACT <no-reply@pact.local>")
SMTP_SECURE = os.environ.get("SMTP_SECURE", "starttls")  # starttls | ssl
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
APPLE_CLIENT_ID = os.environ.get("APPLE_CLIENT_ID", "")  # Services ID
APPLE_REDIRECT_URI = os.environ.get("APPLE_REDIRECT_URI", BASE_URL)
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "capacitor://localhost,http://localhost,https://localhost").split(",") if o.strip()]
# En mode dev (SMTP non configuré) le lien est renvoyé à l'app et écrit dans data/outbox.log
DEV_LINKS = not SMTP_HOST

SESSION_DAYS = 60
GRACE_MIN = 60          # minutes après l'heure pour valider avant débit automatique
OPEN_BEFORE_MIN = 60    # la validation s'ouvre 1 h avant la séance
DELAY_MIN = 20
NGOS = ["UNICEF", "WWF", "Croix-Rouge", "MSF"]
SPORTS = ["Musculation", "Running", "CrossFit", "Boxe", "Yoga", "Natation", "Vélo", "Autre"]

_secret_file = DATA / "secret.key"
if not _secret_file.exists():
    _secret_file.write_text(secrets.token_hex(32))
SECRET = os.environ.get("SECRET_KEY") or _secret_file.read_text().strip()

# ---------------------------------------------------------------- base de données
_db_lock = threading.Lock()
db = sqlite3.connect(DATA / "pact.db", check_same_thread=False)
db.row_factory = sqlite3.Row
db.executescript("""
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
  pw_hash TEXT, verified INTEGER NOT NULL DEFAULT 0, google_sub TEXT, apple_sub TEXT,
  ngo TEXT NOT NULL DEFAULT 'UNICEF', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tokens(
  hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pacts(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, sport TEXT NOT NULL, place TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL, time TEXT NOT NULL, stake INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  delayed INTEGER NOT NULL DEFAULT 0, log_title TEXT DEFAULT '', log_detail TEXT DEFAULT '',
  lat REAL, lng REAL, ngo TEXT, auto INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, resolved_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_pacts_user ON pacts(user_id, date);
""")


def q(sql, args=(), one=False):
    with _db_lock:
        cur = db.execute(sql, args)
        rows = cur.fetchone() if one else cur.fetchall()
        db.commit()
        return rows


def qid(sql, args=()):
    with _db_lock:
        cur = db.execute(sql, args)
        db.commit()
        return cur.lastrowid


# ---------------------------------------------------------------- sécurité
def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 200_000).hex()
    return f"{salt}${h}"


def check_pw(pw, stored):
    if not stored:
        return False
    salt, _ = stored.split("$", 1)
    return hmac.compare_digest(hash_pw(pw, salt), stored)


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def b64d(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def make_session(uid):
    payload = b64u(json.dumps({"uid": uid, "exp": int(time.time()) + SESSION_DAYS * 86400}).encode())
    sig = b64u(hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def read_session(tok):
    try:
        payload, sig = tok.split(".")
        good = b64u(hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, good):
            return None
        d = json.loads(b64d(payload))
        return d["uid"] if d["exp"] > time.time() else None
    except Exception:
        return None


def new_token(uid, kind, hours):
    raw = secrets.token_urlsafe(32)
    q("DELETE FROM tokens WHERE user_id=? AND kind=?", (uid, kind))
    q("INSERT INTO tokens VALUES(?,?,?,?)", (hashlib.sha256(raw.encode()).hexdigest(), uid, kind, int(time.time() + hours * 3600)))
    return raw


def use_token(raw, kind):
    h = hashlib.sha256(raw.encode()).hexdigest()
    row = q("SELECT * FROM tokens WHERE hash=? AND kind=?", (h, kind), one=True)
    if not row or row["expires"] < time.time():
        return None
    q("DELETE FROM tokens WHERE hash=?", (h,))
    return row["user_id"]


_rate = {}
_rate_lock = threading.Lock()


def rate_ok(key, limit=10, window=60):
    now = time.time()
    with _rate_lock:
        hits = [t for t in _rate.get(key, []) if now - t < window]
        if len(hits) >= limit:
            _rate[key] = hits
            return False
        hits.append(now)
        _rate[key] = hits
        return True


# ---------------------------------------------------------------- e-mail
def mail_html(title, text, btn, link):
    return f"""<div style="background:#0B0D13;padding:32px 16px;font-family:-apple-system,Segoe UI,Arial,sans-serif">
<div style="max-width:440px;margin:auto;background:#131722;border:1px solid rgba(0,229,255,.35);border-radius:24px;padding:32px;color:#F8FAFC">
<div style="font-size:26px;font-weight:800">PACT <span style="color:#00E5FF">●</span></div>
<h2 style="margin:24px 0 8px;font-size:20px">{title}</h2>
<p style="color:#94A3B8;line-height:1.6;font-size:14px">{text}</p>
<p style="margin:28px 0"><a href="{link}" style="background:#00E5FF;color:#06070A;padding:14px 24px;border-radius:16px;font-weight:700;text-decoration:none;font-size:14px">{btn}</a></p>
<p style="color:#64748B;font-size:12px">Ou copie ce lien :<br><span style="word-break:break-all">{link}</span></p>
</div></div>"""


def send_mail(to, subject, title, text, btn, link):
    with open(DATA / "outbox.log", "a") as f:
        f.write(f"[{datetime.now():%F %T}] To: {to} | {subject}\n  {link}\n")
    print(f"✉  {to} — {subject}\n   {link}", flush=True)
    if not SMTP_HOST:
        return

    def run():
        try:
            m = EmailMessage()
            m["From"], m["To"], m["Subject"] = SMTP_FROM, to, subject
            m.set_content(f"{title}\n\n{text}\n\n{btn} : {link}")
            m.add_alternative(mail_html(title, text, btn, link), subtype="html")
            if SMTP_SECURE == "ssl":
                s = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20, context=ssl.create_default_context())
            else:
                s = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20)
                s.starttls(context=ssl.create_default_context())
            if SMTP_USER:
                s.login(SMTP_USER, SMTP_PASS)
            s.send_message(m)
            s.quit()
        except Exception as e:
            print("Erreur SMTP:", e, flush=True)

    threading.Thread(target=run, daemon=True).start()


def send_verification(user):
    link = f"{BASE_URL}/api/verify?token={new_token(user['id'], 'verify', 48)}"
    send_mail(user["email"], "Confirme ton adresse e-mail — PACT", "Bienvenue sur PACT",
              "Confirme ton adresse e-mail pour activer ton compte et commencer à t'engager.", "Confirmer mon e-mail", link)
    return link


# ---------------------------------------------------------------- OAuth Google / Apple
def http_json(url, data=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": "pact"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def verify_google(credential):
    if not GOOGLE_CLIENT_ID:
        raise ApiError(501, "Connexion Google non configurée (GOOGLE_CLIENT_ID).")
    try:
        info = http_json("https://oauth2.googleapis.com/tokeninfo?id_token=" + urllib.parse.quote(credential))
    except Exception:
        raise ApiError(401, "Jeton Google invalide.")
    if info.get("aud") != GOOGLE_CLIENT_ID or info.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise ApiError(401, "Jeton Google invalide.")
    if str(info.get("email_verified")).lower() != "true":
        raise ApiError(401, "E-mail Google non vérifié.")
    return info["sub"], info["email"].lower(), info.get("name", "")


_RSA_SHA256 = bytes.fromhex("3031300d060960864801650304020105000420")


def rs256_verify(signing_input, sig, n_b64, e_b64):
    n, e = int.from_bytes(b64d(n_b64), "big"), int.from_bytes(b64d(e_b64), "big")
    k = (n.bit_length() + 7) // 8
    em = pow(int.from_bytes(sig, "big"), e, n).to_bytes(k, "big")
    digest = hashlib.sha256(signing_input).digest()
    t = _RSA_SHA256 + digest
    expected = b"\x00\x01" + b"\xff" * (k - len(t) - 3) + b"\x00" + t
    return hmac.compare_digest(em, expected)


def verify_apple(id_token):
    if not APPLE_CLIENT_ID:
        raise ApiError(501, "Connexion Apple non configurée (APPLE_CLIENT_ID).")
    try:
        h, p, s = id_token.split(".")
        header, claims = json.loads(b64d(h)), json.loads(b64d(p))
        keys = http_json("https://appleid.apple.com/auth/keys")["keys"]
        key = next(k for k in keys if k["kid"] == header["kid"])
        ok = header.get("alg") == "RS256" and rs256_verify(f"{h}.{p}".encode(), b64d(s), key["n"], key["e"])
    except Exception:
        raise ApiError(401, "Jeton Apple invalide.")
    if not ok or claims.get("iss") != "https://appleid.apple.com" or claims.get("aud") != APPLE_CLIENT_ID or claims.get("exp", 0) < time.time():
        raise ApiError(401, "Jeton Apple invalide.")
    return claims["sub"], (claims.get("email") or "").lower(), ""


def social_login(provider, sub, email, name):
    col = "google_sub" if provider == "google" else "apple_sub"
    u = q(f"SELECT * FROM users WHERE {col}=?", (sub,), one=True)
    if not u and email:
        u = q("SELECT * FROM users WHERE email=?", (email,), one=True)
        if u:
            q(f"UPDATE users SET {col}=?, verified=1 WHERE id=?", (sub, u["id"]))
    if not u:
        if not email:
            raise ApiError(400, "Adresse e-mail non fournie par le fournisseur.")
        uid = qid(f"INSERT INTO users(email,name,verified,{col},created_at) VALUES(?,?,1,?,?)", (email, name or email.split("@")[0], sub, int(time.time())))
        u = q("SELECT * FROM users WHERE id=?", (uid,), one=True)
    return u


# ---------------------------------------------------------------- logique métier
class ApiError(Exception):
    def __init__(self, status, msg):
        self.status, self.msg = status, msg


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")


def user_json(u):
    return {"id": u["id"], "email": u["email"], "name": u["name"], "ngo": u["ngo"],
            "hasPassword": bool(u["pw_hash"]), "google": bool(u["google_sub"]), "apple": bool(u["apple_sub"])}


def local_now(tz):
    return datetime.utcnow() - timedelta(minutes=tz)


def start_dt(p):
    return datetime.strptime(f"{p['date']} {p['time']}", "%Y-%m-%d %H:%M")


def resolve_expired(user, tz):
    now = local_now(tz)
    for p in q("SELECT * FROM pacts WHERE user_id=? AND status='pending'", (user["id"],)):
        if now > start_dt(p) + timedelta(minutes=GRACE_MIN):
            q("UPDATE pacts SET status='failed', auto=1, ngo=?, resolved_at=? WHERE id=?", (user["ngo"], int(time.time()), p["id"]))


def pact_json(p):
    return {k: p[k] for k in ("id", "sport", "place", "date", "time", "stake", "status", "delayed", "log_title", "log_detail", "ngo", "auto")}


def stats(uid):
    r = lambda s, a=(): q(s, a, one=True)
    saved = r("SELECT COALESCE(SUM(stake),0) s, COUNT(*) c FROM pacts WHERE user_id=? AND status='done'", (uid,))
    lost = r("SELECT COALESCE(SUM(stake),0) s, COUNT(*) c FROM pacts WHERE user_id=? AND status='failed'", (uid,))
    by_ngo = {row["ngo"] or "—": round(row["s"] * 0.2, 2) for row in q("SELECT ngo, SUM(stake) s FROM pacts WHERE user_id=? AND status='failed' GROUP BY ngo", (uid,))}
    streak = 0
    for row in q("SELECT status FROM pacts WHERE user_id=? AND status!='pending' ORDER BY date DESC, time DESC", (uid,)):
        if row["status"] != "done":
            break
        streak += 1
    return {"saved": saved["s"], "doneCount": saved["c"], "lost": lost["s"], "failedCount": lost["c"],
            "ngoAmount": round(lost["s"] * 0.2, 2), "pactAmount": round(lost["s"] * 0.8, 2), "byNgo": by_ngo, "streak": streak}


def validate_pact(b):
    sport = str(b.get("sport", "")).strip()
    if sport not in SPORTS:
        raise ApiError(400, "Activité invalide.")
    try:
        datetime.strptime(b["date"], "%Y-%m-%d"); datetime.strptime(b["time"], "%H:%M")
        stake = int(b["stake"])
    except Exception:
        raise ApiError(400, "Date, heure ou mise invalide.")
    if not 1 <= stake <= 10:
        raise ApiError(400, "La mise doit être entre 1 € et 10 €.")
    return sport, str(b.get("place", "")).strip()[:120], b["date"], b["time"], stake


# ---------------------------------------------------------------- routes
def route(h, method, path, body, user):
    """Retourne (status, json, extra_headers) ou lève ApiError."""
    ip = h.client_address[0]
    tz = int(h.headers.get("X-TZ-Offset", "0") or 0)
    need = lambda: user or (_ for _ in ()).throw(ApiError(401, "Non connecté."))

    if method == "GET" and path == "/api/config":
        return {"googleClientId": GOOGLE_CLIENT_ID, "appleClientId": APPLE_CLIENT_ID, "appleRedirectUri": APPLE_REDIRECT_URI,
                "ngos": NGOS, "sports": SPORTS, "graceMin": GRACE_MIN, "openBeforeMin": OPEN_BEFORE_MIN}

    if method == "POST" and path == "/api/register":
        if not rate_ok("reg" + ip, 8, 3600):
            raise ApiError(429, "Trop de tentatives, réessaie plus tard.")
        email, pw, name = str(body.get("email", "")).strip().lower(), str(body.get("password", "")), str(body.get("name", "")).strip()[:60]
        if not EMAIL_RE.match(email): raise ApiError(400, "Adresse e-mail invalide.")
        if len(pw) < 8: raise ApiError(400, "Le mot de passe doit faire au moins 8 caractères.")
        if not name: raise ApiError(400, "Indique ton prénom.")
        u = q("SELECT * FROM users WHERE email=?", (email,), one=True)
        if u and u["verified"]:
            raise ApiError(409, "Un compte existe déjà avec cet e-mail.")
        if u:
            q("UPDATE users SET pw_hash=?, name=? WHERE id=?", (hash_pw(pw), name, u["id"]))
        else:
            qid("INSERT INTO users(email,name,pw_hash,created_at) VALUES(?,?,?,?)", (email, name, hash_pw(pw), int(time.time())))
        u = q("SELECT * FROM users WHERE email=?", (email,), one=True)
        link = send_verification(u)
        return {"ok": True, "devLink": link if DEV_LINKS else None}

    if method == "POST" and path == "/api/resend":
        if not rate_ok("rs" + ip, 5, 600): raise ApiError(429, "Trop de demandes.")
        u = q("SELECT * FROM users WHERE email=?", (str(body.get("email", "")).strip().lower(),), one=True)
        link = send_verification(u) if u and not u["verified"] else None
        return {"ok": True, "devLink": link if DEV_LINKS else None}

    if method == "GET" and path == "/api/verify":
        raise ApiError(0, "verify")  # géré à part

    if method == "POST" and path == "/api/login":
        if not rate_ok("login" + ip, 10, 300): raise ApiError(429, "Trop de tentatives, réessaie dans quelques minutes.")
        u = q("SELECT * FROM users WHERE email=?", (str(body.get("email", "")).strip().lower(),), one=True)
        if not u or not check_pw(str(body.get("password", "")), u["pw_hash"]):
            raise ApiError(401, "E-mail ou mot de passe incorrect.")
        if not u["verified"]:
            raise ApiError(403, "Confirme d'abord ton adresse e-mail (vérifie ta boîte de réception).")
        return {"token": make_session(u["id"]), "user": user_json(u)}

    if method == "POST" and path == "/api/forgot":
        if not rate_ok("fg" + ip, 5, 600): raise ApiError(429, "Trop de demandes.")
        u = q("SELECT * FROM users WHERE email=?", (str(body.get("email", "")).strip().lower(),), one=True)
        link = None
        if u:
            link = f"{BASE_URL}/?reset={new_token(u['id'], 'reset', 1)}"
            send_mail(u["email"], "Réinitialisation du mot de passe — PACT", "Nouveau mot de passe",
                      "Clique sur le bouton pour choisir un nouveau mot de passe. Le lien expire dans 1 heure.", "Choisir un mot de passe", link)
        return {"ok": True, "devLink": link if DEV_LINKS else None}

    if method == "POST" and path == "/api/reset":
        pw = str(body.get("password", ""))
        if len(pw) < 8: raise ApiError(400, "Le mot de passe doit faire au moins 8 caractères.")
        uid = use_token(str(body.get("token", "")), "reset")
        if not uid: raise ApiError(400, "Lien invalide ou expiré.")
        q("UPDATE users SET pw_hash=?, verified=1 WHERE id=?", (hash_pw(pw), uid))
        return {"ok": True}

    if method == "POST" and path == "/api/google":
        if not rate_ok("oa" + ip, 20, 300): raise ApiError(429, "Trop de tentatives.")
        u = social_login("google", *verify_google(str(body.get("credential", ""))))
        return {"token": make_session(u["id"]), "user": user_json(u)}

    if method == "POST" and path == "/api/apple":
        if not rate_ok("oa" + ip, 20, 300): raise ApiError(429, "Trop de tentatives.")
        sub, email, _ = verify_apple(str(body.get("id_token", "")))
        u = social_login("apple", sub, email, str(body.get("name", "")).strip()[:60])
        return {"token": make_session(u["id"]), "user": user_json(u)}

    # ---- authentifié
    u = need()
    if method == "GET" and path == "/api/me":
        return {"user": user_json(u)}
    if method == "PATCH" and path == "/api/me":
        name = str(body.get("name", u["name"])).strip()[:60] or u["name"]
        ngo = body.get("ngo", u["ngo"])
        if ngo not in NGOS: raise ApiError(400, "Association inconnue.")
        q("UPDATE users SET name=?, ngo=? WHERE id=?", (name, ngo, u["id"]))
        return {"user": user_json(q("SELECT * FROM users WHERE id=?", (u["id"],), one=True))}
    if method == "POST" and path == "/api/me/password":
        pw = str(body.get("password", ""))
        if len(pw) < 8: raise ApiError(400, "Le mot de passe doit faire au moins 8 caractères.")
        if u["pw_hash"] and not check_pw(str(body.get("current", "")), u["pw_hash"]):
            raise ApiError(403, "Mot de passe actuel incorrect.")
        q("UPDATE users SET pw_hash=? WHERE id=?", (hash_pw(pw), u["id"]))
        return {"ok": True}
    if method == "DELETE" and path == "/api/me":
        q("DELETE FROM pacts WHERE user_id=?", (u["id"],)); q("DELETE FROM tokens WHERE user_id=?", (u["id"],)); q("DELETE FROM users WHERE id=?", (u["id"],))
        return {"ok": True}

    resolve_expired(u, tz)
    if method == "GET" and path == "/api/pacts":
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(h.path).query)
        a, b = qs.get("from", ["0000-01-01"])[0], qs.get("to", ["9999-12-31"])[0]
        rows = q("SELECT * FROM pacts WHERE user_id=? AND date BETWEEN ? AND ? ORDER BY date, time", (u["id"], a, b))
        return {"pacts": [pact_json(p) for p in rows], "stats": stats(u["id"]), "now": local_now(tz).strftime("%Y-%m-%d %H:%M")}
    if method == "GET" and path == "/api/stats":
        return stats(u["id"])
    if method == "POST" and path == "/api/pacts":
        sport, place, date, tm, stake = validate_pact(body)
        if datetime.strptime(f"{date} {tm}", "%Y-%m-%d %H:%M") < local_now(tz):
            raise ApiError(400, "Impossible de programmer une séance dans le passé.")
        pid = qid("INSERT INTO pacts(user_id,sport,place,date,time,stake,created_at) VALUES(?,?,?,?,?,?,?)", (u["id"], sport, place, date, tm, stake, int(time.time())))
        return {"pact": pact_json(q("SELECT * FROM pacts WHERE id=?", (pid,), one=True))}

    m = re.match(r"^/api/pacts/(\d+)(?:/(checkin|delay))?$", path)
    if m:
        p = q("SELECT * FROM pacts WHERE id=? AND user_id=?", (int(m.group(1)), u["id"]), one=True)
        if not p: raise ApiError(404, "Séance introuvable.")
        action, now = m.group(2), local_now(tz)
        if p["status"] != "pending": raise ApiError(409, "Cette séance est déjà clôturée.")
        if action == "checkin" and method == "POST":
            if now < start_dt(p) - timedelta(minutes=OPEN_BEFORE_MIN):
                raise ApiError(400, f"La validation s'ouvre {OPEN_BEFORE_MIN} min avant la séance.")
            lat, lng = body.get("lat"), body.get("lng")
            q("UPDATE pacts SET status='done', log_title=?, log_detail=?, lat=?, lng=?, resolved_at=? WHERE id=?",
              (str(body.get("title", ""))[:120], str(body.get("detail", ""))[:240], lat if isinstance(lat, (int, float)) else None,
               lng if isinstance(lng, (int, float)) else None, int(time.time()), p["id"]))
        elif action == "delay" and method == "POST":
            if p["delayed"]: raise ApiError(409, "Le délai de 20 minutes a déjà été utilisé.")
            new = start_dt(p) + timedelta(minutes=DELAY_MIN)
            q("UPDATE pacts SET delayed=1, date=?, time=? WHERE id=?", (new.strftime("%Y-%m-%d"), new.strftime("%H:%M"), p["id"]))
        elif action is None and method == "DELETE":
            if now > start_dt(p) - timedelta(minutes=OPEN_BEFORE_MIN):
                raise ApiError(400, "Trop tard pour annuler : la séance démarre dans moins d'1 h.")
            q("DELETE FROM pacts WHERE id=?", (p["id"],))
            return {"ok": True, "stats": stats(u["id"])}
        elif action == "miss" or (action is None and method == "PATCH"):
            raise ApiError(405, "Action non autorisée.")
        else:
            raise ApiError(405, "Méthode non autorisée.")
        return {"pact": pact_json(q("SELECT * FROM pacts WHERE id=?", (p["id"],), one=True)), "stats": stats(u["id"])}

    m = re.match(r"^/api/pacts/(\d+)/miss$", path)
    if m and method == "POST":
        p = q("SELECT * FROM pacts WHERE id=? AND user_id=? AND status='pending'", (int(m.group(1)), u["id"]), one=True)
        if not p: raise ApiError(404, "Séance introuvable.")
        q("UPDATE pacts SET status='failed', ngo=?, resolved_at=? WHERE id=?", (u["ngo"], int(time.time()), p["id"]))
        return {"pact": pact_json(q("SELECT * FROM pacts WHERE id=?", (p["id"],), one=True)), "stats": stats(u["id"])}

    raise ApiError(404, "Route inconnue.")


class Handler(BaseHTTPRequestHandler):
    server_version = "PACT"

    def log_message(self, *a):
        pass

    def cors(self):
        o = self.headers.get("Origin")
        if o and (o in CORS_ORIGINS or o == BASE_URL):
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-TZ-Offset")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
            self.send_header("Vary", "Origin")

    def send_json(self, status, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.cors()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()

    def handle_api(self, method):
        path = urllib.parse.urlparse(self.path).path
        body = {}
        if method in ("POST", "PATCH"):
            try:
                n = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(min(n, 100_000)) or b"{}")
            except Exception:
                return self.send_json(400, {"error": "Requête invalide."})
        user = None
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            uid = read_session(auth[7:])
            if uid:
                user = q("SELECT * FROM users WHERE id=?", (uid,), one=True)
        try:
            if method == "GET" and path == "/api/verify":
                tok = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("token", [""])[0]
                uid = use_token(tok, "verify")
                if uid:
                    q("UPDATE users SET verified=1 WHERE id=?", (uid,))
                self.send_response(302)
                self.send_header("Location", "/?verified=1" if uid else "/?verified=0")
                self.end_headers()
                return
            self.send_json(200, route(self, method, path, body, user))
        except ApiError as e:
            self.send_json(e.status or 400, {"error": e.msg})
        except Exception as e:
            print("Erreur:", repr(e), flush=True)
            self.send_json(500, {"error": "Erreur serveur."})

    def static(self):
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        f = (PUBLIC / path.lstrip("/")).resolve()
        if path == "/" or not f.is_file() or PUBLIC not in f.parents:
            f = PUBLIC / "index.html"
        data = f.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", (mimetypes.guess_type(str(f))[0] or "application/octet-stream") + ("; charset=utf-8" if f.suffix in (".html", ".js", ".css", ".webmanifest") else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer-when-downgrade")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.handle_api("GET") if self.path.startswith("/api/") else self.static()

    def do_POST(self): self.handle_api("POST")
    def do_PATCH(self): self.handle_api("PATCH")
    def do_DELETE(self): self.handle_api("DELETE")


if __name__ == "__main__":
    print(f"PACT en ligne sur {BASE_URL}  (e-mails: {'SMTP ' + SMTP_HOST if SMTP_HOST else 'MODE DEV — liens dans la console et data/outbox.log'})")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

