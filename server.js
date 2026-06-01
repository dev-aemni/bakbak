const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const multer = require("multer");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || "*" }
});

const root = __dirname;
const dataDir = path.join(root, "data");
const uploadDir = path.join(root, "uploads");
const dbPath = path.join(dataDir, "bakbak.json");

for (const dir of [dataDir, uploadDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const starterDb = {
  users: [
    {
      id: "u-admin",
      username: "aemni",
      displayName: "Aemni",
      avatar: "A",
      bio: "Building BakBak.",
      status: "online",
      theme: "#00a884",
      role: "Owner"
    },
    {
      id: "u-mira",
      username: "mira",
      displayName: "Mira",
      avatar: "M",
      bio: "Community moderator.",
      status: "online",
      theme: "#7c3aed",
      role: "Moderator"
    }
  ],
  chats: [
    { id: "dm-u-admin-u-mira", type: "dm", name: "Mira", members: ["u-admin", "u-mira"] }
  ],
  messages: [
    {
      id: "msg-welcome",
      channelId: "dm-u-admin-u-mira",
      authorId: "u-mira",
      text: "Welcome to BakBak DMs. Open any person by user ID and start a private chat.",
      createdAt: Date.now() - 600000,
      reactions: [{ emoji: "🔥", count: 3 }],
      pinned: true,
      replies: []
    }
  ],
  auditLogs: []
};

const idPattern = /^u-[a-z0-9][a-z0-9_-]{1,28}$/;

function readDb() {
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(starterDb, null, 2));
  }
  const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  const normalized = normalizeDb(db);
  if (normalized.changed) writeDb(normalized.db);
  return normalized.db;
}

function writeDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function normalizeDb(db) {
  let changed = false;
  if (!Array.isArray(db.users)) {
    db.users = starterDb.users;
    changed = true;
  }
  for (const key of ["servers", "events", "polls"]) {
    if (key in db) {
      delete db[key];
      changed = true;
    }
  }

  if (!Array.isArray(db.chats)) {
    db.chats = [];
    changed = true;
  }
  const dmChats = db.chats.filter(chat => chat.type === "dm");
  if (dmChats.length !== db.chats.length) {
    db.chats = dmChats;
    changed = true;
  }

  const defaultDm = getOrCreateDm(db, "u-admin", "u-mira");
  if (!Array.isArray(db.messages)) {
    db.messages = [];
    changed = true;
  }
  for (const message of db.messages) {
    if (!db.chats.some(chat => chat.id === message.channelId) && defaultDm) {
      message.channelId = defaultDm.id;
      changed = true;
    }
  }
  return { db, changed };
}

function dmIdFor(a, b) {
  return `dm-${[a, b].sort().join("-")}`;
}

function getOrCreateDm(db, me, userId) {
  const meUser = db.users.find(item => item.id === me);
  if (!meUser) return null;
  const user = db.users.find(item => item.id === userId);
  if (!user) return null;
  const id = dmIdFor(me, userId);
  let chat = db.chats.find(item => item.id === id);
  if (!chat) {
    chat = { id, type: "dm", name: user.displayName, members: [me, userId] };
    db.chats.push(chat);
  }
  return chat;
}

function cleanUserId(value) {
  const raw = String(value || "").trim().toLowerCase();
  const withPrefix = raw.startsWith("u-") ? raw : `u-${raw}`;
  return withPrefix.replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 30);
}

function makeAvatar(displayName, username) {
  return String(displayName || username || "?").trim().charAt(0).toUpperCase() || "?";
}

function randomTheme(seed) {
  const colors = ["#00a884", "#53bdeb", "#f59e0b", "#ef4444", "#14b8a6", "#8b5cf6", "#f97316"];
  const hash = crypto.createHash("sha1").update(seed).digest()[0];
  return colors[hash % colors.length];
}

function safeName(name) {
  return name.replace(/[^a-z0-9._-]/gi, "_").toLowerCase();
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}-${crypto.randomBytes(5).toString("hex")}-${safeName(file.originalname)}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("tiny"));
app.use("/uploads", express.static(uploadDir));
app.use(express.static(root, { index: false }));

app.get("/", (_req, res) => {
  res.sendFile(path.join(root, "index.html"));
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "BakBak", realtime: true, mode: "dm" });
});

app.get("/api/state", (_req, res) => {
  res.json(readDb());
});

