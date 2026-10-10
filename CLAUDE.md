# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Ma Cave**: a French-language wine cellar web app (PWA-like), served by GitHub Pages at https://straussette.github.io. All UI text, code identifiers, comments and commit messages are in French. Keep it that way.

The repo holds two files:
- `index.html`: the whole client app (HTML + CSS + vanilla JS, no dependencies, no build step).
- `supabase/functions/chercher-vin/index.ts`: a Supabase Edge Function (Deno) that calls the Claude API.

Database schema, RLS policies, RPCs and storage buckets live in the Supabase project and are **not** in this repo.

## Commands

There is no build, package manager, linter or test suite.

- Run locally: `python3 -m http.server 8000`, then open http://localhost:8000. Calls to the edge function will fail because its CORS/origin check only accepts `https://straussette.github.io`.
- Syntax-check the inline script:
  `awk '/<script>/{f=1;next}/<\/script>/{f=0}f' index.html > /tmp/app.js && node --check /tmp/app.js`
- Deploy the app: push to the default branch; GitHub Pages serves `index.html`.
- Deploy the function: `supabase functions deploy chercher-vin`. This needs the Supabase CLI and project access, neither of which is set up here. Secrets: `ANTHROPIC_API_KEY`, optional `CODE_ACCES`.

## Conventions

- **Bump `<meta name="app-version" content="YYYY-MM-DD.N">` in every change to `index.html`.** `verifierMiseAJour()` compares this value with the online copy and force-reloads clients when it differs, so a missing bump means users keep the old version.
- `index.html` is organised into sections marked `/* ---------- Titre ---------- */` (both CSS and JS). Add code to the relevant section, or create a new section in the same style.
- Theming uses CSS custom properties on `:root`, with dark mode under `prefers-color-scheme` and `[data-theme]`. Use the existing tokens (`--accent`, `--surface`, `--c-rouge`…) rather than hard-coded colours.
- Escape interpolated values in generated HTML with `esc()`.

## Architecture

### Client data flow (`index.html`)
- `bottles` (global array) is the source of truth. `enregistrer()` persists it to IndexedDB (DB `ma-cave`, store `kv`, key `bottles`) and then calls `planifierSync()`.
- The app is offline-first. When logged in, `synchroniser()` runs four steps in order: upload new photos to the storage bucket `photos/<uid>/<id>.jpg`; upsert changed rows into the `bouteilles` table (`{id, data, photo_path}`, where `data` is the bottle object minus the photo); delete rows removed locally; and, if `telecharger`, merge the account's rows back in (`recupererCompte`). Change detection relies on per-row JSON fingerprints stored in localStorage under `ma-cave-sync-<uid>`.
- Supabase is called with raw `fetch` through `sbFetch()` (REST `/rest/v1`, auth `/auth/v1`, storage `/storage/v1`). There is no supabase-js. The session lives in localStorage `ma-cave-session` and is refreshed by `jeton()`. `SB_CLE` is the public publishable key.
- Tables and RPCs used by the client: `bouteilles`, `profils`, `admins`, `commandes`, `commande_vins`, `commande_participants`, `remboursements`, plus the RPCs `admin_comptes`, `admin_definir_membre` and `rejoindre_commande`.
- Bottle identity for grouping and deduplication is `cleVin()` (normalised domaine|cuvée|appellation|millésime|format). Producer names are normalised through `nettoyerDomaine()`, `cleDomaine()` and `domaineCanonique()` so that new entries reuse the spelling already in the cellar.
- Main features: per-bottle search/photo identification, batch photo add, wine detail page, "garde affinée", meal pairing ("Que boire avec mon repas ?"), an opened-bottles history ("Bus"), group orders (`commandes`: share link via `#commande=…`, case sizes, recap/Excel export, importing a caviste's offer), an admin screen, and JSON backup/restore.

### Edge function (`chercher-vin`)
- Single POST endpoint. Access is allowed when either the `x-code-acces` header matches `CODE_ACCES`, or the bearer JWT belongs to a user listed in `membres` (checked by querying `membres` with the user's own token, so RLS decides).
- The `mode` field selects a prompt and handler:
  - `rechercher` (default): text query or label photo, with web search capped by `RECHERCHES_MAX`.
  - `detecter`: several bottles in one photo, no web search.
  - `propale`: extract wines and prices from an offer given as image, PDF or table text.
  - `accord`: pick a wine from the user's cellar for a meal.
  - `garde`: refine the drinking window.
- Every handler asks Claude for JSON only and parses the reply with `extraireJSON()`. If you change a JSON shape in a prompt, update the matching client code in `index.html`, and vice versa.
- Each call is logged to the `recherches` table for the admin screen (best effort).
- The model is set by the `MODELE` constant.
