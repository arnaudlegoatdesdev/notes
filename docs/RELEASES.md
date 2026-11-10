# Windows et mises à jour

## Produire un installeur

Le workflow **Windows**, déclenchable depuis GitHub Actions, exécute les tests web, compile l’interface, teste le code Rust et produit un installeur NSIS. Le résultat est disponible comme artifact `notes-windows`. Sans identifiants OAuth compilés, le mode local fonctionne mais les boutons de connexion concernés restent indisponibles.

Variables de dépôt utilisées : `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_DESKTOP_CLIENT_ID`, `VITE_GOOGLE_DESKTOP_CLIENT_SECRET` si nécessaire, `VITE_MICROSOFT_CLIENT_ID`. Elles identifient l’application publique. N’y placez aucun secret de client Web confidentiel.

Un tag `v0.1.1` correspondant à la version dans `src-tauri/tauri.conf.json` crée un brouillon de GitHub Release. Relisez et testez l’installeur avant de publier ce brouillon. Les fichiers d’une release déjà publiée ne sont pas remplacés par le workflow. Incrémentez aussi `package.json` et `src-tauri/Cargo.toml` pour chaque version.

La compilation simple n’ajoute pas de signature Windows Authenticode. Une distribution publique soignée nécessitera un certificat de signature approprié ou une autre méthode de distribution reconnue par Windows. Cette signature est différente de celle qui protège les mises à jour Tauri.

## Activer les mises à jour intégrées

La paire de signature des compilations officielles est configurée dans GitHub Actions. L’application ne contient aucune fausse clé de signature et ne désactive pas la vérification. Une compilation locale sans cette configuration signale que la fonction n’est pas activée.

1. Générez une paire de clés avec le [signer Tauri](https://v2.tauri.app/plugin/updater/#signing-updates), hors du dépôt. Conservez une copie sûre de la clé privée.
2. Conservez la clé publique de signature dans la variable de dépôt déjà référencée par le workflow Windows.
3. Ajoutez la clé privée à `TAURI_SIGNING_PRIVATE_KEY` dans les secrets GitHub Actions, et son mot de passe éventuel à `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. Déclenchez **Windows** avec l’option de mises à jour signées, ou publiez un tag avec la paire de clés configurée.
5. Vérifiez la mise à jour d’une ancienne installation vers la nouvelle avant de publier la release.

Le workflow embarque la clé publique, génère la signature de l’installeur et un `latest.json` pointant vers cette release. L’application consulte exclusivement l’adresse HTTPS :

```text
https://github.com/arnaudlegoatdesdev/flion/releases/latest/download/latest.json
```

Sans paire de clés complète, aucun manifeste de mise à jour n’est produit. La clé privée ne doit jamais être commitée. Perdre cette clé empêche de continuer les mises à jour des installations qui font confiance à l’ancienne clé. Les utilisateurs d’une première compilation dépourvue de clé devront installer manuellement la première version signée.

Notes vérifie les mises à jour au démarrage. Si une version plus récente est disponible, un bouton apparaît et son installation se déclenche depuis les paramètres après une action explicite. Windows peut fermer l’application pendant l’installation. Le coffre doit avoir fini ses écritures locales avant ce déclenchement.

L’adresse `releases/latest` de GitHub ne sert pas les brouillons ni les prereleases. Après validation, publiez donc la version officielle comme release normale, tout en conservant la mention « version préliminaire » et les limites réelles dans ses notes. Une première version peut fonctionner en mode local tant que les identifiants OAuth ne sont pas configurés ; elle ne doit pas annoncer une synchronisation cloud disponible dans ce cas.

## Continuité des installations existantes

La version 0.1.1 conserve l’identifiant interne et le format des coffres. L’installeur réutilise une ancienne installation reconnue, remplace son exécutable et actualise son nom dans Windows. Le répertoire physique historique peut rester identique pour préserver la continuité. Le workflow teste cette transition depuis la première release, avec un marqueur de données conservé et une vérification des raccourcis.
