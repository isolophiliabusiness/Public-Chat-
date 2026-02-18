const userLastMessage = new Map();
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const app = express();

// ===== CONFIG =====
const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const MONGO_URI = process.env.MONGO_URI;

// ===== INIT FOLDERS =====

// ===== HELPERS =====
const deviceId = (req) =>
crypto
.createHash("sha256")
.update(req.socket.remoteAddress + req.headers["user-agent"])
.digest("hex");

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ MongoDB Error:", err));

const messageSchema = new mongoose.Schema({
  room: String,
  user: String,
  text: String,
  time: Number,
  reactions: Object
});

app.set("trust proxy", 1); //extra line added remove this
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "/auth/google/callback"
},
(accessToken, refreshToken, profile, done) => {

  const email = profile.emails[0].value;

  let role = "user";
  if (email === ADMIN_EMAIL) {
    role = "admin";
  }

  const user = {
    id: profile.id,
    email,
    role
  };

  done(null, user);
}));

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});
app.get("/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get("/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/"
  }),
  (req, res) => {
    res.redirect("/");
  }
);

app.get("/logout", (req, res) => {
  req.logout(() => {
    res.redirect("/");
  });
});
function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/auth/google");
}

const Message = mongoose.model("Message", messageSchema);

/* ===== HTTP SERVER =====
const httpServer = http.createServer((req, res) => {
let filePath = req.url === "/" ? "/index.html" : req.url;
const fullPath = path.join(__dirname, filePath);

fs.readFile(fullPath, (err, data) => {
if (err) {
res.writeHead(404);
return res.end("404 Not Found");
}
res.writeHead(200);
res.end(data);
});
});*/
app.get("/", ensureAuth, (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

app.use(express.static(__dirname));

const server = require("http").createServer(app);

// ===== WEBSOCKET =====
const wss = new WebSocket.Server({ server });
const sockets = new Map();
const onlineUsers = new Set();

function emitOnlineUsers() {
  const data = JSON.stringify({
    type: "online-users",
    count: onlineUsers.size,
  });

  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(data);
  });
}
wss.on("connection", async (ws, req) => {
  const id = deviceId(req);
  sockets.set(ws, { id, room: "public" });
  onlineUsers.add(id);
  emitOnlineUsers();

  ws.on("message", async (raw) => {
    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    const userData = sockets.get(ws);
    if (!userData) return;

    const id = userData.id;

    // ===== JOIN =====
    if (data.type === "join") {
      userData.room = data.room || "public";
      sockets.set(ws, userData);
      return;
    }

    // ===== CHAT =====
    if (data.type === "chat") {
      if (!data.text) return;

      const room = userData.room;
      const now = Date.now();
      const lastTime = userLastMessage.get(id) || 0;

      if (now - lastTime < 1000) return;
      userLastMessage.set(id, now);

      const message = new Message({
        room,
        user: data.user || "Guest",
        text: data.text,
        time: now,
        reactions: {}
      });

      await message.save();

      wss.clients.forEach((client) => {
        const clientData = sockets.get(client);
        if (!clientData) return;
        if (clientData.room !== room) return;

        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: "chat",
            room,
            msg: message
          }));
        }
      });

      return;
    }

    // ===== HISTORY =====
    if (data.type === "history") {
      const room = data.room || "public";

      const messages = await Message.find({ room })
        .sort({ time: 1 })
        .limit(500);

      ws.send(JSON.stringify({
        type: "history",
        room,
        messages
      }));

      return;
    }

    // ===== REACTION =====
    if (data.type === "react") {
      const room = data.room || "public";

      const msg = await Message.findOne({ room, time: data.time });
      if (!msg) return;

      msg.reactions = msg.reactions || {};
      msg.reactions[data.emoji] =
        (msg.reactions[data.emoji] || 0) + 1;

      await msg.save();

      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: "chat-update",
            room,
            msg
          }));
        }
      });

      return;
    }
  });

  ws.on("close", () => {
    const userData = sockets.get(ws);
    if (!userData) return;

    const id = userData.id;
    sockets.delete(ws);

    let stillConnected = false;
    for (let value of sockets.values()) {
      if (value.id === id) {
        stillConnected = true;
        break;
      }
    }

    if (!stillConnected) {
      onlineUsers.delete(id);
    }

    emitOnlineUsers();
  });
});

// ===== START =====
server.listen(PORT, () => {
console.log("🔥 Chat Server Running on Port " + PORT);
});

