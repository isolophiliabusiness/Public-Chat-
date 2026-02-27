document.addEventListener("DOMContentLoaded", () => {

  // Logout handle function
  function handleLogout() {
    localStorage.removeItem("chatUser");   // purana user remove
    window.currentUser = null;             // global variable clear
    window.currentAvatar = null;           // avatar bhi clear
    window.location.reload();              // page reload → redirect login
  }

  // 3-dot menu toggle
const menu = document.querySelector(".menu");
const menuDropdown = document.querySelector(".menu-dropdown");

if(menu) {
  menu.addEventListener("click", (e) => {
    e.stopPropagation(); // click bubble roke
    menuDropdown.classList.toggle("show");
  });
}

// click outside to close
document.addEventListener("click", () => {
  menuDropdown.classList.remove("show");
});

// Logout button
const logoutBtn = document.getElementById("logoutBtn");
if(logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("chatUser");
    window.currentUser = null;
    window.currentAvatar = null;
    window.location.reload(); // Gemini style → page reload karenge
  });
}
  /* ================= GLOBAL STATE ================= */
  const MAX_MESSAGES_IN_DOM = 500;
  let ws;
  let reconnectDelay = 2000;
  let oldestMessageId = null;
  let retryCount = 0; // global at top
  const MAX_RETRIES = 10;

  let unseenCount = 0;
  let historyLoaded = false;
  let loadingHistory = false;
  let historyEndReached = false;

  const renderedMessages = new Set();
  let lastMessageUser = null;
  let lastMessageWasHistory = false;
  let lastMessageTime = 0; // 🆕 time gap ke liye
  const GROUP_TIME_LIMIT = 5 * 60 * 1000; // 5 minutes

  const chat = document.getElementById("chat");
  const input = document.getElementById("messageInput");
  const sendBtn = document.getElementById("sendBtn");
  const newMsgBtn = document.getElementById("newMsgBtn");

/* ================= CHAT SOUNDS ================= */
const sendSound = new Audio("send.mp3");
const receiveSound = new Audio("received.mp3");

sendSound.preload = "auto";
receiveSound.preload = "auto";

function playSendSound() {
  sendSound.currentTime = 0;
  sendSound.play().catch(() => {});
}

function playReceiveSound() {
  receiveSound.currentTime = 0;
  receiveSound.play().catch(() => {});
}

/* ================= TYPING STATE ================= */
let typingTimeout = null;
let isTyping = false;

  /* ================= HELPERS ================= */
  function getTopVisibleMessage() {
    const messages = chat.children;
    if (!messages.length) return null;

    const chatRect = chat.getBoundingClientRect();

    for (let i = 0; i < messages.length; i++) {
      const rect = messages[i].getBoundingClientRect();
      if (rect.bottom > chatRect.top) return messages[i];
    }
    return null;
  }

  function scrollToBottomSmooth() {
    chat.scrollTo({ top: chat.scrollHeight, behavior: "smooth" });
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  /* ================= WEBSOCKET ================= */
  function connectWS() {
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);

    ws.onopen = () => {
      reconnectDelay = 2000;
      retryCount = 0;

      if (!window.currentUser) {
        const cachedUser = localStorage.getItem("chatUser");
        if (cachedUser) window.currentUser = cachedUser;
      }

      ws.send(JSON.stringify({ type: "join", room: "public", user: window.currentUser }));
      ws.send(JSON.stringify({ type: "history", room: "public", beforeId: null }));
    };

    ws.onmessage = handleWSMessage;

    ws.onclose = () => {
      setTimeout(() => {
        if (retryCount < MAX_RETRIES) {
          connectWS();
          retryCount++;
          reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
        } else {
          console.warn("Max reconnect attempts reached.");
        }
      }, reconnectDelay);
    };

    ws.onerror = (err) => {
      console.warn("WS error", err);
    };
  }

  connectWS();

