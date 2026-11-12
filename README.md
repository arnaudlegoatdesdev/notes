# Notes

Une application personnelle pour les mémos, les photos et les fichiers, organisés en espaces et en salons. Le site mobile et les applications Windows et macOS partagent la même interface.

> Projet personnel développé rapidement à la demande de plusieurs personnes, avec une aide importante de l’IA pour le code, l’interface et la documentation. Il est indépendant de ma formation et de tout travail scolaire. Il ne représente pas une évaluation de mes compétences ou de mon apprentissage.

[Ouvrir Notes](https://notes.flion.fr/) · [Télécharger Windows](https://github.com/arnaudlegoatdesdev/notes/releases/download/v0.4.3/Notes_0.4.3_x64-setup.exe) · [Télécharger macOS](https://github.com/arnaudlegoatdesdev/notes/releases/download/v0.4.3/Notes_0.4.3_universal.dmg)

## Utilisation

Connectez-vous avec Google. Choisissez **Google Drive**, recommandé pour retrouver vos notes sur votre téléphone, ou **Stockage local**. Drive reste facultatif. Les nouveaux espaces ne contiennent aucun salon : créez ceux dont vous avez besoin.

La limite maximale proposée correspond à l’espace libre annoncé par Google. Si le compte dispose de 112 Go libres, vous pouvez choisir jusqu’à 112 Go. Chaque transfert vérifie aussi le quota réel du compte.

Aucun mot de passe Notes n’est demandé. Fermer puis rouvrir Notes conserve la connexion et redonne accès à la copie locale, même hors ligne. Le bouton Déconnexion efface la session mémorisée. Sur un autre appareil, le même compte Google retrouve la configuration Drive et la clé de l’espace lorsque l’autorisation a déjà été accordée. Google peut encore demander un consentement ou une reconnexion. Le mode local ne synchronise pas le téléphone.

Les anciennes données d’essai ne sont pas reprises. Aucun parcours de migration ni mot de passe Notes n’est demandé.

**Confidentialité :** la clé est conservée sur l’appareil et, en mode Drive, dans le dossier privé de Notes sur votre compte Google. Google peut techniquement accéder à cette clé. Cette version ne promet donc pas un chiffrement dont Google serait exclu. Les exports `.notes` contiennent également la clé et doivent rester privés.

Sur Windows, l’accès Google est renouvelé automatiquement. Dans le navigateur, Notes reste connecté lorsque le jeton Google expire ; seule la synchronisation Drive peut demander une nouvelle autorisation. Le modèle Google pour les sites statiques impose alors une action de l’utilisateur : [documentation Google](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

## Fonctionnalités

- Salons personnalisables, messages modifiables et supprimables.
- Fichiers, aperçus d’images, zoom, recherche et épingles.
- Dépôt de fichiers dans le chat pour les envoyer directement, en conservant le brouillon.
- Zoom fluide au curseur, déplacement dans l’image et pincement tactile.
- Photo du compte Google dans le profil et les messages, initiales personnelles en remplacement.
- Aperçus Markdown et texte défilants et repliables dans le fil.
- Salons réorganisables par glisser-déposer, au clavier ou sur mobile.
- Messages rapprochés regroupés visuellement et zone de saisie qui grandit avec le texte.
- Cartes de liens avec titre, description et image si disponibles. Dans le navigateur, repli sur une carte simple quand le site refuse CORS. Les aperçus obtenus dans l’app sont chiffrés et synchronisés avec les notes.
- Ouverture des liens dans le navigateur système sur Windows et macOS.
- Espaces distincts, chacun avec ses salons, sa recherche et une icône ou image personnalisée.
- Six thèmes, dont Onyx pour les écrans OLED, choix de police et taille du texte.
- Chiffrement local AES 256 GCM et synchronisation directe avec Google Drive.
- Stockage local seul possible, avec avertissement sur l’absence de synchronisation.
- Fusion automatique des modifications entre ordinateur et téléphone.
- Messages affichés immédiatement, enregistrement local puis synchronisation en arrière-plan.
- Sur Windows et macOS, fermeture après la fin des transferts ; avertissement avant de quitter le navigateur si nécessaire.
- Mises à jour Windows signées et téléchargement direct proposé sur le site sous Windows.

## Hébergement et comptes

Aucun serveur de données ni base de comptes n’est géré par l’auteur. Google vérifie l’identité ; l’application appelle directement ses API. Le sujet Google est conservé dans le coffre chiffré pour l’associer au compte. La session est mémorisée jusqu’à une déconnexion explicite. Dans le navigateur, le profil et les jetons d’accès encore valides sont chiffrés dans IndexedDB avec une clé non exportable. Sur Windows, la connexion et le jeton de renouvellement sont protégés par Windows DPAPI ; sur Mac, ils sont conservés dans le Trousseau macOS.

Le site est statique, construit avec React, TypeScript et Vite. Cloudflare Pages peut le publier depuis ce dépôt : branche `main`, Node 24, commande `npm run build`, sortie `dist`. Le domaine est `notes.flion.fr`. [Configuration](docs/SETUP.md).

## Limites et vérification

Fichiers de 25 Mio maximum. Export regroupé limité à 512 Mio ; l’import cloud est progressif. Les anciennes versions chiffrées restent sur Drive, donc supprimer un message ne purge pas immédiatement toutes ses copies historiques. La synchronisation fusionne les ajouts et les modifications de champs distincts. Deux modifications du même champ sont départagées par leur date, puis de façon déterministe en cas d’égalité. Une suppression prime sur la modification du même élément. Une note nouvelle envoyée dans un salon supprimé sur l’autre appareil conserve ce salon. L’historique cloud garde les versions précédentes.

Le code de chiffrement n’a pas été audité indépendamment. Les tests automatisés ne remplacent pas un essai de connexion avec un vrai compte Google. L’installeur possède une signature de mise à jour Tauri, distincte d’un certificat Windows Authenticode. [Sécurité](SECURITY.md).

## Développement

```sh
npm ci
cp .env.example .env.local
npm run dev
npm test
npm run build
npm run tauri -- dev
```

Node 24 est utilisé en CI. Pour Windows, installez les [prérequis Tauri](https://v2.tauri.app/start/prerequisites/). Les variables OAuth se configurent à la compilation ; les utilisateurs finaux n’ont pas à créer de projet Google.

[Publication Windows](docs/RELEASES.md) · [Architecture](docs/ARCHITECTURE.md) · [Licence MIT](LICENSE)

## macOS

Le DMG universel contient les architectures Intel et Apple Silicon et nécessite macOS 12 ou ultérieur. Glissez Notes dans Applications. Cette première distribution utilise une signature ad hoc, sans notarisation Apple ; macOS peut demander une autorisation à la première ouverture.

Le workflow macOS est déclenché manuellement et ne compile pas Windows. Les mises à jour Mac utilisent `latest-macos.json`, séparé du manifeste Windows. Le code du premier binaire Mac 0.3.2 correspond au tag `mac-v0.3.2`.

### Compatibilité 0.4.0

Les notes existantes sont conservées et leur format est automatiquement actualisé. Mettez les applications à jour sur tous vos ordinateurs pour continuer la synchronisation avec le site. Les anciennes versions ne peuvent pas modifier le nouveau format.

### Version 0.4.2

Les écritures locales n’attendent plus Google Drive. Les actions rapprochées sont regroupées pour l’envoi, avec une vérification toutes les cinq secondes lorsque Notes est visible. Les applications peuvent terminer un transfert fenêtre fermée, puis quitter. En cas d’échec, la fenêtre réapparaît et la copie locale est conservée. Sur le web, le navigateur peut demander confirmation avant de fermer ; les transferts restants reprennent à la prochaine ouverture. Les icônes du site, de Windows et de macOS utilisent un N centré. Le format des notes et les clés restent identiques à la version 0.4.0.

### Version 0.4.3

Le dépôt de fichiers dans le chat envoie un nouveau message sans consommer le brouillon. Le zoom des images suit le point visé avec une animation fluide et prend en charge le pincement. Le profil utilise la photo Google, mémorisée avec la connexion. Les anciens comptes tentent de récupérer leur photo sans imposer une déconnexion ; les initiales sont utilisées si Google n’est pas accessible. Aucun changement du format des notes ni des clés.
