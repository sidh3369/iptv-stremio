const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const express = require("express");
const axios = require("axios");

const PORT = process.env.PORT || 3000;
const TMDB_API_KEY = "e41a38ce73e703a8de9b152992f78279"; // 🔴 REQUIRED

// Cache per playlist URL
const playlistCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// -------- TMDB POSTER FETCH ----------
async function getTMDBPoster(title) {
    try {
        const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}`;
        const res = await axios.get(url, { timeout: 5000 });

        if (res.data.results && res.data.results.length > 0) {
            return "https://image.tmdb.org/t/p/w500" + res.data.results[0].poster_path;
        }
    } catch (e) {}
    return "https://dl.strem.io/addon-logo.png";
}

// -------- PLAYLIST PARSER ----------
async function fetchPlaylist(playlistUrl) {
    const now = Date.now();
    const cached = playlistCache.get(playlistUrl);

    if (cached && now - cached.time < CACHE_DURATION) {
        return cached.data;
    }

    try {
        const res = await axios.get(playlistUrl, { timeout: 10000 });
        const lines = res.data.split(/\r?\n/);

        let byId = new Map();
        let catalogs = {};
        let currentMeta = {};
        let idCounter = 1;

        for (let line of lines) {
            line = line.trim();

            if (line.startsWith("#EXTINF:")) {
                const name = line.split(",")[1] || `Video ${idCounter}`;
                const groupMatch = line.match(/group-title="([^"]+)"/);

                currentMeta = {
                    id: `vod-${idCounter}`,
                    name: name.trim(),
                    type: "movie",
                    description: name.trim(),
                    genre: groupMatch ? groupMatch[1].trim() : "Other"
                };

            } else if (line && !line.startsWith("#")) {
                if (currentMeta.id) {
                    currentMeta.url = line;

                    // Fetch TMDB poster
                    currentMeta.poster = await getTMDBPoster(currentMeta.name);
                    currentMeta.background = currentMeta.poster;

                    byId.set(currentMeta.id, currentMeta);

                    if (!catalogs[currentMeta.genre]) catalogs[currentMeta.genre] = [];
                    catalogs[currentMeta.genre].push(currentMeta);

                    idCounter++;
                    currentMeta = {};
                }
            }
        }

        const data = { byId, catalogs };
        playlistCache.set(playlistUrl, { time: now, data });
        return data;

    } catch (e) {
        console.log("Playlist error:", e.message);
        return cached ? cached.data : { byId: new Map(), catalogs: {} };
    }
}

// -------- MANIFEST TEMPLATE ----------
function getManifest(config) {
    return {
        id: "org.vodplaylist.tmdb",
        version: "3.0.0",
        name: "SID VOD Playlist Ultimate",
        description: "Paste your M3U URL and get posters + categories",
        resources: ["catalog", "meta", "stream"],
        types: ["movie"],
        idPrefixes: ["vod-"],
        catalogs: [],
        behaviorHints: { configurable: true },
        config: [
            {
                key: "playlistUrl",
                type: "text",
                title: "Paste your M3U Playlist URL"
            }
        ]
    };
}

const builder = new addonBuilder(getManifest());

// -------- CATALOG HANDLER ----------
builder.defineCatalogHandler(async ({ id, config }) => {
    if (!config.playlistUrl) return { metas: [] };

    const data = await fetchPlaylist(config.playlistUrl);
    return { metas: data.catalogs[id] || [] };
});

// -------- META HANDLER ----------
builder.defineMetaHandler(async ({ id, config }) => {
    if (!config.playlistUrl) return { meta: {} };

    const data = await fetchPlaylist(config.playlistUrl);
    return { meta: data.byId.get(id) || {} };
});

// -------- STREAM HANDLER ----------
builder.defineStreamHandler(async ({ id, config }) => {
    if (!config.playlistUrl) return { streams: [] };

    const data = await fetchPlaylist(config.playlistUrl);
    const meta = data.byId.get(id);

    if (!meta) return { streams: [] };

    return {
        streams: [{
            title: meta.name,
            url: meta.url,
            behaviorHints: { notWebReady: meta.url.includes(".m3u8") }
        }]
    };
});

// -------- EXPRESS SERVER ----------
const app = express();

app.get("/manifest.json", async (req, res) => {
    const playlistUrl = req.query.playlistUrl;

    if (!playlistUrl) return res.json(getManifest());

    const data = await fetchPlaylist(playlistUrl);

    const catalogs = Object.keys(data.catalogs).map(cat => ({
        type: "movie",
        id: cat,
        name: cat
    }));

    res.json({ ...getManifest(), catalogs });
});

serveHTTP(builder.getInterface(), {
    server: app,
    path: "/manifest.json",
    port: PORT,
    hostname: "0.0.0.0"
});