/* ================= ADD MESSAGE ================= */
function addMessage(user, text, isHistory = false, time = Date.now(), messageId = null, reactions = {}, status = "server", avatar = "") {
    if (messageId && renderedMessages.has(messageId)) return;
    if (messageId) renderedMessages.add(messageId);

    const isMe = (user || "").trim().toLowerCase() === (window.currentUser || "").trim().toLowerCase();
    const wrapper = document.createElement("div");
    wrapper.className = isMe ? "message-row me" : "message-row";

    // ----------------- DATE SEPARATOR -----------------
    const messageDate = new Date(time);
    const messageDateStr = messageDate.toDateString();

    // Check if date separator already exists for this date
    const existingDate = chat.querySelector(`.date-separator[data-date="${messageDateStr}"]`);

    if (!existingDate) {
        const dateWrapperOuter = document.createElement("div");
        dateWrapperOuter.className = "date-wrapper";

        const dateDiv = document.createElement("div");
        dateDiv.className = "date-separator";
        dateDiv.dataset.date = messageDateStr;

        const now = new Date();
        const yesterday = new Date(now.getTime() - 86400000);

        if (messageDateStr === now.toDateString()) dateDiv.textContent = "Today";
        else if (messageDateStr === yesterday.toDateString()) dateDiv.textContent = "Yesterday";
        else dateDiv.textContent = messageDate.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

        dateWrapperOuter.appendChild(dateDiv);


        if (isHistory) {
            // History me message se upar dikhane ke liye prepend use karein
            chat.prepend(dateWrapperOuter);
        } else {
            chat.appendChild(dateWrapperOuter);
        }

    }


    const div = document.createElement("div");
    if (messageId) div.dataset.id = messageId;

    const timeDiff = Math.abs(time - lastMessageTime);
    const isGrouped = lastMessageUser === user && timeDiff <= GROUP_TIME_LIMIT && !isHistory;
    div.className = (isMe ? "message sent" : "message received") + (isGrouped ? " grouped" : " new-group");

    if (!isMe) {
        const avatarEl = document.createElement("img");
        avatarEl.className = "avatar";
        if (avatar) {
            avatarEl.src = avatar;
            avatarEl.onerror = () => { avatarEl.src = "/default-avatar.png"; };
        }
        if (isGrouped) avatarEl.classList.add("avatar-placeholder");
        wrapper.appendChild(avatarEl);
    }

    if (!isGrouped) {
        const nameEl = document.createElement("div");
        nameEl.className = "name";
        nameEl.textContent = user || "Unknown";
        div.appendChild(nameEl);
    }

    const msgEl = document.createElement("div");
    msgEl.className = "msg-text";
    msgEl.textContent = text;
    div.appendChild(msgEl);

    const meta = document.createElement("div");
    meta.className = "message-meta";
    const timeEl = document.createElement("span");
    timeEl.className = "time";
    timeEl.textContent = formatTime(time);
    meta.appendChild(timeEl);

    if (isMe) {
        const statusEl = document.createElement("span");
        statusEl.className = "status";
        statusEl.innerHTML = `
            <svg class="tick small" viewBox="0 0 20 20"><polyline points="4 11 8 15 16 6" /></svg>
            <svg class="tick big hidden" viewBox="0 0 20 20"><polyline points="4 11 8 15 16 6" /></svg>
        `;
        meta.appendChild(statusEl);
        setStatusVisual(statusEl, status);
    }

    div.appendChild(meta);

    const reactContainer = document.createElement("div");
    reactContainer.className = "reaction-popup";
    ["❤️","👍","😂","😮","😢"].forEach(emoji => {
        const btn = document.createElement("span");
        btn.className = "reaction-emoji";
        btn.textContent = emoji;
        const reactedUsers = reactions?.[emoji] || [];
        if (reactedUsers.includes(window.currentUser)) {
            btn.style.background = "rgba(0,150,255,0.35)";
            btn.style.borderRadius = "50%";
        }
        btn.onclick = (e) => {
            e.stopPropagation();
            if (!messageId) return;
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            ws.send(JSON.stringify({ type: "react", room: "public", msgId: messageId, emoji }));
            reactContainer.classList.remove("show");
        };
        reactContainer.appendChild(btn);
    });
    div.appendChild(reactContainer);

    let pressTimer;
    function showReactionPopup() {
        document.querySelectorAll(".reaction-popup.show").forEach(el => el.classList.remove("show"));
        reactContainer.classList.add("show");
        const rect = div.getBoundingClientRect();
        if (rect.top < 80) {
            reactContainer.style.top = "100%";
            reactContainer.style.bottom = "auto";
        } else {
            reactContainer.style.bottom = "100%";
            reactContainer.style.top = "auto";
        }
    }

    div.addEventListener("touchstart", () => { pressTimer = setTimeout(showReactionPopup, 600); });
    div.addEventListener("touchend", () => { clearTimeout(pressTimer); });
    div.addEventListener("mousedown", () => { pressTimer = setTimeout(showReactionPopup, 400); });
    div.addEventListener("mouseup", () => { clearTimeout(pressTimer); });

    wrapper.appendChild(div);

    const wasAtBottom = Math.abs(chat.scrollHeight - chat.scrollTop - chat.clientHeight) < 50;

    if (isHistory) {
        chat.prepend(wrapper); // Purane messages top par jayenge
    } else {
        chat.appendChild(wrapper); // Naye messages bottom par jayenge
    }

    // Max messages limit (Optional, cleanup ke liye)
    if (!isHistory && chat.children.length > 200) { 
        chat.removeChild(chat.firstChild);
    }

    // --- SCROLL LOGIC ---
    if (isHistory) {
        // Agar pehli baar history load ho rahi hai toh bottom bhejo
        if (typeof historyLoaded === 'undefined' || !historyLoaded) {
            chat.scrollTop = chat.scrollHeight;
            window.historyLoaded = true; // Global flag set kar diya
        }
    } else {
        // Naya message aane par auto-scroll agar user bottom par hai ya khud ka message hai
        if (wasAtBottom || isMe) {
            setTimeout(() => {
                chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
            }, 50);
        } else {
            // Agar user upar scroll karke baitha hai toh notification dikhao
            if (typeof unseenCount !== 'undefined') {
                unseenCount++;
                if (typeof updateNewMsgBtn === 'function') updateNewMsgBtn();
            }
        }
    }

    lastMessageUser = user;
    lastMessageTime = time;
}


  function updateMessage(msg) {
    const messageDiv = document.querySelector(`[data-id='${msg._id}']`);
    if (!messageDiv) return;
    const emojis = messageDiv.querySelectorAll(".reaction-emoji");
    emojis.forEach(el => {
      const emoji = el.textContent;
      const users = msg.reactions?.[emoji] || [];
      if (users.includes(window.currentUser)) {
        el.style.background = "rgba(0,150,255,0.35)";
        el.style.borderRadius = "50%";
      } else { el.style.background = "transparent"; }
    });
  }
