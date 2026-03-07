// ====== REALTIME CHAT SERVER (HARDENED ORIGINAL VERSION) ======
const userLastMessage = new Map();
const WebSocket = require("ws");
const crypto = require("crypto");
const startTime = Date.now(); // Server kab start hua uska time
const mongoose = require("mongoose");
require("dotenv").config();
const sanitizeHtml = require("sanitize-html");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const MongoStore = require("connect-mongo").default;

const Filter = require("bad-words");
const filter = new Filter();

// Teri custom Hinglish gaaliyon ki list
const customHinglishWords = [
  'bc', 'mc', 'bhenchod', 'madarchod', 'gandu', 
  'lavda', 'behenchod', 'maderchod', 'bsdk', 'bhosdike', 'lodu', 
  'haramkhor', 'randi'
];
filter.addWords(...customHinglishWords);


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

/* ================= MUTE MODEL ================= */
const MutedUser = mongoose.model("MutedUser", new mongoose.Schema({
  email: { type: String, unique: true },
  name: String,
  mutedAt: { type: Date, default: Date.now }
}));

/* ================= REPORT MODEL ================= */
const reportSchema = new mongoose.Schema({
  reporterEmail: String,
  reportedUser: String,
  reportedEmail: String,
  messageText: String,
  messageId: String,
  reason: String,
  timestamp: { type: Date, default: Date.now }
});
const Report = mongoose.model("Report", reportSchema);


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


/* ================= ROUTES (MODIFIED FOR NEW STRUCTURE) ================= */

// Function to check if user is authenticated
function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  // Agar login nahi hai, toh seedha public/landing.html dikhao
  res.sendFile(__dirname + "/public/landing.html"); 
}

// Main Route
app.get("/", (req, res) => {
  if (req.isAuthenticated()) {
    // Login user ke liye public/index.html
    res.sendFile(__dirname + "/public/index.html");
  } else {
    // Non-login user ke liye public/landing.html
    res.sendFile(__dirname + "/public/landing.html");
  }
});

