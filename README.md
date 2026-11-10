# Notes

Un espace personnel pour les mémos, les photos et les fichiers, organisé en salons. Site mobile et application Windows partagent la même interface.

> Projet personnel développé rapidement à la demande de plusieurs personnes, avec une aide importante de l’IA pour le code, l’interface et la documentation. Il est indépendant de ma formation et de tout travail scolaire. Il ne représente pas une évaluation de mes compétences ou de mon apprentissage.

[Ouvrir Notes](https://notes.flion.fr/) · [Télécharger Windows](https://github.com/arnaudlegoatdesdev/notes/releases/latest)

## Utilisation

Connectez-vous avec Google. Choisissez **Google Drive**, recommandé pour retrouver vos notes sur votre téléphone, ou **Stockage local**. Drive reste facultatif. Les nouveaux espaces ne contiennent aucun salon : créez ceux dont vous avez besoin.

La limite maximale proposée correspond à l’espace libre annoncé par Google. Si le compte dispose de 112 Go libres, vous pouvez choisir jusqu’à 112 Go. Chaque transfert vérifie aussi le quota réel du compte.

Aucun mot de passe Notes n’est demandé. Sur un autre appareil, le même compte Google retrouve la configuration Drive et la clé de l’espace lorsque l’autorisation a déjà été accordée. Google peut encore demander un consentement ou une reconnexion. Le mode local ne synchronise pas le téléphone.

Pour un coffre créé avant la version 0.3, l’ancien mot de passe est nécessaire une seule fois pour récupérer sa clé. Ce mot de passe n’est pas enregistré. Les pièces jointes ne sont pas rechiffrées ni renvoyées pendant cette migration.

**Confidentialité :** la clé est conservée sur l’appareil et, en mode Drive, dans le dossier privé de Notes sur votre compte Google. Google peut techniquement accéder à cette clé. Cette version ne promet donc pas un chiffrement dont Google serait exclu. Les exports `.notes` contiennent également la clé et doivent rester privés.

## Fonctionnalités

- Salons personnalisables, messages modifiables et supprimables.
- Fichiers, aperçus d’images, zoom, recherche et épingles.
- Cinq thèmes, choix de police et taille du texte.
- Chiffrement local AES 256 GCM et synchronisation directe avec Google Drive.
- Stockage local seul possible, avec avertissement sur l’absence de synchronisation.
- Fusion automatique des modifications entre ordinateur et téléphone.
- Mises à jour Windows signées et téléchargement direct proposé sur le site sous Windows.

## Hébergement et comptes

Aucun serveur de données ni base de comptes n’est géré par l’auteur. Google vérifie l’identité ; l’application appelle directement ses API. Le sujet Google est conservé dans le coffre chiffré pour l’associer au compte. Les jetons ne sont pas enregistrés dans le stockage persistant.

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
