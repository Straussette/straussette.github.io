# 🍷 Ma Cave — ton sommelier personnel

**Ma Cave** est une application web pour gérer sa cave à vin personnelle depuis son téléphone ou son ordinateur : on photographie ses bouteilles, l'app les identifie, conseille quand les boire et avec quoi, et estime la valeur de la cave.

👉 **Ouvrir l'app : [straussette.github.io](https://straussette.github.io)**

---

## Ce qu'elle fait

- **📷 Ajout par photo** : on photographie l'étiquette, l'app lit le domaine, la cuvée, l'appellation et le millésime, puis remplit la fiche toute seule.
- **📸 Ajout en lot** : plusieurs bouteilles sur une même photo, plusieurs photos d'un coup. L'app repère chaque vin, regroupe les bouteilles identiques et propose une liste à valider.
- **🔍 Recherche sur internet** : pour chaque vin, une fiche complète tirée du site du domaine, des guides et des cavistes :
  - fenêtre de dégustation (à boire de… à…) et apogée ;
  - descriptif du vin et cépages ;
  - accords mets-vins et conseils de service ;
  - fourchette de prix du marché.
- **🗂️ Organisation** : recherche, filtres par couleur, tri, et regroupements *à boire / à garder*, *par producteur*, *par région* ou *par couleur*.
- **💶 Valeur de la cave** : estimation par bouteille, par groupe et pour toute la cave.
- **☁️ Comptes et synchronisation** : la même cave sur tous ses appareils, photos comprises. L'app marche aussi hors ligne et synchronise dès que la connexion revient.
- **📱 Comme une vraie app** : à ajouter à l'écran d'accueil du téléphone ; elle se met à jour toute seule.

## Comment c'est construit

| Brique | Rôle |
|---|---|
| **GitHub Pages** | Héberge l'application (`index.html`, un seul fichier HTML/CSS/JavaScript, sans dépendance). |
| **Supabase** | Comptes utilisateurs, base de données des bouteilles (chacun ne voit que sa cave), stockage privé des photos, et la fonction serveur `chercher-vin`. |
| **API Claude (Anthropic)** | Lecture des étiquettes en photo et recherche web pour constituer les fiches. Appelée uniquement par la fonction serveur : la clé API n'apparaît jamais dans la page. |

```
Téléphone / ordinateur ──► Supabase (compte, cave, photos)
          │
          └──► fonction chercher-vin ──► API Claude (lecture d'étiquette + recherche web)
```

## Organisation du dépôt

```
index.html                                  l'application
supabase/functions/chercher-vin/index.ts    la fonction serveur (recherche et lecture des photos)
```

## Sécurité

- La clé de l'API Claude est stockée dans les secrets Supabase, jamais dans le code.
- La recherche n'est accessible qu'aux comptes autorisés (table `membres`) ou avec un code d'accès.
- Les bouteilles et les photos sont protégées par des règles d'accès : chaque utilisateur ne peut lire et modifier que les siennes.
- Une limite de dépense mensuelle est fixée côté API Claude.