// Chat Dashboard Route
app.get("/chat", ensureAuth, (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// ZAROORI: Server ko batao ki saari assets 'public' folder mein hain
app.use(express.static(__dirname + "/public"));

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

// Line 293 ke niche
const isMutedLogin = await MutedUser.findOne({ email: req.user.email });
if (isMutedLogin) {
    ws.send(JSON.stringify({ type: "mute-notice", isMuted: true }));
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

/* ===== ADMIN ACTIONS (KICK/BAN) - FIXED ===== */
if (data.type === "admin-action") {
    console.log(`Admin action received: ${data.action} on ${data.targetEmail}`);

    // 🔥 FIX: Check both role OR direct email match
    const isAdmin = req.user && (req.user.role === "admin" || req.user.email === process.env.ADMIN_EMAIL);

    if (!isAdmin) {
        console.log(`❌ Action Blocked: ${req.user?.email} is not an admin.`);
        return ws.send(JSON.stringify({ type: "error", message: "🚫 Permission Denied. You are not an admin!" }));
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

        // 🔥 Admin ka UI update karne ke liye fresh list trigger karo
        const allMsgs = await Message.aggregate([{ $group: { _id: "$email", name: { $first: "$user" }, avatar: { $first: "$avatar" } } }]);
        const bList = await BannedUser.find({});
        const mList = await MutedUser.find({});
        ws.send(JSON.stringify({ 
            type: "all-members-list", 
            users: allMsgs.map(u => ({
                email: u._id, name: u.name, avatar: u.avatar,
                isBanned: bList.some(b => b.email === u._id),
                isMuted: mList.some(m => m.email === u._id)
            }))
        }));

    }
    else if (action === "mute") {
        await MutedUser.findOneAndUpdate(
            { email: targetEmail },
            { email: targetEmail, name: targetName },
            { upsert: true }
        );
        broadcastSystemMessage(`🤐 Admin has muted ${targetName}. Shhh!`);
        
        // User ko batane ke liye ki wo mute ho gaya hai
        wss.clients.forEach(client => {
            const clientData = sockets.get(client);
            if (onlineUsersData.get(clientData?.id)?.email === targetEmail) {
                client.send(JSON.stringify({ type: "mute-notice", isMuted: true }));
            }
        });
    }
    else if (action === "unmute") {
        await MutedUser.findOneAndDelete({ email: targetEmail });
        broadcastSystemMessage(`🔊 Admin has unmuted ${targetName}. Bolne ki azadi!`);
        
        // User ka input wapas kholo
        wss.clients.forEach(client => {
            const clientData = sockets.get(client);
            if (onlineUsersData.get(clientData?.id)?.email === targetEmail) {
                client.send(JSON.stringify({ type: "mute-notice", isMuted: false }));
            }
        });
    }
// --- ISSE REPLACE KARO (Line 522-536 ke beech) ---
    const currentOnlineEmailsAction = Array.from(onlineUsersData.values()).map(u => u.email);
    const allMsgs2 = await Message.aggregate([{ $group: { _id: "$email", name: { $first: "$user" }, avatar: { $first: "$avatar" } } }]);
    const bList2 = await BannedUser.find({});
    const mList2 = await MutedUser.find({});
    
    // NAYA: Stats calculate karo taaki action ke baad dashboard turant update ho
    const totalMessagesAction = await Message.countDocuments();
    const totalBannedAction = bList2.length;

    ws.send(JSON.stringify({ 
        type: "all-members-list", 
        uptime: Math.floor((Date.now() - startTime) / 1000), 
        stats: { // <--- Ye stats yahan missing the, ab add kar diye
            messages: totalMessagesAction,
            banned: totalBannedAction,
            online: currentOnlineEmailsAction.length
        },
        users: allMsgs2.map(u => ({
            email: u._id, name: u.name, avatar: u.avatar,
            isBanned: bList2.some(b => b.email === u._id),
            isMuted: mList2.some(m => m.email === u._id),
            isOnline: currentOnlineEmailsAction.includes(u._id)
        }))
    }));
// -----------------------------------------------

    emitOnlineUsers();
    return;
}


      /* ===== GET ALL MEMBERS (FOR ADMIN TABLE) WITH ONLINE STATUS ===== */
      if (data.type === "get-all-members") {
        if (!req.user || req.user.role !== "admin") return;

        // 1. Database se unique users nikaalo
        const users = await Message.aggregate([
            { $group: { _id: "$email", name: { $first: "$user" }, avatar: { $first: "$avatar" } } }
        ]);

        // 2. Muted aur Banned users
        const bannedList = await BannedUser.find({});
        const mutedList = await MutedUser.find({});
        const bannedEmails = bannedList.map(u => u.email);
        const mutedEmails = mutedList.map(u => u.email);

        // 3. Online Emails ki list nikalo (Map se)
        const currentOnlineEmails = Array.from(onlineUsersData.values()).map(u => u.email);

        // 4. Data format karke Admin ko bhejo (With Stats!)
        const totalMessages = await Message.countDocuments(); // Kitne messages hain total
        const totalBanned = bannedList.length;

        ws.send(JSON.stringify({
            type: "all-members-list",
            uptime: Math.floor((Date.now() - startTime) / 1000), 
            stats: {
                messages: totalMessages,
                banned: totalBanned,
                online: currentOnlineEmails.length
            },
            users: users.map(u => ({
                email: u._id,
                name: u.name,
                avatar: u.avatar,
                isBanned: bannedEmails.includes(u._id),
                isMuted: mutedEmails.includes(u._id),
                isOnline: currentOnlineEmails.includes(u._id)
            }))
        }));

        return;
      }
      /* ===== GET ALL REPORTS (FOR ADMIN DASHBOARD) ===== */
      if (data.type === "get-reports") {
        // Sirf Admin access kar sake
        const isAdmin = req.user && (req.user.role === "admin" || req.user.email === process.env.ADMIN_EMAIL);
        if (!isAdmin) return;

        try {
          const reports = await Report.find().sort({ timestamp: -1 }).limit(50);
          
          // Frontend 'targetName' aur 'targetEmail' dhoondh raha hai
          // Hum database ke fields ko map karke bhejenge
          const formattedReports = reports.map(r => ({
            _id: r._id,
            targetName: r.reportedUser,     // frontend expectation
            targetEmail: r.reportedEmail,   // frontend expectation
            reportedBy: r.reporterEmail,    // frontend expectation
            reason: r.reason,
            text: r.messageText,
            timestamp: r.timestamp
          }));

          ws.send(JSON.stringify({
            type: "all-reports-list",
            reports: formattedReports
          }));
        } catch (err) {
          console.error("Fetch Reports Error:", err);
        }
        return;
      }

/* ===== CHAT ===== */
if (data.type === "chat") {
    // 🛡️ SECURITY GUARD 1: Check if Banned
    const isBanned = await BannedUser.findOne({ email: req.user?.email });
    if (isBanned) {
        ws.send(JSON.stringify({ type: "error", message: "🚫 Action denied. You are banned." }));
        setTimeout(() => ws.terminate(), 500);
        return;
    }

    // 🤐 SECURITY GUARD 2: Check if Muted (YE NAYA HAI)
    const isMuted = await MutedUser.findOne({ email: req.user?.email });
    if (isMuted) {
        ws.send(JSON.stringify({ 
            type: "error", 
            message: "🤐 Admin has muted you. You can't send messages!" 
        }));
        return; // Message aage nahi jayega
    }

    if (!data.text?.trim()) return;
    // ... baaki ka purana code message save karne wala ...

        if (data.text.length > 500) return;

const now = Date.now();
const lastTime = userLastMessage.get(id) || 0;
// Reduce throttle to 300ms
if (now - lastTime < 300) return;
userLastMessage.set(id, now);

// --- YAHAN SE REPLACE KAREIN ---
        // 1. Pehle HTML aur faltu tags saaf karo
        let cleanText = sanitizeHtml(data.text.trim(), {
          allowedTags: [],
          allowedAttributes: {},
        });

        // 2. Phir Gaaliyan saaf karo (**** mein badal dega)
        try {
            cleanText = filter.clean(cleanText);
        } catch (err) {
            console.log("Filter error, keeping original text");
        }
// --- YAHAN TAK ---

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


      /* ===== REPORT MESSAGE ===== */
      if (data.type === "report-msg") {
        const { msgId, reason } = data;
        const reporterEmail = req.user?.email;

        if (!msgId || !reporterEmail) return;

        try {
          const targetMsg = await Message.findById(msgId);
          if (!targetMsg) return;

          // Database mein report save karo
          const newReport = new Report({
            reporterEmail: reporterEmail,
            reportedUser: targetMsg.user,
            reportedEmail: targetMsg.email,
            messageText: targetMsg.text,
            messageId: msgId,
            reason: reason || "Inappropriate Content"
          });
          await newReport.save();

          // Reporter ko confirmation bhejo
          ws.send(JSON.stringify({ 
            type: "success", 
            message: "✅ Report submitted. Admins will review it." 
          }));

          // Online Admins ko real-time notification aur live data bhejo
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
               const clientData = sockets.get(client);
               if (onlineUsersData.get(clientData?.id)?.role === "admin") {
                 
                 // 1. Popup Alert
                 client.send(JSON.stringify({ 
                   type: "admin-alert", 
                   text: `🚨 New Report: ${targetMsg.user} was reported!` 
                 }));

 // 2. Live Dashboard Update (Naya row add karne ke liye)
client.send(JSON.stringify({
  type: "new-live-report",
  report: {
    _id: newReport._id,
    targetName: newReport.reportedUser,
    targetEmail: newReport.reportedEmail,
    reportedBy: newReport.reporterEmail,
    reason: newReport.reason,
    text: newReport.messageText,
    timestamp: newReport.timestamp
  }
}));

               }
            }
          });

        } catch (err) {
          console.error("Report Error:", err);
        }
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
