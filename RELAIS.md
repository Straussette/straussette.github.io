# Relais — reprendre Ma Cave dans Claude Code

Ce fichier sert à passer le travail d'une conversation à une autre, et d'une personne à une autre (Paul, Romain).
`CLAUDE.md` reste la référence technique complète : à lire en premier. Ici : l'état des lieux, la façon de travailler à deux, comment déployer et tester, et les pièges déjà rencontrés.

**Pour démarrer une session Claude Code**, coller :
> Lis CLAUDE.md puis RELAIS.md. On travaille sur Ma Cave à deux (Paul et Romain) : une branche et une PR par changement, relecture par relecteur-cave avant chaque push, rien directement sur main. Dis-moi ce que tu as compris de l'état du projet, puis on attaque : <la demande>.

**Petit glossaire** : *PR* (pull request) = proposition de changement à fusionner dans `main` ; *RLS* = règles d'accès de la base (chacun ne voit que ses lignes) ; *RPC* = fonction SQL appelée par l'app ; *MCP* = le protocole des connecteurs Claude ; *Playwright* = navigateur piloté par script pour tester l'app.

---

## 1. État au 28 novembre 2026

- **App** : https://macave.pstrauss.org (GitHub Pages, branche `main`). Un seul fichier `index.html` (~6 000 lignes, HTML + CSS + JS sans dépendance). Version visible dans `<meta name="app-version">`.
- **Connecteur Claude** (`supabase/functions/ma-cave-mcp`) : version 1.8.1, déployé en version 14 dans Supabase (à revérifier avec `get_edge_function`). Trois comptes l'utilisaient fin novembre.
- **Fonction payante** (`supabase/functions/chercher-vin`) : appelle l'API Claude, avec un plafond de 5 $ par mois et par membre. On pousse désormais tout le monde vers son propre Claude (gratuit pour l'app).
- **Base** : Supabase, projet `axioguzxjiowpyvqmobo` (le schéma, les règles RLS et les RPC ne sont pas dans le dépôt, voir `CLAUDE.md`).
- **Comptes** : une dizaine. Trois caves sont vraiment remplies (Paul, Romain, delmas). L'administrateur est Paul (table `admins`). Les « membres » (table `membres`) ont droit à la recherche payante et écrivent dans le catalogue partagé.

