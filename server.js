// Fresh start server: lobby + shared board (no game logic yet)
const path = require('path');
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

app.get('/health', (_, res) => res.type('text').send('ok'));
app.use(express.static(__dirname));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));

http.listen(PORT, () => console.log('J&M fresh server on :' + PORT));

// ----------------- ROOM STATE -----------------
/*
rooms = Map<roomId, {
  players: [{id, name, color, seat, isHost}],
}>
*/
const rooms = new Map();

io.on('connection', (socket) => {
  socket.on('join', ({ room, name, color, isHost }) => {
    if (!room || !name || !color) {
      socket.emit('toast', 'Missing room/name/color'); return;
    }
    if (!rooms.has(room)) rooms.set(room, { players: [] });
    const R = rooms.get(room);

    if (R.players.length >= 4) {
      socket.emit('toast', 'Room full (max 4)'); return;
    }
    if (R.players.some(p => p.color === color)) {
      socket.emit('toast', 'Color taken. Pick another.'); return;
    }

    const seat = firstOpenSeat(R.players);
    const me = { id: socket.id, name, color, seat, isHost: !!isHost };

    R.players.push(me);
    socket.join(room);
    socket.data.room = room;

    socket.emit('joined', { room, me, players: R.players });
    io.to(room).emit('roster', R.players);
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    if (!room || !rooms.has(room)) return;
    const R = rooms.get(room);
    R.players = R.players.filter(p => p.id !== socket.id);
    if (R.players.length === 0) {
      rooms.delete(room);
    } else {
      io.to(room).emit('roster', R.players);
    }
  });
});

function firstOpenSeat(players) {
  const taken = new Set(players.map(p => p.seat));
  for (let s = 0; s < 4; s++) if (!taken.has(s)) return s;
  return 0;
}
