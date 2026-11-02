# PACT — application complète

Backend Python (aucune dépendance, Python 3.9+) + front PWA installable (PC, iOS, Android) + wrapper natif Capacitor.

## Lancer
```bash
cd pact-app
cp .env.example .env      # puis remplir (voir ci-dessous)
python3 server.py         # http://localhost:8000
python3 test_api.py       # tests de bout en bout
```
Sans SMTP configuré (mode dev), les e-mails ne partent pas : le lien est affiché dans l'app, la console et `data/outbox.log`.

## Fonctionnalités
- Inscription e-mail + **e-mail de confirmation**, connexion, mot de passe oublié (lien 1 h, usage unique), changement de mot de passe
- **Google** (Google Identity Services) et **Apple** (Sign in with Apple JS) — jetons vérifiés côté serveur
- Agenda hebdomadaire réel (navigation par semaine), création de séances (date réelle, 8 sports, mise 1–10 €)
- Validation GPS (ouverte 1 h avant, jusqu'à +60 min), retard +20 min (1×), annulation gratuite > 1 h avant, séance manquée
- **Débit automatique** si non validée dans les temps, répartition 20 % ONG / 80 % PACT, bilan, série, historique
- Rappels de notification (30 min avant), installation sur l'écran d'accueil, mode hors-ligne pour l'interface

## Activer les connexions
- **Google** : console.cloud.google.com → Identifiants → ID client OAuth « Application Web » ; origine JS autorisée = `BASE_URL` ; mettre `GOOGLE_CLIENT_ID`.
- **Apple** : compte Apple Developer → Identifiers → Services ID + domaine vérifié (HTTPS obligatoire) ; `APPLE_CLIENT_ID`, `APPLE_REDIRECT_URI`.
- **SMTP** : Brevo, Mailjet, Gmail (mot de passe d'application), OVH… → `SMTP_*`.

## Mise en ligne
Déployer sur un hébergeur Python avec HTTPS (Render, Railway, Fly.io, VPS + Caddy/nginx). Garder le dossier `data/` persistant (SQLite + clé secrète). Mettre `BASE_URL` en `https://…`.

## Applications natives (iOS / Android)
Une fois le serveur en ligne en HTTPS :
```bash
npm init -y && npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
# dans public/config.js : window.PACT_API = 'https://pact.mondomaine.fr'
npx cap add ios && npx cap add android
npx cap sync && npx cap open ios   # ou android
```
`capacitor.config.json` est déjà fourni (dossier `public`). Pour Google/Apple *natifs* dans l'app, ajouter les plugins
`@capgo/capacitor-social-login` : ils renvoient un `idToken` à envoyer à `POST /api/google` ou `/api/apple` (déjà gérés).
Apple impose « Sign in with Apple » dès qu'un autre login social est proposé sur l'App Store.

## Limites connues
- **Les paiements sont simulés** : la mise est comptabilisée mais aucun prélèvement réel. Pour de vrais débits : Stripe (SetupIntent + débit hors-session) à brancher sur `resolve_expired()` / `/miss`.
- Le GPS est enregistré mais pas comparé à la position de la salle (lieu saisi en texte).
- Tailwind est chargé via CDN (comme ton code d'origine) ; pour la prod, le compiler en CSS local.

