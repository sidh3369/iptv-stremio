// VOD Playlist Addon for Stremio
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const express = require("express");

const PORT = process.env.PORT || 3000;
const VOD_PLAYLIST_URL = "https://app.rcsfacility.com/1.m3u"; // Your video playlist URL

// Manifest
const manifest = {
    id: "org.vodplaylist",
    version: "1.0.0",
    name: "SID VOD Playlist",
    description: "Watch your personal video playlist",
    resources: ["catalog", "meta", "stream"],
    types: ["movie"],
    catalogs: [
        {
            type: "SID",
            id: "vod-playlist",
            name: "My VOD Playlist",
            extra: []
        }
    ],
    idPrefixes: ["vod-"],
    logo: "https://dl.strem.io/addon-logo.png",
    icon: "https://dl.strem.io/addon-logo.png",
    background: "https://dl.strem.io/addon-background.jpg",
    behaviorHints: {
        configurable: false,
        configurationRequired: false
    }
};

const addon = new addonBuilder(manifest);

const axios = require("axios");

// Helper to parse .m3u playlist
async function fetchPlaylist() {
    try {
        const res = await axios.get(VOD_PLAYLIST_URL);
        const lines = res.data.split(/\r?\n/);
        let metas = [];
        let currentMeta = {};
        let idCounter = 1;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith("#EXTINF:")) {
                const info = line.substring(8).split(",");
                currentMeta = {
                    id: `vod-${idCounter}`,
                    name: info[1] ? info[1].trim() : `Video ${idCounter}`,
                    type: "movie",
                    poster: "https://dl.strem.io/addon-logo.png",
                    background: "https://dl.strem.io/addon-background.jpg",
                    description: info[1] ? info[1].trim() : `Video ${idCounter}`
                };
            } else if (line && !line.startsWith("#")) {
                if (currentMeta.id) {
                    currentMeta.url = line;
                    metas.push(currentMeta);
                    idCounter++;
                    currentMeta = {};
                }
            }
        }
        return metas;
    } catch (e) {
        return [];
    }
}

// Catalog: List all videos from playlist
addon.defineCatalogHandler(async () => {
    const metas = await fetchPlaylist();
    return { metas };
});

// Meta: Details about each video
addon.defineMetaHandler(async ({ id }) => {
    const metas = await fetchPlaylist();
    const meta = metas.find(m => m.id === id);
    return { meta: meta || {} };
});

// Stream: Direct link to each video
addon.defineStreamHandler(async ({ id }) => {
    const metas = await fetchPlaylist();
    const meta = metas.find(m => m.id === id);
    if (meta && meta.url) {
        return { streams: [{ url: meta.url, title: meta.name }] };
    }
    return { streams: [] };
});

// Express fallback for manifest.json
const app = express();
app.get("/manifest.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(manifest);
});

// Serve the add-on
serveHTTP(addon.getInterface(), { server: app, path: "/manifest.json", port: PORT, hostname: "0.0.0.0" });
