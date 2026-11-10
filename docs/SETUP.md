# Configuration du mainteneur

## Google

Les clients fournis sont configurés sur GitHub. Pour une nouvelle installation de développement, renseignez les variables publiques dans `.env.local` à partir de `.env.example`.

- `VITE_GOOGLE_CLIENT_ID` : client OAuth **Application Web**.
- `VITE_GOOGLE_DESKTOP_CLIENT_ID` : client **Application de bureau** du même projet Google.
- `VITE_GOOGLE_DESKTOP_CLIENT_SECRET` : uniquement le champ du client installé, si requis. Une application installée est un client public. Ne placez jamais de secret de client Web dans le navigateur.

L’origine Web autorisée est `https://notes.flion.fr`. Pour tester localement, ajoutez vous-même `http://127.0.0.1:5173` aux origines autorisées du client Web. Les deux clients doivent rester dans le même projet pour partager le même dossier Drive.

La connexion à Notes demande les portées `openid email profile`. L’accès à `https://www.googleapis.com/auth/drive.appdata` est demandé lors du premier choix de Drive. Les autorisations déjà accordées sont réutilisées grâce à `include_granted_scopes`. La réponse `scope` permet de reprendre Drive sans second choix lorsque l’accès existe déjà. Activez Google Drive API. Vérifiez les utilisateurs de test dans **Google Auth Platform > Audience**. Pour ouvrir l’application à tous, passez l’audience en production et suivez les éventuelles exigences de vérification indiquées par Google.

L’accueil est `https://notes.flion.fr/`, la confidentialité `https://notes.flion.fr/privacy.html`. Le nom de consentement est **Notes**. Aucun secret de serveur ni compte de service n’est nécessaire.

[Configuration Google](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid) · [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) · [Appdata Drive](https://developers.google.com/workspace/drive/api/guides/appdata)

## Branding Google

La page d’accueil de l’écran OAuth doit être `https://notes.flion.fr/about.html`. Cette présentation statique est publique, décrit Notes et l’usage des données Google, et pointe vers `https://notes.flion.fr/privacy.html`. La page d’utilisation est `https://notes.flion.fr/terms.html`. L’application reste accessible directement à la racine sans modifier les origines OAuth ni la session mémorisée.

Le logo du branding doit être celui de Notes, avec la lettre N. Le fichier PNG du dépôt se trouve dans `src-tauri/icons/icon.png`.

## Cloudflare Pages

Dépôt : `https://github.com/arnaudlegoatdesdev/notes`.

| Paramètre | Valeur |
| --- | --- |
| Branche | main |
| Racine | Racine du dépôt |
| Framework | React avec Vite |
| Node |24 |
| Build | npm run build |
| Sortie | dist |

Variables de production : `NODE_VERSION=24` et `VITE_GOOGLE_CLIENT_ID` avec le client Web public. Les identifiants Desktop ne sont pas nécessaires au site.

Rattachez `notes.flion.fr` dans les domaines personnalisés du projet Pages, puis pointez uniquement son CNAME vers la cible fournie. Préservez les autres enregistrements de `flion.fr`. Vérifiez le site, ses assets et HTTPS avant de désactiver GitHub Pages.

La même origine garde le même stockage navigateur et les mêmes origines OAuth. Le fichier `public/_headers` fournit les en-têtes de sécurité, dont la compatibilité avec les fenêtres Google.

[Build Pages](https://developers.cloudflare.com/pages/configuration/build-configuration/) · [Domaine personnalisé](https://developers.cloudflare.com/pages/configuration/custom-domains/)

## Validation réelle

Connectez-vous avec un vrai compte Google. Vérifiez le choix local sans demande d’accès Drive, puis Drive avec lecture du quota, création sur Windows et ouverture sur téléphone. Testez aussi la fermeture puis réouverture, la déconnexion explicite, une modification dans l’autre sens, deux envois simultanés, un quota atteint et une connexion interrompue. Sur Windows, l’accès hors ligne conserve un jeton de renouvellement protégé par DPAPI. La session web reste ouverte même lorsque l’accès Drive doit être réautorisé. Les données des anciennes versions d’essai sont ignorées sans demander de mot de passe. La validation automatisée du dépôt ne prouve pas que l’audience et les API du projet Google ont été activées dans la console.
