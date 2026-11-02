"""Test de bout en bout de l'API (lance un serveur temporaire). Usage: python3 test_api.py"""
import json, os, re, subprocess, sys, time, urllib.request, urllib.error, tempfile, shutil
from datetime import datetime, timedelta

PORT = "8765"
env = dict(os.environ, PORT=PORT, BASE_URL=f"http://localhost:{PORT}", SMTP_HOST="")
tmp = tempfile.mkdtemp()
shutil.copytree(os.path.dirname(os.path.abspath(__file__)) + "/public", tmp + "/public")
shutil.copy(os.path.dirname(os.path.abspath(__file__)) + "/server.py", tmp + "/server.py")
srv = subprocess.Popen([sys.executable, "server.py"], cwd=tmp, env=env, stdout=subprocess.DEVNULL)
time.sleep(1.2)
B = f"http://localhost:{PORT}"


def call(m, p, body=None, tok=None):
    h = {"Content-Type": "application/json"}
    if tok: h["Authorization"] = "Bearer " + tok
    r = urllib.request.Request(B + p, json.dumps(body).encode() if body is not None else None, h, method=m)
    try:
        with urllib.request.urlopen(r) as x: return x.status, json.loads(x.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read())


def ok(cond, msg):
    print(("✓ " if cond else "✗ ") + msg)
    if not cond: raise SystemExit(1)


try:
    s, d = call("POST", "/api/register", {"email": "a@b.fr", "password": "short", "name": "A"}); ok(s == 400, "mot de passe court refusé")
    s, d = call("POST", "/api/register", {"email": "a@b.fr", "password": "motdepasse1", "name": "Alice"}); ok(s == 200 and d["devLink"], "inscription + lien dev")
    s, d2 = call("POST", "/api/login", {"email": "a@b.fr", "password": "motdepasse1"}); ok(s == 403, "login refusé avant confirmation")
    tok = d["devLink"].split("token=")[1]
    try: urllib.request.build_opener(type("N", (urllib.request.HTTPRedirectHandler,), {"redirect_request": lambda *a, **k: None})).open(d["devLink"])
    except urllib.error.HTTPError as e: ok(e.code == 302 and "verified=1" in e.headers["Location"], "confirmation e-mail")
    s, d = call("POST", "/api/login", {"email": "a@b.fr", "password": "mauvais"}); ok(s == 401, "mauvais mot de passe")
    s, d = call("POST", "/api/login", {"email": "a@b.fr", "password": "motdepasse1"}); ok(s == 200, "login"); T = d["token"]
    s, d = call("GET", "/api/me"); ok(s == 401, "API protégée")
    now = datetime.utcnow()
    day, soon = now.strftime("%Y-%m-%d"), (now + timedelta(minutes=30)).strftime("%H:%M")
    s, d = call("POST", "/api/pacts", {"sport": "Boxe", "place": "Club", "date": day, "time": soon, "stake": 5}, T); ok(s == 200, "création séance"); pid = d["pact"]["id"]
    s, d = call("POST", "/api/pacts", {"sport": "Boxe", "date": "2000-01-01", "time": "10:00", "stake": 5}, T); ok(s == 400, "passé refusé")
    s, d = call("POST", "/api/pacts", {"sport": "Boxe", "date": day, "time": soon, "stake": 50}, T); ok(s == 400, "mise > 10 refusée")
    s, d = call("POST", f"/api/pacts/{pid}/delay", None, T); ok(s == 200 and d["pact"]["delayed"], "retard +20 min")
    s, d = call("POST", f"/api/pacts/{pid}/delay", None, T); ok(s == 409, "retard une seule fois")
    s, d = call("POST", f"/api/pacts/{pid}/checkin", {"title": "Sparring", "lat": 45.7, "lng": 4.8}, T); ok(s == 200 and d["stats"]["saved"] == 5, "validation → 5 € protégés")
    s, d = call("POST", "/api/pacts", {"sport": "Yoga", "date": day, "time": "23:59", "stake": 4}, T); p2 = d["pact"]["id"]
    s, d = call("POST", f"/api/pacts/{p2}/miss", None, T); ok(s == 200 and d["stats"]["lost"] == 4 and d["stats"]["ngoAmount"] == 0.8, "séance manquée 20/80")
    s, d = call("POST", "/api/forgot", {"email": "a@b.fr"}); rt = d["devLink"].split("reset=")[1]
    s, d = call("POST", "/api/reset", {"token": rt, "password": "nouveaumdp1"}); ok(s == 200, "reset mot de passe")
    s, d = call("POST", "/api/reset", {"token": rt, "password": "nouveaumdp1"}); ok(s == 400, "lien reset à usage unique")
    s, d = call("POST", "/api/login", {"email": "a@b.fr", "password": "nouveaumdp1"}); ok(s == 200, "login nouveau mot de passe")
    s, d = call("POST", "/api/google", {"credential": "x"}); ok(s == 501, "Google non configuré → message clair")
    with urllib.request.urlopen(B + "/") as x: ok(b"PACT" in x.read(), "front servi")
    print("\nTous les tests passent.")
finally:
    srv.terminate(); shutil.rmtree(tmp, ignore_errors=True)

