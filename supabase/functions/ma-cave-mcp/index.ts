// Connecteur « Ma Cave » pour Claude (serveur MCP, transport HTTP « streamable », sans état).
//
// Chaque utilisateur branche sa cave dans son propre Claude, avec son abonnement : les
// recherches (fiches, domaines, garde, accords) sont faites par son Claude, sans appel à
// l'API Claude ici, donc sans coût pour le propriétaire de l'app.
//
// Adresse : https://<projet>.supabase.co/functions/v1/ma-cave-mcp/<clé personnelle>
// La clé est créée dans l'app (« Mon compte » → « Brancher mon Claude ») ; seule son
// empreinte SHA-256 est gardée dans la table cles_connecteur. Les outils agissent avec la
// clé secrète du projet, toujours filtrés sur l'utilisateur de la clé.
//
// À déployer sans vérification du JWT (verify_jwt = false) : Claude n'envoie pas de jeton Supabase.

const NOM = "ma-cave";
const VERSION = "1.2.0";
const VERSIONS_PROTOCOLE = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const CONSIGNES = `Tu es le sommelier personnel de l'utilisateur et tu as accès à sa cave « Ma Cave » (https://straussette.github.io). Tu parles en français et tu tutoies, sauf s'il écrit dans une autre langue.

- Avant de conseiller une bouteille, regarde sa vraie cave avec ma_cave (filtre a_boire pour ce qui est prêt). Ne propose dans « ta cave » que des vins qui y sont, avec du stock.
- Pour compléter une fiche ou présenter un domaine, fais une vraie recherche web (site du domaine, guides, cavistes, critiques). N'invente jamais : si tu ne trouves pas, dis-le et n'enregistre rien. Cite tes sources dans le champ sources.
- vins_a_completer liste ce qui manque. enregistrer_fiche et enregistrer_domaine écrivent dans sa cave et, s'il est membre, dans le catalogue partagé avec les autres utilisateurs : sois rigoureux.
- Fenêtres de dégustation : pour affiner une garde, cherche des fenêtres publiées (critiques, domaine, millésime) et enregistre-les avec enregistrer_garde.
- Quand il dit avoir ouvert ou bu une bouteille, utilise ouvrir_bouteille (stock −1, date notée dans « Dégustées »), avec sa note s'il en donne une. Pour une simple correction de stock, utilise modifier_bouteille.
- Pour ajouter des vins (facture, liste, photo d'étiquette), utilise ajouter_vins ; un vin déjà présent (même domaine, cuvée, appellation, millésime et format) voit sa quantité augmenter.
- Photos et listes envoyées depuis l'app : imports_a_traiter les liste, lire_import montre le contenu (photos de bouteilles, listes, tableaux, PDF, offre d'un caviste). Sur une photo de bouteilles, repère chaque vin et son nombre, et le format en comparant les tailles (magnum = bouteille nettement plus grande). Montre d'abord à l'utilisateur la liste que tu as lue (domaine, cuvée, appellation, millésime, format, quantité, prix) et attends sa validation avant d'ajouter. Puis ajouter_vins (sa cave) ou ajouter_vins_commande (import destiné à une commande groupée), et termine avec terminer_import.
- Commandes groupées : mes_commandes liste celles qu'il organise ; ajouter_vins_commande y ajoute les vins d'une offre (prix TTC par bouteille, taille de caisse si indiquée). Pour aider à choisir, vins_commande liste les vins d'une commande (organisée ou rejointe) et enregistrer_fiche_commande leur donne une fiche (recherche web, mêmes champs qu'une fiche de cave, avec le prix du marché pour comparer au prix proposé) : tous les participants la voient en touchant le vin dans la commande.
- Les changements apparaissent dans l'app à sa prochaine ouverture (ou quand il y revient).`;

