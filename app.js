// ============================================================
// app.js — logique de l'application "Coût Recettes"
// ------------------------------------------------------------
// Organisation du fichier :
//   1. Unités et calculs
//   2. Outils (formatage, recherche, messages…)
//   3. État en mémoire + chargement depuis IndexedDB
//   4. Navigation entre les onglets
//   5. Onglet "Mes produits"
//   6. Onglet "Mes recettes" + éditeur de recette
//   7. Réglages, export / import, installation
//   8. Service worker (fonctionnement hors ligne)
//   9. Démarrage
// ============================================================

'use strict';

// Pensez à changer aussi CACHE_VERSION dans sw.js à chaque mise à jour.
const APP_VERSION = '1.0.0';
const DEFAULT_CURRENCY = 'DA';
const DEFAULT_COEFFICIENT = 3;


// ============================================================
// 1. UNITÉS ET CALCULS
// ============================================================

// factor : multiplicateur pour convertir vers l'unité de base
// (kg pour les masses, litre pour les volumes, pièce pour les pièces)
const UNITS = {
  kg:    { label: 'kg',    family: 'mass',   factor: 1 },
  g:     { label: 'g',     family: 'mass',   factor: 0.001 },
  l:     { label: 'L',     family: 'volume', factor: 1 },
  ml:    { label: 'ml',    family: 'volume', factor: 0.001 },
  piece: { label: 'pièce', family: 'piece',  factor: 1 },
};

// Pour chaque famille : libellé du prix unitaire et unités proposées
// dans une recette (on ne peut pas mettre des "ml" de farine achetée en kg).
const FAMILIES = {
  mass:   { perLabel: '/ kg',    units: ['g', 'kg'],  defaultUnit: 'g' },
  volume: { perLabel: '/ L',     units: ['ml', 'l'],  defaultUnit: 'ml' },
  piece:  { perLabel: '/ pièce', units: ['piece'],    defaultUnit: 'piece' },
};

function familyOf(unit) {
  return UNITS[unit] ? UNITS[unit].family : null;
}

// Convertit une quantité vers l'unité de base (ex. 250 g -> 0,25 kg)
function toBase(qty, unit) {
  return UNITS[unit] ? qty * UNITS[unit].factor : 0;
}

// Prix unitaire d'un produit : par kg, par litre ou par pièce
function unitPrice(product) {
  const baseQty = toBase(product.qty, product.unit);
  return baseQty > 0 ? product.price / baseQty : 0;
}

// Coût d'une ligne d'ingrédient (0 si le produit n'existe plus)
function lineCost(ingredient) {
  const product = findProduct(ingredient.productId);
  if (!product) return 0;
  if (familyOf(ingredient.unit) !== familyOf(product.unit)) return 0;
  return toBase(ingredient.qty, ingredient.unit) * unitPrice(product);
}

// Tous les totaux d'une recette.
// Les prix sont toujours recalculés à partir des produits :
// si le prix d'un produit change, toutes les recettes suivent.
function recipeTotals(recipe) {
  const total = recipe.ingredients.reduce((sum, ing) => sum + lineCost(ing), 0);
  const portionsOk = recipe.portions > 0;
  const coefOk = recipe.coefficient > 0;
  const perPortion = portionsOk ? total / recipe.portions : null;
  return {
    total,
    perPortion,
    salePerPortion: portionsOk && coefOk ? perPortion * recipe.coefficient : null,
    saleTotal: coefOk ? total * recipe.coefficient : null,
    // lignes dont le produit a été supprimé
    missing: recipe.ingredients.filter(ing => ing.productId && !findProduct(ing.productId)).length,
  };
}


// ============================================================
// 2. OUTILS
// ============================================================

const $ = id => document.getElementById(id);