### Ce qui a été fait récemment (novembre)
- Connecteur Claude : chacun branche sa cave dans son Claude. Les photos et listes sont déposées par l'app (`imports`), Claude les lit et propose, l'utilisateur valide dans l'app.
- « Claude par défaut » gardé sur le compte. Encarts « Faites tout avec votre Claude ».
- Tri intelligent (région › sous-région › domaine), tri par appellation (villages du nord au sud), rapprochement des écritures d'un même domaine.
- « 🥂 Je déguste une bouteille qui n'est pas dans ma cave » (idée de Romain).
- Onglet 🎯 Conseils : répartition, pistes, goûts (table `sommelier`), conseil d'achat de Claude, mémoire de ses goûts.
- Commandes groupées : fiches, prix contre marché, synthèse et PDF WhatsApp, pastilles « 💡 Absent de votre cave », conseil perso de Claude par participant.
- Onglet 📊 Stats : chiffres clés, grands crus et premiers crus, apogée année par année, notes /20 de Claude (pépites, valeurs sûres, moins bonnes affaires), achats contre marché (PR #10 « Mes coups »), répartitions, millésimes, bouteilles bues sur 12 mois.
- Blanc sec de 25 ans et plus : « probablement passé », quoi que dise la fiche.
- Guide PDF « Ma Cave - guide de démarrage » pour les nouveaux venus : envoyé à Paul (il l'a dans la conversation Claude). Sa source n'est pas dans le dépôt : pour le refaire, demander à Claude de reprendre des captures de l'app sur une cave de démonstration.

---

## 2. Accès nécessaires

| Pour… | Il faut | Qui |
|---|---|---|
| Lire et modifier le code | Être **collaborateur** du dépôt GitHub `Straussette/straussette.github.io` (GitHub → Settings → Collaborators → Add people) | Paul ajoute Romain |
| Travailler avec Claude Code | Une session sur claude.ai/code avec ce dépôt, et GitHub connecté | Chacun |
| Toucher à la base ou déployer les fonctions | Le connecteur **Supabase** dans Claude, avec un accès au projet | Paul seulement, pour l'instant |

Romain n'a pas besoin de Supabase pour modifier l'app (`index.html`). Les changements de base, de RLS ou de fonctions serveur passent par Paul ou par une session de Paul. Si on veut lui ouvrir l'accès : Supabase → Organization → Members → inviter avec le rôle « Developer ».

**Secrets** : jamais de clé dans le dépôt ni dans une conversation. `SB_CLE` dans `index.html` est la clé publique (sans danger). La clé API Claude et la clé secrète Supabase restent dans les secrets Supabase.

---

## 3. Travailler à deux

1. **Une branche par changement**, nommée en français (`stats-millesimes`, `correctif-fenetre-ajout`…), puis une **PR vers `main`**. On ne pousse plus directement sur `main` : c'est la version en ligne pour tout le monde.
2. **Relecture obligatoire** : l'agent `relecteur-cave` (`.claude/agents/relecteur-cave.md`). Corriger jusqu'au verdict « Prêt à pousser », puis coller son rapport dans la PR sous `## Relecture (relecteur-cave)`.
3. **Version de l'app** : chaque PR qui touche `index.html` augmente `app-version` (`AAAA-MM-JJ.N`). Si deux PR se croisent, la seconde se met à jour sur `main` et reprend un numéro au-dessus.
4. **Qui fusionne** : l'auteur demande, l'autre jette un œil, puis Paul fusionne. GitHub Pages publie en une minute environ.
5. **Conventions** (détails dans `CLAUDE.md`) :
   - tout en français : interface, noms dans le code, commentaires, commits ;
   - vouvoiement dans l'app ;
   - couleurs par variables CSS ;
   - `esc()` sur tout ce qui entre dans le HTML ;
   - code rangé dans les sections `/* ---------- … ---------- */`.
6. **Mettre à jour `CLAUDE.md`** à chaque fonctionnalité (et ce fichier si l'état des lieux change).
7. **Fonctions copiées** : les fonctions de normalisation et `statut()` / `declinProbable()` existent dans `index.html` ET dans le connecteur. Toute modification de l'une se reporte dans l'autre.

---

## 4. Déployer

- **App** : fusionner la PR dans `main`. `verifierMiseAJour()` recharge les téléphones dont la version est plus ancienne.
- **Connecteur** (`ma-cave-mcp`), avec le connecteur Supabase de Claude :
  - utiliser `deploy_edge_function`, nom `ma-cave-mcp`, `verify_jwt: false`, avec soit le fichier complet, soit un petit relais qui importe le fichier du dépôt à un commit précis : `import "https://raw.githubusercontent.com/Straussette/straussette.github.io/<sha>/supabase/functions/ma-cave-mcp/index.ts";` (après le push ; le hash s'obtient avec `git rev-parse HEAD`) ;
  - vérifier avec `get_edge_function` ;
  - les journaux (`function_logs`) notent chaque demande de Claude : `mcp tools/call <outil>` ;
  - **après l'ajout d'un outil**, chaque utilisateur doit débrancher puis rebrancher le connecteur dans claude.ai pour voir le nouvel outil.
- **chercher-vin** : même méthode. Les secrets (`ANTHROPIC_API_KEY`) sont déjà en place. Chaque appel coûte de l'argent : tester avec prudence.
- **Base** : `apply_migration` pour ajouter des tables ou des colonnes (sans rien détruire). Les `DELETE` et `DROP` lancés par Claude sont annulés automatiquement : demander à Paul de le faire lui-même.

---

## 5. Tester avant de pousser

- Syntaxe de l'app : `awk '/<script>/{f=1;next}/<\/script>/{f=0}f' index.html > /tmp/app.js && node --check /tmp/app.js`
- Syntaxe du connecteur : `npx esbuild supabase/functions/ma-cave-mcp/index.ts --log-level=error > /dev/null`
- App en local : `python3 -m http.server 8765`, puis Playwright (déjà installé) :
  - fausse session dans le localStorage (`ma-cave-session` avec un `expires_at` lointain) ;
  - cave de test écrite dans IndexedDB (base `ma-cave`, magasin `kv`, clé `bottles`), puis rechargement ;
  - appels Supabase interceptés (`page.route(/supabase\.co/, …)`) pour simuler des réponses, ou coupés.
- Toujours regarder les captures (clair et sombre, 390 px de large) avant de conclure.
- Ne jamais committer les captures ni les scripts de test : les garder hors du dépôt.

---

## 6. Pièges déjà rencontrés

- **localStorage propre à chaque adresse** : le passage à macave.pstrauss.org a fait perdre les réglages gardés sur l'appareil. Tout réglage qui compte se garde sur le compte (`profils`, `sommelier`).
- **claude.ai et les connecteurs** :
  - claude.ai garde la liste des outils en cache : il faut rebrancher le connecteur après l'ajout d'un outil ;
  - Claude dit parfois qu'un outil « n'est pas disponible » au lieu de le chercher, d'où le rappel ajouté à chaque demande pré-écrite (`RAPPEL_OUTILS`) ;
  - une fois, claude.ai a cru la connexion « expirée » : la solution a été de supprimer le connecteur et de le recréer avec un nouveau lien.
- **Inscription avec une adresse déjà inscrite** : Supabase n'envoie aucun e-mail. L'app le dit maintenant et oriente vers « Mot de passe oublié ».
- **E-mails** : ils sont envoyés par Resend depuis `macave@envoi.pstrauss.org`. Les modèles sont dans `supabase/emails/` (à recoller dans Supabase s'ils changent). Les spams restent le premier suspect.
- **Doublons de vins** : `cleVin()` distingue « Échezeaux » et « Échezeaux Grand Cru ». Un même vin peut donc apparaître deux fois. Ignorer ces mentions dans la clé reste à faire.
- **Répartition par région** : `regionsDe()` dans le connecteur est plus simple que `regionVin()` dans l'app. Les chiffres vus par Claude peuvent différer légèrement de ceux de l'onglet.
- **Journal de diagnostic du connecteur** (`journaliser()`) : il est toujours actif. Il ne note que les méthodes et les outils, à alléger un jour.
- **Grands crus sans la mention « Grand Cru »** (Clos de Vougeot, Chambertin…) : ils sont reconnus par `grandCruParAppellation()`, à utiliser plutôt que `niveauCru()` seul.

---

## 7. Pistes ouvertes

- Ignorer « Grand Cru » et « 1er Cru » dans `cleVin()` (avec une migration douce des doublons existants).
- Verser les notes /20 de Claude (`avis`) au catalogue partagé, pour que tout le monde en profite.
- Aligner `regionsDe()` du connecteur sur `regionVin()` de l'app.
- Un niveau « village » dans les gros domaines du tri intelligent.
- Regénérer le guide PDF avec l'onglet Stats et les notes.
- Alléger le journal de diagnostic du connecteur.

---

## 8. Romain : premiers pas

1. Accepter l'invitation GitHub au dépôt (envoyée par Paul).
2. Ouvrir claude.ai/code, connecter GitHub, choisir le dépôt `Straussette/straussette.github.io`.
3. Coller le message de démarrage en haut de ce fichier, avec ta demande.
4. Laisser Claude créer la branche, coder, tester, faire relire, puis ouvrir la PR.
5. Prévenir Paul pour la fusion. Pour tout ce qui touche la base ou le connecteur, passer par Paul.
