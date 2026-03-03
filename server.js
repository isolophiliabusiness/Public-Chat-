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

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "https://*.googleusercontent.com", "https://res.cloudinary.com"],
        "connect-src": ["'self'", "ws:", "wss:"],
      },
    },
  })
);


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
  email: { type: String }, // ✅ YE ZAROORI HAI
  text: { type: String, required: true, maxlength: 500 },
  time: { type: Number, index: true },
  role: { type: String, default: "user" }, // ✅ YE LINE ADD KARO
  reactions: { type: Map, of: [String], default: {} },
  status: { type: String, default: "server" },
  avatar: { type: String, default: "" },
  isDeleted: { type: Boolean, default: false }, // <--- Ye add kar
    // ✅ YE ADD KARO: Reply data save karne ke liye
  replyTo: {
    msgId: { type: String },
    user: { type: String },
    text: { type: String }
  }
});

messageSchema.index({ room: 1, time: 1 });

const Message = mongoose.model("Message", messageSchema);

/* ================= BAN MODEL ================= */
const banSchema = new mongoose.Schema({
  email: { type: String, unique: true }, // Email se ban karna best hai
  name: String,
  reason: { type: String, default: "Violation of rules" },
  bannedAt: { type: Date, default: Date.now }
});
const BannedUser = mongoose.model("BannedUser", banSchema);

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
/*  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite:
      process.env.NODE_ENV === "production" ? "none" : "lax",
  },*/
 cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax"
    }  //localhost only
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

// ✅ AVATAR FIX
let avatarUrl = profile.photos?.[0]?.value || "";

// Google resize safely
if (avatarUrl.includes("googleusercontent")) {
  avatarUrl = avatarUrl.split("=")[0] + "=s200-c";
}
const name = profile.displayName || email.split("@")[0];

const user = {
  id: profile.id,
  email,
  name,          // ✅ ADD THIS
  role,
  avatar: avatarUrl
};
//};

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

app.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);

    // Session ko database se poori tarah khatam karo
    req.session.destroy((err) => {
      if (err) console.error("❌ Session destroy error:", err);

      // Browser ki cookie saaf karo (connect.sid)
      res.clearCookie("connect.sid"); 

      // Phir seedha Landing page par bhejo
      res.redirect("/"); 
    });
  });
});


/* ================= ROUTES (MODIFIED) ================= */

// Ye function check karta hai ki user logged in hai ya nahi
function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  // Agar login nahi hai, toh seedha Google par mat bhejo, Landing page dikhao
  res.sendFile(__dirname + "/landing.html"); 
}

// Main Route: Yahan decide hoga ki kya dikhana hai
app.get("/", (req, res) => {
  if (req.isAuthenticated()) {
    // Agar banda login hai, toh Chat Hub (index.html) bhejo
    res.sendFile(__dirname + "/index.html");
  } else {
    // Agar login nahi hai, toh tera Premium Landing Page dikhao
    res.sendFile(__dirname + "/landing.html");
  }
});

// Ye zaroori hai taaki dashboard ke andar auth check rahe
app.get("/chat", ensureAuth, (req, res) => {
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
const onlineUsersData = new Map(); // Naya Map

function emitOnlineUsers() {
  const usersList = Array.from(onlineUsersData.values());
  const data = JSON.stringify({
    type: "online-users-list", // Type badal diya frontend ke liye
    count: usersList.length,
    users: usersList
  });

  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(data);
  });
}