// Évite que du texte saisi soit interprété comme du HTML
function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Pour la recherche : sans accents ni majuscules ("Crème" -> "creme")
function normalize(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Lit un nombre saisi au clavier, en acceptant la virgule ("1,5" -> 1.5)
function parseNumber(text) {
  const n = parseFloat(String(text).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

// Nombre -> texte pour remplir un champ (1.5 -> "1,5")
function numberToInput(n) {
  return Number.isFinite(n) && n !== 0 ? String(n).replace('.', ',') : '';
}

// 1234.5 -> "1 234,50 DA"
function formatMoney(amount) {
  if (amount === null || !Number.isFinite(amount)) return '—';
  const text = amount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return state.currency ? `${text} ${state.currency}` : text;
}

// 0.25 -> "0,25" ; 1000 -> "1 000"
function formatQty(qty) {
  return qty.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

// Libellé d'unité, avec pluriel pour les pièces
function unitLabel(unit, qty) {
  if (unit === 'piece') return qty > 1 ? 'pièces' : 'pièce';
  return UNITS[unit] ? UNITS[unit].label : '';
}

// Tri alphabétique à la française (accents et majuscules ignorés)
function sortByName(list) {
  return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' }));
}

// Identifiant unique pour chaque produit / recette
function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Petit message temporaire en bas de l'écran
let toastTimer = null;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// Message d'erreur si l'enregistrement échoue (stockage plein, etc.)
function saveError(error) {
  console.error(error);
  alert("Erreur : les données n'ont pas pu être enregistrées sur l'appareil.\n" + (error && error.message ? error.message : ''));
}


// ============================================================
// 3. ÉTAT EN MÉMOIRE
// ------------------------------------------------------------
// Les données sont chargées une fois au démarrage dans "state".
// Chaque modification met à jour "state" PUIS l'enregistre
// immédiatement dans IndexedDB (sauvegarde automatique).
// ============================================================

const state = {
  products: [],
  recipes: [],
  currency: DEFAULT_CURRENCY,
  editingProductId: null, // produit ouvert dans la fenêtre (null = nouveau)
  currentRecipeId: null,  // recette ouverte dans l'éditeur
};

function findProduct(id) {
  return id ? state.products.find(p => p.id === id) : undefined;
}

function findRecipe(id) {
  return state.recipes.find(r => r.id === id);
}

async function loadData() {
  const [products, recipes, currency] = await Promise.all([
    DB.getAll('products'),
    DB.getAll('recipes'),
    DB.getSetting('currency', DEFAULT_CURRENCY),
  ]);
  state.products = products;
  state.recipes = recipes;
  state.currency = currency;
}


// ============================================================
// 4. NAVIGATION
// ------------------------------------------------------------
// L'adresse après le # indique l'écran affiché :
//   #produits, #recettes, #recette/<id>, #reglages
// Ainsi le bouton "retour" d'Android revient à la liste.
// ============================================================

const VIEWS = {
  produits: { section: 'view-products', title: 'Mes produits' },
  recettes: { section: 'view-recipes', title: 'Mes recettes' },
  recette:  { section: 'view-editor', title: 'Recette', tab: 'recettes' },
  reglages: { section: 'view-settings', title: 'Réglages' },
};

let openedEditorFromList = false; // pour savoir si "retour" peut utiliser l'historique

function currentRoute() {
  const [name, id] = location.hash.replace('#', '').split('/');
  return VIEWS[name] ? { name, id: id ? decodeURIComponent(id) : null } : { name: 'produits', id: null };
}

function route() {
  const { name, id } = currentRoute();

  // On quitte l'éditeur : on enregistre et on nettoie
  if (state.currentRecipeId && !(name === 'recette' && id === state.currentRecipeId)) {
    closeEditor();
  }
  if (name !== 'recette') openedEditorFromList = false;

  const view = VIEWS[name];
  Object.values(VIEWS).forEach(v => { $(v.section).hidden = v !== view; });
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === (view.tab || name));
  });
  $('page-title').textContent = view.title;
  $('btn-back').hidden = name !== 'recette';
  $('save-status').textContent = '';

  if (name === 'produits') renderProducts();
  if (name === 'recettes') renderRecipes();
  if (name === 'recette') openEditor(id);
  if (name === 'reglages') renderSettings();
  window.scrollTo(0, 0);
}

// Changer d'onglet sans empiler l'historique
function goToTab(name) {
  location.replace('#' + name);
}

// Ouvrir une recette (ajoute une étape dans l'historique)
function goToRecipe(id) {
  openedEditorFromList = true;
  location.hash = '#recette/' + encodeURIComponent(id);
}

function setupNavigation() {
  window.addEventListener('hashchange', route);
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', event => {
      event.preventDefault();
      goToTab(tab.dataset.tab);
    });
  });
  $('btn-back').addEventListener('click', () => {
    if (openedEditorFromList) history.back();
    else goToTab('recettes');
  });
}


