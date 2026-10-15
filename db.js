// ============================================================
// db.js — stockage des données sur l'appareil (IndexedDB)
// ------------------------------------------------------------
// IndexedDB est la "base de données" intégrée au navigateur.
// Ce fichier l'enveloppe dans quelques fonctions simples qui
// renvoient des promesses (utilisables avec await).
//
// Trois "tables" (object stores) :
//   products : les produits achetés      (clé : id)
//   recipes  : les recettes              (clé : id)
//   settings : les réglages (devise...)  (clé : key)
// ============================================================

const DB = (() => {
  const DB_NAME = 'recette-calculateur';
  const DB_VERSION = 1;
  const STORES = ['products', 'recipes', 'settings'];

  let dbPromise = null;

  // Ouvre la base (et la crée la première fois).
  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('products')) db.createObjectStore('products', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('recipes')) db.createObjectStore('recipes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  // Transforme une requête IndexedDB en promesse.
  function wrap(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Promesse résolue quand la transaction est entièrement écrite.
  function done(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction annulée'));
    });
  }

  return {
    // Toutes les lignes d'une table
    async getAll(store) {
      const db = await open();
      return wrap(db.transaction(store).objectStore(store).getAll());
    },

    // Ajoute ou remplace une ligne
    async put(store, value) {
      const db = await open();
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      return done(tx);
    },

    // Supprime une ligne par sa clé
    async remove(store, key) {
      const db = await open();
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      return done(tx);
    },

    // Lit un réglage (ou renvoie la valeur par défaut)
    async getSetting(key, defaultValue) {
      const db = await open();
      const row = await wrap(db.transaction('settings').objectStore('settings').get(key));
      return row ? row.value : defaultValue;
    },

    // Enregistre un réglage
    async setSetting(key, value) {
      return this.put('settings', { key, value });
    },

    // Remplace TOUTES les données (utilisé par l'import).
    // Une seule transaction : en cas d'erreur, rien n'est modifié.
    async replaceAll({ products, recipes, settings }) {
      const db = await open();
      const tx = db.transaction(STORES, 'readwrite');
      STORES.forEach(name => tx.objectStore(name).clear());
      products.forEach(p => tx.objectStore('products').put(p));
      recipes.forEach(r => tx.objectStore('recipes').put(r));
      Object.entries(settings).forEach(([key, value]) => tx.objectStore('settings').put({ key, value }));
      return done(tx);
    },
  };
})();
