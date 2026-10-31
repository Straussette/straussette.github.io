# 🍷 Ma Cave — ton sommelier personnel

**Ma Cave** est une application web pour gérer sa cave à vin personnelle depuis son téléphone ou son ordinateur : on photographie ses bouteilles, l'app les identifie, conseille quand les boire et avec quoi, estime la valeur de la cave, et permet d'organiser des commandes groupées entre amis.

👉 **Ouvrir l'app : [straussette.github.io](https://straussette.github.io)**

---

## Ce qu'elle fait

### Remplir sa cave
- **📷 Ajout par photo** : on photographie l'étiquette, l'app lit le domaine, la cuvée, l'appellation, le classement et le millésime, puis remplit la fiche toute seule.
- **📸 Un seul bouton « + Ajouter des bouteilles »** : une ou plusieurs bouteilles sur une même photo, plusieurs photos d'un coup. L'app repère chaque vin, regroupe les bouteilles identiques et propose une liste à valider.
- **🤝 Fiches partagées** : une fiche trouvée par un membre (vin ou domaine) est reprise gratuitement par tous ceux qui ajoutent le même vin — pratique pour les commandes groupées.
- **🏡 Le domaine** : chaque fiche présente aussi le domaine (histoire, vignoble, viticulture, style, cuvées phares).
- **📄 Import d'une liste existante** : tableau Excel ou CSV, PDF, capture d'écran d'une autre app (Vivino, CellarTracker…) ou photo d'une liste écrite. L'app relit la liste (quantités, prix d'achat, emplacements compris) ; on vérifie puis on ajoute, avec ou sans recherche de fiche pour chaque vin.
- **🔍 Fiche complète tirée d'internet** (site du domaine, guides, cavistes) : descriptif, cépages, accords mets-vins, conseils de service, fourchette de prix du marché.
- **🍾 Formats** : bouteille, magnum, demi… (la valeur est ajustée au format).
- **🏷️ Noms de domaines unifiés** : un même producteur n'apparaît qu'une fois, même si l'étiquette l'écrit différemment.

### Savoir quand boire
- **⏳ Fenêtre de dégustation** : à boire / à garder, d'après la fiche.
- **🎯 « Affiner la garde »** (à la demande) : recherche approfondie en 4 phases — ouverture, apogée, fin d'apogée, à boire avant — avec les sources (critiques, domaine, millésime).
- **📝 Notes de dégustation** : état du vin, commentaire et note sur 20, gardés dans la fiche.

### Que boire ce soir ?
- **🍽️ Accord mets-vin** : on décrit son repas (quotidien ou belle occasion), le sommelier choisit les meilleures bouteilles **dans sa propre cave**, en tenant compte de leur maturité.
- **🕘 Recherches mémorisées** : les conseils déjà demandés sont gardés sur le compte et se retrouvent sans relancer la recherche.
- **« J'ouvre celle-ci »** : la bouteille est retirée du stock et la date est notée.

### Organiser et consulter
- **🗂️ Regroupements** : à boire / à garder, par producteur, par région, par couleur.
- **🔎 Filtres et tris** : couleur, grands crus / premiers crus, recherche texte, tri par valeur estimée.
- **📖 Vins bus** : à 0 bouteille, le vin reste en mémoire (onglet « Bus ») avec ses dates d'ouverture et ses notes.
- **💶 Valeur de la cave** : estimation par bouteille, par groupe et pour toute la cave.
- **📄 Page de consultation** de chaque vin, séparée de l'écran de modification.

### Partager
- **📤 Partager une fiche** en texte (WhatsApp, message…) ou par **lien public** : l'ami voit la fiche et peut l'ajouter à sa propre cave. Les infos personnelles (prix payé, emplacement, notes) ne sont jamais partagées.

