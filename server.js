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
  servers: [
    {
      id: "srv-bakbak",
      name: "BakBak HQ",
      icon: "B",
      privacy: "public",
      roles: ["Owner", "Admin", "Moderator", "Member"],
      channels: [
        { id: "ch-general", name: "general", type: "text", topic: "Real-time public chat" },
        { id: "ch-announcements", name: "announcements", type: "announcement", topic: "Pinned launches and updates" },
        { id: "ch-forum", name: "forum", type: "forum", topic: "Q&A and longer discussions" },
        { id: "ch-voice", name: "voice-room", type: "voice", topic: "Low-latency voice room placeholder" },
        { id: "ch-video", name: "video-stage", type: "video", topic: "Group video and screen share placeholder" }
      ]
    }
  ],
  chats: [
    { id: "dm-u-admin-u-mira", type: "dm", name: "Mira", members: ["u-admin", "u-mira"] },
    { id: "grp-design", type: "group", name: "Design Squad", members: ["u-admin", "u-mira"] }
  ],
  messages: [
    {
      id: "msg-welcome",
      channelId: "ch-general",
      authorId: "u-mira",
      text: "Welcome to BakBak. Drop links, images, videos, docs, stickers, GIFs, or start a thread.",
      createdAt: Date.now() - 600000,
      reactions: [{ emoji: "🔥", count: 3 }],
      pinned: true,
      replies: []
    },
    {
      id: "msg-roadmap",
      channelId: "ch-announcements",
      authorId: "u-admin",
      text: "Core realtime chat, channels, previews, uploads, PWA, responsive UI, moderation panels, and smart feature surfaces are live in this build.",
      createdAt: Date.now() - 300000,
      reactions: [{ emoji: "✅", count: 5 }],
      pinned: true,
      replies: []
    }
  ],
  events: [
    { id: "evt-launch", title: "BakBak launch check", startsAt: "Today 8:00 PM", channel: "general" }
  ],
  polls: [
    { id: "poll-ui", question: "Favorite default theme?", options: ["Green", "Blue", "Purple"], votes: [6, 4, 3] }
  ],
  auditLogs: []
};

function readDb() {
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(starterDb, null, 2));
  }
  return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
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
  res.json({ ok: true, name: "BakBak", realtime: true });
});

app.get("/api/state", (_req, res) => {
  res.json(readDb());
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
    channelId: payload.channelId || "ch-general",
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
