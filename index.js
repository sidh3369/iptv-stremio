const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");

const PORT = process.env.PORT || 3000;
const DEFAULT_VOD_PLAYLIST_URL = "https://raw.githubusercontent.com/sidh3369/m3u_bot/main/1.m3u";

let playlistUrls = [DEFAULT_VOD_PLAYLIST_URL];

const manifest = {
    id: "org.vodplaylist",
    version: "1.0.4",           // ← bump version so you know it's the new one
    name: "SID VOD Playlist",
    description: "Personal M3U playlist with reload & multiple links",
    resources: ["catalog", "meta", "stream"],
    types: ["movie"],
    catalogs: [{
        type: "movie",
        id: "vod-playlist",
        name: "My VOD Playlist",
        extra: []
    }],
    idPrefixes: ["vod-"],
    logo: "https://dl.strem.io/addon-logo.png",
    icon: "https://dl.strem.io/addon-logo.png",
    background: "https://dl.strem.io/addon-background.jpg",
    behaviorHints: {
        configurable: true,
        configurationRequired: false
    },
    stremioAddonsConfig: {
        issuer: "https://stremio-addons.net",
        signature: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..JW4q64pqr0-IqzI-be5dVw.o6hTt07qtJsM86dzHCbJ12JRN81iVYpyqcrrXOOVnqmBEHD2J2Oeo9TpYaxtV9UjgLizHF4W2hkIjjvz46ftbkC1sLfcCPvIaO7kkq_XO9A9UncISdPMfJLGorL9ngmc.Y26jBejNzwLBxhMYx-V20g"
    }
};

const builder = new addonBuilder(manifest);

let cachedMetas = []; // Cache for playlist
let lastFetchTime = 0;
const CACHE_DURATION = 600000; // 10 minutes

// Fetch and parse from all configured URLs
async function fetchPlaylist(force = false) {
    const now = Date.now();
    if (!force && cachedMetas.length > 0 && now - lastFetchTime < CACHE_DURATION) {
        return cachedMetas;
    }

    let allMetas = [];
    let globalIdCounter = 1;

    for (let urlIndex = 0; urlIndex < playlistUrls.length; urlIndex++) {
        const url = playlistUrls[urlIndex];
        try {
            const res = await axios.get(url);
            const lines = res.data.split(/\r?\n/);
            let currentMeta = {};

            for (let line of lines) {
                line = line.trim();
                if (line.startsWith("#EXTINF:")) {
                    const extinf = line.substring(8);
                    const commaIndex = extinf.lastIndexOf(",");
                    const attrsStr = commaIndex > -1 ? extinf.substring(0, commaIndex) : extinf;
                    const name = commaIndex > -1 ? extinf.substring(commaIndex + 1).trim() : `Video ${globalIdCounter}`;

                    const attrs = {};
                    attrsStr.replace(/(\w+)=["']([^"']+)["']/g, (_, key, val) => { attrs[key] = val; });

                    currentMeta = {
                        id: `vod-${urlIndex + 1}-${globalIdCounter}`, // Prefix with urlIndex to avoid collisions
                        name: attrs["tvg-name"] || name || `Video ${globalIdCounter}`,
                        type: "movie",
                        poster: attrs["tvg-logo"] || "https://dl.strem.io/addon-logo.png",
                        background: "https://dl.strem.io/addon-background.jpg",
                        description: name
                    };
                } else if (line && !line.startsWith("#")) {
                    if (currentMeta.id) {
                        currentMeta.url = line;
                        allMetas.push(currentMeta);
                        globalIdCounter++;
                        currentMeta = {};
                    }
                }
            }
        } catch (e) {
            console.error(`Error fetching playlist from ${url}:`, e);
        }
    }

    cachedMetas = allMetas;
    lastFetchTime = now;
    return allMetas;
}

// Catalog: List all videos + special reload item at the top
builder.defineCatalogHandler(async (args) => {
    let metas = await fetchPlaylist();
    const reloadItem = {
        id: "reload",
        name: "Reload Playlists",
        type: "movie",
        poster: "https://dl.strem.io/addon-logo.png",
        description: "Click to reload all M3U playlists"
    };
    metas = [reloadItem, ...metas];
    return { metas };
});

// Meta: Details about each video, force reload if id === "reload"
builder.defineMetaHandler(async (args) => {
    if (args.id === "reload") {
        await fetchPlaylist(true);
        return { meta: {
            id: "reload",
            name: "Reload Playlists",
            type: "movie",
            description: "All playlists reloaded! Go back and refresh the catalog to see updates.",
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
        return { streams: [] };
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
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ─── Important fix: redirect /configure → /configure.html ───
app.get("/configure", (req, res) => {
    res.redirect("/configure.html");
});

// Your existing routes
app.get("/configure.html", (req, res) => {
    // ... your current configure.html code ...
});

app.post("/save-config", (req, res) => {
    // ... your current save-config code ...
});

app.get("/reload", async (req, res) => {
    await fetchPlaylist(true);
    res.send("Playlists reloaded successfully!");
});

app.get("/", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <body>
            <h1>SID VOD Playlist</h1>
            <a href="/configure.html">Configure (add M3U links)</a><br>
            <a href="/reload">Reload Playlists</a>
        </body>
        </html>
    `);
});

// Start the addon server (this also starts the HTTP listener)
serveHTTP(builder.getInterface(), {
    server: app,
    port: PORT,
    hostname: "0.0.0.0"
});

console.log(`Addon running on port ${PORT}`);
console.log(`Configure page: http://localhost:${PORT}/configure.html`);
