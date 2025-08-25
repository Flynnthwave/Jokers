// ============================ SERVER (Node) =============================
// Single-folder app: serves index.html and hosts Socket.IO
// Host code is fixed to "F@rt".
// Provides /health for Render health checks.
// =======================================================================
const path = require('path');
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http, { cors:{ origin: '*' } });
const PORT = process.env.PORT || 3000;

const FIXED_HOST_CODE = "F@rt";

// Health + version
app.get('/health', (_,res)=> res.type('text').send('ok'));
app.get('/version', (_,res)=> res.json({version:'1.1.0'}));

// Serve static files from root (so /index.html loads)
app.use(express.static(__dirname));

// Root route -> index.html
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

http.listen(PORT, () => console.log('J&M server running on :' + PORT));

// ----------------- GAME STATE -----------------
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const TRACK_LEN = 56, PER_SEAT = 14; // 4 players MVP
// roomId -> { players:[{id,name,color,seat,team,host}], game:null|{...} }
const rooms = new Map();

io.on('connection', (socket) => {
  socket.on('join', ({ room, name, color, hostcode }) => {
    if (!room || !name || !color) return socket.emit('game:log','Missing room/name/color');
    if (!rooms.has(room)) rooms.set(room, { players: [], game: null });
    const R = rooms.get(room);

    if (R.players.length >= 4) return socket.emit('game:log', 'Room full (MVP supports 4 players)');
    if (R.players.some(p=>p.color===color)) return socket.emit('game:log', 'Color taken. Pick another.');

    const seat = findFirstSeat(R.players);
    const team = seat%2===0?'A':'B';
    const me = { id:socket.id, name, color, seat, team, host: hostcode === FIXED_HOST_CODE };

    R.players.push(me);
    socket.join(room);
    socket.data.room = room; 
    socket.data.seat = seat;

    io.to(room).emit('roster', R.players);
    socket.emit('joined', { room, me, players:R.players, isHost:me.host });
    io.to(room).emit('game:log', `${name} joined (seat ${seat}, team ${team})${me.host?' [HOST]':''}`);
  });

  socket.on('host:start', ({ room }) => {
    const R = rooms.get(room); if(!R) return;
    const host = R.players.find(p=>p.id===socket.id && p.host);
    if(!host) return io.to(socket.id).emit('game:log','Host only (enter the correct host code).');
    if(R.players.length<4) return io.to(socket.id).emit('game:log','Need 4 players for MVP.');
    R.game = createNewGame(R.players);
    dealAll(R);
    broadcastState(R, room);
    io.to(room).emit('game:log','Game started.');
  });

  socket.on('host:reset', ({ room }) => {
    const R = rooms.get(room); if(!R) return;
    const host = R.players.find(p=>p.id===socket.id && p.host);
    if(!host) return io.to(socket.id).emit('game:log','Host only');
    R.game=null;
    io.to(room).emit('game:state', null);
    io.to(room).emit('game:log','Game reset.');
  });

  socket.on('play', ({ room, seat, cardIndex, rank, marbleId, jokerChoice }) => {
    const R = rooms.get(room); if(!R||!R.game) return;
    if(R.game.turn!==seat) return;
    const hand = R.game.hands[seat]; if(hand[cardIndex]!==rank) return;

    const ok = applyMove(R, seat, { rank, marbleId, jokerChoice });
    if(!ok) return io.to(socket.id).emit('game:log','Illegal move.');

    hand.splice(cardIndex,1);
    drawUpToFive(R, seat);

    R.game.turn = (R.game.turn+1)%4;
    broadcastState(R, room);
  });

  socket.on('disconnect', ()=>{
    const room = socket.data.room; if(!room||!rooms.has(room)) return;
    const R = rooms.get(room);
    R.players = R.players.filter(p=>p.id!==socket.id);
    if(R.players.length===0) rooms.delete(room);
    else io.to(room).emit('roster', R.players);
  });
});

// ----------------- HELPERS -----------------
function findFirstSeat(players){ const taken=new Set(players.map(p=>p.seat)); for(let i=0;i<4;i++) if(!taken.has(i)) return i; return 0; }

