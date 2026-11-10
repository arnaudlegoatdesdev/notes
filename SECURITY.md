# Sécurité

Notes est une version préliminaire développée avec une aide importante de l’IA. Le format du coffre, OAuth et le mécanisme de synchronisation n’ont pas fait l’objet d’un audit indépendant. Les tests présents ne constituent pas une preuve de sécurité.

Le contenu reste chiffré, mais la clé est conservée dans le stockage local et, en mode Drive, dans le dossier privé d’application du compte Google. Google peut techniquement lire cette clé. La suppression du mot de passe rend possible la reprise automatique sur plusieurs appareils ; elle ne garantit pas la confidentialité contre Google ou contre un accès au stockage de l’appareil.

Un export `.notes` récent contient également la clé. Il doit être conservé comme un fichier privé. Aucun mot de passe Notes ou parcours de migration n’est proposé. La connexion est mémorisée jusqu’à une déconnexion explicite. Le profil et le jeton d’accès web sont chiffrés dans IndexedDB avec une clé non exportable. Le jeton de renouvellement Windows est chiffré par DPAPI pour l’utilisateur Windows courant et reste dans le noyau Rust. Cette protection ne protège pas d’un code d’application compromis. Les jetons d’accès OAuth sont éphémères, les permissions Drive sont limitées au dossier d’application et l’identité est vérifiée auprès de Google.

Le code d’application altéré, un appareil compromis ou une extension malveillante peuvent accéder aux données ouvertes. Les anciennes versions cloud peuvent conserver des messages supprimés. Il n’existe pas de purge automatique ou d’effacement cryptographique garanti.

Pour signaler un problème, utilisez le signalement privé de vulnérabilité du dépôt GitHub si celui-ci est activé. Sinon, ouvrez un ticket demandant un canal de contact, sans publier de mot de passe, jeton, coffre personnel ou détail d’exploitation sensible. Aucun service de support ou délai de réponse n’est garanti.
