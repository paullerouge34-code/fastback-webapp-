// Stockage local (IndexedDB). Les données restent sur le téléphone.
const DB_NAME = 'fastback';
const DB_VERSION = 1;
const STORES = {
  projects: [],
  branches: ['projectId'],
  sessions: ['branchId'],
  feedbacks: ['sessionId'],
  images: ['feedbackId'],
};

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, indexes] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: 'id' });
        for (const idx of indexes) store.createIndex(idx, idx);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode = 'readonly') {
  const db = await open();
  return db.transaction(store, mode).objectStore(store);
}

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}

export async function get(store, id) {
  return wrap((await tx(store)).get(id));
}

export async function put(store, value) {
  await wrap((await tx(store, 'readwrite')).put(value));
  return value;
}

export async function del(store, id) {
  return wrap((await tx(store, 'readwrite')).delete(id));
}

export async function all(store) {
  return wrap((await tx(store)).getAll());
}

export async function by(store, index, value) {
  return wrap((await tx(store)).index(index).getAll(value));
}

const byDate = (a, b) => a.createdAt - b.createdAt;

// --- Requêtes métier ---

export async function listProjects() {
  return (await all('projects')).sort((a, b) => b.createdAt - a.createdAt);
}

export async function createProject(name) {
  const project = await put('projects', { id: uid(), name, createdAt: Date.now() });
  await put('branches', { id: uid(), projectId: project.id, version: 1, createdAt: Date.now() });
  return project;
}

export async function listBranches(projectId) {
  return (await by('branches', 'projectId', projectId)).sort((a, b) => a.version - b.version);
}

export async function createBranch(projectId) {
  const branches = await listBranches(projectId);
  const version = branches.length ? Math.max(...branches.map((b) => b.version)) + 1 : 1;
  return put('branches', { id: uid(), projectId, version, createdAt: Date.now() });
}

export async function listSessions(branchId) {
  return (await by('sessions', 'branchId', branchId)).sort((a, b) => a.number - b.number);
}

export async function createSession(branchId) {
  const sessions = await listSessions(branchId);
  const number = sessions.length ? Math.max(...sessions.map((s) => s.number)) + 1 : 1;
  return put('sessions', { id: uid(), branchId, number, createdAt: Date.now() });
}

export async function listFeedbacks(sessionId) {
  return (await by('feedbacks', 'sessionId', sessionId)).sort(byDate);
}

export async function createFeedback(sessionId) {
  return put('feedbacks', {
    id: uid(), sessionId, note: '', priority: null, status: 'todo', imageIds: [], createdAt: Date.now(),
  });
}

export async function deleteFeedback(id) {
  for (const img of await by('images', 'feedbackId', id)) await del('images', img.id);
  await del('feedbacks', id);
}

export async function deleteSession(id) {
  for (const fb of await listFeedbacks(id)) await deleteFeedback(fb.id);
  await del('sessions', id);
}

export async function deleteBranch(id) {
  for (const s of await listSessions(id)) await deleteSession(s.id);
  await del('branches', id);
}

export async function deleteProject(id) {
  for (const b of await listBranches(id)) await deleteBranch(b.id);
  await del('projects', id);
}

// Remonte la chaîne feedback → session → branche → projet.
export async function context({ feedbackId, sessionId, branchId, projectId }) {
  const ctx = {};
  if (feedbackId) { ctx.feedback = await get('feedbacks', feedbackId); sessionId = ctx.feedback?.sessionId; }
  if (sessionId) { ctx.session = await get('sessions', sessionId); branchId = ctx.session?.branchId; }
  if (branchId) { ctx.branch = await get('branches', branchId); projectId = ctx.branch?.projectId; }
  if (projectId) ctx.project = await get('projects', projectId);
  return ctx;
}

export function sessionLabel(branch, session) {
  return `v${branch.version}.${String(session.number).padStart(2, '0')}`;
}
