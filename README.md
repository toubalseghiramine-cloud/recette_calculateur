# Coût Recettes — calcul du coût des recettes de pâtisserie

Petite application web installable (PWA) qui fonctionne hors ligne.
Les données restent sur le téléphone (IndexedDB) ; aucun compte, aucun serveur.

## Contenu du dossier

| Fichier | Rôle |
|---|---|
| `index.html` | Structure des écrans |
| `styles.css` | Apparence (mobile d'abord, mode sombre automatique) |
| `app.js` | Logique : produits, recettes, calculs, export/import |
| `db.js` | Enregistrement des données sur l'appareil (IndexedDB) |
| `sw.js` | Service worker : fonctionnement hors ligne |
| `manifest.webmanifest` | Nom, couleurs, icônes pour l'installation |
| `icons/` | Icônes de l'application |
| `tools/generate-icons.js` | Régénère les icônes (`node tools/generate-icons.js`) |

---

## 1. Tester sur l'ordinateur

Ouvrir `index.html` en double-cliquant **ne suffit pas** : le mode hors ligne
et l'installation ne fonctionnent qu'avec une adresse `http://localhost` ou `https://`.

1. Ouvrez un terminal dans le dossier du projet
   (dans l'Explorateur Windows : clic droit dans le dossier → « Ouvrir dans le terminal »).
2. Lancez un petit serveur (Node.js est nécessaire) :
   ```
   npx http-server -c-1 -p 8080
   ```
3. Ouvrez **http://localhost:8080** dans Chrome ou Edge.
4. Pour voir l'app comme sur un téléphone : touche **F12** → icône téléphone/tablette
   (« Toggle device toolbar »).
5. Toujours dans F12, onglet **Application** : vous y voyez le manifest, le service
   worker et les données (IndexedDB). Cochez « Offline » dans *Service workers*
   pour vérifier que l'app marche sans internet.
6. Pour arrêter le serveur : **Ctrl + C** dans le terminal.

> Astuce pendant le développement : dans F12 → Application → Service workers,
> cochez « Update on reload » pour toujours voir vos dernières modifications.

---

## 2. Mettre en ligne gratuitement (GitHub Pages)

Tout se fait depuis le site web de GitHub, sans ligne de commande.

1. Créez un compte gratuit sur **https://github.com** (bouton *Sign up*).
2. En haut à droite, **+** → **New repository**.
   - *Repository name* : par exemple `cout-recettes`
   - Cochez **Public** (obligatoire pour GitHub Pages gratuit)
   - Cliquez sur **Create repository**.
3. Sur la page du dépôt, cliquez sur le lien **« uploading an existing file »**.
4. Glissez-déposez **le contenu** du dossier du projet (les fichiers `index.html`,
   `app.js`… et les dossiers `icons` et `tools`), pas le dossier lui-même.
   `index.html` doit se trouver à la racine du dépôt.
5. En bas, cliquez sur **Commit changes**.
6. Allez dans **Settings** (onglet du dépôt) → **Pages** (menu de gauche).
   - *Source* : **Deploy from a branch**
   - *Branch* : **main** et dossier **/ (root)** → **Save**.
7. Attendez 1 à 2 minutes puis rechargez la page *Pages* : l'adresse s'affiche,
   du type **https://votre-pseudo.github.io/cout-recettes/**.

### Publier une mise à jour plus tard

1. Dans le dépôt GitHub : **Add file → Upload files**, glissez les fichiers modifiés
   (ils remplacent les anciens) → **Commit changes**.
2. Dans `sw.js`, augmentez `CACHE_VERSION` (`'v1'` → `'v2'`…) et dans `app.js`
   `APP_VERSION`. Les téléphones afficheront alors « Nouvelle version disponible ».

> Alternative encore plus rapide : **Netlify Drop** (https://app.netlify.com/drop) —
> on glisse le dossier dans la page et le site est en ligne. Il faut créer un compte
> gratuit pour que le site reste en ligne durablement.

---

## 3. Installer sur le téléphone

Ouvrez d'abord l'adresse du site (celle de GitHub Pages) sur le téléphone.

### Android (Chrome)
1. Ouvrez l'adresse dans **Chrome**.
2. Touchez le menu **⋮** (en haut à droite) → **« Installer l'application »**
   (ou « Ajouter à l'écran d'accueil »).
   Vous pouvez aussi utiliser le bouton **Installer** dans l'onglet **Réglages** de l'app.
3. L'icône « Coût Recettes » apparaît sur l'écran d'accueil.

### iPhone (Safari obligatoire)
1. Ouvrez l'adresse dans **Safari** (pas Chrome).
2. Touchez le bouton **Partager** (carré avec une flèche vers le haut).
3. Faites défiler et touchez **« Sur l'écran d'accueil »** → **Ajouter**.

Une fois installée, l'application s'ouvre en plein écran et fonctionne sans internet.

---

## Sauvegarder ses données

Les données sont enregistrées **uniquement sur le téléphone**.
Dans **Réglages → Exporter mes données**, l'app télécharge un fichier
`sauvegarde-recettes-AAAA-MM-JJ.json`. Gardez-le en lieu sûr (e-mail, Drive…).
Sur un nouveau téléphone : **Réglages → Importer une sauvegarde** et choisissez ce fichier.

⚠️ Sur iPhone, si vous utilisez l'app dans Safari **sans l'installer**, Safari peut
effacer ses données après quelques semaines sans visite. Installez-la sur l'écran
d'accueil et exportez régulièrement une sauvegarde.
