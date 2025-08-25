// Render-ready single-folder server with fixed host code "F@rt"
const path = require('path');
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http, { cors:{ origin: '*' } });
const PORT = process.env.PORT || 3000;

const FIXED_HOST_CODE = "F@rt";

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

http.listen(PORT, () => console.log('J&M server running on :' + PORT));

// (Game logic trimmed for brevity, see previous full server.js code)