// ============================================================
// 5. ONGLET "MES PRODUITS"
// ============================================================

function renderProducts() {
  const query = normalize($('product-search').value);
  const list = sortByName(state.products).filter(p => normalize(p.name).includes(query));

  $('product-list').innerHTML = list.map(p => `
    <li>
      <button type="button" class="card card-btn" data-id="${escapeHtml(p.id)}">
        <span class="card-title">${escapeHtml(p.name)}</span>
        <span class="card-sub">${formatQty(p.qty)} ${unitLabel(p.unit, p.qty)} pour ${formatMoney(p.price)}</span>
        <span class="card-price">${formatMoney(unitPrice(p))}<small>${FAMILIES[familyOf(p.unit)].perLabel}</small></span>
      </button>
    </li>`).join('');

  const empty = $('product-empty');
  if (state.products.length === 0) {
    empty.textContent = 'Aucun produit pour l’instant. Touchez le bouton + pour ajouter votre premier produit.';
    empty.hidden = false;
  } else if (list.length === 0) {
    empty.textContent = `Aucun produit ne correspond à « ${$('product-search').value.trim()} ».`;
    empty.hidden = false;
  } else {
    empty.hidden = true;
  }
}

// Recettes qui utilisent un produit
function recipesUsing(productId) {
  return state.recipes.filter(r => r.ingredients.some(ing => ing.productId === productId));
}

// Ouvre la fenêtre produit (id = null pour un nouveau produit)
function openProductDialog(id) {
  const product = findProduct(id);
  state.editingProductId = product ? product.id : null;

  $('pd-title').textContent = product ? 'Modifier le produit' : 'Nouveau produit';
  $('p-name').value = product ? product.name : '';
  $('p-unit').value = product ? product.unit : 'kg';
  $('p-qty').value = product ? numberToInput(product.qty) : '';
  $('p-price').value = product ? numberToInput(product.price) : '';
  $('p-delete').hidden = !product;
  $('p-error').textContent = '';

  const used = product ? recipesUsing(product.id) : [];
  $('p-usage').textContent = used.length
    ? `Utilisé dans ${used.length} recette${used.length > 1 ? 's' : ''} : ${sortByName(used).map(r => r.name || 'Sans nom').join(', ')}`
    : '';

  updateProductPreview();
  $('product-dialog').showModal();
  if (!product) $('p-name').focus();
}

function closeProductDialog() {
  $('product-dialog').close();
}

// Aperçu du prix unitaire pendant la saisie
function updateProductPreview() {
  const qty = parseNumber($('p-qty').value);
  const price = parseNumber($('p-price').value);
  const unit = $('p-unit').value;
  const preview = $('p-preview');
  if (qty > 0 && price >= 0) {
    preview.textContent = `Prix unitaire : ${formatMoney(unitPrice({ qty, price, unit }))} ${FAMILIES[familyOf(unit)].perLabel}`;
  } else {
    preview.textContent = 'Prix unitaire : saisissez la quantité et le prix.';
  }
}

