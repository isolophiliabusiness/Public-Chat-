// ====== REALTIME CHAT SERVER (HARDENED ORIGINAL VERSION) ======

const userLastMessage = new Map();
const WebSocket = require("ws");
const crypto = require("crypto");
const mongoose = require("mongoose");
require("dotenv").config();
const sanitizeHtml = require("sanitize-html");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const MongoStore = require("connect-mongo").default;

const express = require("express");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const app = express();
app.use(helmet());

/* ================= RATE LIMIT ================= */
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

/* ================= CONFIG ================= */
const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const MONGO_URI = process.env.MONGO_URI;

if (!process.env.SESSION_SECRET) {
  console.error("❌ SESSION_SECRET missing");
  process.exit(1);
}

if (!MONGO_URI) {
  console.error("❌ MONGO_URI missing");
  process.exit(1);
}

/* ================= DEVICE ID ================= */
const deviceId = (req) =>
  crypto
    .createHash("sha256")
    .update(
      (req.headers["x-forwarded-for"] || req.socket.remoteAddress) +
        req.headers["user-agent"]
    )
    .digest("hex");

/* ================= MONGODB ================= */
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => {
    console.error("❌ MongoDB Error:", err);
    process.exit(1);
  });

/* ================= MESSAGE MODEL ================= */
const messageSchema = new mongoose.Schema({
  room: { type: String, required: true },
  user: { type: String, required: true },
  text: { type: String, required: true, maxlength: 500 },
  time: { type: Number, index: true },
  reactions: { type: Map, of: [String], default: {} },
  status: { type: String, default: "server" },
});

messageSchema.index({ room: 1, time: 1 });

const Message = mongoose.model("Message", messageSchema);

/* ================= SESSION ================= */
app.set("trust proxy", 1);

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: MONGO_URI,
    ttl: 14 * 24 * 60 * 60,
  }),
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite:
      process.env.NODE_ENV === "production" ? "none" : "lax",
  },
});

app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

/* ================= GOOGLE AUTH ================= */
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/auth/google/callback",
    },
    (accessToken, refreshToken, profile, done) => {
      const email = profile.emails?.[0]?.value;
      if (!email) return done(null, false);

      let role = "user";
      if (email === ADMIN_EMAIL) role = "admin";

      const user = {
        id: profile.id,
        email,
        role,
      };

      done(null, user);
    }
  )
);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => res.redirect("/")
);

app.get("/logout", (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.redirect("/");
    });
  });
});

function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect("/auth/google");
}

app.get("/", ensureAuth, (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

app.use(express.static(__dirname));

const server = require("http").createServer(app);

/* ================= WEBSOCKET ================= */
const wss = new WebSocket.Server({
  server,
  maxPayload: 1024 * 8,
});

/* ================= HEARTBEAT ================= */
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

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

wss.on("connection", (ws, req) => {
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

/*  sessionMiddleware(req, {}, async () => {
    if (!req.session?.passport?.user) {
      ws.close();
      return;
    }*/
sessionMiddleware(req, {}, () => {

  passport.initialize()(req, {}, () => {
    passport.session()(req, {}, () => {

      if (!req.user) {
        ws.close();
        return;
      }

    ws.send(
      JSON.stringify({
        type: "me",
        //email: req.session.passport.user.email,
     email: req.user.email, 
})
    );

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
      const room = userData.room;

      /* ===== JOIN ===== */
      if (data.type === "join") {
        userData.room = data.room || "public";
        sockets.set(ws, userData);
        return;
      }

      /* ===== CHAT ===== */
      if (data.type === "chat") {
        if (!data.text?.trim()) return;
        if (data.text.length > 500) return;

        const now = Date.now();
        const lastTime = userLastMessage.get(id) || 0;
        if (now - lastTime < 1000) return;
        userLastMessage.set(id, now);

        const cleanText = sanitizeHtml(data.text.trim(), {
          allowedTags: [],
          allowedAttributes: {},
        });

        //const userEmail = req.session.passport.user.email;
//const userEmail = req.user?.email;
const userEmail = req.user.email;

/*if (!userEmail) {
  console.log("⚠️ Missing user email in WS");
  return;
}*/
        const message = new Message({
          room,
          user: userEmail,
          text: cleanText,
          time: now,
          reactions: {},
          status: "server",
        });

        await message.save();

        wss.clients.forEach((client) => {
          const clientData = sockets.get(client);
          if (!clientData) return;
          if (clientData.room !== room) return;
          if (client.readyState === WebSocket.OPEN) {
            client.send(
              JSON.stringify({
                type: "chat",
                room,
                msg: message,
              })
            );
          }
        });

        message.status = "delivered";
        await message.save();

        ws.send(
          JSON.stringify({
            type: "status-update",
            msgId: message._id,
            state: "delivered",
          })
        );

        return;
      }

      /* ===== HISTORY ===== */
      if (data.type === "history") {
        const messages = await Message.find({ room })
          .sort({ time: 1 })
          .limit(500);

        ws.send(
          JSON.stringify({
            type: "history",
            room,
            messages,
          })
        );

        return;
      }

      /* ===== SEEN ===== */
      if (data.type === "seen") {
        const msg = await Message.findById(data.msgId);
        if (!msg || msg.room !== room) return;

        if (msg.status !== "seen") {
          msg.status = "seen";
          await msg.save();
        }

        ws.send(
          JSON.stringify({
            type: "status-update",
            msgId: msg._id,
            state: "seen",
          })
        );

        return;
      }

      /* ===== REACTION ===== */
      if (data.type === "react") {
        if (typeof data.emoji !== "string" || data.emoji.length > 10)
          return;

        const userEmail = req.session.passport.user.email;
const msg = await Message.findById(data.msgId);
        if (!msg || msg.room !== room) return;

        msg.reactions = msg.reactions || new Map();

        if (!(msg.reactions instanceof Map)) {
          msg.reactions = new Map(Object.entries(msg.reactions));
        }

        let alreadyHadSame = false;

        for (const [emojiKey, users] of msg.reactions.entries()) {
          const index = users.indexOf(userEmail);

          if (emojiKey === data.emoji && index !== -1) {
            alreadyHadSame = true;
          }

          if (index !== -1) {
            users.splice(index, 1);
            msg.reactions.set(emojiKey, users);
          }
        }

        if (!alreadyHadSame) {
          const arr = msg.reactions.get(data.emoji) || [];
          arr.push(userEmail);
          msg.reactions.set(data.emoji, arr);
        }

        await msg.save();

        wss.clients.forEach((client) => {
          const clientData = sockets.get(client);
          if (!clientData) return;
          if (clientData.room !== room) return;

          if (client.readyState === WebSocket.OPEN) {
            client.send(
              JSON.stringify({
                type: "chat-update",
                room,
                msg,
              })
            );
          }
        });

        return;
      }
    });

    /* ===== DISCONNECT ===== */
    ws.on("close", () => {
      const userData = sockets.get(ws);
      if (!userData) return;

      const id = userData.id;
      sockets.delete(ws);
      userLastMessage.delete(id);

      let stillConnected = false;
      for (let value of sockets.values()) {
        if (value.id === id) {
          stillConnected = true;
          break;
        }
      }

      if (!stillConnected) onlineUsers.delete(id);

      emitOnlineUsers();
    });
  //});
//});
}); // passport.session
  });   // passport.initialize
});     // sessionMiddleware
});     // wss connection
/* ===== CLEANUP ===== */
wss.on("close", () => clearInterval(interval));

/* ===== START ===== */
server.listen(PORT, () => {
  console.log("🔥 Chat Server Running on Port " + PORT);
});
