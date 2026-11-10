# Notes

Un espace personnel pour les mémos, les photos et les fichiers, organisé en salons. Site mobile et application Windows partagent la même interface.

> Projet personnel développé rapidement à la demande de plusieurs personnes, avec une aide importante de l’IA pour le code, l’interface et la documentation. Il est indépendant de ma formation et de tout travail scolaire. Il ne représente pas une évaluation de mes compétences ou de mon apprentissage.

[Ouvrir Notes](https://notes.flion.fr/) · [Télécharger Windows](https://github.com/arnaudlegoatdesdev/notes/releases/latest)

## Utilisation

Connectez-vous avec Google. Choisissez ensuite **Google Drive**, recommandé pour retrouver le coffre sur votre téléphone, ou **cet appareil uniquement**. La connexion Google ne donne pas automatiquement accès à Drive. Le mode local ne synchronise pas les fichiers entre appareils.

Pour un nouveau coffre Drive, la limite maximale correspond à l’espace libre annoncé par le compte Google. Une limite de112 Go est donc proposée si le quota indique112 Go libres. Les autres usages du compte continuent à consommer cet espace ; chaque transfert vérifie de nouveau la disponibilité.

Créez le mot de passe du coffre, puis utilisez vos salons. Ce mot de passe chiffre les données et reste distinct du compte Google. Il ne peut pas être réinitialisé pour récupérer un coffre perdu.

Sur un autre appareil, connectez le même compte Google, choisissez Google Drive et saisissez le mot de passe du coffre existant. L’ouverture de Notes demande une connexion Internet pour Google ; une fois le coffre ouvert, les modifications locales sont conservées même si le réseau est interrompu.

## Fonctionnalités

- Salons personnalisables, messages modifiables et supprimables.
- Fichiers, aperçus d’images, zoom, recherche et épingles.
- Cinq thèmes, choix de police et taille du texte.
- Chiffrement local AES 256 GCM et synchronisation directe avec Google Drive.
- Stockage local seul possible, avec avertissement sur l’absence de synchronisation.
- Mises à jour Windows signées.

## Hébergement et comptes

Aucun serveur de données ni base de comptes n’est géré par l’auteur. Google vérifie l’identité ; l’application appelle directement ses API. Le sujet Google est conservé dans le coffre chiffré pour l’associer au compte. Les jetons ne sont pas enregistrés dans le stockage persistant.

Le site est statique, construit avec React, TypeScript et Vite. Cloudflare Pages peut le publier depuis ce dépôt : branche `main`, Node 24, commande `npm run build`, sortie `dist`. Le domaine est `notes.flion.fr`. [Configuration](docs/SETUP.md).

## Limites et vérification

Fichiers de 25 Mio maximum. Export regroupé limité à 512 Mio ; l’import cloud est progressif. Les anciennes versions chiffrées restent sur Drive, donc supprimer un message ne purge pas immédiatement toutes ses copies historiques. Les conflits entre appareils sont bloqués pour préserver les copies locales.

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