async function saveProductFromForm(event) {
  event.preventDefault();
  const name = $('p-name').value.trim();
  const unit = $('p-unit').value;
  const qty = parseNumber($('p-qty').value);
  const price = parseNumber($('p-price').value);

  // Vérifications
  const error = !name ? 'Indiquez le nom du produit.'
    : !(qty > 0) ? 'La quantité achetée doit être supérieure à 0.'
    : !(price >= 0) ? 'Indiquez le prix payé.'
    : '';
  $('p-error').textContent = error;
  if (error) return;

  const duplicate = state.products.find(p => p.id !== state.editingProductId && normalize(p.name) === normalize(name));
  if (duplicate && !confirm(`Un produit nommé « ${duplicate.name} » existe déjà. Enregistrer quand même ?`)) return;

  let product = findProduct(state.editingProductId);
  if (product) {
    // Si l'unité change de famille (ex. kg -> pièce), les recettes
    // qui utilisent ce produit passent à l'unité par défaut.
    if (familyOf(product.unit) !== familyOf(unit)) await adaptRecipesToUnit(product.id, unit);
    Object.assign(product, { name, unit, qty, price, updatedAt: Date.now() });
  } else {
    product = { id: newId(), name, unit, qty, price, updatedAt: Date.now() };
    state.products.push(product);
  }

  try {
    await DB.put('products', product);
  } catch (e) { saveError(e); return; }

  closeProductDialog();
  renderProducts();
  toast('Produit enregistré ✓');
}

// Met à jour l'unité des ingrédients quand un produit change de famille d'unité
async function adaptRecipesToUnit(productId, newUnit) {
  const defaultUnit = FAMILIES[familyOf(newUnit)].defaultUnit;
  for (const recipe of recipesUsing(productId)) {
    recipe.ingredients.forEach(ing => {
      if (ing.productId === productId) ing.unit = defaultUnit;
    });
    recipe.updatedAt = Date.now();
    await DB.put('recipes', recipe).catch(saveError);
  }
}

async function deleteProduct() {
  const product = findProduct(state.editingProductId);
  if (!product) return;
  const used = recipesUsing(product.id);
  const message = used.length
    ? `« ${product.name} » est utilisé dans : ${used.map(r => r.name || 'Sans nom').join(', ')}.\n\n` +
      'Ces lignes afficheront « Produit supprimé ». Supprimer quand même ?'
    : `Supprimer « ${product.name} » ?`;
  if (!confirm(message)) return;

  state.products = state.products.filter(p => p.id !== product.id);
  try {
    await DB.remove('products', product.id);
  } catch (e) { saveError(e); }
  closeProductDialog();
  renderProducts();
  toast('Produit supprimé');
}

function setupProducts() {
  $('product-search').addEventListener('input', renderProducts);
  $('btn-add-product').addEventListener('click', () => openProductDialog(null));
  $('product-list').addEventListener('click', event => {
    const card = event.target.closest('[data-id]');
    if (card) openProductDialog(card.dataset.id);
  });
  $('product-form').addEventListener('submit', saveProductFromForm);
  ['p-qty', 'p-price', 'p-unit'].forEach(id => $(id).addEventListener('input', updateProductPreview));
  $('p-cancel').addEventListener('click', closeProductDialog);
  $('p-delete').addEventListener('click', deleteProduct);
  // Toucher le fond grisé ferme la fenêtre
  $('product-dialog').addEventListener('click', event => {
    if (event.target === $('product-dialog')) closeProductDialog();
  });
}


// ============================================================
// 6. ONGLET "MES RECETTES" ET ÉDITEUR
// ============================================================

function renderRecipes() {
  const query = normalize($('recipe-search').value);
  const list = sortByName(state.recipes).filter(r => normalize(r.name).includes(query));

  $('recipe-list').innerHTML = list.map(r => {
    const t = recipeTotals(r);
    const nb = r.ingredients.length;
    return `
    <li>
      <button type="button" class="card card-btn" data-id="${escapeHtml(r.id)}">
        <span class="card-title">${escapeHtml(r.name || 'Sans nom')}</span>
        <span class="card-sub">${formatQty(r.portions || 0)} portion${r.portions > 1 ? 's' : ''} · ${nb} ingrédient${nb > 1 ? 's' : ''} · coût ${formatMoney(t.total)}</span>
        <span class="card-price">${formatMoney(t.perPortion)}<small>coût / portion</small></span>
        ${t.missing ? `<span class="card-warning">⚠ ${t.missing} produit${t.missing > 1 ? 's' : ''} supprimé${t.missing > 1 ? 's' : ''}</span>` : ''}
      </button>
    </li>`;
  }).join('');

  const empty = $('recipe-empty');
  if (state.recipes.length === 0) {
    empty.textContent = 'Aucune recette pour l’instant. Touchez le bouton + pour créer votre première recette.';
    empty.hidden = false;
  } else if (list.length === 0) {
    empty.textContent = `Aucune recette ne correspond à « ${$('recipe-search').value.trim()} ».`;
    empty.hidden = false;
  } else {
    empty.hidden = true;
  }
}

