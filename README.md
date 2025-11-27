# NFC Audio Player — Browser Yoto

This project is a Progressive Web App (PWA) that turns any compatible Android phone (Chrome on Android with Web NFC) into a Yoto-like NFC audio player without installing a native app.

Features:
- PWA installable (Add to Home Screen)
- Works offline after first load (service worker + IndexedDB)
- Read and write NFC cards via Web NFC API (NDEF text records)
- Upload audio tracks from phone, create cards (playlists), store everything in IndexedDB
- Kid-friendly playback UI with large controls

How to use (quick):
1. Host the folder on a simple HTTP server (Android Chrome blocks many features on file://). Example using Python:

```powershell
# from project folder
python -m http.server 8000
``` 

2. Open `http://<your-pc-or-phone-ip>:8000` in Chrome on your Android phone (or open directly on the device if you host there).
3. Tap the menu and choose "Add to Home screen" to install PWA.
4. Upload audio files using the upload area.
5. Create a card (playlist), add tracks to it.
6. Use "Write to Card" and tap your blank NTAG213/215 card to write the card ID as an NDEF text record.
7. When a programmed card is tapped, the app will automatically play that playlist from track 1.

Notes & Limitations:
- Web NFC is only available in Chromium-based browsers on Android (Chrome 89+). If the browser does not support it, the app will show messages.
- For maximum offline storage, allow storage persistence if the browser prompts.
- The manifest references `icons/` which you may add images to (192x192 and 512x512 PNGs) for proper home-screen icons.

Files:
- `index.html` — main UI
- `styles.css` — styling
- `app.js` — application logic (NFC, playback, UI)
- `db.js` — IndexedDB helper
- `sw.js` — service worker
- `manifest.json` — PWA manifest

Want me to:
- Add icon PNGs into `/icons` and a nicer default cover image? (I can generate simple SVG icons.)
- Improve track-to-card assignment UI (drag/drop)?
- Add export/import buttons in UI? (Currently available via `DB.exportAll()` in console.)
