const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const express = require("express");
const axios = require("axios");

const PORT = process.env.PORT || 3000;
const DEFAULT_PLAYLIST = "https://raw.githubusercontent.com/sidh3369/m3u_bot/main/1.m3u";

let playlistCache = { time: 0, data: null };
const CACHE_DURATION = 5 * 60 * 1000;

// ---------------- FETCH M3U ----------------
async function fetchPlaylist(force = false) {
    const now = Date.now();

    if (!force && playlistCache.data && now - playlistCache.time < CACHE_DURATION) {
        return playlistCache.data;
    }

    const res = await axios.get(DEFAULT_PLAYLIST, { timeout: 10000 });
    const lines = res.data.split(/\r?\n/);

    let episodes = [];
    let byId = new Map();
    let title = "";
    let epNum = 1;

    for (let line of lines) {
        line = line.trim();

        if (line.startsWith("#EXTINF:")) {
            title = line.split(",")[1] || `Episode ${epNum}`;
        } else if (line && !line.startsWith("#")) {
            const id = `ep-${epNum}`;

            const meta = {
                id,
                name: title,
                season: 1,
                episode: epNum,
                url: line,
                released: new Date().toISOString()
            };

            episodes.push(meta);
            byId.set(id, meta);
            epNum++;
        }
    }

    const data = { episodes, byId };
    playlistCache = { time: now, data };
    return data;
}

// ---------------- MANIFEST ----------------
const manifest = {
    id: "org.sid.autoplayseries",
    version: "1.1.1",
    name: "SID Autoplay Playlist",
    description: "Autoplay personal video playlist",
    resources: ["catalog", "meta", "stream"],
    types: ["series"],
    catalogs: [
        {
            type: "series",
            id: "sid-playlist",
            name: "My Playlist"
        }
    ]
};

const builder = new addonBuilder(manifest);

// ---------------- CATALOG ----------------
builder.defineCatalogHandler(() => ({
    metas: [{
        id: "sid-playlist",
        type: "series",
        name: "My Video Playlist",
        poster: "https://dl.strem.io/addon-logo.png"
    }]
}));

// ---------------- META ----------------
builder.defineMetaHandler(async ({ id }) => {
    if (id !== "sid-playlist") return { meta: null };

    const data = await fetchPlaylist();

    return {
        meta: {
            id: "sid-playlist",
            type: "series",
            name: "My Video Playlist",
            videos: [
                {
                    id: "reload",
                    season: 1,
                    episode: 0,
                    title: "🔄 RELOAD"
                },
                ...data.episodes.map(ep => ({
                    id: ep.id,
                    season: 1,
                    episode: ep.episode,
                    title: ep.name
                }))
            ]
        }
    };
});

// ---------------- STREAM ----------------
builder.defineStreamHandler(async ({ id }) => {

    if (id === "reload") {
        await fetchPlaylist(true);
        return {
            streams: [{
                title: "Playlist Reloaded. Open again.",
                url: "https://placeholdervideo.dev/1920x1080"
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

// ---------------- SERVER ----------------
const app = express();
serveHTTP(builder.getInterface(), { app });

app.listen(PORT, () => {
    console.log("Addon running on port", PORT);
});