function setStatusVisual(statusEl, state) {
  const small = statusEl.querySelector(".tick.small");
  const big = statusEl.querySelector(".tick.big");

  // Dono ticks ko pehle hide karna
  small.classList.add("hidden");
  big.classList.add("hidden");

  // Agar message delivered hai, toh small tick ko dikhana
  if (state === "delivered") {
    small.classList.remove("hidden");
    small.style.opacity = "1";  // Small tick ko visible karte hain
  }

  // Agar message seen hai, toh big tick ko dikhana
  if (state === "seen") {
    big.classList.remove("hidden");
    big.style.opacity = "1";  // Big tick ko visible karte hain
  }
}

function updateMessageStatus(msgId, state) {
  const messageDiv = document.querySelector(`[data-id='${msgId}']`);
  if (!messageDiv) return;

  const statusEl = messageDiv.querySelector(".status");
  if (!statusEl) return;

  setStatusVisual(statusEl, state); // Update the tick based on the status
}

function sendMessage() {
  const text = input.value.trim();
  if (!text) return; // Agar input empty hai, toh kuch mat bhejo

  if (!ws || ws.readyState !== WebSocket.OPEN) return; // Agar WebSocket open nahi hai, toh kuch mat bhejo

  // Unique message ID generate kar rahe hain
  const messageID = Date.now();  // Yeh unique ID hai har message ke liye

  // Message ko WebSocket ke through send karte hain
  ws.send(JSON.stringify({
    type: "chat",
    room: "public",
    text: text,
    messageId: messageID  // Yeh ID message ke sath bhej rahe hain
  }));

  input.value = ""; // Input field ko clear karte hain
}
  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("keydown", e => { if(e.key === "Enter") sendMessage(); });
