const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");

const PORT = process.env.PORT || 3000;
const DEFAULT_VOD_PLAYLIST_URL = "https://raw.githubusercontent.com/sidh3369/m3u_bot/main/1.m3u";

// In-memory storage for multiple M3U URLs (starts with default)
let playlistUrls = [DEFAULT_VOD_PLAYLIST_URL];

// Manifest (with added stremioAddonsConfig for signature)
const manifest = {
    id: "org.vodplaylist",
    version: "1.0.3",
    name: "SID VOD Playlist",
    description: "Watch your personal video playlist with reload and configure options",
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
        configurable: true,
        configurationRequired: false
    },
    stremioAddonsConfig: { // <-- Added here
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

// Reload endpoint (optional)
app.get("/reload", async (req, res) => {
    await fetchPlaylist(true);
    res.send("Playlists reloaded successfully!");
});

// Configure page: HTML form to add/remove M3U URLs
app.get("/configure.html", (req, res) => {
    let urlList = playlistUrls.map((url, index) => `
        <li>
            ${url} <button type="button" onclick="removeUrl(${index})">Remove</button>
        </li>
    `).join("");

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Configure Playlists</title>
            <script>
                let urlCounter = ${playlistUrls.length};
                function addUrlField() {
                    const container = document.getElementById('url-container');
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.name = \`url\${urlCounter}\`;
                    input.placeholder = 'Enter M3U URL';
                    const removeBtn = document.createElement('button');
                    removeBtn.type = 'button';
                    removeBtn.textContent = 'Remove';
                    removeBtn.onclick = () => container.removeChild(input.parentNode);
                    const div = document.createElement('div');
                    div.appendChild(input);
                    div.appendChild(removeBtn);
                    container.appendChild(div);
                    urlCounter++;
                }
                function removeUrl(index) {
                    document.getElementById('remove-' + index).value = 'true';
                    document.forms[0].submit();
                }
            </script>
        </head>
        <body>
            <h1>Configure M3U Playlists</h1>
            <form action="/save-config" method="POST">
                <h2>Current Playlists:</h2>
                <ul>
                    ${urlList}
                </ul>
                <h2>Add New Playlists:</h2>
                <div id="url-container"></div>
                <button type="button" onclick="addUrlField()">Add URL</button>
                <br><br>
                <input type="submit" value="Save Changes">
            </form>
            <script>
                // Hidden inputs for removals (simplified, submit form on remove)
                const form = document.forms[0];
                ${playlistUrls.map((_, index) => `
                    const removeInput${index} = document.createElement('input');
                    removeInput${index}.type = 'hidden';
                    removeInput${index}.name = 'remove-${index}';
                    removeInput${index}.id = 'remove-${index}';
                    removeInput${index}.value = 'false';
                    form.appendChild(removeInput${index});
                `).join("")}
            </script>
        </body>
        </html>
    `);
});

// Save config: Update playlistUrls based on form data
app.post("/save-config", (req, res) => {
    let newUrls = [...playlistUrls];

    // Handle removals
    for (let i = 0; i < playlistUrls.length; i++) {
        if (req.body[`remove-${i}`] === 'true') {
            newUrls.splice(i, 1);
        }
    }

    // Add new URLs
    Object.keys(req.body).forEach(key => {
        if (key.startsWith('url') && req.body[key].trim()) {
            newUrls.push(req.body[key].trim());
        }
    });

    // Remove duplicates
    playlistUrls = [...new Set(newUrls)];

    // Force reload after config change
    fetchPlaylist(true);

    res.send("Configuration saved! You can close this page and refresh the catalog in Stremio.");
});

// Simple root page (optional)
app.get("/", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <body>
            <h1>SID VOD Playlist</h1>
            <a href="/configure.html">Configure Playlists</a><br>
            <a href="/reload">Reload Playlists</a>
        </body>
        </html>
    `);
});

// Serve the addon at root (this starts the server, no need for separate app.listen)
serveHTTP(builder.getInterface(), { server: app, port: PORT, hostname: "0.0.0.0" });

console.log(`Addon running on port ${PORT}. Configure at http://localhost:${PORT}/configure.html`);