### Commandes groupées entre amis
- **🔗 Lien d'invitation** : l'organisateur crée la commande, les amis la rejoignent avec un pseudo.
- **📑 Import de la proposition** du caviste (photo, PDF, Excel/CSV) : vins, prix et tailles de caisse sont lus automatiquement.
- **📦 Caisses** : quantités par multiples de 3 ou 6, suivi du remplissage des caisses.
- **💸 Dettes** : chacun voit ce qu'il doit ; remboursement par virement, déclaré par l'ami puis confirmé par l'organisateur.
- **🚚 Livraison** : reçue, puis « à récupérer » / « récupéré » pour chacun ; les bouteilles s'ajoutent automatiquement à la cave de chacun.
- **📊 Récapitulatif** pour l'organisateur, exportable en CSV.

### 🤖 Avec son propre Claude
- **Connecteur « Ma Cave »** : depuis « Mon compte » → « Brancher mon Claude », chacun crée un lien personnel à coller dans les connecteurs de son Claude (claude.ai, appli mobile, ordinateur).
- On parle ensuite à Claude de sa cave : « que boire ce soir avec un poulet rôti ? », « complète les fiches qui manquent », « présente-moi ce domaine », « j'ai ouvert le Paulands, 16/20 », « ajoute cette facture ».
- Les recherches passent par l'abonnement Claude de chacun : elles ne coûtent rien à l'app et ne comptent pas dans le plafond. Le lien se révoque à tout moment.

### Comptes
- **☁️ Synchronisation** : la même cave sur tous ses appareils, photos comprises. L'app marche aussi hors ligne et synchronise dès que la connexion revient.
- **🔐 Compte obligatoire** (email + mot de passe, mot de passe oublié) : chacun ne voit que sa cave.
- **🛡️ Écran d'administration** : l'administrateur valide un à un les membres autorisés à utiliser les recherches par IA et suit leur consommation.
- **📱 Comme une vraie app** : à ajouter à l'écran d'accueil du téléphone ; elle se met à jour toute seule.

## Comment c'est construit

| Brique | Rôle |
|---|---|
| **GitHub Pages** | Héberge l'application (`index.html`, un seul fichier HTML/CSS/JavaScript, sans dépendance). |
| **Supabase** | Comptes utilisateurs, base de données (caves, commandes groupées, partages, accords mémorisés), stockage privé des photos, et la fonction serveur `chercher-vin`. |
| **Connecteur MCP `ma-cave-mcp`** | Fonction Supabase qui donne au Claude de chaque utilisateur l'accès à sa cave (lecture, fiches, domaines, garde, dégustations, ajouts), avec un lien personnel révocable. |
| **API Claude (Anthropic)** | Lecture des étiquettes et des propositions de cavistes, recherche web pour les fiches et la garde, conseils d'accords. Appelée uniquement par la fonction serveur : la clé API n'apparaît jamais dans la page. |

```
Téléphone / ordinateur ──► Supabase (compte, cave, photos, commandes, partages)
          │
          └──► fonction chercher-vin ──► API Claude (étiquettes, recherche web, accords)

Claude de l'utilisateur ──► connecteur ma-cave-mcp ──► sa cave (et le catalogue partagé)
```

## Organisation du dépôt

```
index.html                                  l'application
supabase/functions/chercher-vin/index.ts    la fonction serveur (recherche, photos, garde, accords, propositions)
supabase/functions/ma-cave-mcp/index.ts     le connecteur pour Claude (serveur MCP)
```

## Sécurité

- La clé de l'API Claude est stockée dans les secrets Supabase, jamais dans le code.
- Les recherches par IA ne sont accessibles qu'aux comptes validés par l'administrateur (table `membres`) ; chaque recherche est journalisée.
- Toutes les données sont protégées par des règles d'accès (RLS) : chacun ne lit et ne modifie que sa cave, ses photos et ses recherches ; une commande groupée n'est visible que par ses participants.
- Chaque compte a un plafond mensuel de recherches IA (5 $ par défaut, réglable par l'administrateur) ; le coût réel de chaque recherche est calculé et journalisé.
- Le connecteur Claude n'est accessible qu'avec un lien personnel : seule son empreinte est gardée en base, il ne donne accès qu'à la cave de son propriétaire et se révoque depuis l'app.
- Une limite de dépense mensuelle globale est aussi fixée côté API Claude.
