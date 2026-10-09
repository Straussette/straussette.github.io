// Supabase Edge Function : chercher-vin
// Reçoit { requete: "Jamet Côte-Rôtie 2015" } et renvoie une fiche de vin
// trouvée par Claude avec la recherche web.
// La clé API est lue dans le secret ANTHROPIC_API_KEY (jamais dans le code).

const ORIGINES_AUTORISEES = [
  "https://straussette.github.io",
];

const MODELE = "claude-sonnet-5-5";
const RECHERCHES_MAX = 4; // limite le nombre de recherches web (et donc le coût)

const COULEURS = ["Rouge", "Blanc", "Rosé", "Effervescent", "Liquoreux"];

const CONSIGNE = `Tu es un sommelier expert. L'utilisateur décrit une bouteille de vin de sa cave.
Fais quelques recherches web ciblées (site du domaine, guides, critiques, cavistes) pour identifier précisément ce vin, puis réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de cette forme :
{
  "trouve": true,
  "domaine": "nom du domaine ou château",
  "cuvee": "nom de la cuvée, ou chaîne vide",
  "appellation": "appellation officielle",
  "region": "région viticole (ex. Rhône Nord, Bourgogne, Bordeaux)",
  "pays": "pays",
  "couleur": "une valeur parmi ${COULEURS.join(", ")}",
  "millesime": 2015,
  "cepages": "cépages et proportions si connues",
  "boireDe": 2023,
  "boireA": 2040,
  "apogee": "courte phrase sur l'apogée, ex. 'apogée vers 2028-2035'",
  "description": "2 à 3 phrases : style, arômes, structure",
  "accords": ["3 à 5 accords mets-vins précis"],
  "service": "température de service et carafage éventuel",
  "prixMin": 60,
  "prixMax": 90,
  "confiance": "haute | moyenne | faible",
  "sources": ["URLs principales utilisées"]
}
Règles :
- millesime, boireDe, boireA, prixMin, prixMax sont des nombres (ou null si inconnus). Les prix sont en euros, prix actuel du marché par bouteille 75 cl.
- La fenêtre de dégustation (boireDe → boireA) s'appuie de préférence sur des critiques ou le domaine ; sinon estime-la d'après l'appellation, le style et la qualité du millésime, et mets confiance à "moyenne" ou "faible".
- Si le millésime n'est pas précisé, raisonne sur le millésime le plus courant et mets millesime à null.
- Si tu ne trouves pas le vin, renvoie {"trouve": false, "message": "explication courte"}.
- Réponds en français.`;

// Mode « détecter » : repérer toutes les bouteilles d'une photo (sans recherche web)
const CONSIGNE_DETECTION = `Tu es un sommelier expert. On te montre une photo contenant une ou plusieurs bouteilles de vin.
Repère chaque bouteille dont l'étiquette est au moins partiellement lisible, lis son étiquette, et regroupe les bouteilles identiques (même domaine, cuvée, appellation et millésime).
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{
  "vins": [
    {
      "domaine": "nom du domaine ou château",
      "cuvee": "nom de la cuvée, ou chaîne vide",
      "appellation": "appellation",
      "millesime": 2015,
      "couleur": "une valeur parmi ${COULEURS.join(", ")}",
      "nombre": 2,
      "certitude": "haute | moyenne | faible",
      "position": "où elle est sur la photo, ex. 'à gauche', '3e en partant de la gauche'"
    }
  ],
  "nonIdentifiees": 1
}
Règles :
- millesime est un nombre, ou null s'il n'est pas visible (ne l'invente pas).
- Complète l'appellation et la couleur d'après tes connaissances si l'étiquette ne les montre pas clairement.
- nonIdentifiees = nombre de bouteilles visibles dont tu n'as pas pu lire l'étiquette.
- S'il n'y a aucune bouteille de vin, renvoie {"vins": [], "nonIdentifiees": 0}.`;

function reponse(corps: unknown, statut: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

function extraireJSON(texte: string) {
  const debut = texte.indexOf("{");
  const fin = texte.lastIndexOf("}");
  if (debut === -1 || fin <= debut) throw new Error("Pas de JSON dans la réponse");
  return JSON.parse(texte.slice(debut, fin + 1));
}

async function detecter(
  cle: string,
  image: { media_type: string; data: string },
  cors: Record<string, string>,
) {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": cle, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODELE,
        max_tokens: 3000,
        system: CONSIGNE_DETECTION,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", ...image } },
            { type: "text", text: "Liste les vins visibles sur cette photo." },
          ],
        }],
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      console.error("Erreur API Anthropic", data);
      return reponse({ erreur: data?.error?.message ?? "Erreur du service d'IA" }, 502, cors);
    }
    const texte = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n");
    const res = extraireJSON(texte);
    const vins = (Array.isArray(res.vins) ? res.vins : []).map((v: Record<string, unknown>) => ({
      ...v,
      couleur: COULEURS.includes(String(v.couleur)) ? v.couleur : "",
      nombre: Math.max(1, Math.min(48, Number(v.nombre) || 1)),
    }));
    return reponse({ vins, nonIdentifiees: Number(res.nonIdentifiees) || 0 }, 200, cors);
  } catch (e) {
    console.error(e);
    return reponse({ erreur: "Impossible de lire la photo, réessayez." }, 500, cors);
  }
}

