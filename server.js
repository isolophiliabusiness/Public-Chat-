const http = require("http");
const https = require("https");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");

// ===== CONFIG =====
const PORT = process.env.PORT || 3000;
const DATA = "./data";
const MSGS = "./data/messages";
const USERS_FILE = DATA + "/users.json";
const ROOMS_FILE = DATA + "/rooms.json";
const ADMIN_FILE = DATA + "/admin.json";
const MAX_PUBLIC_MSGS = 500;
const MAX_PRIVATE_MSGS = 500;
const DELETE_COUNT = 400;
const SSL_DIR = "./ssl";

// ===== INIT FILES & FOLDERS =====
function createFileIfNotExists(filePath, defaultData) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, defaultData);
    console.log(`✅ Created file: ${filePath}`);
  }
}

function createFolderIfNotExists(folderPath) {
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
    console.log(`📁 Created folder: ${folderPath}`);
  }
}

createFolderIfNotExists(DATA);
createFolderIfNotExists(MSGS);
createFolderIfNotExists(SSL_DIR);

createFileIfNotExists(USERS_FILE, "{}");
createFileIfNotExists(ROOMS_FILE, "{}");
createFileIfNotExists(ADMIN_FILE, JSON.stringify({ password: null }, null, 2));

// ===== SELF-GENERATING HTTPS CERT =====
const keyPath = path.join(SSL_DIR, "key.pem");
const certPath = path.join(SSL_DIR, "cert.pem");

let sslOptions = { key: null, cert: null };
let httpsAvailable = false;

function generateSSL(cb) {
  console.log("⚡ Attempting to generate self-signed HTTPS certificate...");
  exec(
    `openssl req -x509 -newkey rsa:2048 -nodes -keyout ${keyPath} -out ${certPath} -days 365 -subj "/CN=localhost"`,
    (err) => {
      if (err) {
        console.warn("⚠ HTTPS not available, falling back to HTTP only.", err);
        httpsAvailable = false;
        cb();
      } else {
        console.log("✅ Self-signed HTTPS certificate created.");
        sslOptions = {
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath),
        };
        httpsAvailable = true;
        cb();
      }
    }
  );
}

// ===== HELPERS =====
const readJSON = (f) => JSON.parse(fs.readFileSync(f));
const writeJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));
const deviceId = (req) =>
  crypto
    .createHash("sha256")
    .update(req.socket.remoteAddress + req.headers["user-agent"])
    .digest("hex");
const roomFile = (r) =>
  MSGS + "/" + (r.startsWith("private_") ? r + ".json" : r === "public" ? "public.json" : `room_${r}.json`);
const loadMsgs = (r) => {
  if (!fs.existsSync(roomFile(r))) fs.writeFileSync(roomFile(r), "[]");
  return readJSON(roomFile(r));
};
const saveMsgs = (r, msgs) => {
  const limit = r.startsWith("private_") ? MAX_PRIVATE_MSGS : MAX_PUBLIC_MSGS;
  if (msgs.length > limit) msgs = msgs.slice(-limit + (limit - DELETE_COUNT));
  writeJSON(roomFile(r), msgs);
  if (msgs.length % 50 === 0)
    console.log(`💬 Room "${r}" reached ${msgs.length} messages`);
  return msgs;
};

// ===== SERVERS =====
const httpServer = http.createServer((req, res) => {
  const f = req.url === "/" ? "/index.html" : req.url;
  if (f.startsWith("/admin-dashboard")) {
    fs.readFile(path.join(__dirname, "admin-dashboard.html"), (e, d) => {
      if (e) return res.end("404");
      res.end(d);
    });
    return;
  }
  fs.readFile(path.join(__dirname, f), (e, d) => {
    if (e) return res.end("404");
    res.end(d);
  });
});

let httpsServer = null;

// ===== WEBSOCKET =====
const wss = new WebSocket.Server({ server: httpServer });
const sockets = new Map();

function emitOnlineUsers() {
  const data = JSON.stringify({ type: "online-users", count: wss.clients.size });
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(data);
  });
}

// ===== ADMIN =====
let adminData = readJSON(ADMIN_FILE);

