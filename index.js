const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const express = require("express");
const axios = require("axios");

const PORT = process.env.PORT || 10000;
const DEFAULT_PLAYLIST = "https://raw.githubusercontent.com/sidh3369/m3u_bot/main/1.m3u";

// Cache
let cache = { time: 0, episodes: [], byId: new Map() };
const CACHE_TIME = 5 * 60 * 1000;

// Fetch M3U
async function parseM3U(url) {
    try {
        const res = await axios.get(url, { timeout: 15000 });
        const lines = res.data.split(/\r?\n/);
        let episodes = [], byId = new Map(), title = "", ep = 1;
        for (let line of lines) {
            line = line.trim();
            if (line.startsWith("#EXTINF:")) title = line.split(",")[1] || `Video ${ep}`;
            else if (line && !line.startsWith("#")) {
                const id = `ep-${ep}`;
                const meta = { id, name: title, season: 1, episode: ep, url: line };
                episodes.push(meta); byId.set(id, meta); ep++;
            }
        }
        return { episodes, byId };
    } catch (e) { console.log("M3U fetch failed:", e.message); return { episodes: [], byId: new Map() }; }
}

// Load playlists (default + optional user)
async function loadPlaylists(userUrl, force = false) {
    const now = Date.now();
    if (!force && cache.time && now - cache.time < CACHE_TIME) return cache;

    const def = await parseM3U(DEFAULT_PLAYLIST);
    let user = { episodes: [], byId: new Map() };
    if (userUrl) user = await parseM3U(userUrl);

    const episodes = [...def.episodes, ...user.episodes];
    const byId = new Map([...def.byId, ...user.byId]);
    cache = { time: now, episodes, byId };
    return cache;
}

// Manifest
const manifest = {
    id: "org.sid.autoplay",
    version: "2.0.0",
    name: "SID Autoplay Series",
    description: "Personal autoplay playlist with reload",
    resources: ["catalog", "meta", "stream"],
    types: ["series"],
    catalogs: [{ type: "series", id: "sid-series", name: "My Playlist" }],
    behaviorHints: { configurable: true },
    config: [{ key: "userM3U", type: "text", title: "Optional M3U URL" }]
};

const builder = new addonBuilder(manifest);

// Catalog
builder.defineCatalogHandler(async () => ({
    metas: [{ id: "sid-series", type: "series", name: "My Video Playlist", poster: "https://dl.strem.io/addon-logo.png" }]
}));

// Meta
builder.defineMetaHandler(async ({ id, config }) => {
    if (id !== "sid-series") return { meta: null };
    const data = await loadPlaylists(config?.userM3U);
    return {
        meta: {
            id: "sid-series",
            type: "series",
            name: "My Video Playlist",
            videos: [
                { id: "reload", season: 1, episode: 0, title: "🔄 RELOAD PLAYLIST" },
                ...data.episodes.map(e => ({ id: e.id, season: 1, episode: e.episode, title: e.name }))
            ]
        }
    };
});

// Stream
builder.defineStreamHandler(async ({ id, config }) => {
    if (id === "reload") {
        await loadPlaylists(config?.userM3U, true);
        return { streams: [{ title: "Playlist Reloaded. Open series again", url: "https://archive.org/download/blank-video-file/blank.mp4" }] };
    }
    const data = await loadPlaylists(config?.userM3U);
    const ep = data.byId.get(id);
    if (!ep) return { streams: [] };
    return { streams: [{ title: ep.name, url: ep.url, behaviorHints: { notWebReady: ep.url.includes(".m3u8") } }] };
});

// Express + Serve HTTP
const app = express();
serveHTTP(builder.getInterface(), { app });

// Render-safe manifest route
app.get("/manifest.json", (req, res) => res.json(manifest));

// Web page + web Stremio install
app.get("/", (req, res) => {
    const host = req.headers.host;
    res.send(`
        <h2>SID Autoplay Playlist</h2>
        <a href="stremio://${host}/manifest.json">Install in Stremio Desktop</a><br><br>
        <a href="https://web.stremio.com/#/addons?addon=${encodeURIComponent(`https://${host}/manifest.json`)}">Install in Web Stremio</a>
    `);
});

app.listen(PORT, () => console.log(`Addon running on port ${PORT}`));