app.post("/api/accounts", (req, res) => {
  const db = readDb();
  const username = String(req.body.username || "").trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "");
  const displayName = String(req.body.displayName || username || "").trim().slice(0, 40);
  const requestedId = cleanUserId(req.body.id || username || displayName);

  if (!username || username.length < 2) return res.status(400).json({ error: "Username must be at least 2 characters." });
  if (!displayName) return res.status(400).json({ error: "Display name is required." });
  if (!idPattern.test(requestedId)) return res.status(400).json({ error: "User ID must look like u-name and use letters, numbers, _ or -." });
  if (db.users.some(user => user.id === requestedId)) return res.status(409).json({ error: `User ID ${requestedId} is already taken.` });
  if (db.users.some(user => user.username === username)) return res.status(409).json({ error: `Username ${username} is already taken.` });

  const user = {
    id: requestedId,
    username,
    displayName,
    avatar: makeAvatar(displayName, username),
    bio: "",
    status: "online",
    theme: randomTheme(requestedId),
    role: "Member"
  };
  db.users.push(user);
  db.auditLogs.unshift({
    id: crypto.randomUUID(),
    action: "account.create",
    actorId: user.id,
    targetId: user.id,
    at: Date.now()
  });
  writeDb(db);
  io.emit("account:new", user);
  res.status(201).json({ user });
});

app.post("/api/dm", (req, res) => {
  const db = readDb();
  const me = String(req.body.me || "u-admin");
  const userId = String(req.body.userId || "").trim();
  const meUser = db.users.find(user => user.id === me);
  const user = db.users.find(item => item.id === userId);

  if (!meUser) return res.status(400).json({ error: "Current user not found" });
  if (!user) return res.status(404).json({ error: `No user found with ID ${userId}` });
  if (user.id === me) return res.status(400).json({ error: "Pick another user's ID" });

  const chat = getOrCreateDm(db, me, user.id);
  writeDb(db);
  res.json({ chat, user });
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const mime = req.file.mimetype || "application/octet-stream";
  const type = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "document";
  res.json({
    id: crypto.randomUUID(),
    name: req.file.originalname,
    url: `/uploads/${req.file.filename}`,
    mime,
    type,
    size: req.file.size
  });
});

app.post("/api/messages", (req, res) => {
  const db = readDb();
  const channel = db.chats.find(chat => chat.id === req.body.channelId);
  if (!channel) return res.status(404).json({ error: "Chat not found" });
  if (!channel.members.includes(req.body.authorId)) return res.status(403).json({ error: "Author is not a member of this chat" });
  const message = createMessage(req.body);
  db.messages.push(message);
  db.auditLogs.unshift({
    id: crypto.randomUUID(),
    action: "message.create",
    actorId: message.authorId,
    targetId: message.id,
    at: Date.now()
  });
  writeDb(db);
  io.to(message.channelId).emit("message:new", message);
  res.status(201).json(message);
});

function createMessage(payload) {
  return {
    id: crypto.randomUUID(),
    channelId: payload.channelId || "dm-u-admin-u-mira",
    authorId: payload.authorId || "u-admin",
    text: String(payload.text || "").slice(0, 4000),
    attachments: payload.attachments || [],
    preview: payload.preview || null,
    replyTo: payload.replyTo || null,
    forwarded: Boolean(payload.forwarded),
    createdAt: Date.now(),
    editedAt: null,
    deletedAt: null,
    reactions: [],
    pinned: false,
    replies: []
  };
}

io.on("connection", socket => {
  socket.emit("presence", { id: socket.id, status: "online" });

  socket.on("channel:join", channelId => {
    socket.join(channelId);
  });

  socket.on("typing", data => {
    socket.to(data.channelId).emit("typing", data);
  });

  socket.on("message:create", payload => {
    const db = readDb();
    const channel = db.chats.find(chat => chat.id === payload.channelId);
    if (!channel || !channel.members.includes(payload.authorId)) return;
    const message = createMessage(payload);
    db.messages.push(message);
    writeDb(db);
    io.to(message.channelId).emit("message:new", message);
  });

  socket.on("message:edit", ({ id, text }) => {
    const db = readDb();
    const message = db.messages.find(item => item.id === id);
    if (!message || message.deletedAt) return;
    message.text = String(text || "").slice(0, 4000);
    message.editedAt = Date.now();
    writeDb(db);
    io.to(message.channelId).emit("message:updated", message);
  });

  socket.on("message:delete", ({ id }) => {
    const db = readDb();
    const message = db.messages.find(item => item.id === id);
    if (!message) return;
    message.deletedAt = Date.now();
    writeDb(db);
    io.to(message.channelId).emit("message:updated", message);
  });

  socket.on("message:react", ({ id, emoji }) => {
    const db = readDb();
    const message = db.messages.find(item => item.id === id);
    if (!message || !emoji) return;
    const reaction = message.reactions.find(item => item.emoji === emoji);
    if (reaction) reaction.count += 1;
    else message.reactions.push({ emoji, count: 1 });
    writeDb(db);
    io.to(message.channelId).emit("message:updated", message);
  });

  socket.on("message:pin", ({ id }) => {
    const db = readDb();
    const message = db.messages.find(item => item.id === id);
    if (!message) return;
    message.pinned = !message.pinned;
    writeDb(db);
    io.to(message.channelId).emit("message:updated", message);
  });
});

server.listen(PORT, () => {
  console.log(`BakBak server running on http://localhost:${PORT}`);
});
