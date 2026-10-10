# CLAUDE.md

Ce fichier guide Claude Code (claude.ai/code) lorsqu'il travaille sur le code de ce dépôt.

## Projet

**Ma Cave** : application web de gestion de cave à vin, en français, installable comme une app. Elle est hébergée par GitHub Pages à l'adresse https://straussette.github.io. Le texte de l'interface, les noms dans le code, les commentaires et les messages de commit sont en français : il faut garder cette règle.

Le dépôt contient deux fichiers :
- `index.html` : toute l'application côté navigateur (HTML + CSS + JavaScript sans framework, sans dépendance, sans étape de build).
- `supabase/functions/chercher-vin/index.ts` : une fonction serveur Supabase (Deno) qui appelle l'API Claude.

Le schéma de la base, les règles d'accès (RLS), les fonctions RPC et les espaces de stockage sont configurés dans le projet Supabase et **ne sont pas** dans ce dépôt.

## Commandes

Il n'y a ni build, ni gestionnaire de paquets, ni linter, ni tests.

- Lancer en local : `python3 -m http.server 8000`, puis ouvrir http://localhost:8000. Les appels à la fonction serveur échoueront, car elle n'accepte que l'origine `https://straussette.github.io` (contrôle CORS).
- Vérifier la syntaxe du script intégré :
  `awk '/<script>/{f=1;next}/<\/script>/{f=0}f' index.html > /tmp/app.js && node --check /tmp/app.js`
- Déployer l'app : pousser sur la branche par défaut. GitHub Pages publie `index.html`.
- Déployer la fonction : `supabase functions deploy chercher-vin`. Il faut la CLI Supabase et un accès au projet, ce qui n'est pas en place ici. Secrets : `ANTHROPIC_API_KEY`, et `CODE_ACCES` (facultatif).

## Conventions

- **À chaque modification de `index.html`, augmenter `<meta name="app-version" content="AAAA-MM-JJ.N">`.** `verifierMiseAJour()` compare cette valeur à celle de la version en ligne et force le rechargement quand elles diffèrent. Sans cette augmentation, les utilisateurs gardent l'ancienne version.
- `index.html` est découpé en sections repérées par `/* ---------- Titre ---------- */`, côté CSS comme côté JS. Ajouter le code dans la section concernée, ou créer une nouvelle section dans le même style.
- Les couleurs passent par des variables CSS définies sur `:root`, avec le mode sombre géré par `prefers-color-scheme` et `[data-theme]`. Utiliser les variables existantes (`--accent`, `--surface`, `--c-rouge`…) plutôt que des couleurs en dur.
- Échapper les valeurs insérées dans le HTML généré avec `esc()`.

## Architecture

### Circulation des données côté navigateur (`index.html`)
- Le tableau global `bottles` fait foi. `enregistrer()` l'écrit dans IndexedDB (base `ma-cave`, magasin `kv`, clé `bottles`), puis appelle `planifierSync()`.
- L'app fonctionne d'abord en local, y compris hors ligne. Quand l'utilisateur est connecté, `synchroniser()` enchaîne quatre étapes, dans cet ordre :
  1. envoi des nouvelles photos dans le stockage `photos/<uid>/<id>.jpg` ;
  2. envoi des bouteilles modifiées dans la table `bouteilles` (`{id, data, photo_path}`, où `data` est la bouteille sans sa photo) ;
  3. suppression des bouteilles retirées sur l'appareil ;
  4. si `telecharger` est demandé, récupération des bouteilles du compte (`recupererCompte`).

  Les changements sont repérés grâce à une empreinte JSON par bouteille, conservée dans le localStorage sous `ma-cave-sync-<uid>`.
- Supabase est appelé directement avec `fetch`, via `sbFetch()` : REST `/rest/v1`, authentification `/auth/v1`, stockage `/storage/v1`. La bibliothèque supabase-js n'est pas utilisée. La session est conservée dans le localStorage sous `ma-cave-session` et renouvelée par `jeton()`. `SB_CLE` est la clé publique Supabase, sans danger dans la page.
- Tables et RPC utilisées par l'app : `bouteilles`, `profils`, `admins`, `commandes`, `commande_vins`, `commande_participants`, `remboursements`, ainsi que les RPC `admin_comptes`, `admin_definir_membre` et `rejoindre_commande`.
- Pour regrouper les bouteilles et éviter les doublons, un vin est identifié par `cleVin()` (domaine | cuvée | appellation | millésime | format, normalisés). Les noms de domaine passent par `nettoyerDomaine()`, `cleDomaine()` et `domaineCanonique()`, pour qu'un nouvel ajout reprenne l'écriture déjà présente dans la cave.
- Fonctionnalités principales :
  - recherche d'un vin et identification par photo de l'étiquette ;
  - ajout en lot par photo ;
  - page de consultation d'un vin ;
  - garde affinée ;
  - accord mets-vins (« Que boire avec mon repas ? ») ;
  - historique des bouteilles ouvertes (onglet « Bus ») ;
  - commandes groupées (`commandes`) : lien de partage `#commande=…`, tailles de caisse, récapitulatif et export Excel, import d'une proposition de caviste ;
  - écran d'administration ;
  - sauvegarde et restauration au format JSON.

### Fonction serveur (`chercher-vin`)
- Un seul point d'entrée, en POST. L'accès est autorisé dans deux cas : l'en-tête `x-code-acces` correspond à `CODE_ACCES`, ou le jeton de connexion appartient à un utilisateur inscrit dans la table `membres`. Cette vérification interroge `membres` avec le jeton de l'utilisateur lui-même : ce sont donc les règles RLS qui tranchent.
- Le champ `mode` choisit la consigne et le traitement :
  - `rechercher` (par défaut) : texte ou photo d'étiquette, avec un nombre de recherches web limité par `RECHERCHES_MAX` ;
  - `detecter` : plusieurs bouteilles sur une même photo, sans recherche web ;
  - `propale` : extraction des vins et des prix d'une offre (image, PDF ou texte de tableau) ;
  - `accord` : choix d'un vin de la cave pour un repas ;
  - `garde` : affinage de la fenêtre de dégustation.
- Chaque traitement demande à Claude une réponse uniquement en JSON, lue par `extraireJSON()`. Si la forme du JSON change dans une consigne, il faut mettre à jour le code correspondant dans `index.html`, et inversement.
- Chaque appel est noté dans la table `recherches`, consultée par l'écran d'administration. Un échec de cette écriture ne bloque rien.
- Le modèle utilisé est défini par la constante `MODELE`.