// ===== CONNECTION LOGIC =====
function setupWebSocket() {
  wss.on("connection", (ws, req) => {
    const dId = deviceId(req);
    const users = readJSON(USERS_FILE);
    const rooms = readJSON(ROOMS_FILE);

    if (!users[dId]) {
      users[dId] = {
        id: crypto.randomUUID(),
        name: null,
        nameChanges: 0,
        admin: Object.keys(users).length === 0,
        banned: false,
        muted: false,
        adminLoggedIn: Object.keys(users).length === 0,
      };
      writeJSON(USERS_FILE, users);
      console.log(`🆕 New user created: ${dId}`);
    }

    const user = users[dId];
    if (user.banned) return ws.close();
    sockets.set(ws, dId);
    ws.send(JSON.stringify({ type: "me", user }));
    emitOnlineUsers();

    ws.on("message", (raw) => {
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }
      const users = readJSON(USERS_FILE);
      const rooms = readJSON(ROOMS_FILE);
      const user = users[dId];

      // ---- USERNAME ----
      if (data.type === "set-name") {
        if (user.name && user.nameChanges >= 1) return;
        user.name = data.name;
        user.nameChanges++;
        writeJSON(USERS_FILE, users);
      }
     // ---- CREATE ROOM (PRIVATE OR PUBLIC) ----
  if (data.type === "create-room") {
    if (!rooms[data.room]) {
      rooms[data.room] = {
        password: data.password || null,
        members: [dId] // creator automatically member
      };
      writeJSON(ROOMS_FILE, rooms);
    }
  }
    // ---- INVITE TO ROOM ----
  if (data.type === "invite") {
    const room = rooms[data.room];
    const targetId = Object.keys(users).find(id => users[id].id === data.toId);
    if (!room || !targetId) return;
    if (!room.members.includes(dId)) return; // sirf room member invite kar sakta hai
    if (!room.members.includes(targetId)) room.members.push(targetId);
    writeJSON(ROOMS_FILE, rooms);

    // Notify invited user if online
    sockets.forEach((sid, wsClient) => {
      if (sid === targetId && wsClient.readyState === WebSocket.OPEN) {
        wsClient.send(JSON.stringify({
          type: "system",
          msg: `📨 You have been invited to join room "${data.room}" by ${user.name}`
        }));
      }
    });
  }
    // ---- ROOM-BASED CHAT ----
  if (data.type === "chat") {
    if (!user.name || user.muted) return;
    const roomName = data.room || "public";
    const room = rooms[roomName] || { members: [] };
    if (room.password && room.password !== data.password) return;
    if (roomName !== "public" && !room.members.includes(dId)) return; // member check

    let msgs = loadMsgs(roomName);
    msgs.push({ user: user.name, text: data.text, time: Date.now() });
    msgs = saveMsgs(roomName, msgs);

    // Broadcast only to room members
    wss.clients.forEach(c => {
      const sid = sockets.get(c);
      if (sid && (roomName === "public" || room.members.includes(sid))) {
        if (c.readyState === WebSocket.OPEN) {
          c.send(JSON.stringify({ type: roomName === "public" ? "chat" : "private-chat", room: roomName, msg: msgs.at(-1) }));
        }
      }
    });
  } 
     
// ---- HISTORY ----
  if (data.type === "history") {
    const roomName = data.room || "public";
    ws.send(JSON.stringify({ type: "history", room: roomName, messages: loadMsgs(roomName) }));
  }

      // ---- REACTIONS / LIKES ----
      if (data.type === "react") {
        const room = data.room || "public";
        const msgs = loadMsgs(room);
        const msg = msgs.find((m) => m.time === data.time && m.user === data.user);
        if (msg) {
          msg.reactions = msg.reactions || {};
          msg.reactions[data.emoji] = msg.reactions[data.emoji] || 0;
          msg.reactions[data.emoji]++;
          saveMsgs(room, msgs);
          wss.clients.forEach((c) => {
            if (c.readyState === WebSocket.OPEN)
              c.send(JSON.stringify({ type: "chat-update", room, msg }));
          });
        }
      }
     // ---- EXISTING ADMIN LOGIN & ACTIONS (UNCHANGED) ----
  if (data.type === "admin-login") {
    if (!adminData.password) return;
    const hash = crypto.createHash("sha256").update(data.password).digest("hex");
    if (hash === adminData.password) {
      users[dId].admin = true;
      users[dId].adminLoggedIn = true;
      writeJSON(USERS_FILE, users);
      ws.send(JSON.stringify({ type: "system", msg: "Admin login successful 😎" }));
    } else ws.send(JSON.stringify({ type: "system", msg: "❌ Wrong admin password" }));
  }

  if (user.admin && user.adminLoggedIn) {
    if (data.type === "ban" && users[data.target]) {
      users[data.target].banned = true;
      writeJSON(USERS_FILE, users);
    }
    if (data.type === "mute" && users[data.target]) {
      users[data.target].muted = true;
      writeJSON(USERS_FILE, users);
    }
    if (data.type === "unmute" && users[data.target]) {
      users[data.target].muted = false;
      writeJSON(USERS_FILE, users);
    }
    if (data.type === "delete-room" && rooms[data.room]) {
      delete rooms[data.room];
      writeJSON(ROOMS_FILE, rooms);
    }
    if (data.type === "dashboard") {
      ws.send(JSON.stringify({
        type: "dashboard",
        onlineUsers: wss.clients.size,
        totalUsers: Object.keys(users).length,
        rooms: Object.keys(rooms),
        users: Object.values(users),

            })
          );
        }
      }
    });

    ws.on("close", () => {
      sockets.delete(ws);
      emitOnlineUsers();
    });
  });
}

// ===== START SERVERS =====
function startServer() {
  httpServer.listen(PORT, () => {
    console.log("🔥 CHAT SERVER RUNNING on port " + PORT);
  });

  setupWebSocket();
}
// ===== CHECK HTTPS =====
startServer();


