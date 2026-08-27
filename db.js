// Firebase config and data-access layer, kept separate from index.html.
//
// SETUP REQUIRED: this points at a placeholder project. Create a new
// Firebase project for Recipe (console.firebase.google.com -> Add project),
// enable Firestore in it, then replace firebaseConfig below with the config
// object from Project settings -> your web app. See SETUP.md for the full
// walkthrough, including deploying firestore.rules.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.firebasestorage.app",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
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
export const CATEGORIES = ["עיקריות", "סלטים", "קינוחים", "מרקים", "מאפים", "ארוחת בוקר", "משקאות"];

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

// values: { name: string (Hebrew), link: string, category: string }
export async function addRecipe(values) {
  const name = values.name.trim();
  const link = values.link.trim();
  const category = values.category;

  if (!name) throw new Error("נא להזין שם למתכון.");
  if (!link || !/^https?:\/\//i.test(link)) throw new Error("נא להזין קישור תקין (החל ב-http:// או https://).");
  if (!CATEGORIES.includes(category)) throw new Error("נא לבחור קטגוריה.");

  const platform = detectPlatform(link);
  const thumbnailUrl = await resolveThumbnail(link, platform);

  await withTimeout(addDoc(recipesCollection(), {
    name,
    link,
    category,
    platform,
    thumbnailUrl,
    createdAt: serverTimestamp(),
    createdAtLocal: new Date().toString()
  }), "recipe:add");
}

// Returns one row per recipe: { id, name, link, category, platform,
// thumbnailUrl, createdAt: Date }, newest first.
export async function getRecipes() {
  const q = query(recipesCollection(), orderBy("createdAt", "desc"));
  const snap = await withTimeout(getDocs(q), "recipe:list");

  return snap.docs.map(docSnap => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      name: data.name,
      link: data.link,
      category: data.category,
      platform: data.platform || "other",
      thumbnailUrl: data.thumbnailUrl || null,
      createdAt: data.createdAt ? data.createdAt.toDate() : new Date(data.createdAtLocal)
    };
  });
}

export async function deleteRecipe(id) {
  await withTimeout(deleteDoc(doc(db, "recipes", id)), "recipe:delete");
}
