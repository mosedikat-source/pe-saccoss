const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- THIS FIXES NOT FOUND ---
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));
// -----------------------------

const DB_FILE = path.join(__dirname, 'database.json');

// Load DB or create empty
let db = { members: [], loans: [], repayments: [], users: [] };
if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!db.members) db.members = [];
    if (!db.loans) db.loans = [];
    if (!db.repayments) db.repayments = [];
    if (!db.users) db.users = [];
  } catch (e) { console.log('DB read error, using empty'); }
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// --- API ROUTES ---

// Get all data
app.get('/api/members', (req, res) => res.json(db.members));
app.get('/api/loans', (req, res) => res.json(db.loans));
app.get('/api/repayments', (req, res) => res.json(db.repayments));
app.get('/api/dashboard', (req, res) => res.json(db));

// Add member
app.post('/api/members', (req, res) => {
  const m = { id: Date.now(), ...req.body };
  db.members.push(m);
  saveDB();
  res.json({ success: true, member: m });
});

// Add loan
app.post('/api/loans', (req, res) => {
  const l = { id: Date.now(), status: 'Active', ...req.body };
  db.loans.push(l);
  saveDB();
  res.json({ success: true, loan: l });
});

// Member pays loan -> Pending approval
app.post('/api/repay', (req, res) => {
  const r = { id: Date.now(), status: 'Pending', date: new Date().toISOString(), ...req.body };
  db.repayments.push(r);
  saveDB();
  res.json({ success: true, repayment: r });
});

// Admin approves repayment
app.post('/api/approve-repayment', (req, res) => {
  const { id } = req.body;
  const rep = db.repayments.find(x => x.id == id);
  if (!rep) return res.json({ success: false, message: 'Not found' });
  rep.status = 'Approved';
  // Reduce loan balance
  const loan = db.loans.find(l => l.id == rep.loanId || l.id == rep.loan_id);
  if (loan) {
    loan.balance = (loan.balance || loan.amount || 0) - (rep.amount || 0);
    if (loan.balance <= 0) { loan.balance = 0; loan.status = 'Paid'; }
  }
  saveDB();
  res.json({ success: true });
});

// Reject repayment
app.post('/api/reject-repayment', (req, res) => {
  const { id } = req.body;
  const rep = db.repayments.find(x => x.id == id);
  if (rep) rep.status = 'Rejected';
  saveDB();
  res.json({ success: true });
});

// Login - simple check
app.post('/api/login', (req, res) => {
  const { username, password, role } = req.body;
  // Default admin for testing if no users yet
  if (username === 'admin' && password === 'admin123') {
    return res.json({ success: true, user: { username: 'admin', role: 'admin' } });
  }
  const user = db.users.find(u => u.username === username && u.password === password);
  if (user) return res.json({ success: true, user });
  res.json({ success: false, message: 'Wrong login' });
});

// Fallback - show index.html for any other page
app.get('*', (req, res) => {
  const file = path.join(__dirname, 'index.html');
  if (fs.existsSync(file)) res.sendFile(file);
  else res.send('PE-SACCOS is Live! Add index.html');
});

app.listen(PORT, () => {
  console.log('PE-SACCOS running on port ' + PORT);
});
