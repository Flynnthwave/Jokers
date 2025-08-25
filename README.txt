# Jokers & Marbles — Full Single-Folder Deploy

## Files
- `package.json` — Node config (`express`, `socket.io`) with `"start": "node server.js"`
- `server.js` — Express + Socket.IO server, **fixed host code = `F@rt`**, includes `/health`
- `index.html` — Full client UI with a **Server URL field**. If this page is hosted separately (e.g., Squarespace), paste your Render URL there.

## Run Locally
```
npm install
node server.js
# open http://localhost:3000
```

## Deploy on Render
- Web Service (Node)
- Build Command: `npm install`
- Start Command: `npm start`
- After deploy, open: `https://YOUR-APP.onrender.com/health` → should show `ok`
- Then open the root URL and join a room.