Deno.serve(async (req) => {
  const origine = req.headers.get("origin") ?? "";
  const cors = {
    "Access-Control-Allow-Origin": ORIGINES_AUTORISEES.includes(origine) ? origine : ORIGINES_AUTORISEES[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-code-acces",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reponse({ erreur: "Méthode non autorisée" }, 405, cors);
  if (!ORIGINES_AUTORISEES.includes(origine)) return reponse({ erreur: "Origine non autorisée" }, 403, cors);

  // Code d'accès : seul celui qui le connaît peut lancer une recherche (et dépenser des crédits)
  const codeAttendu = Deno.env.get("CODE_ACCES");
  if (!codeAttendu) return reponse({ erreur: "Secret CODE_ACCES manquant dans Supabase" }, 500, cors);
  if ((req.headers.get("x-code-acces") ?? "") !== codeAttendu) {
    return reponse({ erreur: "Code d'accès incorrect", code: "CODE_INVALIDE" }, 401, cors);
  }

  const cle = Deno.env.get("ANTHROPIC_API_KEY");
  if (!cle) return reponse({ erreur: "Secret ANTHROPIC_API_KEY manquant dans Supabase" }, 500, cors);

  let requete = "";
  let mode = "rechercher";
  let image: { media_type: string; data: string } | null = null;
  try {
    const corps = await req.json();
    requete = String(corps.requete ?? "").trim();
    if (corps.mode === "detecter") mode = "detecter";
    if (corps.image) {
      // Photo de l'étiquette envoyée en "data URL" (data:image/jpeg;base64,....)
      const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(corps.image));
      if (!m) return reponse({ erreur: "Format de photo non reconnu" }, 400, cors);
      if (m[2].length > 4_000_000) return reponse({ erreur: "Photo trop lourde" }, 413, cors);
      image = { media_type: m[1], data: m[2] };
    }
  } catch {
    return reponse({ erreur: "Requête invalide" }, 400, cors);
  }
  if (mode === "detecter") {
    if (!image) return reponse({ erreur: "Photo manquante" }, 400, cors);
    return await detecter(cle, image, cors);
  }

  if (!image && requete.length < 3) return reponse({ erreur: "Décrivez le vin (domaine, appellation, millésime…) ou prenez l'étiquette en photo" }, 400, cors);
  if (requete.length > 300) requete = requete.slice(0, 300);

  const contenu: unknown[] = [];
  if (image) {
    contenu.push({ type: "image", source: { type: "base64", ...image } });
    contenu.push({
      type: "text",
      text: "Voici la photo de l'étiquette. Lis d'abord tout ce qui y figure (domaine, cuvée, appellation, millésime, mentions), puis identifie ce vin précisément avec tes recherches."
        + (requete ? `\nPrécisions de l'utilisateur : ${requete}` : "")
        + "\nSi l'étiquette est illisible ou ne montre pas de vin, renvoie trouve: false avec une explication.",
    });
  } else {
    contenu.push({ type: "text", text: `Bouteille à identifier : ${requete}` });
  }
  const messages: unknown[] = [{ role: "user", content: contenu }];

  try {
    // La recherche web peut demander plusieurs tours (stop_reason "pause_turn")
    for (let tour = 0; tour < 3; tour++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": cle,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODELE,
          max_tokens: 2000,
          system: CONSIGNE,
          messages,
          tools: [{
            type: "web_search_20250305",
            name: "web_search",
            max_uses: RECHERCHES_MAX,
            user_location: { type: "approximate", country: "FR", timezone: "Europe/Paris" },
          }],
        }),
      });

      const data = await r.json();
      if (!r.ok) {
        console.error("Erreur API Anthropic", data);
        const msg = data?.error?.message ?? "Erreur du service d'IA";
        return reponse({ erreur: msg }, 502, cors);
      }

      if (data.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: data.content });
        continue;
      }

      const texte = (data.content ?? [])
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text)
        .join("\n");

      const fiche = extraireJSON(texte);
      if (fiche.couleur && !COULEURS.includes(fiche.couleur)) fiche.couleur = "";
      return reponse(fiche, 200, cors);
    }
    return reponse({ erreur: "La recherche a pris trop de temps, réessayez." }, 504, cors);
  } catch (e) {
    console.error(e);
    return reponse({ erreur: "Impossible de lire la réponse, réessayez." }, 500, cors);
  }
});
