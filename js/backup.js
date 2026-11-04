// Sauvegarde : exporte toutes les données (images comprises) dans un fichier JSON, et les réimporte.
import * as db from './db.js';

const STORES = ['projects', 'branches', 'sessions', 'feedbacks', 'images'];
const LAST_KEY = 'fastback-last-backup';

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
const dataUrlToBlob = async (url) => (await fetch(url)).blob();

export function lastBackup() {
  try { return Number(localStorage.getItem(LAST_KEY)) || null; } catch { return null; }
}

export async function exportFile() {
  const data = { app: 'fastback', format: 1, exportedAt: Date.now() };
  for (const s of STORES) data[s] = await db.all(s);
  data.images = await Promise.all(data.images.map(async (img) => ({
    ...img,
    original: img.original ? await blobToDataUrl(img.original) : null,
    rendered: img.rendered ? await blobToDataUrl(img.rendered) : null,
  })));
  const date = new Date().toISOString().slice(0, 10);
  const file = new File([JSON.stringify(data)], `fastback-sauvegarde-${date}.json`, { type: 'application/json' });
  try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch { /* sans importance */ }
  return { file, counts: { projects: data.projects.length, feedbacks: data.feedbacks.length, images: data.images.length } };
}

export function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function readFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('Ce fichier n\'est pas une sauvegarde Fastback.'); }
  if (data?.app !== 'fastback' || !Array.isArray(data.projects)) throw new Error('Ce fichier n\'est pas une sauvegarde Fastback.');
  return data;
}

// Ajoute ou remplace (même identifiant) ; ne supprime rien de ce qui existe déjà.
export async function importData(data) {
  for (const s of STORES.filter((x) => x !== 'images')) for (const row of data[s] || []) await db.put(s, row);
  for (const img of data.images || []) {
    await db.put('images', {
      ...img,
      original: img.original ? await dataUrlToBlob(img.original) : null,
      rendered: img.rendered ? await dataUrlToBlob(img.rendered) : null,
    });
  }
}
