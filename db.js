// Firebase config and data-access layer, kept separate from index.html.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  deleteField,
  serverTimestamp,
  query,
  orderBy,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBKb8Ody6tWABmGk-61iR4C8h4dDJ78xxw",
  authDomain: "amit-recipe-d3532.firebaseapp.com",
  projectId: "amit-recipe-d3532",
  storageBucket: "amit-recipe-d3532.firebasestorage.app",
  messagingSenderId: "1056335001514",
  appId: "1:1056335001514:web:01e8f5f9298706950d5dd3"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Registers the static-shell cache once per page load (see sw.js). Firestore
// traffic itself is untouched by the service worker - this only speeds up
// and adds resilience to loading the app's own HTML/CSS/JS.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

// Hebrew category list shown in the add-recipe form and the filter chips.
export const CATEGORIES = ["עיקריות", "סלטים", "קינוחים", "מרקים", "מאפים", "משקאות"];

// A hung request (e.g. a flaky mobile connection, or a socket a suspended
// PWA silently lost) never rejects on its own - it just leaves the caller
// awaiting forever. Every Firestore call below is wrapped with this so a
// stuck request fails after REQUEST_TIMEOUT_MS with a clear error instead
// of leaving the screen stuck on a spinner forever.
const REQUEST_TIMEOUT_MS = 10000;

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("הבקשה נכשלה. בדקו את החיבור לאינטרנט ונסו שוב.")), REQUEST_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).then(
    result => { clearTimeout(timer); return result; },
    err => { clearTimeout(timer); throw err; }
  );
}

// --- Link parsing: platform detection + best-effort thumbnails ------------

export function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("instagram.com")) return "instagram";
  if (u.includes("tiktok.com")) return "tiktok";
  return "other";
}

// Handles watch?v=, youtu.be/<id>, shorts/<id> and embed/<id> link shapes.
function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0] || null;
    if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] || null;
    if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2] || null;
    return u.searchParams.get("v");
  } catch (e) {
    return null;
  }
}

// Best-effort thumbnail lookup at add-time. YouTube thumbnails are derived
// from the URL directly (no request needed). TikTok exposes a public oembed
// endpoint that usually allows cross-origin reads and returns a thumbnail
// URL. Instagram's oembed has required an authenticated app token since
// 2020, so there is no reliable no-login way to fetch a thumbnail for it -
// those recipes fall back to a plain platform badge in the UI.
export async function resolveThumbnail(url, platform) {
  if (platform === "youtube") {
    const id = extractYouTubeId(url);
    return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
  }
  if (platform === "tiktok") {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = await res.json();
      return data.thumbnail_url || null;
    } catch (e) {
      return null; // offline / CORS blocked / endpoint changed - fine, badge fallback covers it
    }
  }
  return null;
}

// --- Recipes collection, shared across every visitor (no login) -----------

function recipesCollection() {
  return collection(db, "recipes");
}

// Cleans up a raw list of textbox values into the array actually stored:
// trims each entry and drops empty ones (e.g. a blank row left when the
// user added a step but never filled it in).
function cleanList(items) {
  return (items || []).map(s => s.trim()).filter(Boolean);
}

// Validates values shared by add/update and builds the Firestore field set
// for whichever mode was picked. Shared so add and edit can never drift
// out of sync on validation rules.
//
// values, link mode: { mode: 'link', name, link, category }
// values, manual mode: { mode: 'manual', name, category, ingredients: string[], instructions: string[] }
async function buildRecipeFields(values) {
  const name = values.name.trim();
  const category = values.category;

  if (!name) throw new Error("נא להזין שם למתכון.");
  if (!CATEGORIES.includes(category)) throw new Error("נא לבחור קטגוריה.");

  if (values.mode === "manual") {
    const ingredients = cleanList(values.ingredients);
    const instructions = cleanList(values.instructions);
    if (ingredients.length === 0) throw new Error("נא להזין לפחות מצרך אחד.");
    if (instructions.length === 0) throw new Error("נא להזין לפחות שלב הכנה אחד.");

    return {
      name,
      category,
      platform: "manual",
      thumbnailUrl: null,
      ingredients,
      instructions
    };
  }

  const link = values.link.trim();
  if (!link || !/^https?:\/\//i.test(link)) throw new Error("נא להזין קישור תקין (החל ב-http:// או https://).");

  const platform = detectPlatform(link);
  const thumbnailUrl = await resolveThumbnail(link, platform);

  return { name, link, category, platform, thumbnailUrl };
}

export async function addRecipe(values) {
  const fields = await buildRecipeFields(values);
  await withTimeout(addDoc(recipesCollection(), {
    ...fields,
    createdAt: serverTimestamp(),
    createdAtLocal: new Date().toString()
  }), "recipe:add");
}

// Overwrites an existing recipe's content. Supports switching between link
// and manual mode: whichever fields don't apply to the new mode are removed
// with deleteField() rather than left stale from the old mode.
export async function updateRecipe(id, values) {
  const fields = await buildRecipeFields(values);
  const clearFields = values.mode === "manual"
    ? { link: deleteField() }
    : { ingredients: deleteField(), instructions: deleteField() };

  await withTimeout(updateDoc(doc(db, "recipes", id), {
    ...fields,
    ...clearFields
  }), "recipe:update");
}

// Returns one row per recipe: { id, name, link, category, platform,
// thumbnailUrl, ingredients, instructions, createdAt: Date }, newest first.
// link/ingredients/instructions are only populated for the relevant mode.
export async function getRecipes() {
  const q = query(recipesCollection(), orderBy("createdAt", "desc"));
  const snap = await withTimeout(getDocs(q), "recipe:list");

  return snap.docs.map(docSnap => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      name: data.name,
      link: data.link || null,
      category: data.category,
      platform: data.platform || "other",
      thumbnailUrl: data.thumbnailUrl || null,
      ingredients: data.ingredients || null,
      instructions: data.instructions || null,
      createdAt: data.createdAt ? data.createdAt.toDate() : new Date(data.createdAtLocal)
    };
  });
}

export async function deleteRecipe(id) {
  await withTimeout(deleteDoc(doc(db, "recipes", id)), "recipe:delete");
}
