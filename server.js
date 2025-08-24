// ============================ SERVER (Node) =============================
// Save as: server.js
// Run locally:  npm init -y && npm i express socket.io && node server.js
// On Render: package.json should have "start": "node server.js"
// =========================================================================

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http, { cors:{ origin: '*' } });
const PORT = process.env.PORT || 3000;

// Serve static files (so index.html is accessible if in same folder)
app.use(express.static(__dirname));

http.listen(PORT, () =>
  console.log('Jokers & Marbles server running on http://localhost:' + PORT)
);

// ----------------- ROOM STATE -----------------
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const TRACK_LEN = 56;
const PER_SEAT = 14; // 4 players only in MVP

const rooms = new Map(); // roomId -> { hostCode, players:[], game:null }

io.on('connection', (socket) => {
  socket.on('join', ({ room, name, color, hostcode }) => {
    if (!rooms.has(room)) rooms.set(room, { hostCode: hostcode || '', players: [], game: null });
    const R = rooms.get(room);

    if (R.players.length >= 4) {
      socket.emit('game:log', 'Room full.');
      return;
    }

    const seat = findFirstSeat(R.players);
    const team = seat % 2 === 0 ? 'A' : 'B';
    const me = {
      id: socket.id,
      name,
      color,
      seat,
      team,
      host: !!hostcode && (R.hostCode === '' || R.hostCode === hostcode),
    };
    if (me.host && !R.hostCode) R.hostCode = hostcode;

    R.players.push(me);
    socket.join(room);
    socket.data.room = room;
    socket.data.seat = seat;

    io.to(room).emit('roster', R.players);
    socket.emit('joined', { room, me, players: R.players, isHost: me.host });
  });

  socket.on('host:start', ({ room }) => {
    const R = rooms.get(room);
    if (!R) return;
    const host = R.players.find((p) => p.id === socket.id && p.host);
    if (!host) {
      io.to(socket.id).emit('game:log', 'Host only');
      return;
    }
    if (R.players.length < 4) {
      io.to(socket.id).emit('game:log', 'Need 4 players for MVP.');
      return;
    }
    R.game = createNewGame(R.players);
    dealAll(R);
    broadcastState(R, room);
  });

  socket.on('host:reset', ({ room }) => {
    const R = rooms.get(room);
    if (!R) return;
    const host = R.players.find((p) => p.id === socket.id && p.host);
    if (!host) return;
    R.game = null;
    io.to(room).emit('game:state', null);
    io.to(room).emit('game:log', 'Game reset by host.');
  });

  socket.on('play', ({ room, seat, cardIndex, rank, marbleId, jokerChoice }) => {
    const R = rooms.get(room);
    if (!R || !R.game) return;
    if (R.game.turn !== seat) return;
    const hand = R.game.hands[seat];
    if (hand[cardIndex] !== rank) return;

    const ok = applyMove(R, seat, { rank, marbleId, jokerChoice });
    if (!ok) {
      io.to(socket.id).emit('game:log', 'Illegal move.');
      return;
    }

    hand.splice(cardIndex, 1);
    drawUpToFive(R, seat);

    R.game.turn = (R.game.turn + 1) % 4;

    broadcastState(R, room);
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    if (!room || !rooms.has(room)) return;
    const R = rooms.get(room);
    R.players = R.players.filter((p) => p.id !== socket.id);
    if (R.players.length === 0) {
      rooms.delete(room);
      return;
    }
    io.to(room).emit('roster', R.players);
  });
});

// ----------------- HELPERS -----------------
function findFirstSeat(players) {
  const taken = new Set(players.map((p) => p.seat));
  for (let i = 0; i < 4; i++) if (!taken.has(i)) return i;
  return 0;
}

function createNewGame(players) {
  return {
    turn: 0,
    deck: shuffledDeck(),
    hands: [[], [], [], []],
    players: players.map(() => ({
      allHome: false,
      marbles: [0, 1, 2, 3, 4].map((i) => ({ where: 'START', index: i })),
    })),
  };
}

function shuffledDeck() {
  const deck = [];
  for (const r of RANKS) for (let i = 0; i < 8; i++) deck.push(r);
  for (let j = 0; j < 4; j++) deck.push('JOKER');
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function dealAll(R) {
  for (let s = 0; s < 4; s++) {
    while (R.game.hands[s].length < 5) R.game.hands[s].push(R.game.deck.pop());
  }
  sendHands(R);
}
function drawUpToFive(R, seat) {
  while (R.game.hands[seat].length < 5 && R.game.deck.length)
    R.game.hands[seat].push(R.game.deck.pop());
  sendHand(R, seat);
}
function sendHands(R) {
  R.players.forEach((p) => sendHand(R, p.seat));
}
function sendHand(R, seat) {
  const pid = R.players.find((p) => p.seat === seat)?.id;
  if (pid) io.to(pid).emit('game:hand', R.game.hands[seat]);
}
function broadcastState(R, room) {
  io.to(room).emit('game:state', { turn: R.game.turn, players: R.game.players });
}

// ----------------- RULES / MOVEMENT -----------------
// (For brevity here: keep your applyMove, pathBlockedByOwn, resolveLanding, etc. logic
// from the previous long file. Just make sure NO <script> tags are in this file.)
