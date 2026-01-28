const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const express = require("express");
const axios = require("axios");

const PORT = process.env.PORT || 10000;

/* ================= SETTINGS ================= */

const DEFAULT_PLAYLIST = "https://raw.githubusercontent.com/sidh3369/m3u_bot/main/1.m3u"; // ALWAYS LOADS
const CACHE_TIME = 5 * 60 * 1000;

let cache = { time: 0, episodes: [], byId: new Map() };

/* ================= FETCH PLAYLIST ================= */

async function parseM3U(url) {
    try {
        const res = await axios.get(url, { timeout: 15000 });
        const lines = res.data.split(/\r?\n/);

        let episodes = [];
        let byId = new Map();
        let title = "";
        let ep = 1;

        for (let line of lines) {
            line = line.trim();

            if (line.startsWith("#EXTINF:")) {
                title = line.split(",")[1] || `Video ${ep}`;
            } else if (line && !line.startsWith("#")) {
                const id = `ep-${ep}`;
                const meta = {
                    id,
                    name: title,
                    season: 1,
                    episode: ep,
                    url: line
                };
                episodes.push(meta);
                byId.set(id, meta);
                ep++;
            }
        }
        return { episodes, byId };
    } catch (e) {
        console.log("M3U Fetch Failed:", e.message);
        return { episodes: [], byId: new Map() };
    }
}

async function loadPlaylists(userUrl, force = false) {
    const now = Date.now();
    if (!force && now - cache.time < CACHE_TIME) return cache;

    const def = await parseM3U(DEFAULT_PLAYLIST);
    let user = { episodes: [], byId: new Map() };

    if (userUrl) user = await parseM3U(userUrl);

    const episodes = [...def.episodes, ...user.episodes];
    const byId = new Map([...def.byId, ...user.byId]);

    cache = { time: now, episodes, byId };
    return cache;
}

/* ================= MANIFEST ================= */

const manifest = {
    id: "org.sid.autoplay",
    version: "2.0.0",
    name: "SID Autoplay Series",
    description: "Personal autoplay playlist with reload",
    resources: ["catalog", "meta", "stream"],
    types: ["series"],
    catalogs: [{ type: "series", id: "sid-series", name: "My Playlist" }],
    behaviorHints: { configurable: true },
    config: [
        {
            key: "userM3U",
            type: "text",
            title: "Your M3U Playlist URL (Optional)"
        }
    ]
};

const builder = new addonBuilder(manifest);

/* ================= CATALOG ================= */

builder.defineCatalogHandler(async () => ({
    metas: [{
        id: "sid-series",
        type: "series",
        name: "My Video Playlist",
        poster: "https://dl.strem.io/addon-logo.png"
    }]
}));

/* ================= META (EPISODES LIST) ================= */

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
                ...data.episodes.map(e => ({
                    id: e.id,
                    season: 1,
                    episode: e.episode,
                    title: e.name
                }))
            ]
        }
    };
});

/* ================= STREAM ================= */

builder.defineStreamHandler(async ({ id, config }) => {

    if (id === "reload") {
        await loadPlaylists(config?.userM3U, true);
        return {
            streams: [{
                title: "Playlist Reloaded ✔ Open series again",
                url: "https://archive.org/download/blank-video-file/blank.mp4"
            }]
        };
    }

    const data = await loadPlaylists(config?.userM3U);
    const ep = data.byId.get(id);
    if (!ep) return { streams: [] };

    return {
        streams: [{
            title: ep.name,
            url: ep.url,
            behaviorHints: { notWebReady: ep.url.includes(".m3u8") }
        }]
    };
});

/* ================= SERVER ================= */

const app = express();
serveHTTP(builder.getInterface(), { app });

app.get("/", (req, res) => {
    res.send(`
        <h2>SID Autoplay Series Addon</h2>
        <a href="stremio://${req.headers.host}/manifest.json">INSTALL IN STREMIO</a><br><br>
        <a href="https://web.stremio.com/#/addons?addon=${encodeURIComponent(`https://${req.headers.host}/manifest.json`)}">
        INSTALL IN WEB STREMIO
        </a>
    `);
});

app.listen(PORT, () => console.log("Addon running on port", PORT));