// ---------- Supabase (clé secrète du projet) ----------

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
function cleSecrete(): string {
  try {
    const cles = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (cles.default) return cles.default;
  } catch { /* clé historique ci-dessous */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const SB_CLE = cleSecrete();

async function sb(chemin: string, options: RequestInit = {}): Promise<any> {
  const entetes: Record<string, string> = { apikey: SB_CLE, ...(options.headers as Record<string, string> ?? {}) };
  if (SB_CLE.startsWith("eyJ")) entetes.Authorization = `Bearer ${SB_CLE}`;
  const r = await fetch(`${SB_URL}${chemin}`, { ...options, headers: entetes });
  const texte = await r.text();
  if (!r.ok) {
    console.error("Base de données", r.status, texte.slice(0, 500));
    throw new Error(`base de données indisponible (${r.status})`);
  }
  return texte ? JSON.parse(texte) : null;
}

async function empreinte(texte: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
  return [...new Uint8Array(h)].map((o) => o.toString(16).padStart(2, "0")).join("");
}

// Clé personnelle → identifiant de l'utilisateur (ou null)
async function utilisateurDeCle(cle: string): Promise<string | null> {
  if (!/^mc_[0-9a-f]{48}$/.test(cle)) return null;
  const lignes = await sb(`/rest/v1/cles_connecteur?select=user_id,utilise&empreinte=eq.${await empreinte(cle)}`);
  const l = lignes?.[0];
  if (!l) return null;
  // Date de dernière utilisation, au plus une écriture par heure
  if (!l.utilise || Date.now() - Date.parse(l.utilise) > 3600_000) {
    await sb(`/rest/v1/cles_connecteur?user_id=eq.${l.user_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ utilise: new Date().toISOString() }),
    }).catch(() => {});
  }
  return l.user_id;
}

// ---------- Règles de l'app (copiées d'index.html, à garder identiques) ----------

type Vin = Record<string, any>;
const CHAMPS_FICHE = ["pays", "cepages", "apogee", "description", "accords", "service", "prixMin", "prixMax", "confiance", "sources", "domaineInfo", "domaineSite"];
const CHAMPS_CATALOGUE = ["region", "pays", "classement", "couleur", "boireDe", "boireA", ...CHAMPS_FICHE];
const COULEURS = ["Rouge", "Blanc", "Rosé", "Effervescent", "Liquoreux"];
const FORMATS = ["", "Demi-bouteille", "Clavelin", "Magnum", "Double magnum", "Jéroboam", "Mathusalem"];
const ETATS_DEGUST: Record<string, string> = { ferme: "Encore fermé / trop jeune", point: "À point", fatigue: "Fatigué / sur le déclin" };

const sansAccent = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const norm = (s: unknown) => sansAccent(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const cleVin = (b: Vin) => [norm(b.domaine), norm(b.cuvee), norm(b.appellation), b.millesime || "nm", norm(b.format || "")].join("|");

function nettoyerDomaine(nom: unknown): string {
  let t = String(nom || "").trim();
  t = t.replace(/\s*[(«\[][^)»\]]*[)»\]]/g, "");
  t = t.replace(/,.*$/, "");
  t = t.replace(/\.\s+[A-ZÀ-Ý][a-zà-ÿ]+\s+[a-zà-ÿ].*$/, "");
  t = t.replace(/\b(EARL|SCEA|GAEC|SARL|SAS|SA|GFA|SCV)\b\.?/gi, "");
  return t.replace(/\s{2,}/g, " ").replace(/^[\s\-–,]+|[\s\-–,]+$/g, "").trim();
}
const cleDomaine = (nom: unknown) => norm(nettoyerDomaine(nom))
  .replace(/\b(domaine|domaines|chateau|clos|maison|cave|caves|vignobles?|earl|scea|gaec)\b/g, " ")
  .replace(/\b(pere|peres|fils|freres|et|and|de|du|des|la|le|les|l|d)\b/g, " ")
  .replace(/\s+/g, " ").trim();
const nettoyerAppellation = (a: unknown) => String(a || "").replace(/\s*\([^)]*\)/g, "").replace(/\s+AOC\b|\s+AOP\b/gi, "").replace(/\s{2,}/g, " ").trim();
const sansMentions = (t: unknown) => norm(String(t || "").replace(/\(.*?\)/g, ""))
  .replace(/\b(aoc|aop|igp|appellation|controlee|protegee|premier|1er|grand|cru|village|villages|rouge|blanc)\b/g, " ")
  .replace(/\s+/g, " ").trim();
function cleCatalogue(v: Vin): string | null {
  const dom = cleDomaine(v.domaine);
  const app = sansMentions(v.appellation);
  if (!dom || !app) return null;
  let cuv = sansMentions(v.cuvee);
  if (app.includes(cuv)) cuv = "";
  return `vin:${dom}|${cuv}|${app}|${Number(v.millesime) || "nm"}`;
}
const cleCatalogueDomaine = (nom: unknown) => { const d = cleDomaine(nom); return d ? `domaine:${d}` : null; };
function memeDomaine(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const A = a.split(" "), B = b.split(" ");
  const [petit, grand] = A.length <= B.length ? [A, B] : [B, A];
  return petit.some((m) => m.length >= 4) && petit.every((m) => grand.includes(m));
}
function facteurFormat(f: unknown): number {
  const t = sansAccent(f || "").toLowerCase();
  if (/double magnum|jeroboam/.test(t)) return 4;
  if (/mathusalem|imperial/.test(t)) return 8;
  if (/magnum|1[,.]5/.test(t)) return 2;
  if (/demi|37/.test(t)) return 0.5;
  if (/clavelin|62/.test(t)) return 0.83;
  return 1;
}
function valeurUnitaire(b: Vin): number {
  const min = Number(b.prixMin) || 0, max = Number(b.prixMax) || 0;
  const marche = min && max ? (min + max) / 2 : (min || max);
  if (marche) return marche * facteurFormat(b.format);
  return Number(b.prix) || 0;
}
function statut(b: Vin): string {
  const an = new Date().getFullYear();
  const g = b.garde;
  if (g && g.ouverture && g.avant) {
    if (an < g.ouverture) return `trop tôt (dès ${g.ouverture}, apogée ${g.apogeeDe}–${g.apogeeA})`;
    if (an < g.apogeeDe) return `ouvrable (apogée ${g.apogeeDe}–${g.apogeeA})`;
    if (an <= g.apogeeA) return `à l'apogée (jusqu'à ${g.apogeeA})`;
    if (an <= g.avant) return `à boire bientôt (avant ${g.avant})`;
    return `à boire d'urgence (prévu avant ${g.avant})`;
  }
  const de = Number(b.boireDe) || 0, a = Number(b.boireA) || 0;
  if (!de && !a) return "fenêtre inconnue";
  if (de && an < de) return `trop tôt (dès ${de})`;
  if (a && an > a) return `à boire d'urgence (prévu jusqu'à ${a})`;
  if (a && an >= a - 1) return `à boire bientôt (jusqu'à ${a})`;
  return a ? `prêt à boire (jusqu'à ${a})` : "prêt à boire";
}
const pret = (b: Vin) => /^(ouvrable|à l'apogée|à boire|prêt)/.test(statut(b));
const nomVin = (b: Vin) => [b.domaine, b.cuvee, b.appellation].filter(Boolean).join(" · ") + (b.millesime ? ` ${b.millesime}` : "") + (b.format ? ` (${b.format})` : "");
const vide = (x: unknown) => x === undefined || x === null || x === "";

// Même écriture du domaine que dans la cave (ou presque : « Dubreuil » → « Domaine Philippe et Arnaud Dubreuil », si un seul domaine correspond)
function domaineDansCave(cave: Vin[], nom: unknown): string {
  const propre = nettoyerDomaine(nom);
  const cd = cleDomaine(propre);
  if (!cd) return propre;
  const ecritures = [...new Set(cave.map((b) => b.domaine).filter(Boolean))];
  const proches = [...new Set(ecritures.filter((d) => memeDomaine(cleDomaine(d), cd)).map(cleDomaine))];
  return ecritures.find((d) => cleDomaine(d) === cd)
    || (proches.length === 1 && ecritures.find((d) => cleDomaine(d) === proches[0])) || propre;
}

// ---------- Accès à la cave ----------

async function lireCave(uid: string): Promise<Vin[]> {
  // Par pages de 1000 (limite de lignes de l'API du projet)
  const lignes: any[] = [];
  for (let debut = 0; ; debut += 1000) {
    const page = await sb(`/rest/v1/bouteilles?select=id,data&user_id=eq.${uid}&order=id&limit=1000&offset=${debut}`) || [];
    lignes.push(...page);
    if (page.length < 1000) break;
  }
  return lignes.map((l: any) => ({ ...l.data, id: l.id }));
}
async function lireVin(uid: string, id: string): Promise<Vin> {
  if (!/^[\w-]{1,80}$/.test(String(id || ""))) throw new Error("identifiant de vin invalide");
  const lignes = await sb(`/rest/v1/bouteilles?select=id,data&user_id=eq.${uid}&id=eq.${encodeURIComponent(id)}`);
  if (!lignes?.length) throw new Error("vin introuvable dans ta cave (vérifie l'identifiant avec ma_cave)");
  return { ...lignes[0].data, id: lignes[0].id };
}
async function ecrireVins(uid: string, vins: Vin[]) {
  if (!vins.length) return;
  const maintenant = new Date().toISOString();
  // Vérifie que les vins existants appartiennent bien à l'utilisateur
  const ids = vins.map((v) => v.id);
  const existants = await sb(`/rest/v1/bouteilles?select=id,user_id&id=in.(${ids.map((i) => `"${i}"`).join(",")})`);
  if ((existants || []).some((l: any) => l.user_id !== uid)) throw new Error("identifiant déjà utilisé");
  await sb(`/rest/v1/bouteilles?on_conflict=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(vins.map((v) => {
      const { photo, photo_path, ...data } = v;
      return { id: v.id, user_id: uid, data, modifie: maintenant };
    })),
  });
}
async function estMembre(uid: string): Promise<boolean> {
  const l = await sb(`/rest/v1/membres?select=user_id&user_id=eq.${uid}`);
  return !!l?.length;
}
// Publie dans le catalogue partagé, sans écraser la fiche d'un autre membre
async function publier(uid: string, cle: string, fiche: Vin, remplacer: boolean): Promise<string> {
  if (!(await estMembre(uid))) return "non partagée (catalogue réservé aux membres validés)";
  const deja = (await sb(`/rest/v1/catalogue?select=cle,auteur&cle=eq.${encodeURIComponent(cle)}`))?.[0];
  if (deja && !(remplacer && deja.auteur === uid)) return "catalogue déjà rempli pour ce vin : laissé tel quel";
  await sb(`/rest/v1/catalogue?on_conflict=cle`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ cle, fiche, auteur: uid, maj: new Date().toISOString() }]),
  });
  return deja ? "catalogue partagé mis à jour" : "ajoutée au catalogue partagé";
}
async function cloreDemandes(uid: string, cle: string) {
  await sb(`/rest/v1/demandes?user_id=eq.${uid}&cle=eq.${encodeURIComponent(cle)}&statut=eq.attente`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ statut: "faite", traitee: new Date().toISOString() }),
  }).catch(() => {});
}

// ---------- Imports (fichiers déposés depuis l'app) ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function lireImport(uid: string, id: string) {
  if (!UUID.test(String(id || ""))) throw new Error("identifiant d'import invalide");
  const l = (await sb(`/rest/v1/imports?select=id,but,commande_id,fichiers,statut,cree&user_id=eq.${uid}&id=eq.${id}`))?.[0];
  if (!l) throw new Error("import introuvable (vérifie avec imports_a_traiter)");
  return l;
}
// Seuls les chemins déposés par l'app : <uid>/<uuid de l'import>/<n>.<jpg|pdf|txt>
const cheminSur = (uid: string, chemin: unknown) => {
  const m = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/\d{1,2}\.(jpg|pdf|txt)$/i.exec(String(chemin || ""));
  return !!m && m[1] === uid && UUID.test(m[2]);
};
async function telecharger(uid: string, chemin: string): Promise<Uint8Array> {
  if (!cheminSur(uid, chemin)) throw new Error("fichier inaccessible");
  const entetes: Record<string, string> = { apikey: SB_CLE };
  if (SB_CLE.startsWith("eyJ")) entetes.Authorization = `Bearer ${SB_CLE}`;
  const r = await fetch(`${SB_URL}/storage/v1/object/imports/${chemin.split("/").map(encodeURIComponent).join("/")}`, { headers: entetes });
  if (!r.ok) { console.error("Stockage", r.status, (await r.text()).slice(0, 300)); throw new Error(`fichier illisible (${r.status})`); }
  return new Uint8Array(await r.arrayBuffer());
}
function enBase64(octets: Uint8Array): string {
  let t = "";
  for (let i = 0; i < octets.length; i += 0x8000) t += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(t);
}
// Commande organisée ou rejointe par l'utilisateur
async function commandeVisible(uid: string, id: string) {
  if (!UUID.test(String(id || ""))) throw new Error("identifiant de commande invalide");
  const c = (await sb(`/rest/v1/commandes?select=id,titre,organisateur,statut&id=eq.${id}`))?.[0];
  const participe = c && (c.organisateur === uid
    || (await sb(`/rest/v1/commande_participants?select=user_id&commande_id=eq.${id}&user_id=eq.${uid}`))?.length);
  if (!participe) throw new Error("commande introuvable parmi celles que tu organises ou as rejointes");
  return c;
}
async function maCommande(uid: string, id: string) {
  if (!UUID.test(String(id || ""))) throw new Error("identifiant de commande invalide");
  const c = (await sb(`/rest/v1/commandes?select=id,titre,fournisseur,statut&organisateur=eq.${uid}&id=eq.${id}`))?.[0];
  if (!c) throw new Error("commande introuvable parmi celles que tu organises (vérifie avec mes_commandes)");
  return c;
}

function resume(b: Vin) {
  return {
    id: b.id,
    vin: nomVin(b),
    couleur: b.couleur || undefined,
    region: b.region || undefined,
    classement: b.classement || undefined,
    quantite: Number(b.quantite) || 0,
    statut: statut(b),
    valeur_unitaire_eur: Math.round(valeurUnitaire(b)) || undefined,
    emplacement: b.emplacement || undefined,
    fiche: !!b.description,
    domaine_presente: !!b.domaineInfo,
  };
}

// ---------- Outils ----------

const texte = { type: "string" };
const entier = { type: "integer" };
const CHAMPS_FICHE_SCHEMA = {
  region: { ...texte, description: "Région, ex. « Bourgogne (Côte de Beaune) »" },
  pays: texte,
  classement: { ...texte, description: "Grand cru, Premier cru, cru classé… ou vide" },
  couleur: { type: "string", enum: COULEURS },
  boireDe: { ...entier, description: "Année à partir de laquelle le boire" },
  boireA: { ...entier, description: "Année jusqu'à laquelle le boire" },
  cepages: texte,
  apogee: { ...texte, description: "Une phrase sur l'apogée" },
  description: { ...texte, description: "Descriptif du vin (3 à 5 phrases)" },
  accords: { type: "array", items: texte, description: "4 à 6 plats" },
  service: { ...texte, description: "Température, carafe…" },
  prixMin: { type: "number", description: "Prix de marché bas, en € pour 75 cl" },
  prixMax: { type: "number", description: "Prix de marché haut, en € pour 75 cl" },
  confiance: { type: "string", enum: ["faible", "moyenne", "haute"] },
  sources: { type: "array", items: texte, description: "Adresses des pages consultées" },
};

const OUTILS = [
  {
    name: "ma_cave",
    description: "Liste les vins de la cave (identifiant, nom, stock, fenêtre de dégustation, valeur estimée, fiche présente ou non) et les totaux. Par défaut, seuls les vins en stock.",
    inputSchema: {
      type: "object",
      properties: {
        recherche: { ...texte, description: "Mots à chercher (domaine, cuvée, appellation, région, millésime)" },
        couleur: { type: "string", enum: COULEURS },
        a_boire: { type: "boolean", description: "Seulement les vins prêts à boire cette année" },
        inclure_bus: { type: "boolean", description: "Inclure les vins à 0 bouteille (déjà tous bus)" },
      },
    },
    annotations: { title: "Voir ma cave", readOnlyHint: true },
  },
  {
    name: "fiche_vin",
    description: "Tout ce que la cave sait d'un vin : fiche, domaine, garde, dégustations, dates d'ouverture, prix d'achat, emplacement, notes.",
    inputSchema: { type: "object", properties: { id: texte }, required: ["id"] },
    annotations: { title: "Fiche d'un vin", readOnlyHint: true },
  },
  {
    name: "vins_a_completer",
    description: "Vins sans fiche et domaines sans présentation, à compléter par une recherche web.",
    inputSchema: { type: "object", properties: {} },
    annotations: { title: "Ce qui manque", readOnlyHint: true },
  },
  {
    name: "enregistrer_fiche",
    description: "Enregistre la fiche d'un vin trouvée par recherche web (dans ce vin, ses autres formats et, pour un membre, le catalogue partagé). Ne remplit que les champs vides, sauf avec remplacer.",
    inputSchema: {
      type: "object",
      properties: { id: texte, ...CHAMPS_FICHE_SCHEMA, remplacer: { type: "boolean", description: "Écraser les champs déjà remplis" } },
      required: ["id", "description", "sources"],
    },
    annotations: { title: "Enregistrer une fiche", readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "enregistrer_domaine",
    description: "Enregistre la présentation d'un domaine (histoire, vignoble, viticulture, style, cuvées phares, 5 à 8 phrases) sur tous les vins de ce domaine dans la cave et, pour un membre, dans le catalogue partagé.",
    inputSchema: {
      type: "object",
      properties: {
        domaine: { ...texte, description: "Nom du domaine tel qu'il est écrit dans la cave" },
        presentation: texte,
        site: { ...texte, description: "Site officiel du domaine, s'il existe" },
        remplacer: { type: "boolean", description: "Écraser une présentation déjà là" },
      },
      required: ["domaine", "presentation"],
    },
    annotations: { title: "Présenter un domaine", readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "enregistrer_garde",
    description: "Enregistre une fenêtre de dégustation affinée (ouverture, apogée, à boire avant), avec conseil, explication et sources. Met aussi à jour « boire de / jusqu'à ».",
    inputSchema: {
      type: "object",
      properties: {
        id: texte,
        ouverture: entier, apogeeDe: entier, apogeeA: entier, avant: entier,
        confiance: { type: "string", enum: ["faible", "moyenne", "haute"] },
        conseil: { ...texte, description: "Conseil pratique, 2 à 4 phrases" },
        explication: { ...texte, description: "Comment ces dates ont été établies" },
        millesime: { ...texte, description: "Appréciation du millésime (une ou deux phrases)" },
        sources: {
          type: "array",
          items: { type: "object", properties: { nom: texte, url: texte, fenetre: texte }, required: ["nom"] },
        },
      },
      required: ["id", "ouverture", "apogeeDe", "apogeeA", "avant"],
    },
    annotations: { title: "Affiner la garde", readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "ouvrir_bouteille",
    description: "Note une bouteille ouverte / bue : stock −1 et date ajoutée au journal « Dégustées ». Peut noter la dégustation en même temps.",
    inputSchema: {
      type: "object",
      properties: {
        id: texte,
        date: { ...texte, description: "Date (AAAA-MM-JJ), aujourd'hui par défaut" },
        etat: { type: "string", enum: Object.keys(ETATS_DEGUST), description: "ferme = encore fermé / trop jeune, point = à point, fatigue = sur le déclin" },
        sur20: { type: "number", minimum: 0, maximum: 20 },
        note: { ...texte, description: "Commentaire de dégustation" },
      },
      required: ["id"],
    },
    annotations: { title: "J'ouvre une bouteille", readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "noter_degustation",
    description: "Ajoute une note de dégustation à un vin, sans toucher au stock.",
    inputSchema: {
      type: "object",
      properties: {
        id: texte,
        etat: { type: "string", enum: Object.keys(ETATS_DEGUST) },
        sur20: { type: "number", minimum: 0, maximum: 20 },
        note: texte,
      },
      required: ["id", "etat"],
    },
    annotations: { title: "Noter une dégustation", readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "modifier_bouteille",
    description: "Corrige le stock, l'emplacement, le prix d'achat, les notes personnelles ou la fenêtre simple d'un vin.",
    inputSchema: {
      type: "object",
      properties: {
        id: texte,
        quantite: { type: "integer", minimum: 0 },
        emplacement: texte,
        prix: { type: "number", description: "Prix d'achat, € par bouteille" },
        notes: texte,
        boireDe: entier,
        boireA: entier,
      },
      required: ["id"],
    },
    annotations: { title: "Modifier un vin", readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "ajouter_vins",
    description: "Ajoute des vins à la cave. Un vin déjà présent (même domaine, cuvée, appellation, millésime et format) voit sa quantité augmenter. Peut inclure la fiche si tu l'as déjà cherchée.",
    inputSchema: {
      type: "object",
      properties: {
        vins: {
          type: "array",
          minItems: 1,
          maxItems: 200,
          items: {
            type: "object",
            properties: {
              domaine: texte, cuvee: texte, appellation: texte,
              millesime: { type: "integer", description: "Vide si non millésimé" },
              format: { type: "string", enum: FORMATS, description: "Vide = bouteille 75 cl" },
              quantite: { type: "integer", minimum: 1 },
              prix: { type: "number", description: "Prix d'achat, € par bouteille" },
              emplacement: texte, notes: texte,
              ...CHAMPS_FICHE_SCHEMA,
            },
            required: ["domaine", "appellation", "quantite"],
          },
        },
      },
      required: ["vins"],
    },
    annotations: { title: "Ajouter des vins", readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "imports_a_traiter",
    description: "Photos et listes envoyées depuis l'app Ma Cave pour que tu les traites (ajout à la cave, ou offre d'un caviste pour une commande groupée).",
    inputSchema: { type: "object", properties: {} },
    annotations: { title: "Imports en attente", readOnlyHint: true },
  },
  {
    name: "lire_import",
    description: "Montre le contenu d'un import : photos (images), listes et tableaux (texte), PDF.",
    inputSchema: { type: "object", properties: { id: texte }, required: ["id"] },
    annotations: { title: "Lire un import", readOnlyHint: true },
  },
  {
    name: "terminer_import",
    description: "Marque un import comme traité et supprime ses fichiers, une fois les vins ajoutés (ou si l'utilisateur renonce).",
    inputSchema: { type: "object", properties: { id: texte }, required: ["id"] },
    annotations: { title: "Terminer un import", readOnlyHint: false, destructiveHint: true },
  },
  {
    name: "mes_commandes",
    description: "Commandes groupées que l'utilisateur organise (titre, fournisseur, statut, vins déjà proposés).",
    inputSchema: { type: "object", properties: {} },
    annotations: { title: "Mes commandes", readOnlyHint: true },
  },
  {
    name: "ajouter_vins_commande",
    description: "Ajoute des vins (offre d'un caviste ou d'un domaine) à une commande groupée ouverte que l'utilisateur organise. Prix TTC par bouteille.",
    inputSchema: {
      type: "object",
      properties: {
        commande_id: texte,
        fournisseur: { ...texte, description: "Nom du caviste ou du domaine, s'il n'est pas déjà renseigné" },
        vins: {
          type: "array",
          minItems: 1,
          maxItems: 150,
          items: {
            type: "object",
            properties: {
              domaine: texte, cuvee: texte, appellation: texte, classement: texte,
              millesime: { type: "integer" },
              couleur: { type: "string", enum: COULEURS },
              format: { type: "string", enum: FORMATS, description: "Vide = bouteille 75 cl" },
              prix: { type: "number", description: "Prix TTC par bouteille, en €" },
              caisse: { type: "integer", description: "Taille de caisse imposée (6, 12…), si indiquée" },
              remarque: { ...texte, description: "Allocation, quantité max, prix HT…" },
            },
            required: ["domaine", "appellation"],
          },
        },
      },
      required: ["commande_id", "vins"],
    },
    annotations: { title: "Ajouter à une commande", readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "vins_commande",
    description: "Vins d'une commande groupée (organisée ou rejointe), avec leur prix proposé et s'ils ont déjà une fiche.",
    inputSchema: { type: "object", properties: { commande_id: texte }, required: ["commande_id"] },
    annotations: { title: "Vins d'une commande", readOnlyHint: true },
  },
  {
    name: "enregistrer_fiche_commande",
    description: "Enregistre la fiche d'un vin d'une commande groupée (trouvée par recherche web), visible par tous les participants, avec le prix du marché pour comparer au prix proposé. Partagée aussi au catalogue si l'utilisateur est membre.",
    inputSchema: {
      type: "object",
      properties: { commande_id: texte, vin_id: texte, ...CHAMPS_FICHE_SCHEMA, remplacer: { type: "boolean", description: "Remplacer une fiche déjà là" } },
      required: ["commande_id", "vin_id", "description", "sources"],
    },
    annotations: { title: "Fiche d'un vin de commande", readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "degustees",
    description: "Journal des bouteilles bues (dates d'ouverture), le plus récent d'abord, avec les notes de dégustation.",
    inputSchema: { type: "object", properties: { depuis: { ...texte, description: "Date de début (AAAA-MM-JJ)" } } },
    annotations: { title: "Bouteilles bues", readOnlyHint: true },
  },
];

// Fiche venant de Claude : types forcés et longueurs bornées (elle peut aller au catalogue partagé)
const borne = (x: unknown, n: number) => String(x ?? "").trim().slice(0, n);
const estUrl = (x: unknown) => /^https?:\/\/\S+$/.test(String(x || ""));
function nettoyerFiche(a: Vin): Vin {
  const f: Vin = {};
  for (const k of ["region", "pays", "classement"]) if (!vide(a[k])) f[k] = borne(a[k], 120);
  for (const k of ["cepages", "apogee", "service"]) if (!vide(a[k])) f[k] = borne(a[k], 600);
  if (!vide(a.description)) f.description = borne(a.description, 2000);
  if (COULEURS.includes(a.couleur)) f.couleur = a.couleur;
  for (const k of ["boireDe", "boireA"]) { const n = Number(a[k]); if (Number.isInteger(n) && n >= 1900 && n <= 2200) f[k] = n; }
  for (const k of ["prixMin", "prixMax"]) { const n = Number(a[k]); if (isFinite(n) && n > 0 && n < 100000) f[k] = Math.round(n); }
  if (["faible", "moyenne", "haute"].includes(a.confiance)) f.confiance = a.confiance;
  const liste = (x: unknown) => (Array.isArray(x) ? x : vide(x) ? [] : [x]);
  const accords = liste(a.accords).map((x) => borne(x, 120)).filter(Boolean).slice(0, 8);
  if (accords.length) f.accords = accords;
  const sources = liste(a.sources).filter(estUrl).map((x) => borne(x, 400)).slice(0, 8);
  if (sources.length) f.sources = sources;
  return f;
}

function choisirChamps(source: Vin, champs: string[]): Vin {
  const r: Vin = {};
  for (const k of champs) if (!vide(source[k])) r[k] = source[k];
  return r;
}
function dateISO(d: unknown): string {
  if (vide(d)) return new Date().toISOString();
  const t = Date.parse(String(d) + (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? "T12:00:00Z" : ""));
  if (isNaN(t)) throw new Error("date illisible (format attendu AAAA-MM-JJ)");
  return new Date(t).toISOString();
}
function degustation(a: Vin, date = new Date().toISOString()) {
  if (!ETATS_DEGUST[a.etat]) throw new Error("état inconnu : ferme, point ou fatigue");
  const d: Vin = { date, etat: a.etat, note: borne(a.note, 300) };
  const n = Number(a.sur20);
  if (!vide(a.sur20) && n >= 0 && n <= 20) d.sur20 = n;
  return d;
}

async function appelerOutil(uid: string, nom: string, a: Vin): Promise<unknown> {
  switch (nom) {
    case "ma_cave": {
      const cave = await lireCave(uid);
      const mots = norm(a.recherche).split(" ").filter(Boolean);
      const liste = cave
        .filter((b) => a.inclure_bus || Number(b.quantite) > 0)
        .filter((b) => !a.couleur || b.couleur === a.couleur)
        .filter((b) => !a.a_boire || pret(b))
        .filter((b) => {
          if (!mots.length) return true;
          const t = norm([b.domaine, b.cuvee, b.appellation, b.region, b.millesime, b.classement, b.emplacement].join(" "));
          return mots.every((m) => t.includes(m));
        })
        .sort((x, y) => String(x.domaine).localeCompare(String(y.domaine)) || (Number(x.millesime) || 0) - (Number(y.millesime) || 0));
      const enStock = cave.filter((b) => Number(b.quantite) > 0);
      return {
        totaux: {
          vins_en_stock: enStock.length,
          bouteilles: enStock.reduce((s, b) => s + (Number(b.quantite) || 0), 0),
          valeur_estimee_eur: Math.round(enStock.reduce((s, b) => s + valeurUnitaire(b) * (Number(b.quantite) || 0), 0)),
        },
        resultats: liste.length,
        vins: liste.map(resume),
      };
    }

    case "fiche_vin": {
      const { photo, photo_path, partageId, ...b } = await lireVin(uid, a.id);
      return { ...b, statut: statut(b), valeur_unitaire_eur: Math.round(valeurUnitaire(b)) || undefined };
    }

    case "vins_a_completer": {
      const cave = await lireCave(uid);
      const sansFiche = cave.filter((b) => !b.description).map((b) => ({ id: b.id, vin: nomVin(b), quantite: Number(b.quantite) || 0 }));
      const domaines = new Map<string, { domaine: string; vins: number }>();
      for (const b of cave) {
        if (b.domaineInfo || !b.domaine) continue;
        const cle = cleDomaine(b.domaine);
        // Pas de présentation si un autre vin du même domaine l'a déjà
        if (cave.some((x) => x.domaineInfo && memeDomaine(cleDomaine(x.domaine), cle))) continue;
        const d = domaines.get(cle) ?? { domaine: b.domaine, vins: 0 };
        d.vins++;
        domaines.set(cle, d);
      }
      return { vins_sans_fiche: sansFiche, domaines_sans_presentation: [...domaines.values()] };
    }

    case "enregistrer_fiche": {
      const b = await lireVin(uid, a.id);
      const fiche = nettoyerFiche(a);
      if (!fiche.description) throw new Error("la fiche doit contenir une description");
      // Ce vin et ses autres formats (même clé de catalogue)
      const cle = cleCatalogue(b);
      const cave = await lireCave(uid);
      const memes = cave.filter((x) => x.id === b.id || (cle && cleCatalogue(x) === cle));
      for (const x of memes) {
        for (const [k, v] of Object.entries(fiche)) if (a.remplacer || vide(x[k])) x[k] = v;
        delete x.demandeFiche;
      }
      await ecrireVins(uid, memes);
      let partage = "non partagée (domaine ou appellation manquant)";
      if (cle) {
        partage = await publier(uid, cle, choisirChamps(memes.find((x) => x.id === b.id)!, CHAMPS_CATALOGUE.filter((k) => !["domaineInfo", "domaineSite"].includes(k))), !!a.remplacer);
        await cloreDemandes(uid, cle);
      }
      return { ok: true, vins_mis_a_jour: memes.map((x) => nomVin(x)), catalogue: partage };
    }

    case "enregistrer_domaine": {
      const presentation = borne(a.presentation, 3000);
      if (presentation.length < 80) throw new Error("présentation trop courte");
      const cle = cleDomaine(a.domaine);
      if (!cle) throw new Error("nom de domaine vide");
      const cave = await lireCave(uid);
      const memes = cave.filter((x) => x.domaine && memeDomaine(cleDomaine(x.domaine), cle));
      if (!memes.length) throw new Error("aucun vin de ce domaine dans ta cave (vérifie l'écriture avec ma_cave)");
      const site = estUrl(a.site) ? borne(a.site, 300) : "";
      const changes = memes.filter((x) => a.remplacer || !x.domaineInfo);
      if (!changes.length) return { ok: false, message: "tous les vins de ce domaine ont déjà une présentation : rien changé (utilise remplacer pour l'écraser)" };
      for (const x of changes) { x.domaineInfo = presentation; x.domaineSite = site; delete x.demandeDomaine; }
      await ecrireVins(uid, changes);
      const cd = cleCatalogueDomaine(memes[0].domaine)!;
      const partage = await publier(uid, cd, { presentation, site, nom: memes[0].domaine }, !!a.remplacer);
      await cloreDemandes(uid, cd);
      return { ok: true, vins_mis_a_jour: changes.length, deja_presentes: memes.length - changes.length, catalogue: partage };
    }

    case "enregistrer_garde": {
      const b = await lireVin(uid, a.id);
      const an = (x: unknown) => { const n = Number(x); if (!Number.isInteger(n) || n < 1900 || n > 2200) throw new Error("année invalide"); return n; };
      const g = {
        ouverture: an(a.ouverture), apogeeDe: an(a.apogeeDe), apogeeA: an(a.apogeeA), avant: an(a.avant),
        ...(a.confiance ? { confiance: a.confiance } : {}),
        conseil: borne(a.conseil, 1500), explication: borne(a.explication, 2000),
        ...(vide(a.millesime) ? {} : { millesime: borne(a.millesime, 600) }),
        sources: (Array.isArray(a.sources) ? a.sources : []).slice(0, 8)
          .map((x: Vin) => ({ nom: borne(x?.nom, 150), url: estUrl(x?.url) ? borne(x.url, 400) : "", fenetre: borne(x?.fenetre, 300) }))
          .filter((x: Vin) => x.nom),
        le: new Date().toISOString(),
      };
      if (!(g.ouverture <= g.apogeeDe && g.apogeeDe <= g.apogeeA && g.apogeeA <= g.avant)) throw new Error("les années doivent se suivre : ouverture ≤ apogée ≤ fin d'apogée ≤ avant");
      b.garde = g;
      b.boireDe = g.ouverture;
      b.boireA = g.avant;
      await ecrireVins(uid, [b]);
      return { ok: true, vin: nomVin(b), statut: statut(b) };
    }

    case "ouvrir_bouteille": {
      const b = await lireVin(uid, a.id);
      if ((Number(b.quantite) || 0) <= 0) throw new Error("plus aucune bouteille de ce vin en stock");
      b.quantite = Number(b.quantite) - 1;
      const date = dateISO(a.date);
      b.ouvertures = [...(b.ouvertures || []), date];
      if (a.etat) b.degustations = [...(b.degustations || []), degustation(a, date)];
      await ecrireVins(uid, [b]);
      return { ok: true, vin: nomVin(b), reste: b.quantite };
    }

    case "noter_degustation": {
      const b = await lireVin(uid, a.id);
      b.degustations = [...(b.degustations || []), degustation(a)];
      await ecrireVins(uid, [b]);
      return { ok: true, vin: nomVin(b), degustations: b.degustations.length };
    }

    case "modifier_bouteille": {
      const b = await lireVin(uid, a.id);
      const changes: string[] = [];
      if (!vide(a.quantite)) { const q = Number(a.quantite); if (!Number.isInteger(q) || q < 0) throw new Error("quantité invalide"); b.quantite = q; changes.push("quantité"); }
      if (a.emplacement !== undefined) { b.emplacement = borne(a.emplacement, 120); changes.push("emplacement"); }
      if (a.notes !== undefined) { b.notes = borne(a.notes, 2000); changes.push("notes"); }
      if (a.prix !== undefined) { const p = Number(a.prix); b.prix = isFinite(p) && p > 0 ? p : ""; changes.push("prix"); }
      for (const k of ["boireDe", "boireA"]) if (!vide(a[k])) { const n = Number(a[k]); if (!Number.isInteger(n) || n < 1900 || n > 2200) throw new Error("année invalide"); b[k] = n; changes.push(k); }
      if (!changes.length) throw new Error("rien à modifier");
      await ecrireVins(uid, [b]);
      return { ok: true, vin: nomVin(b), modifie: changes, quantite: b.quantite };
    }

    case "ajouter_vins": {
      if (!Array.isArray(a.vins) || !a.vins.length) throw new Error("liste de vins vide");
      if (a.vins.length > 200) throw new Error("200 vins au plus par appel");
      const cave = await lireCave(uid);
      const parCle = new Map(cave.map((b) => [cleVin(b), b]));
      const aEcrire = new Map<string, Vin>();
      const bilan: string[] = [];
      for (const v of a.vins) {
        const q = Number(v.quantite);
        if (!Number.isInteger(q) || q < 1) throw new Error("quantité invalide pour " + (v.domaine || "un vin"));
        const domaine = domaineDansCave(cave, v.domaine);
        const format = FORMATS.includes(v.format) ? v.format : "";
        const millesime = Number(v.millesime) || "";
        const base: Vin = {
          domaine: borne(domaine, 150), cuvee: borne(v.cuvee, 150), appellation: borne(nettoyerAppellation(v.appellation), 150), millesime, format,
        };
        if (!base.domaine || !base.appellation) throw new Error("domaine et appellation obligatoires");
        const jumelle = parCle.get(cleVin(base));
        if (jumelle) {
          jumelle.quantite = (Number(jumelle.quantite) || 0) + q;
          for (const [k, x] of Object.entries(nettoyerFiche(v))) if (vide(jumelle[k])) jumelle[k] = x;
          aEcrire.set(jumelle.id, jumelle);
          bilan.push(`${nomVin(jumelle)} : +${q} (total ${jumelle.quantite})`);
          continue;
        }
        const fiche = nettoyerFiche(v);
        const prix = Number(v.prix);
        const nouveau: Vin = {
          id: crypto.randomUUID(),
          ...base,
          classement: "", region: "", couleur: "Rouge", boireDe: "", boireA: "",
          ...fiche,
          quantite: q, prix: isFinite(prix) && prix > 0 ? prix : "",
          emplacement: borne(v.emplacement, 120), notes: borne(v.notes, 2000),
          ajoute: Date.now(),
        };
        // Présentation du domaine déjà connue dans la cave ?
        const frere = cave.find((b) => b.domaineInfo && memeDomaine(cleDomaine(b.domaine), cleDomaine(domaine)));
        if (frere) { nouveau.domaineInfo = frere.domaineInfo; nouveau.domaineSite = frere.domaineSite || ""; }
        cave.push(nouveau);
        parCle.set(cleVin(nouveau), nouveau);
        aEcrire.set(nouveau.id, nouveau);
        bilan.push(`${nomVin(nouveau)} : ajouté (${q})`);
      }
      const liste = [...aEcrire.values()];
      for (let i = 0; i < liste.length; i += 100) await ecrireVins(uid, liste.slice(i, i + 100));
      return { ok: true, bilan, a_completer: liste.filter((b) => !b.description).map((b) => ({ id: b.id, vin: nomVin(b) })) };
    }

    case "imports_a_traiter": {
      const lignes = await sb(`/rest/v1/imports?select=id,but,commande_id,fichiers,cree&user_id=eq.${uid}&statut=eq.attente&order=cree.desc&limit=20`) || [];
      const titres = new Map<string, string>();
      const ids = [...new Set(lignes.map((l: any) => l.commande_id).filter((i: string) => UUID.test(String(i || ""))))];
      if (ids.length) for (const c of await sb(`/rest/v1/commandes?select=id,titre&organisateur=eq.${uid}&id=in.(${ids.join(",")})`) || []) titres.set(c.id, c.titre);
      return {
        imports: lignes.map((l: any) => ({
          id: l.id, cree: l.cree,
          but: l.but === "commande" ? `offre pour la commande « ${titres.get(l.commande_id) || "?"} » (commande_id ${l.commande_id})` : "ajout à la cave",
          fichiers: (l.fichiers || []).map((f: Vin) => `${f.nom || "fichier"} (${f.type})`),
        })),
      };
    }

    case "lire_import": {
      const imp = await lireImport(uid, a.id);
      const blocs: Vin[] = [{
        type: "text",
        text: imp.but === "commande"
          ? `Import ${imp.id} : offre à ajouter à la commande groupée ${imp.commande_id} (ajouter_vins_commande, après validation de l'utilisateur).`
          : `Import ${imp.id} : bouteilles à ajouter à la cave (ajouter_vins, après validation de l'utilisateur).`,
      }];
      for (const f of (imp.fichiers || []).slice(0, 12)) {
        if (!cheminSur(uid, f.chemin)) continue; // jamais le fichier d'un autre compte
        const octets = await telecharger(uid, f.chemin);
        if (f.type === "image") blocs.push({ type: "image", data: enBase64(octets), mimeType: /\.png$/i.test(f.chemin) ? "image/png" : "image/jpeg" });
        else if (f.type === "texte") blocs.push({ type: "text", text: `--- ${borne(f.nom, 120)} ---\n` + new TextDecoder().decode(octets).slice(0, 200_000) });
        else if (f.type === "pdf") blocs.push({ type: "resource", resource: { uri: `ma-cave://imports/${imp.id}/${encodeURIComponent(borne(f.nom, 120) || "document.pdf")}`, mimeType: "application/pdf", blob: enBase64(octets) } });
      }
      return { __contenu: blocs };
    }

    case "terminer_import": {
      const imp = await lireImport(uid, a.id);
      const chemins = (imp.fichiers || []).map((f: Vin) => f.chemin).filter((c: string) => cheminSur(uid, c));
      if (chemins.length) {
        await sb(`/storage/v1/object/imports`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prefixes: chemins }),
        }).catch(() => {});
      }
      await sb(`/rest/v1/imports?user_id=eq.${uid}&id=eq.${imp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ statut: "traite", traite: new Date().toISOString() }),
      });
      return { ok: true };
    }

    case "mes_commandes": {
      const lignes = await sb(`/rest/v1/commandes?select=id,titre,fournisseur,statut,cree,commande_vins(data,prix)&organisateur=eq.${uid}&order=cree.desc&limit=20`) || [];
      return {
        commandes: lignes.map((c: any) => ({
          id: c.id, titre: c.titre, fournisseur: c.fournisseur || undefined, statut: c.statut,
          vins: (c.commande_vins || []).map((v: any) => `${nomVin(v.data || {})} — ${Number(v.prix) || 0} €`),
        })),
      };
    }

    case "ajouter_vins_commande": {
      const c = await maCommande(uid, a.commande_id);
      if (c.statut !== "ouverte") throw new Error("cette commande n'est plus ouverte : on ne peut plus y ajouter de vins");
      if (!Array.isArray(a.vins) || !a.vins.length) throw new Error("liste de vins vide");
      if (a.vins.length > 150) throw new Error("150 vins au plus par appel");
      const cave = await lireCave(uid);
      const lignes = a.vins.map((v: Vin) => {
        const prix = Number(v.prix);
        const caisse = Number(v.caisse);
        const data: Vin = {
          domaine: borne(domaineDansCave(cave, v.domaine), 150), cuvee: borne(v.cuvee, 150),
          appellation: borne(nettoyerAppellation(v.appellation), 150),
          millesime: Number(v.millesime) || "", couleur: COULEURS.includes(v.couleur) ? v.couleur : "Rouge",
        };
        if (!data.domaine && !data.appellation) throw new Error("domaine ou appellation manquant");
        if (!vide(v.classement)) data.classement = borne(v.classement, 120);
        if (FORMATS.includes(v.format) && v.format) data.format = v.format;
        if (!vide(v.remarque)) data.remarque = borne(v.remarque, 300);
        if (Number.isInteger(caisse) && caisse > 1 && caisse <= 120) data.caisse = caisse;
        return { commande_id: c.id, prix: isFinite(prix) && prix > 0 ? Math.round(prix * 100) / 100 : 0, data, ajoute_par: uid };
      });
      await sb(`/rest/v1/commande_vins`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(lignes),
      });
      if (!vide(a.fournisseur) && !c.fournisseur) {
        await sb(`/rest/v1/commandes?id=eq.${c.id}&organisateur=eq.${uid}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ fournisseur: borne(a.fournisseur, 150) }),
        });
      }
      return { ok: true, commande: c.titre, vins_ajoutes: lignes.length, sans_prix: lignes.filter((l: Vin) => !l.prix).length };
    }

    case "vins_commande": {
      const c = await commandeVisible(uid, a.commande_id);
      const vins = await sb(`/rest/v1/commande_vins?select=id,data,prix&commande_id=eq.${c.id}&order=cree`) || [];
      return {
        commande: c.titre,
        vins: vins.map((v: any) => ({ vin_id: v.id, vin: nomVin(v.data || {}), prix_propose_eur: Number(v.prix) || undefined, fiche: !!v.data?.fiche?.description })),
      };
    }

    case "enregistrer_fiche_commande": {
      const c = await commandeVisible(uid, a.commande_id);
      if (!UUID.test(String(a.vin_id || ""))) throw new Error("identifiant de vin invalide");
      const v = (await sb(`/rest/v1/commande_vins?select=id,data&commande_id=eq.${c.id}&id=eq.${a.vin_id}`))?.[0];
      if (!v) throw new Error("vin introuvable dans cette commande (vérifie avec vins_commande)");
      const fiche = nettoyerFiche(a);
      if (!fiche.description) throw new Error("la fiche doit contenir une description");
      if (v.data?.fiche?.description && !a.remplacer) return { ok: false, message: "ce vin a déjà une fiche : rien changé (utilise remplacer pour la refaire)" };
      const data = { ...(v.data || {}), fiche: { ...fiche, le: new Date().toISOString() } };
      await sb(`/rest/v1/commande_vins?id=eq.${v.id}&commande_id=eq.${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ data }),
      });
      const cle = cleCatalogue(v.data || {});
      const partage = cle ? await publier(uid, cle, { ...choisirChamps(v.data || {}, ["classement", "couleur"]), ...fiche }, false) : "non partagée (domaine ou appellation manquant)";
      return { ok: true, vin: nomVin(v.data || {}), catalogue: partage };
    }

    case "degustees": {
      const depuis = vide(a.depuis) ? 0 : Date.parse(dateISO(a.depuis));
      const cave = await lireCave(uid);
      const journal = cave.flatMap((b) => (b.ouvertures || []).map((d: string) => ({ date: d, id: b.id, vin: nomVin(b) })))
        .filter((x) => Date.parse(x.date) >= depuis)
        .sort((x, y) => y.date.localeCompare(x.date))
        .slice(0, 300);
      const notes = cave.flatMap((b) => (b.degustations || []).map((d: Vin) => ({ ...d, etat: ETATS_DEGUST[d.etat] || d.etat, id: b.id, vin: nomVin(b) })))
        .filter((x) => Date.parse(x.date) >= depuis)
        .sort((x, y) => String(y.date).localeCompare(String(x.date)))
        .slice(0, 100);
      return { bouteilles_bues: journal.length, journal, degustations: notes };
    }
  }
  throw new Error(`outil inconnu : ${nom}`);
}

// ---------- Protocole MCP (JSON-RPC sur HTTP, réponses JSON) ----------

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, mcp-protocol-version, mcp-session-id, authorization, accept",
};
const json = (corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), { status: statut, headers: { ...CORS, "Content-Type": "application/json" } });
const erreurRpc = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function traiterMessage(uid: string, m: any): Promise<unknown | null> {
  if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string") return erreurRpc(m?.id, -32600, "requête invalide");
  const estNotification = m.id === undefined || m.id === null;
  if (estNotification) return null; // notifications/initialized, annulations… : rien à répondre
  const p = m.params ?? {};
  switch (m.method) {
    case "initialize": {
      const demande = String(p.protocolVersion || "");
      return {
        jsonrpc: "2.0", id: m.id,
        result: {
          protocolVersion: VERSIONS_PROTOCOLE.includes(demande) ? demande : VERSIONS_PROTOCOLE[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: NOM, title: "Ma Cave", version: VERSION },
          instructions: CONSIGNES,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id: m.id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id: m.id, result: { tools: OUTILS } };
    case "tools/call": {
      const nom = String(p.name || "");
      if (!OUTILS.some((o) => o.name === nom)) return erreurRpc(m.id, -32602, `outil inconnu : ${nom}`);
      try {
        const r: any = await appelerOutil(uid, nom, p.arguments ?? {});
        if (r && Array.isArray(r.__contenu)) return { jsonrpc: "2.0", id: m.id, result: { content: r.__contenu } };
        return { jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: JSON.stringify(r, null, 1) }], structuredContent: r } };
      } catch (e) {
        return { jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "Erreur : " + (e as Error).message }], isError: true } };
      }
    }
    case "resources/list":
      return { jsonrpc: "2.0", id: m.id, result: { resources: [] } };
    case "prompts/list":
      return { jsonrpc: "2.0", id: m.id, result: { prompts: [] } };
    default:
      return erreurRpc(m.id, -32601, `méthode non prise en charge : ${m.method}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  // La clé est le dernier morceau de l'adresse : …/ma-cave-mcp/<clé>
  const morceaux = new URL(req.url).pathname.split("/").filter(Boolean);
  const cle = morceaux.at(-1) ?? "";
  if (req.method === "GET" || req.method === "DELETE") {
    // Pas de flux d'événements ni de session : tout passe par POST
    return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
  }
  if (req.method !== "POST") return new Response(null, { status: 405, headers: CORS });
  if (!SB_URL || !SB_CLE) return json(erreurRpc(null, -32603, "configuration du serveur incomplète"), 500);

  let uid: string | null = null;
  try { uid = await utilisateurDeCle(cle); } catch { return json(erreurRpc(null, -32603, "base de données indisponible"), 503); }
  if (!uid) return json(erreurRpc(null, -32001, "Lien du connecteur inconnu ou révoqué : créez un nouveau lien dans Ma Cave (Mon compte → Brancher mon Claude)."), 403);

  let corps: any;
  try { corps = await req.json(); } catch { return json(erreurRpc(null, -32700, "JSON illisible"), 400); }

  if (Array.isArray(corps)) {
    const reponses = (await Promise.all(corps.map((m) => traiterMessage(uid!, m)))).filter((r) => r !== null);
    return reponses.length ? json(reponses) : new Response(null, { status: 202, headers: CORS });
  }
  const r = await traiterMessage(uid, corps);
  return r === null ? new Response(null, { status: 202, headers: CORS }) : json(r);
});
