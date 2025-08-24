<script type="text/plain" id="server-js">
// land
const newLocal = (m.index + stepsNeeded)%PER_SEAT; // local index wraps each quadrant
const landed = {where:'TRACK', index: newLocal};
resolveLanding(R, targetSeat, landed);
m.index = newLocal; return true;
}
}


// Regular move on track or backward
if(m.where==='TRACK'){
const dir = backward? -1: 1;
// compute traversal; entering home if crossing homeEntry
const gStart = (seatOffset(targetSeat) + m.index) % TRACK_LEN;
const gEnd = (gStart + dir*steps + TRACK_LEN*1000) % TRACK_LEN; // wrap safe


// Moving backward cannot enter home, and we ensure not passing through own
if(pathBlockedByOwn(R, targetSeat, m, steps, backward)) return false;


// Check if moving forward crosses into home
const hEntry = homeEntry(targetSeat);
if(!backward && allowHome){
const crossesHome = crosses(gStart, gEnd, hEntry);
if(crossesHome){
// how many steps from hEntry to gEnd
const toEntry = (hEntry - gStart + TRACK_LEN) % TRACK_LEN;
const remaining = steps - toEntry - 1; // step into the first home slot counts 1
if(remaining<0) return false;
// can we place into home? exact slot index = remaining
if(remaining>4) return false; // 5 home slots (0..4)
// must not land on occupied home slot
if(occupiedHomeSlot(R, targetSeat, remaining)) return false;
// move into home
m.where='HOME'; m.index=remaining; return true;
}
}


// staying on track
const newGlobal = gEnd;
const newLocal = (newGlobal - seatOffset(targetSeat) + TRACK_LEN) % TRACK_LEN;
const landing = {where:'TRACK', index:newLocal};
resolveLanding(R, targetSeat, landing);
m.index = newLocal; return true;
}


// Move inside HOME
if(m.where==='HOME'){
if(backward) return false; // cannot move backward in home
const target = m.index + steps; if(target>4) return false; // exact only
if(occupiedHomeSlot(R, targetSeat, target)) return false;
m.index = target; return true;
}


// Move from START without Get Out was attempted
return false;
}


function crosses(a,b,x){ // does forward path from a to b (mod TRACK_LEN) pass x?
return (a<=b)? (x>a && x<=b) : (x>a || x<=b);
}


function occupiedByOwn(R, seat, landing){
return locateAny(R, (s,mm)=> s===seat && sameCell(s,mm,landing));
}
function occupiedHomeSlot(R, seat, slot){
return R.game.players[seat].marbles.some(m=> m.where==='HOME' && m.index===slot);
}
function sameCell(seat, m, landing){
if(landing.where==='TRACK' && m.where==='TRACK'){
return m.index===landing.index;
}
return false;
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
// if any own marble occupies nextLocal, it's blocked (cannot pass over or land)
if(R.game.players[seat].marbles.some(mm=> mm!==m && mm.where==='TRACK' && mm.index===nextLocal)) return true;
local = nextLocal;
}
return false;
}


function resolveLanding(R, seat, landing){
// If opponent on landing: send to START; if partner on landing: send to their Home Front Door
for(let s=0;s<4;s++){
for(const mm of R.game.players[s].marbles){
if(mm.where==='TRACK' && landing.where==='TRACK' && mm.index===landing.index){
if(s===seat) return; // own — should have been blocked earlier
const isPartner = (s%2)===(seat%2);
if(isPartner){ // send to front door (home entry cell)
// put them onto their homeEntry cell (TRACK) instead of start
mm.where='TRACK';
mm.index = (homeEntry(s) - seatOffset(s) + TRACK_LEN) % TRACK_LEN;
} else { mm.where='START'; mm.index= rebundleIndex(mm.index); }
}
}
}
}
function rebundleIndex(i){ return i%5; }
</script>