wss.on("connection", (ws, req) => {
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

sessionMiddleware(req, {}, () => {

  passport.initialize()(req, {}, () => {
    passport.session()(req, {}, async () => { // <--- Yahan 'async' add kiya

      if (!req.user) {
        ws.close();
        return;
      }

      // ✅ BAN CHECK: Check if user is in Banned list
      const isBanned = await BannedUser.findOne({ email: req.user.email });
      if (isBanned) {
        ws.send(JSON.stringify({ 
          type: "error", 
          message: "🚫 You are permanently banned from this chat." 
        }));
        setTimeout(() => ws.close(), 1000); // Thoda time do message dikhne ka
        return;
      }


      // --- IDENTITY & REGISTRATION ---
      ws.send(JSON.stringify({
        type: "me",
        email: req.user.email,
        name: req.user.name,
        avatar: req.user.avatar,
        role: req.user.role || "user" 
      }));

      // Generate a truly unique ID for this specific connection
      const socketId = require('crypto').randomUUID(); 
      sockets.set(ws, { id: socketId, room: "public" });

      // Sidebar data mein save karo
      onlineUsersData.set(socketId, {
        name: req.user.name,
        avatar: req.user.avatar,
        email: req.user.email,
        role: req.user.role || "user"
      });

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
/* ===== TYPING ===== */
if (data.type === "typing") {
  wss.clients.forEach((client) => {
    const clientData = sockets.get(client);
    if (!clientData) return;
    if (clientData.room !== room) return;
    if (client === ws) return;

    if (client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: "typing",
          name: req.user?.name,
          isTyping: data.isTyping
        })
      );
    }
  });
  return;
}
      /* ===== DELETE MESSAGE ===== */
      if (data.type === "delete-msg") {
        const msg = await Message.findById(data.msgId);
        if (!msg) return;

        // Security: Sirf owner ya admin delete kar sake
        const isOwner = msg.user === (req.user?.name || req.user?.email);
//        const isAdmin = req.user?.role === "admin";
          const isAdmin = req.user?.role === "admin" || req.user?.email === process.env.ADMIN_EMAIL;

        if (isOwner || isAdmin) {
          msg.text = "🚫 This message was deleted";
          msg.isDeleted = true;
          await msg.save();

          // Frontend (app.js) iska wait kar raha hai
          const deleteNotice = JSON.stringify({
            type: "msg-deleted",
            msgId: data.msgId
          });

          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(deleteNotice);
            }
          });
        }
        return;
      }

/* ===== ADMIN ACTIONS (KICK/BAN) - UPDATED ===== */
if (data.type === "admin-action") {
    console.log(`Admin action received: ${data.action} on ${data.targetEmail}`);

    if (!req.user || req.user.role !== "admin") {
        return ws.send(JSON.stringify({ type: "error", message: "🚫 Permission Denied." }));
    }

    const targetEmail = data.targetEmail;
    const targetName = data.targetName;
    const action = data.action;
// 🔥 OWNER PROTECTION: Admin khud ke baap (Owner) ko touch nahi kar sakta
    if (targetEmail === process.env.ADMIN_EMAIL) {
        return ws.send(JSON.stringify({ 
            type: "error", 
            message: "🤣 Aukat mein reh! You cannot action the Owner." 
        }));
    }

    // 📢 SABKO BATANE WALA LOGIC (Broadcast)
    const broadcastSystemMessage = (text) => {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: "chat",
                    msg: {
                        user: "SYSTEM",
                        text: text,
                        time: Date.now(),
                        role: "system",
                        avatar: "https://cdn-icons-png.flaticon.com/512/1041/1041916.png"
                    }
                }));
            }
        });
    };
    if (action === "kick" || action === "ban") {
        const msgText = action === "kick"
            ? `📢 Admin has kicked ${targetName} from the chat!`
            : `🚫 JUSTICE SERVED: ${targetName} has been PERMANENTLY BANNED!`;

        broadcastSystemMessage(msgText);

        if (action === "ban") {
            await BannedUser.findOneAndUpdate(
                { email: targetEmail },
                { email: targetEmail, name: targetName, reason: "Banned by Admin" },
                { upsert: true }
            );
        }

        // Target user ko dhoondh kar laat maaro
        wss.clients.forEach(client => {
            const clientData = sockets.get(client);
            const clientEmail = onlineUsersData.get(clientData?.id)?.email;

            if (clientEmail === targetEmail) {
                client.send(JSON.stringify({
                    type: action === "kick" ? "kick-notice" : "ban-notice",
                    reason: "Admin action performed."
                }));
                setTimeout(() => client.terminate(), 500);
            }
        });
    } 
    else if (action === "unban") {
        // Database se hatao
        const result = await BannedUser.findOneAndDelete({ email: targetEmail });
        
        if (result) {
            broadcastSystemMessage(`✅ Admin has unbanned ${targetName}. Welcome back!`);
        }

        // 🔥 Admin ka UI update karne ke liye fresh list bhejo
        const updatedList = await BannedUser.find({});
        ws.send(JSON.stringify({ 
            type: "ban-list", 
            users: updatedList 
        }));
    }

    emitOnlineUsers();
    return;
}


      /* ===== GET BAN LIST (FOR ADMIN ONLY) ===== */
      if (data.type === "get-ban-list") {
        if (!req.user || req.user.role !== "admin") return;
        
        const bannedUsers = await BannedUser.find({});
        ws.send(JSON.stringify({
          type: "ban-list",
          users: bannedUsers
        }));
        return;
      }


      /* ===== CHAT ===== */
      if (data.type === "chat") {
        // 🛡️ SECURITY GUARD: Check if user is banned before doing anything
        const isBanned = await BannedUser.findOne({ email: req.user?.email });
        if (isBanned) {
          ws.send(JSON.stringify({ type: "error", message: "🚫 Action denied. You are banned." }));
          setTimeout(() => ws.terminate(), 500);
          return;
        }

        if (!data.text?.trim()) return;
        if (data.text.length > 500) return;

const now = Date.now();
const lastTime = userLastMessage.get(id) || 0;
// Reduce throttle to 300ms
if (now - lastTime < 300) return;
userLastMessage.set(id, now);

        const cleanText = sanitizeHtml(data.text.trim(), {
          allowedTags: [],
          allowedAttributes: {},
        });

const userEmail = req.user?.email;
if (!userEmail) {
  console.log("⚠️ WS user missing");
  return;
}
  const message = new Message({
    room,
    user: req.user?.name || userEmail,
    email: userEmail, // ✅ YE LINE ADD KARO (Taaki Admin ban kar sake)
    text: cleanText,
    time: now,
    role: req.user?.role || "user", // ✅ YE LINE ADD KARO (Database me save hoga)
    reactions: {},
    status: "server",
    avatar: req.user?.avatar || "",
    // ✅ Safe way to handle reply data
    replyTo: data.replyTo ? {
      msgId: data.replyTo.msgId,
      user: data.replyTo.user,
      text: data.replyTo.text
    } : null
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
                msg: {
                  ...message.toObject(),
                  role: req.user?.role || "user" // ✅ Message ke saath role chipka diya
                },
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

      /* ===== HISTORY (WITH PAGINATION) ===== */
      if (data.type === "history") {
       if (!req.user) return ws.close(); // 🛡️ Add this line
        const limit = 30; 
        const beforeTime = data.beforeTime || Date.now(); 

        let messages = await Message.find({
          room,
          time: { $lt: beforeTime } 
        })
        .sort({ time: -1 }) 
        .limit(limit)
        .lean();

        // 1. Array ko sirf EK BAAR reverse karo taaki chronological order mile
        messages.reverse();

        // 2. Data format karo (isDeleted check)
        messages = messages.map(m => {
          if (m.isDeleted) m.text = "🚫 This message was deleted";
          // role ab m object ke andar database se pehle hi maujood hai
          return m;
        });

        ws.send(
          JSON.stringify({
            type: "history",
            room,
            messages,
            isInitial: !data.beforeTime 
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
        const userEmail = req.user?.email;
        if (!userEmail || !data.emoji) return;

        const msg = await Message.findById(data.msgId);
        if (!msg || msg.room !== room) return;

        // Ensure reactions is a Map
        if (!(msg.reactions instanceof Map)) {
            msg.reactions = new Map(Object.entries(msg.reactions || {}));
        }

        const currentEmoji = data.emoji;
        let alreadyMatched = false;

        // 1. Remove user from ALL existing emojis (1 user, 1 reaction policy)
        msg.reactions.forEach((users, emojiKey) => {
            const index = users.indexOf(userEmail);
            if (index !== -1) {
                if (emojiKey === currentEmoji) alreadyMatched = true;
                users.splice(index, 1);
                msg.reactions.set(emojiKey, users);
            }
        });

        // 2. If user hadn't reacted with THIS emoji yet, add it
        if (!alreadyMatched) {
            const users = msg.reactions.get(currentEmoji) || [];
            users.push(userEmail);
            msg.reactions.set(currentEmoji, users);
        }

        msg.markModified('reactions'); // 🚩 Crucial for MongoDB
        await msg.save();

        const updateData = JSON.stringify({ type: "chat-update", room, msg });
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(updateData);
        });
        return;
      }

    });

    /* ===== DISCONNECT ===== */
    ws.on("close", () => {
      const userData = sockets.get(ws);
      if (!userData) return;

      const sid = userData.id; // Ye wahi unique UUID hai

      // 1. WebSocket map se hatao
      sockets.delete(ws);
      
      // 2. Throttling map se hatao
      userLastMessage.delete(sid);

      // 3. Online users ki list se turant hatao (Memory safe)
      onlineUsersData.delete(sid); 

      // 4. Sabko nayi list bhejo
      emitOnlineUsers();
      
      console.log(`🔌 User disconnected and memory cleared: ${sid}`);
    });


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
