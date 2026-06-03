const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(helmet());
app.use(express.json({ limit: '50mb' })); // Support for larger profile pictures
app.use(express.static(__dirname));

// Server-side at-rest encryption key (AES-256-GCM)
const SERVER_KEY = crypto.scryptSync(process.env.ENCRYPTION_KEY || 'bakbak-secret-key-2026', 'salt', 32);

function encryptAESGCM(text) {
    if (!text) return text;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', SERVER_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptAESGCM(encStr) {
    if (!encStr) return encStr;
    try {
        const parts = encStr.split(':');
        if (parts.length !== 3) return encStr;
        const [ivHex, authTagHex, encryptedHex] = parts;
        const decipher = crypto.createDecipheriv('aes-256-gcm', SERVER_KEY, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch(e) {
        return encStr; // return raw if not encrypted
    }
}

const usersDb = new sqlite3.Database('users.sql');
const dataDb = new sqlite3.Database('data.sql');

usersDb.serialize(() => {
    usersDb.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT,
        displayName TEXT,
        pfp TEXT
    )`);
    usersDb.run(`CREATE TABLE IF NOT EXISTS friends (
        userId TEXT,
        friendId TEXT,
        UNIQUE(userId, friendId)
    )`);
});

dataDb.serialize(() => {
    dataDb.run(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        channelId TEXT,
        authorId TEXT,
        text TEXT,
        createdAt INTEGER
    )`);
});

// Authentication System
app.post('/api/auth', (req, res) => {
    const { username, password, displayName, action } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    
    const passHash = crypto.createHash('sha256').update(password).digest('hex');
    
    if (action === 'register') {
        const id = 'u-' + crypto.randomUUID().slice(0,8);
        const encName = encryptAESGCM(displayName || username);
        const encPfp = encryptAESGCM('');
        usersDb.run(`INSERT INTO users (id, username, password, displayName, pfp) VALUES (?, ?, ?, ?, ?)`,
            [id, username, passHash, encName, encPfp], function(err) {
                if (err) return res.status(400).json({ error: 'Username taken. Try another.' });
                res.json({ id, username, displayName: displayName || username, pfp: '' });
        });
    } else {
        usersDb.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, passHash], (err, row) => {
            if (err || !row) return res.status(401).json({ error: 'Invalid credentials' });
            res.json({ id: row.id, username: row.username, displayName: decryptAESGCM(row.displayName), pfp: decryptAESGCM(row.pfp) });
        });
    }
});

// Friend/Contact System
app.post('/api/friends/add', (req, res) => {
    const { userId, friendUsername } = req.body;
    usersDb.get(`SELECT id FROM users WHERE username = ?`, [friendUsername], (err, friend) => {
        if (err || !friend) return res.status(404).json({ error: 'User not found' });
        usersDb.run(`INSERT OR IGNORE INTO friends (userId, friendId) VALUES (?, ?)`, [userId, friend.id], () => {
            usersDb.run(`INSERT OR IGNORE INTO friends (userId, friendId) VALUES (?, ?)`, [friend.id, userId], () => {
                res.json({ success: true, friendId: friend.id });
            });
        });
    });
});

app.get('/api/friends/:userId', (req, res) => {
    usersDb.all(`SELECT u.id, u.username, u.displayName, u.pfp FROM users u JOIN friends f ON u.id = f.friendId WHERE f.userId = ?`, [req.params.userId], (err, rows) => {
        if (err) return res.json([]);
        res.json(rows.map(r => ({ ...r, displayName: decryptAESGCM(r.displayName), pfp: decryptAESGCM(r.pfp) })));
    });
});

// PFP Upload System
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
app.post('/api/pfp/:userId', upload.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    usersDb.run(`UPDATE users SET pfp = ? WHERE id = ?`, [encryptAESGCM(base64), req.params.userId], () => {
        res.json({ success: true, pfp: base64 });
    });
});

// Get Messages
app.get('/api/messages/:channelId', (req, res) => {
    dataDb.all(`SELECT * FROM messages WHERE channelId = ? ORDER BY createdAt ASC LIMIT 200`, [req.params.channelId], (err, rows) => {
        if (err) return res.json([]);
        // Decrypt the server-side at-rest encryption layer before sending to client
        res.json(rows.map(r => ({ ...r, text: decryptAESGCM(r.text) })));
    });
});

// Real-Time Socket
io.on('connection', (socket) => {
    socket.on('join', (userId) => {
        if(userId) socket.join(userId);
    });
    
    socket.on('sendMessage', (msg) => {
        // msg.text is already client-side E2EE encrypted. We wrap it again At-Rest.
        const encText = encryptAESGCM(msg.text); 
        dataDb.run(`INSERT INTO messages (id, channelId, authorId, text, createdAt) VALUES (?, ?, ?, ?, ?)`,
            [msg.id, msg.channelId, msg.authorId, encText, msg.createdAt]);
        
        const ids = msg.channelId.split('_');
        const targetId = ids.find(id => id !== msg.authorId);
        
        // Emitting the msg directly, which retains the Client-Side E2EE layer unmodified
        if (targetId) io.to(targetId).emit('receiveMessage', msg);
        io.to(msg.authorId).emit('receiveMessage', msg);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`BakBak server running on port ${PORT}`);
});