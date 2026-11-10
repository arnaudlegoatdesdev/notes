# Configuration du mainteneur

La distribution destinée aux utilisateurs doit déjà contenir les identifiants publics OAuth. Aucun secret de serveur confidentiel ne doit être placé dans une variable `VITE_*`, car ces valeurs font partie du code livré au navigateur.

## Google Drive

1. Créez un projet Google Cloud, activez Google Drive API et configurez l’écran de consentement Notes.
2. Créez un client OAuth de type **Application Web**. Autorisez les origines exactes de développement et de production, par exemple `http://127.0.0.1:5173` et `https://notes.flion.fr`.
3. Placez son identifiant public dans `VITE_GOOGLE_CLIENT_ID`.
4. Dans le même projet, créez un client OAuth de type **Application de bureau**. Placez son identifiant dans `VITE_GOOGLE_DESKTOP_CLIENT_ID`.
5. Si votre client de bureau nécessite le champ `client_secret` pour l’échange du code, placez uniquement le secret de ce client installé dans `VITE_GOOGLE_DESKTOP_CLIENT_SECRET`. Google considère les applications installées comme des clients publics, incapables de garder ce champ confidentiel. Ce n’est pas un secret de client Web et il ne doit pas être utilisé comme preuve d’identité de l’application.
6. Autorisez la portée `https://www.googleapis.com/auth/drive.appdata`. Tant que le consentement est en mode test, ajoutez les comptes de test nécessaires.

Le web utilise Google Identity Services. Windows ouvre le navigateur système, reçoit le retour sur `127.0.0.1` à un port temporaire et échange le code avec PKCE. Le mot de passe Google n’est jamais demandé par Notes. Les jetons d’accès ne sont pas enregistrés par Notes dans le coffre.

Les fichiers résident dans le dossier caché de l’application. Réutilisez le même projet Google pour les clients Web et bureau, puis vérifiez le partage du coffre entre les deux avant publication. Changer de projet peut changer l’espace de stockage visible par l’application.

Références : [modèle de jeton Web](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [OAuth des applications installées](https://developers.google.com/identity/protocols/oauth2/native-app), [données d’application Drive](https://developers.google.com/workspace/drive/api/guides/appdata).

## OneDrive personnel

1. Créez une inscription d’application Microsoft Entra acceptant les comptes Microsoft personnels.
2. Ajoutez une plateforme **Application monopage (SPA)** avec l’adresse de retour exacte de chaque version web. Le code utilise l’origine et le chemin actuels de la page, sans paramètres ni fragment. Pour le sous-domaine proposé : `https://notes.flion.fr/`.
3. Dans la même inscription, ajoutez une plateforme **Applications mobiles et de bureau**, avec le retour `http://localhost/callback`. Microsoft ignore le port temporaire pour les retours localhost, mais le chemin doit correspondre.
4. Ajoutez les autorisations Microsoft Graph déléguées `Files.ReadWrite.AppFolder` et `User.Read`. La seconde sert à afficher le compte effectivement connecté.
5. Placez l’Application (client) ID dans `VITE_MICROSOFT_CLIENT_ID`. Aucun secret client Microsoft n’est utilisé.

Conservez le même client ID sur Windows et sur le web : le dossier d’application OneDrive lui est associé. La version web utilise MSAL et PKCE, Windows utilise le navigateur système et PKCE. Cette version vise les comptes personnels. Ne rajoutez pas silencieusement une permission donnant accès à tout le disque si le dossier d’application ou la lecture du quota est refusé.

Références : [PKCE et SPA](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [retours localhost](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url#localhost-exceptions), [dossier d’application](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder).

## Hébergement web

Le site ne dépend d’aucune API privée de l’auteur. Compilez avec `npm run build` et servez le contenu de `dist/` sur un hébergement statique HTTPS. Choisissez la configuration DNS demandée par cet hébergeur pour `notes.flion.fr`, puis ajoutez cette origine ou adresse de retour dans les deux consoles OAuth avant de livrer la version compilée.

N’exposez pas le dossier source, les fichiers `.env` ou les sauvegardes des utilisateurs. Un hébergement statique n’a pas besoin des identifiants OAuth comme variables serveur une fois le site compilé. Utilisez les en-têtes de sécurité fournis dans `public/_headers` si l’hébergeur les accepte, ou configurez leurs équivalents dans sa console.

Sur un hébergement autre que Sites, le répertoire `.openai/` n’est pas nécessaire. Le nom de domaine prévu n’est actif qu’après validation de la configuration DNS et du certificat HTTPS.

## Vérification avant ouverture

Testez les deux fournisseurs avec un vrai compte : création depuis Windows, récupération sur téléphone, modification sur les deux appareils, expiration du jeton, connexion interrompue, quota personnel atteint, cloud plein et conflit entre deux modifications hors ligne. Vérifiez que les deux versions accèdent bien au même coffre. Le dépôt et ses tests ne remplacent pas cette validation d’intégration.

## Déployer sur Cloudflare Pages

Dans **Workers & Pages**, créez un projet Pages et connectez le [dépôt GitHub](https://github.com/arnaudlegoatdesdev/flion). Utilisez les réglages suivants :

| Réglage | Valeur |
| --- | --- |
| Nom du projet | `notes` ou un nom disponible |
| Branche de production | `main` |
| Répertoire racine | racine du dépôt |
| Preset | React (Vite) |
| Commande de build | `npm ci && npm run build` |
| Répertoire de sortie | `dist` |
| Variable `NODE_VERSION` | `24` |

Ajoutez les identifiants publics `VITE_GOOGLE_CLIENT_ID` et `VITE_MICROSOFT_CLIENT_ID` aux variables de compilation, ainsi que `VITE_PUBLIC_URL=https://notes.flion.fr`. Les identifiants de l’application Windows et les clés de signature ne sont pas nécessaires à Pages. Les fonctions cloud restent indisponibles si leurs identifiants ne sont pas configurés.

Après la première publication, testez l’adresse Pages fournie. Dans **Custom domains**, associez ensuite **notes.flion.fr** au projet. Faites remplacer le CNAME du sous-domaine par la cible `pages.dev` indiquée par Cloudflare, puis attendez la validation HTTPS. Gardez les inscriptions OAuth autorisant `https://notes.flion.fr` pour Google et `https://notes.flion.fr/` pour Microsoft. Le fichier `public/_headers` est inclus dans `dist` et fournit la politique d’en-têtes pour Pages.

Le dépôt peut être préparé sans modifier immédiatement le DNS. La migration du domaine se fait dans Cloudflare après vérification du nouveau déploiement. Une fois cette migration confirmée, l’ancien workflow GitHub Pages peut être désactivé ; les tests et la compilation Windows restent utiles.

Sources : [intégration Git](https://developers.cloudflare.com/pages/get-started/git-integration/), [réglages de build](https://developers.cloudflare.com/pages/configuration/build-configuration/), [version de Node](https://developers.cloudflare.com/pages/configuration/build-image/), [domaine personnalisé](https://developers.cloudflare.com/pages/configuration/custom-domains/).

## Ancien hébergement GitHub Pages

Le workflow `Site public` reste présent pour l’hébergement précédent. Il adapte les chemins d’assets à son adresse de publication. L’adresse sans domaine personnalisé est `https://arnaudlegoatdesdev.github.io/flion/`. Un fichier `CNAME` du dépôt n’est pas utilisé par les déploiements Pages via GitHub Actions. Aucun changement de DNS n’est effectué par la préparation de cette version de Notes.