function createNewGame(players){ 
  return { 
    turn:0, 
    deck:shuffledDeck(), 
    hands:[[],[],[],[]], 
    players: players.map(()=>({ 
      allHome:false, 
      marbles:[0,1,2,3,4].map(i=>({where:'START', index:i})) 
    })) 
  }; 
}

function shuffledDeck(){ // 2 decks: 8 of each rank + 4 Jokers
  const deck=[]; 
  for(const r of RANKS) for(let i=0;i<8;i++) deck.push(r);
  for(let j=0;j<4;j++) deck.push('JOKER');
  for(let i=deck.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [deck[i],deck[j]]=[deck[j],deck[i]]; }
  return deck; 
}

function dealAll(R){ for(let s=0;s<4;s++){ while(R.game.hands[s].length<5) R.game.hands[s].push(R.game.deck.pop()); } sendHands(R); }
function drawUpToFive(R, seat){ while(R.game.hands[seat].length<5 && R.game.deck.length) R.game.hands[seat].push(R.game.deck.pop()); sendHand(R, seat); }
function sendHands(R){ R.players.forEach(p=> sendHand(R, p.seat)); }
function sendHand(R, seat){ const pid = R.players.find(p=>p.seat===seat)?.id; if(pid) io.to(pid).emit('game:hand', R.game.hands[seat]); }
function broadcastState(R, room){ io.to(room).emit('game:state', { turn:R.game.turn, players:R.game.players }); }

// ----------------- RULES / MOVEMENT -----------------
function seatOffset(seat){ return seat*PER_SEAT; }
function entryIndex(seat){ return seatOffset(seat); }             // entry cell local index 0
function homeEntry(seat){ return (seatOffset(seat)+PER_SEAT-1+TRACK_LEN)%TRACK_LEN; } // last cell before home

function applyMove(R, seat, mv){
  const P = R.game.players[seat];
  const actingOnPartner = P.allHome;
  const targetSeat = actingOnPartner? (seat+2)%4 : seat;
  const TP = R.game.players[targetSeat];
  const card = mv.rank;
  const m = TP.marbles[mv.marbleId]; if(!m) return false;

  let steps=0, backward=false, allowGetOut=false, allowHome=true, corner=false, joker=false;
  if(card==='A'){ allowGetOut=true; steps=1; corner=true; }
  if(card==='K'){ allowGetOut=true; steps=13; }
  if(card==='Q'){ allowGetOut=true; steps=12; }
  if(card==='J'){ allowGetOut=true; steps=11; }
  if(card==='10'){ allowGetOut=true; steps=10; }
  if(['2','3','4','5','6','7','9'].includes(card)){ steps=parseInt(card,10); }
  if(card==='8'){ steps=8; backward=true; }
  if(card==='7'){ steps=7; } // TODO: split across two marbles
  if(card==='JOKER'){
    joker=true;
    if(mv.jokerChoice && mv.jokerChoice.toUpperCase()==='GETOUT'){ allowGetOut=true; steps=0; }
    else{
      const n=parseInt(mv.jokerChoice,10); if(!n||n<1||n>13) return false;
      steps=n;
    }
    allowHome = (mv.jokerChoice && mv.jokerChoice.toUpperCase()!=='GETOUT'); // not directly into Home via Joker "getout"
  }

  // GET OUT
  if(allowGetOut && m.where==='START' && (card==='A'||card==='K'||card==='Q'||card==='J'||card==='10' || (joker && mv.jokerChoice && mv.jokerChoice.toUpperCase()==='GETOUT'))){
    if(occupiedByOwn(R, targetSeat, {where:'TRACK', index:0})) return false; // entry blocked by own
    resolveLanding(R, targetSeat, {where:'TRACK', index:0});
    m.where='TRACK'; m.index=0; 
    return true;
  }

  // Corner-to-corner (Ace at a corner may hop to next corner)
  if(card==='A' && m.where==='TRACK'){
    const global = (seatOffset(targetSeat) + m.index) % TRACK_LEN;
    const corners=[0,14,28,42];
    if(corners.includes(global)){
      const nextCorner = corners[(corners.indexOf(global)+1)%4];
      const stepsNeeded = (nextCorner - global + TRACK_LEN)%TRACK_LEN;
      if(pathBlockedByOwn(R, targetSeat, m, stepsNeeded, false)) return false;
      const newLocal = (m.index + stepsNeeded)%PER_SEAT;
      resolveLanding(R, targetSeat, {where:'TRACK', index:newLocal});
      m.index = newLocal; 
      return true;
    }
  }

  // Move along track (or backward for 8)
  if(m.where==='TRACK'){
    const dir = backward? -1: 1;
    const gStart = (seatOffset(targetSeat) + m.index) % TRACK_LEN;
    const gEnd = (gStart + dir*steps + TRACK_LEN*1000) % TRACK_LEN;

    if(pathBlockedByOwn(R, targetSeat, m, steps, backward)) return false;

    const hEntry = homeEntry(targetSeat);
    if(!backward && allowHome){
      const crossesHome = crosses(gStart, gEnd, hEntry);
      if(crossesHome){
        const toEntry = (hEntry - gStart + TRACK_LEN) % TRACK_LEN;
        const remaining = steps - toEntry - 1; // step into first home counts 1
        if(remaining<0 || remaining>4) return false;
        if(occupiedHomeSlot(R, targetSeat, remaining)) return false;
        m.where='HOME'; m.index=remaining; 
        updateAllHomeFlag(R, targetSeat);
        return true;
      }
    }

    const newGlobal = gEnd;
    const newLocal = (newGlobal - seatOffset(targetSeat) + TRACK_LEN) % TRACK_LEN;
    resolveLanding(R, targetSeat, {where:'TRACK', index:newLocal});
    m.index = newLocal; 
    return true;
  }

  // Move within HOME
  if(m.where==='HOME'){
    if(backward) return false;
    const target = m.index + steps; if(target>4) return false; // exact
    if(occupiedHomeSlot(R, targetSeat, target)) return false;
    m.index = target; 
    updateAllHomeFlag(R, targetSeat);
    return true;
  }
  return false;
}

