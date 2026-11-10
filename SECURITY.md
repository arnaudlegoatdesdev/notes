# Sécurité

Flion est une version préliminaire développée avec une aide importante de l’IA. Le format du coffre, OAuth et le mécanisme de synchronisation n’ont pas fait l’objet d’un audit indépendant. Les tests présents ne constituent pas une preuve de sécurité.

Le chiffrement protège le contenu enregistré dans le cloud et dans le stockage local lorsque la clé n’est pas disponible. Il ne protège pas un appareil compromis, une extension malveillante, une copie vulnérable du navigateur ou un code d’application altéré. Le fournisseur cloud conserve des métadonnées techniques, et ses politiques peuvent conserver des versions historiques.

Le mot de passe du coffre ne doit pas être envoyé à un serveur Flion. Il n’existe pas de récupération du contenu sans ce mot de passe. Les jetons cloud doivent rester éphémères et les permissions limitées au dossier d’application, plus l’accès de base au profil Microsoft pour afficher le compte.

Pour signaler un problème, utilisez le signalement privé de vulnérabilité du dépôt GitHub si celui-ci est activé. Sinon, ouvrez un ticket demandant un canal de contact, sans publier de mot de passe, jeton, coffre personnel ou détail d’exploitation sensible. Aucun service de support ou délai de réponse n’est garanti.
