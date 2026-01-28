const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const express = require("express");
const axios = require("axios");

const PORT = process.env.PORT || 3000;
const DEFAULT_PLAYLIST = "https://raw.githubusercontent.com/sidh3369/m3u_bot/main/1.m3u";

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const playlistCache = new Map();

// -------- FETCH & PARSE PLAYLIST AS EPISODES --------
async function fetchPlaylist(url) {
    const now = Date.now();
    const cached = playlistCache.get(url);

    if (cached && now - cached.time < CACHE_DURATION) {
        return cached.data;
    }

    try {
        const res = await axios.get(url, { timeout: 10000 });
        const lines = res.data.split(/\r?\n/);

        let episodes = [];
        let byId = new Map();
        let title = "";
        let episodeNumber = 1;

        for (let line of lines) {
            line = line.trim();

            if (line.startsWith("#EXTINF:")) {
                title = line.split(",")[1] || `Episode ${episodeNumber}`;
            } else if (line && !line.startsWith("#")) {
                const id = `ep-${episodeNumber}`;

                const meta = {
                    id,
                    type: "series",
                    name: title.trim(),
                    season: 1,
                    episode: episodeNumber,
                    url: line,
                    released: new Date().toISOString()
                };

                episodes.push(meta);
                byId.set(id, meta);
                episodeNumber++;
            }
        }

        const data = { episodes, byId };
        playlistCache.set(url, { time: now, data });
        return data;

    } catch (e) {
        console.log("Playlist error:", e.message);
        return cached ? cached.data : { episodes: [], byId: new Map() };
    }
}

// -------- MANIFEST --------
function getManifest() {
    return {
        id: "org.sid.autoplayseries",
        version: "1.0.0",
        name: "SID Autoplay Playlist",
        description: "Continuous autoplay playlist — like a personal TV channel",
        resources: ["catalog", "meta", "stream"],
        types: ["series"],
        idPrefixes: ["ep-", "sid-playlist"],
        catalogs: [{
            type: "series",
            id: "sid-playlist",
            name: "My Playlist"
        }],
        behaviorHints: { configurable: true },
        config: [{
            key: "playlistUrl",
            type: "text",
            title: "Optional: Paste your M3U Playlist URL"
        }]
    };
}

const builder = new addonBuilder(getManifest());

// -------- CATALOG HANDLER (SHOW SINGLE SERIES) --------
builder.defineCatalogHandler(async () => {
    return {
        metas: [{
            id: "sid-playlist",
            type: "series",
            name: "My Video Playlist",
            poster: "https://dl.strem.io/addon-logo.png",
            background: "https://dl.strem.io/addon-background.jpg",
            description: "All your videos play automatically one after another"
        }]
    };
});

// -------- META HANDLER (LIST EPISODES) --------
builder.defineMetaHandler(async ({ id, config }) => {
    if (id !== "sid-playlist") return { meta: {} };

    const playlistUrl = config.playlistUrl || DEFAULT_PLAYLIST;
    const data = await fetchPlaylist(playlistUrl);

    return {
        meta: {
            id: "sid-playlist",
            type: "series",
            name: "My Video Playlist",
            poster: "https://dl.strem.io/addon-logo.png",
            background: "https://dl.strem.io/addon-background.jpg",
            videos: data.episodes.map(ep => ({
                id: ep.id,
                season: 1,
                episode: ep.episode,
                title: ep.name,
                released: ep.released
            }))
        }
    };
});

// -------- STREAM HANDLER --------
builder.defineStreamHandler(async ({ id, config }) => {
    const playlistUrl = config.playlistUrl || DEFAULT_PLAYLIST;
    const data = await fetchPlaylist(playlistUrl);
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

// -------- SERVER --------
const app = express();

app.get("/manifest.json", (req, res) => {
    res.json(getManifest());
});

serveHTTP(builder.getInterface(), {
    server: app,
    path: "/manifest.json",
    port: PORT,
    hostname: "0.0.0.0"
});