function updateAllHomeFlag(R, seat){ R.game.players[seat].allHome = R.game.players[seat].marbles.every(m=> m.where==='HOME'); }
function crosses(a,b,x){ return (a<=b)? (x>a && x<=b) : (x>a || x<=b); }

function occupiedByOwn(R, seat, landing){
  return locateAny(R, (s,mm)=> s===seat && sameCell(s,mm,landing));
}
function occupiedHomeSlot(R, seat, slot){
  return R.game.players[seat].marbles.some(m=> m.where==='HOME' && m.index===slot);
}
function sameCell(seat, m, landing){
  return landing.where==='TRACK' && m.where==='TRACK' && m.index===landing.index;
}
function locateAny(R, pred){
  for(let s=0;s<4;s++) for(const m of R.game.players[s].marbles){ if(pred(s,m)) return {s,m}; }
  return null;
}
function pathBlockedByOwn(R, seat, m, steps, backward){
  if(m.where!=='TRACK') return false;
  const dir = backward? -1:1; let local = m.index;
  for(let i=1;i<=steps;i++){
    const nextLocal = (local + dir + TRACK_LEN) % TRACK_LEN;
    if(R.game.players[seat].marbles.some(mm=> mm!==m && mm.where==='TRACK' && mm.index===nextLocal)) return true;
    local = nextLocal;
  }
  return false;
}
function resolveLanding(R, seat, landing){
  for(let s=0;s<4;s++){
    for(const mm of R.game.players[s].marbles){
      if(mm.where==='TRACK' && landing.where==='TRACK' && mm.index===landing.index){
        if(s===seat) return; // own (should be blocked)
        const isPartner = (s%2)===(seat%2);
        if(isPartner){
          mm.where='TRACK';
          mm.index = (homeEntry(s) - seatOffset(s) + TRACK_LEN) % TRACK_LEN;
        } else {
          mm.where='START';
          mm.index = mm.index % 5;
        }
      }
    }
  }
}
