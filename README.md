# Stremio Addon for personal video Playlist

This Stremio addon streams from a single URL:


## Local Setup

1. Ensure Node.js v14.0.0+ is installed.

2. Clone the repository:
   ```
   git clone https://github.com/your-username/iptv-stremio-addon.git
   cd iptv-stremio-addon
   ```

3. Install dependencies:
   ```
   npm install
   ```

4. Configure environment variables (optional):
   Create a `.env` file or set variables in your terminal.

5. Start the server:
   ```
   npm start
   ```
   For development mode with auto-restart:
   ```
   npm run dev
   ```

6. Access the addon at `http://localhost:3000/manifest.json`

7. Add to Stremio:
   ```
   http://localhost:3000/manifest.json
   ```
   Use your local IP instead of `localhost` for network-wide access.



3. Access at `http://localhost:3000/manifest.json`


Ensure your proxy is reliable and fast for optimal performance.

## Timeout Settings

Set `FETCH_TIMEOUT` for fetch operations (in milliseconds):