async function createRecipe() {
  const recipe = {
    id: newId(),
    name: '',
    portions: 1,
    coefficient: DEFAULT_COEFFICIENT,
    ingredients: [],
    updatedAt: Date.now(),
  };
  state.recipes.push(recipe);
  await DB.put('recipes', recipe).catch(saveError);
  goToRecipe(recipe.id);
}

function currentRecipe() {
  return findRecipe(state.currentRecipeId);
}

// ---------- Sauvegarde automatique de la recette ouverte ----------
// Pendant la frappe, on attend 400 ms sans saisie avant d'écrire
// (évite d'écrire à chaque lettre). Les autres changements
// (choix d'un produit, suppression d'une ligne) sont écrits tout de suite.

let saveTimer = null;

function scheduleSave() {
  $('save-status').textContent = '…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCurrentRecipe, 400);
}

async function saveCurrentRecipe() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const recipe = currentRecipe();
  if (!recipe) return;
  recipe.updatedAt = Date.now();
  try {
    await DB.put('recipes', recipe);
    $('save-status').textContent = 'Enregistré ✓';
  } catch (e) { saveError(e); }
}

// Écrit tout de suite une sauvegarde en attente (si l'app passe en arrière-plan, etc.)
function flushSave() {
  if (saveTimer) saveCurrentRecipe();
}

// ---------- Ouverture / fermeture de l'éditeur ----------

function openEditor(id) {
  const recipe = findRecipe(id);
  if (!recipe) { goToTab('recettes'); return; }
  state.currentRecipeId = recipe.id;

  $('r-name').value = recipe.name;
  $('r-portions').value = numberToInput(recipe.portions);
  $('r-coef').value = numberToInput(recipe.coefficient);
  $('page-title').textContent = recipe.name || 'Nouvelle recette';
  renderIngredients();
  // Nouvelle recette : on place directement le curseur sur le nom
  if (!recipe.name && recipe.ingredients.length === 0) setTimeout(() => $('r-name').focus(), 50);
}

function closeEditor() {
  flushSave();
  const recipe = currentRecipe();
  state.currentRecipeId = null;
  // Une recette laissée vide (sans nom ni ingrédient) est supprimée
  if (recipe && !recipe.name.trim() && recipe.ingredients.length === 0) {
    state.recipes = state.recipes.filter(r => r.id !== recipe.id);
    DB.remove('recipes', recipe.id).catch(saveError);
  }
}

// ---------- Lignes d'ingrédients ----------

