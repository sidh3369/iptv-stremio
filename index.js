const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const express = require("express");
const axios = require("axios");

const PORT = process.env.PORT || 3000;
const VOD_PLAYLIST_URL = "https://raw.githubusercontent.com/sidh3369/m3u_bot/main/1.m3u";

// Manifest (kept as is, but ensured consistency)
const manifest = {
    id: "org.vodplaylist",
    version: "1.0.2", // Bumped for changes
    name: "SID VOD Playlist",
    description: "Watch your personal video playlist with reload option",
    resources: ["catalog", "meta", "stream"],
    types: ["movie"], // Using movie for single videos
    catalogs: [
        {
            type: "movie",
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

const builder = new addonBuilder(manifest);

let cachedMetas = []; // Cache for playlist
let lastFetchTime = 0;
const CACHE_DURATION = 600000; // 10 minutes

// Improved M3U parser
async function fetchPlaylist(force = false) {
    const now = Date.now();
    if (!force && cachedMetas.length > 0 && now - lastFetchTime < CACHE_DURATION) {
        return cachedMetas;
    }

    try {
        const res = await axios.get(VOD_PLAYLIST_URL);
        const lines = res.data.split(/\r?\n/);
        const metas = [];
        let currentMeta = {};
        let idCounter = 1;

        for (let line of lines) {
            line = line.trim();
            if (line.startsWith("#EXTINF:")) {
                const extinf = line.substring(8);
                const commaIndex = extinf.lastIndexOf(",");
                const attrsStr = commaIndex > -1 ? extinf.substring(0, commaIndex) : extinf;
                const name = commaIndex > -1 ? extinf.substring(commaIndex + 1).trim() : `Video ${idCounter}`;

                const attrs = {};
                attrsStr.replace(/(\w+)=["']([^"']+)["']/g, (_, key, val) => { attrs[key] = val; });

                currentMeta = {
                    id: `vod-${idCounter}`,
                    name: attrs["tvg-name"] || name || `Video ${idCounter}`,
                    type: "movie",
                    poster: attrs["tvg-logo"] || "https://dl.strem.io/addon-logo.png",
                    background: "https://dl.strem.io/addon-background.jpg",
                    description: name
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

        cachedMetas = metas;
        lastFetchTime = now;
        return metas;
    } catch (e) {
        console.error("Error fetching playlist:", e);
        return [];
    }
}

// Catalog: List all videos + special reload item at the top
builder.defineCatalogHandler(async (args) => {
    let metas = await fetchPlaylist();
    const reloadItem = {
        id: "reload",
        name: "Reload Playlist",
        type: "movie",
        poster: "https://dl.strem.io/addon-logo.png", // Or a custom icon for button-like feel
        description: "Click to reload the M3U playlist"
    };
    metas = [reloadItem, ...metas]; // Add reload item first
    return { metas };
});

// Meta: Details about each video, force reload if id === "reload"
builder.defineMetaHandler(async (args) => {
    if (args.id === "reload") {
        await fetchPlaylist(true); // Force reload when details are viewed
        return { meta: {
            id: "reload",
            name: "Reload Playlist",
            type: "movie",
            description: "Playlist reloaded! Go back and refresh the catalog to see updates.",
            poster: "https://dl.strem.io/addon-logo.png"
        } };
    }
    const metas = await fetchPlaylist();
    const meta = metas.find(m => m.id === args.id);
    return { meta: meta || {} };
});

// Stream: Direct link to each video, no stream for reload item
builder.defineStreamHandler(async (args) => {
    if (args.id === "reload") {
        return { streams: [] }; // No stream, just for trigger
    }
    const metas = await fetchPlaylist();
    const meta = metas.find(m => m.id === args.id);
    if (meta && meta.url) {
        return { streams: [{ url: meta.url, title: meta.name }] };
    }
    return { streams: [] };
});

// Set up server
const app = express();

// Optional: Web reload endpoint for external access
app.get("/reload", async (req, res) => {
    await fetchPlaylist(true);
    res.send("Playlist reloaded successfully!");
});

// Simple HTML page with reload button at root (optional)
app.get("/", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Reload Playlist</title>
        </head>
        <body>
            <h1>SID VOD Playlist Controls</h1>
            <button onclick="reloadPlaylist()">Reload Playlist</button>
            <p id="status"></p>
            <script>
                async function reloadPlaylist() {
                    const status = document.getElementById('status');
                    status.textContent = 'Reloading...';
                    try {
                        const response = await fetch('/reload');
                        const text = await response.text();
                        status.textContent = text;
                    } catch (error) {
                        status.textContent = 'Error: ' + error.message;
                    }
                }
            </script>
        </body>
        </html>
    `);
});

// Serve the addon at root
serveHTTP(builder.getInterface(), { server: app, port: PORT, hostname: "0.0.0.0" });

app.listen(PORT, () => {
    console.log(`Addon running on port ${PORT}. Visit http://localhost:${PORT}/ for web controls.`);
});
