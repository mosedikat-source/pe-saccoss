const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const backupName = `database-backup-${new Date().toISOString().split('T')[0]}.json`;
if (fs.existsSync('database.json') && !fs.existsSync(backupName)) { fs.copyFileSync('database.json', backupName); console.log('✅ Backup created:', backupName); }
let db = { users: [], members: [], pendingMembers: [], transactions: [] };
try { if (fs.existsSync('database.json')) { db = JSON.parse(fs.readFileSync('database.json','utf8')); } } catch(e){ db = { users: [], members: [], pendingMembers: [], transactions: [] } }
if(!db.members) db.members = [];
if(!db.pendingMembers) db.pendingMembers = [];
if(!db.transactions) db.transactions = [];
if(!db.users) db.users = [];
function saveDB(){ fs.writeFileSync('database.json', JSON.stringify(db,null,2)); }
function parseBodySafe(body){ if(!body || !body.trim()) return null; try{ return JSON.parse(body); }catch(e){ return null; } }
function recalcMemberLoan(memberId){
  let m = db.members.find(x=>String(x.member_no||x.id||x.memberNo)===String(memberId));
  if(!m) return;
  let txs = (db.transactions||[]).filter(t=>String(t.memberId)===String(memberId));
  let loanSum=0, repaySum=0;
  txs.forEach(t=>{ let ty=(t.type||'').toLowerCase(); if(ty.includes('repay')) repaySum+=Number(t.amount||0); else if(ty.includes('loan')) loanSum+=Number(t.amount||0); });
  let bal=Math.max(0, loanSum-repaySum); m.loan=bal; m.loanBalance=bal;
}
const server = http.createServer((req,res)=>{
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){ res.writeHead(204); return res.end(); }
  if(req.method==='GET'){
    let filePath = pathname === '/' ? '/public/index.html' : '/public' + pathname;
    if(pathname === '/settings.html') filePath = '/public/settings.html';
    if(pathname === '/dashboard.html') filePath = '/public/dashboard.html';
    filePath = path.join(__dirname, filePath);
    if(fs.existsSync(filePath)){
      const ext = path.extname(filePath);
      const type = ext==='.html'?'text/html':ext==='.js'?'text/javascript':ext==='.json'?'application/json':'text/plain';
      res.writeHead(200,{'Content-Type':type});
      return res.end(fs.readFileSync(filePath));
    }
  }
  if(pathname==='/api/members' && req.method==='GET'){ res.writeHead(200,{'Content-Type':'application/json'}); return res.end(JSON.stringify(db.members)); }
  if(pathname==='/api/pending-members' && req.method==='GET'){ res.writeHead(200,{'Content-Type':'application/json'}); return res.end(JSON.stringify(db.pendingMembers)); }
  if(pathname==='/api/register' && req.method==='POST'){
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
      const data = JSON.parse(body);
      const id = 'M' + (200 + db.members.length + db.pendingMembers.length + 1);
      const newPending = { id, ...data, status:'pending', date: new Date().toISOString() };
      db.pendingMembers.push(newPending); saveDB();
      res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({message:'Registered - waiting admin approval', member:newPending}));
    }); return;
  }
  if(pathname==='/api/approve-member' && req.method==='POST'){
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
      const data = parseBodySafe(body);
      if(!data || !data.id){ res.writeHead(400,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Missing id'})); }
      const idx = db.pendingMembers.findIndex(m=>m.id===data.id);
      if(idx>=0){ const member = db.pendingMembers[idx]; member.status='approved'; db.members.push(member); db.pendingMembers.splice(idx,1); saveDB(); res.writeHead(200,{'Content-Type':'application/json'}); return res.end(JSON.stringify({message:'Member approved - now in 223 list'})); }
      res.writeHead(404); res.end(JSON.stringify({error:'Not found'}));
    }); return;
  }
  if(pathname.startsWith('/api/transactions') && req.method==='GET'){
    const memberId = parsed.query.memberId; let txs = db.transactions || [];
    if(memberId) txs = txs.filter(t=>String(t.memberId)===String(memberId));
    res.writeHead(200,{'Content-Type':'application/json'}); return res.end(JSON.stringify(txs));
  }
  if(pathname === '/api/transaction' && req.method==='POST'){
    let body=''; req.on('data',chunk=>body+=chunk); req.on('end',()=>{
      try{
        const b = JSON.parse(body);
        const {memberId, amount, type, desc} = b;
        const tx = { id: Date.now(), memberId: String(memberId), amount: Number(amount), type: type, desc: desc||'', date: b.date||new Date().toISOString(), loanType: b.loanType||'', member_no: b.member_no||memberId, principal: b.principal||Number(amount), totalToRepay: b.totalToRepay||null };
        db.transactions.push(tx);
        const m = db.members.find(x=>String(x.member_no||x.id||x.memberNo)===String(memberId));
        if(m){
  let t=(type||'').toLowerCase();
  let amt = Number(amount||0);
  let cur = Number(m.savings ?? m.balance ?? 0);
  if(t==='deposit' || t==='saving' || t==='savings'){
    cur = cur + amt;
    m.savings=cur; m.balance=cur;
  } else if(t==='withdrawal' || t==='withdraw'){
    cur = Math.max(0, cur - amt);
    m.savings=cur; m.balance=cur;
  } else if(t==='loan'){
    m.loan=(Number(m.loan)||0)+amt; m.loanBalance=m.loan;
  } else if(t==='repayment'||t==='repay'||t==='loan_repayment'){
    m.loan=Math.max(0,(Number(m.loan)||0)-amt); m.loanBalance=m.loan;
  }
}
        saveDB(); res.writeHead(200,{'Content-Type':'application/json'}); return res.end(JSON.stringify({success:true, tx}));
      }catch(e){ res.writeHead(500,{'Content-Type':'application/json'}); return res.end(JSON.stringify({error:e.message})); }
    }); return;
  }
  // --- CLEAR: DELETE ONE LOAN ---
  if(pathname.startsWith('/api/transaction/') && req.method==='DELETE'){
    let id=String(pathname.split('/').pop()); let memberId=String(parsed.query.memberId||'');
    let before=(db.transactions||[]).length;
    db.transactions=(db.transactions||[]).filter(t=>String(t.id)!==id);
    if(memberId) recalcMemberLoan(memberId); else { let all=new Set((db.transactions||[]).map(t=>t.memberId)); all.forEach(mid=>recalcMemberLoan(mid)); }
    saveDB(); res.writeHead(200,{'Content-Type':'application/json'}); return res.end(JSON.stringify({ok:true, deleted: before-db.transactions.length}));
  }
  // --- CLEAR: ALL LOANS FOR ONE MEMBER ---
  if(pathname==='/api/clear-loans' && req.method==='POST'){
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{ let d=parseBodySafe(body)||{}; let mid=String(d.memberId||''); db.transactions=(db.transactions||[]).filter(t=>{ if(String(t.memberId)!==mid) return true; let ty=(t.type||'').toLowerCase(); if(ty.includes('loan')||ty.includes('repay')) return false; return true; }); recalcMemberLoan(mid); saveDB(); res.writeHead(200,{'Content-Type':'application/json'}); return res.end(JSON.stringify({ok:true})); }); return;
  }
  // --- CLEAR: ONE TYPE FOR ONE MEMBER ---
  if(pathname==='/api/clear-loans-type' && req.method==='POST'){
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{ let d=parseBodySafe(body)||{}; let mid=String(d.memberId||''); let lt=String(d.loanType||'').toLowerCase(); db.transactions=(db.transactions||[]).filter(t=>{ if(String(t.memberId)!==mid) return true; let hay=((t.type||'')+' '+(t.loanType||'')+' '+(t.desc||'')).toLowerCase(); if((hay.includes('loan')||hay.includes('repay')) && hay.includes(lt)) return false; return true; }); recalcMemberLoan(mid); saveDB(); res.writeHead(200,{'Content-Type':'application/json'}); return res.end(JSON.stringify({ok:true})); }); return;
  }
  if(pathname==='/api/users' && req.method==='GET'){ res.writeHead(200,{'Content-Type':'application/json'}); return res.end(JSON.stringify(db.users)); }
  res.writeHead(404); res.end('Not found');
});
server.listen(3000, ()=>console.log('Server running on http://localhost:3000'));