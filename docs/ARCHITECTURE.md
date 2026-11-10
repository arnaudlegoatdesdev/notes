# Architecture du coffre

## Une interface, deux modes de distribution

React et TypeScript fournissent les salons, le fil de messages et les réglages. Le navigateur mobile charge ces fichiers statiques. Tauri les embarque dans une application Windows et ajoute un petit noyau Rust pour OAuth et les mises à jour. Aucune base de comptes Flion n’est nécessaire : les droits du compte Google ou Microsoft donnent accès au dossier de l’application.

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

Les adaptateurs utilisent uniquement le dossier d’application Google Drive ou OneDrive. Les jetons d’accès sont éphémères et séparés des données du coffre. Sur Windows, le noyau Rust ouvre une URL d’autorisation prédéfinie, vérifie un état aléatoire, utilise PKCE S256 et écoute uniquement sur l’interface locale pendant au maximum trois minutes. Le serveur local temporaire reçoit le retour OAuth ; ce n’est pas un serveur hébergé par l’auteur.

Cette architecture réduit les données détenues par l’auteur. Elle ne rend pas invisibles les tailles, les dates de transfert et le compte utilisé, et ne constitue pas une garantie de confidentialité absolue.
