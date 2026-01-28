const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const express = require("express");
const axios = require("axios");

const PORT = process.env.PORT || 3000;
const DEFAULT_PLAYLIST = "https://raw.githubusercontent.com/sidh3369/m3u_bot/main/1.m3u";

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
let playlistCache = { time: 0, data: null };

// -------- FETCH PLAYLIST --------
async function fetchPlaylist(force = false) {
    const now = Date.now();

    if (!force && playlistCache.data && (now - playlistCache.time < CACHE_DURATION)) {
        return playlistCache.data;
    }

    try {
        const res = await axios.get(DEFAULT_PLAYLIST, { timeout: 10000 });
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
        playlistCache = { time: now, data };
        return data;

    } catch (e) {
        console.log("Playlist fetch error:", e.message);
        return playlistCache.data || { episodes: [], byId: new Map() };
    }
}

// -------- MANIFEST --------
const manifest = {
    id: "org.sid.autoplayseries",
    version: "1.1.0",
    name: "SID Autoplay Playlist",
    description: "Continuous autoplay playlist with reload button",
    resources: ["catalog", "meta", "stream"],
    types: ["series"],
    idPrefixes: ["ep-", "sid-playlist", "reload"],
    catalogs: [{
        type: "series",
        id: "sid-playlist",
        name: "My Playlist"
    }]
};

const builder = new addonBuilder(manifest);

// -------- CATALOG (ONE SERIES) --------
builder.defineCatalogHandler(() => {
    return {
        metas: [{
            id: "sid-playlist",
            type: "series",
            name: "My Video Playlist",
            poster: "https://dl.strem.io/addon-logo.png",
            background: "https://dl.strem.io/addon-background.jpg",
            description: "Videos play automatically one after another"
        }]
    };
});

// -------- META (EPISODE LIST + RELOAD) --------
builder.defineMetaHandler(async ({ id }) => {
    if (id !== "sid-playlist") return { meta: {} };

    const data = await fetchPlaylist();

    const videos = [
        {
            id: "reload",
            season: 1,
            episode: 0,
            title: "🔄 RELOAD",
            released: new Date().toISOString()
        },
        ...data.episodes.map(ep => ({
            id: ep.id,
            season: 1,
            episode: ep.episode,
            title: ep.name,
            released: ep.released
        }))
    ];

    return {
        meta: {
            id: "sid-playlist",
            type: "series",
            name: "My Video Playlist",
            poster: "https://dl.strem.io/addon-logo.png",
            background: "https://dl.strem.io/addon-background.jpg",
            videos
        }
    };
});

// -------- STREAM HANDLER --------
builder.defineStreamHandler(async ({ id }) => {

    // 🔄 RELOAD BUTTON
    if (id === "reload") {
        await fetchPlaylist(true); // force refresh
        return {
            streams: [{
                title: "Playlist reloaded. Go back and open again.",
                url: "https://archive.org/download/blank-video-file/blank.mp4"
            }]
        };
    }

    const data = await fetchPlaylist();
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
    res.json(manifest);
});

serveHTTP(builder.getInterface(), {
    server: app,
    path: "/manifest.json",
    port: PORT,
    hostname: "0.0.0.0"
});
