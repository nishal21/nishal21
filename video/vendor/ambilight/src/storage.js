/* Stand-in for youtube-ambilight's storage.js (not copied): the extension keeps flags in chrome.storage;
   here they go to localStorage. Written for nishal21's video page. */
export const storage = {
  async get(key) {
    try { const v = localStorage.getItem('vp:ambilight:' + key); return v == null ? undefined : JSON.parse(v); } catch { return undefined; }
  },
  async set(key, value) {
    try { value === undefined ? localStorage.removeItem('vp:ambilight:' + key) : localStorage.setItem('vp:ambilight:' + key, JSON.stringify(value)); } catch { /* private mode */ }
  },
};