function productOptions(selectedId) {
  let html = '<option value="">— Choisir un produit —</option>';
  if (selectedId && !findProduct(selectedId)) {
    html += `<option value="${escapeHtml(selectedId)}" selected>⚠ Produit supprimé</option>`;
  }
  html += sortByName(state.products).map(p =>
    `<option value="${escapeHtml(p.id)}"${p.id === selectedId ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
  ).join('');
  return html;
}

// Unités proposées : celles de la famille du produit choisi
function unitOptions(productId, selectedUnit) {
  const product = findProduct(productId);
  const units = product ? FAMILIES[familyOf(product.unit)].units : Object.keys(UNITS);
  return units.map(u =>
    `<option value="${u}"${u === selectedUnit ? ' selected' : ''}>${UNITS[u].label}</option>`
  ).join('');
}

function ingredientHtml(ing, index) {
  const orphan = ing.productId && !findProduct(ing.productId);
  return `
  <li class="card ingredient${orphan ? ' orphan' : ''}" data-index="${index}">
    <div class="ing-top">
      <select class="ing-product" aria-label="Produit">${productOptions(ing.productId)}</select>
      <button type="button" class="icon-btn ing-remove" aria-label="Retirer cet ingrédient">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
    <div class="ing-bottom">
      <input class="ing-qty" type="text" inputmode="decimal" placeholder="Quantité" aria-label="Quantité" value="${numberToInput(ing.qty)}">
      <select class="ing-unit" aria-label="Unité">${unitOptions(ing.productId, ing.unit)}</select>
      <span class="ing-cost"></span>
    </div>
  </li>`;
}

function renderIngredients() {
  const recipe = currentRecipe();
  $('ingredient-list').innerHTML = recipe.ingredients.map(ingredientHtml).join('');
  $('no-products-hint').hidden = state.products.length > 0;
  updateTotals();
}

// Met à jour les coûts affichés sans reconstruire les champs
// (pour ne pas perdre le curseur pendant la saisie)
function updateTotals() {
  const recipe = currentRecipe();
  if (!recipe) return;
  document.querySelectorAll('#ingredient-list .ingredient').forEach(li => {
    const ing = recipe.ingredients[li.dataset.index];
    li.querySelector('.ing-cost').textContent = formatMoney(lineCost(ing));
  });
  const t = recipeTotals(recipe);
  $('sum-total').textContent = formatMoney(t.total);
  $('sum-portion').textContent = formatMoney(t.perPortion);
  $('sum-sale-portion').textContent = formatMoney(t.salePerPortion);
  $('sum-sale-total').textContent = formatMoney(t.saleTotal);
  const warning = $('sum-warning');
  warning.hidden = !t.missing;
  warning.textContent = t.missing
    ? `⚠ ${t.missing} ingrédient${t.missing > 1 ? 's' : ''} sans produit (supprimé) : non compté${t.missing > 1 ? 's' : ''} dans le coût.`
    : '';
}

function setupEditor() {
  // Nom, portions, coefficient
  $('r-name').addEventListener('input', () => {
    currentRecipe().name = $('r-name').value;
    $('page-title').textContent = $('r-name').value.trim() || 'Nouvelle recette';
    scheduleSave();
  });
  $('r-portions').addEventListener('input', () => {
    currentRecipe().portions = parseNumber($('r-portions').value) || 0;
    updateTotals();
    scheduleSave();
  });
  $('r-coef').addEventListener('input', () => {
    currentRecipe().coefficient = parseNumber($('r-coef').value) || 0;
    updateTotals();
    scheduleSave();
  });

  const list = $('ingredient-list');

  // Saisie d'une quantité
  list.addEventListener('input', event => {
    if (!event.target.classList.contains('ing-qty')) return;
    const li = event.target.closest('.ingredient');
    currentRecipe().ingredients[li.dataset.index].qty = parseNumber(event.target.value) || 0;
    updateTotals();
    scheduleSave();
  });

  // Choix d'un produit ou d'une unité
  list.addEventListener('change', event => {
    const li = event.target.closest('.ingredient');
    if (!li) return;
    const ing = currentRecipe().ingredients[li.dataset.index];

    if (event.target.classList.contains('ing-product')) {
      ing.productId = event.target.value;
      const product = findProduct(ing.productId);
      // Si l'unité ne correspond pas au produit, on prend l'unité par défaut
      if (product && familyOf(ing.unit) !== familyOf(product.unit)) {
        ing.unit = FAMILIES[familyOf(product.unit)].defaultUnit;
      }
      li.querySelector('.ing-unit').innerHTML = unitOptions(ing.productId, ing.unit);
      li.classList.toggle('orphan', !!ing.productId && !product);
    }
    if (event.target.classList.contains('ing-unit')) {
      ing.unit = event.target.value;
    }
    updateTotals();
    saveCurrentRecipe();
  });

  // Retirer une ligne
  list.addEventListener('click', event => {
    const button = event.target.closest('.ing-remove');
    if (!button) return;
    const index = Number(button.closest('.ingredient').dataset.index);
    currentRecipe().ingredients.splice(index, 1);
    renderIngredients();
    saveCurrentRecipe();
  });

  // Ajouter une ligne
  $('btn-add-ingredient').addEventListener('click', () => {
    currentRecipe().ingredients.push({ productId: '', qty: 0, unit: 'g' });
    renderIngredients();
    saveCurrentRecipe();
    const last = list.lastElementChild;
    if (last) last.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Dupliquer
  $('btn-duplicate').addEventListener('click', async () => {
    flushSave();
    const source = currentRecipe();
    const copy = JSON.parse(JSON.stringify(source));
    copy.id = newId();
    copy.name = (source.name.trim() || 'Sans nom') + ' (copie)';
    copy.updatedAt = Date.now();
    state.recipes.push(copy);
    await DB.put('recipes', copy).catch(saveError);
    location.replace('#recette/' + encodeURIComponent(copy.id)); // "retour" ramènera à la liste
    toast('Recette dupliquée ✓');
  });

  // Supprimer
  $('btn-delete-recipe').addEventListener('click', async () => {
    const recipe = currentRecipe();
    if (!confirm(`Supprimer la recette « ${recipe.name || 'Sans nom'} » ?`)) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    state.recipes = state.recipes.filter(r => r.id !== recipe.id);
    await DB.remove('recipes', recipe.id).catch(saveError);
    state.currentRecipeId = null;
    if (openedEditorFromList) history.back(); else goToTab('recettes');
    toast('Recette supprimée');
  });

  $('recipe-search').addEventListener('input', renderRecipes);
  $('btn-add-recipe').addEventListener('click', createRecipe);
  $('recipe-list').addEventListener('click', event => {
    const card = event.target.closest('[data-id]');
    if (card) goToRecipe(card.dataset.id);
  });

  // Si l'app passe en arrière-plan, on enregistre ce qui est en attente
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
}


// ============================================================
// 7. RÉGLAGES, EXPORT / IMPORT, INSTALLATION
// ============================================================

function renderCurrency() {
  document.querySelectorAll('.currency').forEach(el => { el.textContent = state.currency || '—'; });
  $('s-currency-example').textContent = formatMoney(1250);
}

function renderSettings() {
  $('s-currency').value = state.currency;
  renderCurrency();
  const np = state.products.length;
  const nr = state.recipes.length;
  $('s-stats').textContent = `${np} produit${np > 1 ? 's' : ''} · ${nr} recette${nr > 1 ? 's' : ''} sur cet appareil`;
  $('app-version').textContent = `Coût Recettes — version ${APP_VERSION}`;
  renderInstallHelp();
}

// ---------- Export ----------

function buildBackup() {
  return {
    app: 'recette-calculateur',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: { currency: state.currency },
    products: state.products,
    recipes: state.recipes,
  };
}

function backupFile() {
  const date = new Date().toISOString().slice(0, 10); // AAAA-MM-JJ
  const json = JSON.stringify(buildBackup(), null, 2);
  return new File([json], `sauvegarde-recettes-${date}.json`, { type: 'application/json' });
}

// Télécharge le fichier de sauvegarde
function exportData() {
  flushSave();
  const file = backupFile();
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('Sauvegarde exportée ✓');
}

// Envoie le fichier via le menu "Partager" du téléphone (e-mail, WhatsApp, Drive…)
async function shareData() {
  flushSave();
  const file = backupFile();
  try {
    await navigator.share({ files: [file], title: 'Sauvegarde Coût Recettes' });
  } catch (e) {
    if (e.name !== 'AbortError') alert('Le partage a échoué. Utilisez plutôt « Exporter mes données ».');
  }
}

// ---------- Import ----------

// Vérifie et nettoie le contenu d'un fichier de sauvegarde
function readBackup(data) {
  if (!data || !Array.isArray(data.products) || !Array.isArray(data.recipes)) {
    throw new Error("Ce fichier n'est pas une sauvegarde de Coût Recettes.");
  }
  const products = data.products
    .filter(p => p && p.id && UNITS[p.unit])
    .map(p => ({
      id: String(p.id),
      name: String(p.name || 'Sans nom'),
      unit: p.unit,
      qty: Number(p.qty) || 0,
      price: Number(p.price) || 0,
      updatedAt: Number(p.updatedAt) || Date.now(),
    }));
  const recipes = data.recipes
    .filter(r => r && r.id)
    .map(r => ({
      id: String(r.id),
      name: String(r.name || ''),
      portions: Number(r.portions) || 0,
      coefficient: Number(r.coefficient) || 0,
      ingredients: (Array.isArray(r.ingredients) ? r.ingredients : []).map(ing => ({
        productId: String(ing.productId || ''),
        qty: Number(ing.qty) || 0,
        unit: UNITS[ing.unit] ? ing.unit : 'g',
      })),
      updatedAt: Number(r.updatedAt) || Date.now(),
    }));
  const currency = data.settings && typeof data.settings.currency === 'string'
    ? data.settings.currency : DEFAULT_CURRENCY;
  return { products, recipes, settings: { currency } };
}

async function importFile(file) {
  let backup;
  try {
    backup = readBackup(JSON.parse(await file.text()));
  } catch (e) {
    alert('Import impossible : ' + (e instanceof SyntaxError ? 'le fichier est illisible ou abîmé.' : e.message));
    return;
  }

  const ok = confirm(
    `Ce fichier contient ${backup.products.length} produit(s) et ${backup.recipes.length} recette(s).\n\n` +
    'Remplacer TOUTES les données actuelles de cet appareil par celles du fichier ?'
  );
  if (!ok) return;

  // On oublie la recette ouverte : sa sauvegarde en attente
  // ne doit pas écraser les données importées.
  clearTimeout(saveTimer);
  saveTimer = null;
  state.currentRecipeId = null;

  try {
    await DB.replaceAll(backup);
  } catch (e) { saveError(e); return; }
  await loadData();
  renderCurrency();
  route(); // réaffiche l'écran courant avec les nouvelles données
  toast('Données importées ✓');
}

// ---------- Installation sur l'écran d'accueil ----------

let installPrompt = null; // fourni par Chrome / Edge sur Android et ordinateur

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function renderInstallHelp() {
  const installed = isStandalone();
  $('install-done').hidden = !installed;
  $('btn-install').hidden = installed || !installPrompt;
  $('install-ios').hidden = installed || !isIOS();
  $('install-other').hidden = installed || isIOS() || !!installPrompt;
}

function setupSettings() {
  // Devise : enregistrée à chaque frappe
  $('s-currency').addEventListener('input', () => {
    state.currency = $('s-currency').value.trim();
    renderCurrency();
    DB.setSetting('currency', state.currency).catch(saveError);
  });

  $('btn-export').addEventListener('click', exportData);
  $('btn-import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', event => {
    const file = event.target.files[0];
    event.target.value = ''; // permet de réimporter le même fichier
    if (file) importFile(file);
  });

  // Bouton "Envoyer" seulement si le téléphone sait partager des fichiers
  try {
    const testFile = new File(['{}'], 'test.json', { type: 'application/json' });
    $('btn-share').hidden = !(navigator.canShare && navigator.canShare({ files: [testFile] }));
  } catch (e) { /* partage non disponible */ }
  $('btn-share').addEventListener('click', shareData);

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    renderInstallHelp();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    renderInstallHelp();
    toast('Application installée ✓');
  });
  $('btn-install').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    renderInstallHelp();
  });
}


// ============================================================
// 8. SERVICE WORKER (fonctionnement hors ligne)
// ============================================================

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.register('./sw.js').catch(e => console.warn('Service worker :', e));

  // Une nouvelle version a pris le relais : on propose de recharger
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) $('update-banner').hidden = false;
  });
  $('btn-reload').addEventListener('click', () => {
    flushSave();
    location.reload();
  });
}


// ============================================================
// 9. DÉMARRAGE
// ============================================================

async function start() {
  setupNavigation();
  setupProducts();
  setupEditor();
  setupSettings();
  registerServiceWorker();

  // Demande au navigateur de ne pas effacer nos données s'il manque de place
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  try {
    await loadData();
  } catch (e) {
    console.error(e);
    alert("Impossible d'ouvrir la base de données de l'appareil. " +
      'Vérifiez que vous n’êtes pas en navigation privée.');
  }
  renderCurrency();
  route();
}

start();
