# Architecture

## Application

React, TypeScript et Vite fournissent le site mobile. Tauri embarque la même interface dans Windows avec un noyau Rust pour OAuth et les mises à jour. Le site est statique. Aucun serveur de données ni base de comptes Notes n’est nécessaire.

Google vérifie l’identité via UserInfo après OAuth. La connexion demande `openid email profile`, réutilise les autorisations précédemment accordées et reste distincte du premier consentement Drive. Le choix local ne déclenche pas une autorisation Drive. Les jetons d’accès restent en mémoire. Ils peuvent expirer et nécessiter une reconnexion.

## Clés et migration

Chaque nouvel espace reçoit une clé aléatoire de 256 bits. AES-256-GCM chiffre les métadonnées et chaque pièce jointe avec un IV aléatoire et des données authentifiées propres au format. La clé est conservée dans une base IndexedDB séparée, associée au sujet Google et à l’identifiant du coffre. La connexion Google détermine quelle clé ouvrir ; elle ne produit pas elle-même cette clé.

Avec Drive, un fichier `notes-access-<identifiant>.json` contient cette clé dans le dossier privé d’application. Cela permet à un nouvel appareil autorisé de retrouver l’espace sans mot de passe ni serveur Notes. Ce dossier est accessible au fournisseur Google : il ne s’agit pas d’une promesse de chiffrement excluant Google. Une version modifiée de l’application ou un appareil compromis peut également lire les clés.

Les anciens coffres utilisent PBKDF2-SHA256 avec 600 000 itérations. La migration demande leur ancien mot de passe une fois, vérifie le déchiffrement et conserve uniquement la clé dérivée. Les enveloppes et les pièces jointes restent inchangées pour éviter une réécriture de toutes les données. Le mot de passe n’est enregistré ni localement ni sur Drive. Les identifiants historiques de stockage et de l’application Windows sont conservés pour retrouver les données existantes.

Il n’y a plus de verrouillage automatique ou de mot de passe Notes. La déconnexion abandonne les références de session aux données et aux clés. Le stockage persistant reste récupérable après la prochaine connexion Google.

## Synchronisation

Les pièces jointes sont des objets chiffrés immuables nommés avec un UUID. Les métadonnées sont des instantanés immuables avec un à trois parents dans leur nom. L’application comprend les anciennes chaînes à parent unique. Un manifeste reste limité à 16 Mio et un fichier à 25 Mio, ce qui borne la mémoire nécessaire à Web Crypto.

La synchronisation compare la dernière base locale, l’état local et les têtes distantes. Elle fusionne les ajouts par UUID et les champs indépendants. Si le même champ est modifié des deux côtés, la date de modification puis une comparaison déterministe choisissent la valeur courante. Une suppression prime sur la modification du même élément ; un message nouvellement envoyé dans un salon supprimé simultanément restaure le salon pour conserver ce message. Les anciennes valeurs restent dans les instantanés historiques.

Deux publications simultanées forment deux branches. Une publication de fusion référence leurs deux têtes. Les changements survenus pendant un transfert sont relus avant publication, et les véritables courses de publication sont fusionnées à la passe suivante. Les écritures locales attendent la fin d’une synchronisation puis réappliquent leur changement à la session courante.

Une vérification a lieu toutes les cinq secondes quand la page est visible, au retour sur la page, au retour du réseau et après un enregistrement. Un brouillon ou une pièce jointe encore dans le composeur, une édition de message ou une fenêtre ouverte suspend temporairement la synchronisation. Il ne s’agit pas d’une connexion temps réel au serveur.

Les pièces jointes importées sont authentifiées et écrites une par une dans un espace temporaire IndexedDB. Le manifeste ne remplace la copie courante qu’après validation complète et vérification de sa révision. Une interruption conserve la copie précédente ; si la fusion a déjà été activée avant une erreur réseau, la nouvelle session reste accessible. Les fichiers déjà présents et inchangés sont réutilisés.

La limite Notes inclut l’historique et la configuration cloud. Chaque envoi vérifie séparément cette limite et le quota réel Google. L’historique n’est pas purgé automatiquement, y compris après suppression d’un message. L’espace navigateur et le disque constituent aussi des limites indépendantes.

## Sauvegardes

L’export `.notes` portable contient les objets chiffrés et la clé de l’espace. Le fichier permet donc de récupérer les données et doit rester privé. Les anciens exports protégés par mot de passe restent importables avec une migration unique. L’index complet est vérifié avant l’allocation des contenus. L’export regroupé est limité à 512 Mio ; la synchronisation Drive reste progressive.

## Windows

OAuth utilise le navigateur système, PKCE S256, un état aléatoire et un retour limité à l’interface locale pendant trois minutes. Les clients web et Windows doivent appartenir au même projet Google pour partager le dossier d’application.

Sur le site, l’offre d’installation exige un navigateur Windows de bureau et exclut Tauri ainsi que les appareils mobiles. L’API GitHub fournit la dernière version publiée. Seul l’installeur du dépôt Notes correspondant exactement au tag est accepté ; le bouton télécharge directement cet asset. Les versions plus anciennes que le site ne sont pas proposées. Le refus est mémorisé jusqu’à une nouvelle version.

Les mises à jour intégrées utilisent le manifeste GitHub et une signature Tauri. Cette signature est distincte d’un certificat Windows Authenticode. Les formats, OAuth et la synchronisation n’ont pas reçu d’audit indépendant.
