# E-mails de Ma Cave

Modèles des e-mails envoyés par Supabase Auth (projet Ma Cave), à coller dans
Authentication → Emails → Templates. Les styles sont écrits en ligne, avec des couleurs fixes
(celles de `--accent` en mode clair) : les messageries ne lisent ni les feuilles de style ni les variables CSS.

| Modèle Supabase | Objet | Fichier |
|---|---|---|
| Confirm signup | Confirmez votre adresse Ma Cave | `confirmation.html` |
| Reset password | Votre nouveau mot de passe Ma Cave | `mot-de-passe.html` |
| Change email address | Confirmez votre nouvelle adresse Ma Cave | `changement-email.html` |
| Magic link | Votre lien de connexion à Ma Cave | `lien-magique.html` |

Envoi par Resend (Authentication → Emails → SMTP Settings) : hôte `smtp.resend.com`, port 465,
utilisateur `resend`, mot de passe = clé API Resend (jamais dans ce dépôt), expéditeur
`macave@envoi.pstrauss.org`, nom « Ma Cave ». Domaine `envoi.pstrauss.org` vérifié dans Resend (Ireland),
partagé avec Cloach.
