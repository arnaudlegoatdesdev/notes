# Notes

Un espace personnel pour garder des mémos, des photos et des fichiers dans des salons, avec le confort d’une messagerie. Une interface web adaptée au téléphone et une application Windows construite avec Tauri.

> Ce projet personnel a été réalisé rapidement à la demande de plusieurs personnes, avec une aide importante d’outils d’intelligence artificielle pour le code, l’interface et la documentation. Il est indépendant de ma formation et de tout travail scolaire. Il ne doit pas être interprété comme une évaluation de mes compétences, de mon niveau ou de mon apprentissage.

## Ce que fait cette version

- Salons personnalisables et messages modifiables ou supprimables.
- Pièces jointes, recherche et messages épinglés.
- Coffre chiffré sur l’appareil et sauvegarde sur Google Drive ou OneDrive personnel.
- Limite de stockage choisie par l’utilisateur, consommation visible et gestion des erreurs de quota.
- Cinq thèmes, plusieurs polices et réglage de la taille du texte.
- Même code d’interface pour le web mobile et Windows.

L’application s’appelle **Notes** et utilise le domaine **https://notes.flion.fr**. L’hébergement peut être transféré vers Cloudflare Pages sans ajouter de serveur de données.

## État du projet

Cette version est une base fonctionnelle préliminaire, sans audit de sécurité indépendant. Les intégrations cloud sont implémentées, mais doivent être vérifiées avec les inscriptions OAuth du mainteneur avant une ouverture au public. Les connexions désactivées faute de configuration ne simulent aucun compte ni aucune synchronisation.

Le dépôt contient une compilation Windows par GitHub Actions. Les compilations officielles sont configurées pour des mises à jour signées : Notes vérifie la disponibilité d’une version au démarrage et propose son installation. Une compilation locale reste sans mise à jour intégrée tant qu’une vraie paire de clés n’est pas configurée. L’installeur n’est pas signé avec Authenticode ; la signature des mises à jour Tauri est distincte de la signature Windows.

## Utilisation

Créez un coffre et conservez son mot de passe, puis organisez vos salons. Pour retrouver le même espace sur un autre appareil, choisissez le même fournisseur, connectez le même compte cloud et utilisez le mot de passe du coffre. Les éléments locaux restent disponibles dans ce navigateur ou cette installation tant que ses données ne sont pas effacées. Le chargement initial de la version web nécessite une connexion Internet.

Le mot de passe du coffre n’est pas celui de Google ou de Microsoft. Il n’existe pas de réinitialisation permettant de récupérer le contenu chiffré en cas de perte. Conservez également une sauvegarde exportée avant toute opération de remplacement du coffre.

L’export en un fichier est limité à **512 Mio** ; cette limite ne s’applique pas à la synchronisation cloud progressive. Les pièces jointes sont limitées à **25 Mio par fichier** dans cette première version. La consommation du cloud peut inclure d’anciennes versions de synchronisation. Supprimer un message dans l’interface ne garantit donc pas l’effacement immédiat de toutes ses copies historiques. Voir [l’architecture](docs/ARCHITECTURE.md).

## Stockage et confidentialité

Notes ne nécessite ni serveur applicatif de données ni base de comptes gérés par l’auteur. Il faut un hébergement web statique HTTPS et les services du fournisseur cloud choisi. L’application communique directement avec ce fournisseur.

Le contenu et les noms privés sont chiffrés avant l’envoi. Le cloud conserve plusieurs objets opaques plutôt qu’un gros fichier à réécrire à chaque modification. Un éventuel export regroupe le coffre pour la sauvegarde. Le fournisseur peut encore connaître le compte, la taille des objets et les dates d’accès. Le chiffrement ne protège pas un appareil compromis ou une version de l’application malveillante.

Google annonce [jusqu’à 15 Go partagés entre Gmail, Drive et Photos](https://support.google.com/mail/answer/9312312?hl=fr). Une [page officielle Google](https://www.google.com/intl/en_ph/photos/about/) décrit, pour les comptes concernés, 5 Go plus 10 Go après ajout d’un numéro valide. La capacité réelle du compte prévaut. Microsoft propose [5 Go de stockage cloud gratuit](https://support.microsoft.com/en-us/onedrive/microsoft-storage-faqs). Dans les deux cas, les autres usages du compte réduisent l’espace disponible.

Le quota personnel Notes est distinct du quota global du compte. Avec l’accès limité au dossier d’application OneDrive, le quota global peut être indisponible. L’application l’indique et conserve les données locales si le fournisseur refuse un transfert.

## Développement

Prérequis : Node.js 24 LTS et npm. Pour Windows, ajoutez [les prérequis Tauri](https://v2.tauri.app/start/prerequisites/), dont Rust et les outils C++ de Visual Studio.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

```sh
npm test
npm run build
npm run tauri -- dev
npm run tauri -- build
```

L’interface utilise React et TypeScript. Rust sert à l’enveloppe Windows, à l’autorisation OAuth dans le navigateur système et aux mises à jour natives. Cette répartition garde une seule interface et un seul format de coffre pour les deux plateformes.

Les identifiants OAuth se configurent par le mainteneur au moment de la compilation. Les utilisateurs finaux n’ont pas à créer un projet Google ou Microsoft. Voir [la configuration cloud et l’hébergement](docs/SETUP.md) et [la publication Windows](docs/RELEASES.md).

## Licence

[MIT](LICENSE). Voir [SECURITY.md](SECURITY.md) pour les limites de protection et le signalement d’un problème.
