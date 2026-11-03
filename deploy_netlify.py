#!/usr/bin/env python3
import hashlib, io, json, os, pathlib, sys, urllib.request, urllib.parse, zipfile

SITE_ID = "aefb4b28-19ef-4f30-bab4-0d6aebe59bcf"
TOKEN = sys.argv[1] if len(sys.argv) > 1 else os.environ["NETLIFY_AUTH_TOKEN"]
ROOT = pathlib.Path(__file__).parent.resolve()
PUBLIC = ROOT / "public"
FUNC_FILE = ROOT / "netlify" / "functions" / "api.js"

# 1. Collect static files and SHA1 hashes
files_sha1 = {}
files_bytes = {}
for p in PUBLIC.rglob("*"):
    if p.is_file():
        rel = "/" + p.relative_to(PUBLIC).as_posix()
        data = p.read_bytes()
        files_bytes[rel] = data
        files_sha1[rel] = hashlib.sha1(data).hexdigest()

# 2. Create zip for function "api" and compute SHA256
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
    zf.writestr("api.js", FUNC_FILE.read_bytes())
func_zip = buf.getvalue()
func_sha256 = hashlib.sha256(func_zip).hexdigest()

def req(method, path, body=None, ctype="application/json"):
    r = urllib.request.Request(
        "https://api.netlify.com/api/v1" + path,
        data=body,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": ctype},
        method=method,
    )
    with urllib.request.urlopen(r, timeout=60) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}

# 3. Create deploy
deploy = req("POST", f"/sites/{SITE_ID}/deploys", json.dumps({
    "files": files_sha1,
    "functions": {"api": func_sha256},
}).encode())

deploy_id = deploy["id"]
required_files = set(deploy.get("required", []))
required_funcs = set(deploy.get("required_functions", []))
print(f"Deploy created: {deploy_id} | Required files: {len(required_files)} | Required functions: {len(required_funcs)}")

# 4. Upload required static files
for rel, sha in files_sha1.items():
    if sha in required_files:
        qpath = "/".join(urllib.parse.quote(seg) for seg in rel.lstrip("/").split("/"))
        req("PUT", f"/deploys/{deploy_id}/files/{qpath}", files_bytes[rel], "application/octet-stream")
        print(f"  Uploaded file: {rel}")

# 5. Upload function if required
if func_sha256 in required_funcs or "api" in required_funcs:
    req("PUT", f"/deploys/{deploy_id}/functions/api?runtime=js", func_zip, "application/octet-stream")
    print("  Uploaded function: api")

final = req("GET", f"/sites/{SITE_ID}/deploys/{deploy_id}")
print("Deploy state:", final.get("state"), "| URL:", final.get("ssl_url"))

