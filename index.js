const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");

const PORT = process.env.PORT || 3000;
const DEFAULT_VOD_PLAYLIST_URL = "https://raw.githubusercontent.com/sidh3369/m3u_bot/main/1.m3u";

// In-memory list of M3U URLs
let playlistUrls = [DEFAULT_VOD_PLAYLIST_URL];

// Manifest - disabled configurable to avoid /configure error
const manifest = {
    id: "org.vodplaylist",
    version: "1.0.6", // bumped version
    name: "SID VOD Playlist",
    description: "Personal M3U playlist viewer - add links via browser at addon root URL",
    resources: ["catalog", "meta", "stream"],
    types: ["movie"],
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
        configurable: false,          // ← disabled to stop /configure 404 error
        configurationRequired: false
    },
    stremioAddonsConfig: {
        issuer: "https://stremio-addons.net",
        signature: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..JW4q64pqr0-IqzI-be5dVw.o6hTt07qtJsM86dzHCbJ12JRN81iVYpyqcrrXOOVnqmBEHD2J2Oeo9TpYaxtV9UjgLizHF4W2hkIjjvz46ftbkC1sLfcCPvIaO7kkq_XO9A9UncISdPMfJLGorL9ngmc.Y26jBejNzwLBxhMYx-V20g"
    }
};

const builder = new addonBuilder(manifest);

let cachedMetas = [];
let lastFetchTime = 0;
const CACHE_DURATION = 600000; // 10 minutes

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
                        id: `vod-${urlIndex + 1}-${globalIdCounter}`,
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
            console.error(`Fetch error ${url}: ${e.message}`);
        }
    }

    cachedMetas = allMetas;
    lastFetchTime = now;
    return allMetas;
}

// Catalog - add reload dummy item at top
builder.defineCatalogHandler(async () => {
    let metas = await fetchPlaylist();
    const reloadItem = {
        id: "reload",
        name: "↻ Reload Playlists",
        type: "movie",
        poster: "https://dl.strem.io/addon-logo.png",
        description: "Play this → wait 5-10 sec → stop → pull-to-refresh catalog to update M3U content"
    };
    metas = [reloadItem, ...metas];
    return { metas };
});

// Meta
builder.defineMetaHandler(async ({ id }) => {
    if (id === "reload") {
        return { meta: {
            id: "reload",
            name: "↻ Reload Playlists",
            type: "movie",
            description: "Plays blank video while reloading. Stop playback & pull-to-refresh catalog.",
            poster: "https://dl.strem.io/addon-logo.png"
        } };
    }
    const metas = await fetchPlaylist();
    const meta = metas.find(m => m.id === id);
    return { meta: meta || {} };
});

// Stream
builder.defineStreamHandler(async ({ id }) => {
    if (id === "reload") {
        await fetchPlaylist(true); // force reload
        return { streams: [{
            url: "https://placeholdervideo.dev/1920x1080",
            title: "Reloading... stop & refresh catalog"
        }] };
    }

    const metas = await fetchPlaylist();
    const meta = metas.find(m => m.id === id);
    if (meta && meta.url) {
        return { streams: [{ url: meta.url, title: meta.name }] };
    }
    return { streams: [] };
});

// Express server
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Root page - now with add/remove M3U form (no /configure needed)
app.get("/", (req, res) => {
    let urlListHtml = playlistUrls.map((url, i) => `
        <li>
            <a href="${url}" target="_blank">${url}</a>
            <form style="display:inline;" method="POST" action="/remove">
                <input type="hidden" name="index" value="${i}">
                <button type="submit">Remove</button>
            </form>
        </li>
    `).join("");

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>SID VOD Playlist Manager</title>
            <style>body { font-family: Arial; padding: 20px; } ul { list-style: none; padding: 0; } li { margin: 10px 0; }</style>
        </head>
        <body>
            <h1>SID VOD Playlist</h1>
            <p>Add M3U links below. Changes apply after reload in Stremio (or play "↻ Reload Playlists" item).</p>
            
            <h2>Current M3U Links</h2>
            <ul>${urlListHtml || "<li>No custom links yet</li>"}</ul>
            
            <h2>Add New M3U Link</h2>
            <form method="POST" action="/add">
                <input type="text" name="url" placeholder="https://example.com/playlist.m3u" style="width: 300px;" required>
                <button type="submit">Add Link</button>
            </form>
            
            <br>
            <a href="/reload">Force Reload All Playlists Now</a>
            
            <p><strong>Stremio Install URL:</strong> https://iptv-stremio.onrender.com/manifest.json</p>
        </body>
        </html>
    `);
});

// Add new URL
app.post("/add", (req, res) => {
    const newUrl = req.body.url?.trim();
    if (newUrl && !playlistUrls.includes(newUrl)) {
        playlistUrls.push(newUrl);
    }
    res.redirect("/");
});

// Remove URL
app.post("/remove", (req, res) => {
    const index = parseInt(req.body.index, 10);
    if (!isNaN(index) && index >= 0 && index < playlistUrls.length) {
        playlistUrls.splice(index, 1);
    }
    res.redirect("/");
});

// Reload endpoint (for manual browser reload)
app.get("/reload", async (req, res) => {
    await fetchPlaylist(true);
    res.send("Playlists reloaded! Return to Stremio and pull-to-refresh catalog.");
});

// Start addon
serveHTTP(builder.getInterface(), { server: app, port: PORT, hostname: "0.0.0.0" });

console.log(`Addon running on port ${PORT}`);
console.log(`Manager page: http://localhost:${PORT}/`);