/* ================= SEND TYPING EVENT ================= */
input.addEventListener("input", () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  if (!isTyping) {
    isTyping = true;
    ws.send(JSON.stringify({ type: "typing", isTyping: true }));
  }

  clearTimeout(typingTimeout);

  typingTimeout = setTimeout(() => {
    isTyping = false;
    ws.send(JSON.stringify({ type: "typing", isTyping: false }));
  }, 1200);
});

  function handleWSMessage(event) {
    const data = JSON.parse(event.data);

if (data.type === "me") {
  window.currentUser = data.name || data.email; // ✅ FIX
  window.currentAvatar = data.avatar || "";
  localStorage.setItem("chatUser", window.currentUser); // ✅ FIX
  return;
}
/* ================= RECEIVE TYPING ================= */
if (data.type === "typing") {
  if (data.isTyping) {
    showTypingIndicator(data.name);
  } else {
    removeTypingIndicator();
  }
}

    if (data.type === "online-users") {
      document.getElementById("online").textContent = `${data.count} Live`;
    }

    if (data.type === "history") {
      if (data.messages.length > 0) oldestMessageId = data.messages[0]._id;
      data.messages.reverse().forEach(msg => {
        addMessage(msg.user, msg.text, true, msg.time, msg._id, msg.reactions, msg.status || "server", msg.avatar);
      });
      if (data.messages.length < 500) historyEndReached = true;
      loadingHistory = false;
    }

if (data.type === "chat") {
   removeTypingIndicator();

   const isMe =
     (data.msg.user || "").trim().toLowerCase() ===
     (window.currentUser || "").trim().toLowerCase();

   addMessage(
     data.msg.user,
     data.msg.text,
     false,
     data.msg.time,
     data.msg._id,
     data.msg.reactions,
     data.msg.status || "server",
     data.msg.avatar
   );

   updateMessageStatus(data.msg._id, 'seen');

   // 🔊 Sound play
   if (isMe) {
     playSendSound();
   } else {
     playReceiveSound();
   }
}

    if (data.type === "chat-update") updateMessage(data.msg);
    if (data.type === "status-update") updateMessageStatus(data.msgId, data.state);
  }
/* ================= SHOW TYPING ================= */
function showTypingIndicator(name) {
  let existing = document.getElementById("typingIndicator");

  if (!existing) {
    const wrapper = document.createElement("div");
    wrapper.className = "message-row";

    const avatarSpacer = document.createElement("div");
    avatarSpacer.className = "avatar-spacer";

    const bubble = document.createElement("div");
    bubble.id = "typingIndicator";
//    bubble.className = "message received typing-indicator";
    bubble.className = "message received typing-indicator neon"; // ✅ YAHAN class add hogi

    bubble.innerHTML = `
        <div class="typing-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
    `;

    wrapper.appendChild(avatarSpacer);
    wrapper.appendChild(bubble);

    chat.appendChild(wrapper);
    scrollToBottomSmooth();
  }
}

function removeTypingIndicator() {
  const el = document.getElementById("typingIndicator");
  if (el && el.parentElement) {
    el.parentElement.remove();
  }
}

  function updateNewMsgBtn() {
    if (unseenCount > 0) {
      newMsgBtn.textContent = `${unseenCount} new message(s) ⬇`;
      newMsgBtn.classList.remove("hidden");
    } else { newMsgBtn.classList.add("hidden"); }
  }

  newMsgBtn.addEventListener("click", () => {
    scrollToBottomSmooth();
    unseenCount = 0;
    updateNewMsgBtn();
  });

  let scrollTicking = false;
  chat.addEventListener("scroll", () => {
    if (scrollTicking) return;
    scrollTicking = true;

    requestAnimationFrame(() => {
      const scrollTop = chat.scrollTop;
      const scrollHeight = chat.scrollHeight;
      const clientHeight = chat.clientHeight;

      const atBottom = scrollHeight - scrollTop <= clientHeight + 5;
      if (atBottom) { unseenCount = 0; updateNewMsgBtn(); }

      const nearTop = scrollTop <= 80;
      if (nearTop && !loadingHistory && !historyEndReached) {
        if (!ws || ws.readyState !== WebSocket.OPEN) { scrollTicking = false; return; }
        loadingHistory = true;
        ws.send(JSON.stringify({ type: "history", room: "public", beforeId: oldestMessageId }));
      }

      scrollTicking = false;
    });
  }, { passive: true });

  // Global click to close popups
  document.addEventListener("click", () => {
    document.querySelectorAll(".reaction-popup.show").forEach(el => el.classList.remove("show"));
  });

});
