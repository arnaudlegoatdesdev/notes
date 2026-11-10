# Architecture du coffre

## Une interface, deux modes de distribution

React et TypeScript fournissent les salons, le fil de messages et les réglages. Le navigateur mobile charge ces fichiers statiques. Tauri les embarque dans une application Windows et ajoute un petit noyau Rust pour OAuth et les mises à jour. Aucune base de comptes Notes n’est nécessaire : la connexion Google vérifie l’identité. Drive est une autorisation distincte et facultative.

L’hébergement web reste nécessaire, même sans serveur de données. Il doit servir un code fiable sous HTTPS. Le code de l’application reçoit les clés de déchiffrement pendant l’utilisation du coffre : une version compromise pourrait donc accéder au contenu ouvert.

## Chiffrement

Le contenu du coffre utilise AES-256-GCM, avec un vecteur d’initialisation aléatoire pour chaque chiffrement. La clé dérive du mot de passe par PBKDF2-SHA256 avec un sel propre au coffre et 600 000 itérations. Le sel et les informations nécessaires au format restent lisibles. Les messages, les salons, les réglages et les noms des pièces jointes sont contenus dans les données chiffrées.

Le coffre local est enregistré dans IndexedDB sous forme chiffrée. La clé reste en mémoire pendant la session. L’interface prévoit un verrouillage après quinze minutes d’inactivité. Verrouiller le coffre retire la clé de la session applicative, sans pouvoir garantir l’effacement de toutes les copies mémoire internes au moteur JavaScript. Une perte du mot de passe n’a pas de procédure de récupération.

Les pièces jointes ont leurs propres objets chiffrés et des identifiants opaques. Un coffre n’est donc pas un unique gros fichier cloud : modifier une ligne de texte ne doit pas obliger à renvoyer toutes les photos. La limite de 25 Mio par pièce jointe borne la mémoire nécessaire dans cette version, car Web Crypto traite chaque fichier en une fois. Pour des vidéos volumineuses, une future version devra définir et auditer un format de chiffrement par blocs.

## Synchronisation

Les écritures cloud utilisent des objets immuables et des versions de métadonnées. Elles n’écrasent pas aveuglément le même gros fichier. Les versions permettent de repérer une divergence entre appareils. Une divergence doit rester visible et ne doit pas supprimer silencieusement les modifications d’un appareil.

Les sauvegardes locales restent la référence tant qu’un transfert n’est pas confirmé. La saturation du cloud et la limite personnelle sont deux erreurs différentes. L’espace disponible fourni par le cloud peut changer entre son affichage et l’écriture ; l’échec réel du transfert reste donc traité.

L’historique de synchronisation peut consommer de l’espace même après la suppression d’un message. Cette première version n’annonce pas d’effacement cryptographique ni de nettoyage automatique des anciennes versions. Le fournisseur cloud et ses fonctions de conservation peuvent également conserver des copies. Un mécanisme de compactage devra préserver les appareils hors ligne avant toute suppression définitive d’objets.

## Accès cloud

La version courante utilise le dossier d’application Google Drive. L’option OneDrive est retirée de l’interface. Les jetons d’accès sont éphémères et séparés des données du coffre. Sur Windows, le noyau Rust ouvre une URL d’autorisation prédéfinie, vérifie un état aléatoire, utilise PKCE S256 et écoute uniquement sur l’interface locale pendant au maximum trois minutes. Le serveur local temporaire reçoit le retour OAuth ; ce n’est pas un serveur hébergé par l’auteur.

Cette architecture réduit les données détenues par l’auteur. Elle ne rend pas invisibles les tailles, les dates de transfert et le compte utilisé, et ne constitue pas une garantie de confidentialité absolue.

## Imports et sauvegardes

L’import cloud authentifie les objets et les écrit un par un dans un espace temporaire IndexedDB. Le manifeste ne remplace la copie courante qu’après validation de toutes les pièces jointes et vérification de la révision locale. Un transfert interrompu conserve le coffre précédent. Les fichiers locaux inchangés sont réutilisés. La capacité réelle de stockage du navigateur ou de l’appareil reste une limite et les erreurs disque sont traitées.

L’export regroupé en fichier `.notes` est limité à 512 Mio dans cette version. Cette limite ne concerne pas la synchronisation cloud. Les fichiers d’une sauvegarde sont vérifiés avant l’import ; les téléchargements cloud utilisent un chargeur progressif.

## Connexion Google et stockage local

La connexion initiale demande uniquement `openid email profile`, puis vérifie le jeton auprès de Google via UserInfo. Elle ne demande pas l’accès Drive. Le choix Drive autorise ensuite séparément le dossier d’application et vérifie qu’il s’agit du même sujet Google. Les jetons et le profil de session restent en mémoire.

Les nouveaux coffres contiennent l’identifiant opaque du propriétaire dans leurs métadonnées chiffrées. Les anciens coffres restent ouvrables avec leur mot de passe et sont associés au compte lors de leur prochaine modification explicite. La connexion Google ne remplace pas le mot de passe de chiffrement.

La limite proposée utilise `storageQuota.limit - storageQuota.usage`, en octets. Un compte sans plafond annoncé reste distinct d’un compte plein. En local, l’espace estimé du navigateur est utilisé lorsqu’il est disponible. Le mode local n’envoie aucun contenu à Drive et ne synchronise pas le téléphone.
