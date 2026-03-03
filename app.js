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
    // Ab refresh nahi, seedha server ko request bhejenge logout ke liye
    window.location.href = "/logout"; 
  });
}

  /* ================= GLOBAL STATE ================= */
  const MAX_MESSAGES_IN_DOM = 500;
  let ws;
  let reconnectDelay = 2000;
 // let oldestMessageId = null;
  let oldestMessageTime = null; // ID ki jagah ab time track karenge
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
  // Line 56 ke paas add karo
  let currentReplyData = null; 
  let onlineUsersList = []; // 🆕 Online users ka data store karne ke liye

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
      ws.send(JSON.stringify({ type: "join", room: "public", user: window.currentUser }));
      // Initial load ke liye beforeTime null bhejenge
      ws.send(JSON.stringify({ type: "history", room: "public", beforeTime: null }));
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
function addMessage(user, text, isHistory = false, time = Date.now(), messageId = null, reactions = {}, status = "server", avatar = "", replyTo = null, role = "user", email = "") {

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

    // 👇 SYSTEM MESSAGE LOGIC
    if (user === "SYSTEM") {
        div.className = "system-msg"; 
        div.style.background = "rgba(255, 152, 0, 0.15)"; 
        div.style.border = "1px solid #ff9800";
        div.style.color = "#ff9800";
        div.style.textAlign = "center";
        div.style.margin = "10px auto";
        div.style.width = "90%";
        div.style.borderRadius = "10px";
        div.style.padding = "8px";
        div.style.fontSize = "0.85em";
        div.style.fontWeight = "bold";
        div.style.boxShadow = "0 0 10px rgba(255, 152, 0, 0.2)";
        
        div.textContent = text; // Seedha text daalo
        wrapper.appendChild(div);
        chat.appendChild(wrapper); // System msg ko yahin khatam karo
        return; // <--- IMPORTANT: Iske niche ka code (Avatar/Reactions) execute nahi hoga
    }


    // ✅ YE ADD KARO: Agar banda admin hai, toh bubble par special class laga do
    if (role === "admin") {
        div.classList.add("admin-theme");
    }


           if (!isMe) {
        const avatarEl = document.createElement("img");
        avatarEl.className = "avatar";
        if (avatar) {
            avatarEl.src = avatar;
            avatarEl.onerror = () => { avatarEl.src = "/default-avatar.png"; };
        }

        // ✅ YE MISSING THA: Profile open karne ka trigger
        avatarEl.style.cursor = "pointer";
        avatarEl.onclick = () => {
            if (typeof window.openProfile === "function") {
                // Pehle yahan sirf (user, avatar) tha, ab 'role' bhi bhej rahe hain
               window.openProfile(user, avatar, role, email); 
            }
        };

        if (isGrouped) avatarEl.classList.add("avatar-placeholder");
        wrapper.appendChild(avatarEl);
    }


    if (!isGrouped) {
        // Ek naya container banate hain Name + Badge ke liye
        const nameContainer = document.createElement("div");
        nameContainer.style.display = "flex";
        nameContainer.style.alignItems = "center";
        nameContainer.style.gap = "6px";
        nameContainer.style.marginBottom = "2px";

        const nameEl = document.createElement("div");
        nameEl.className = "name";
        nameEl.textContent = user || "Unknown";
        nameContainer.appendChild(nameEl);

        // ✅ ADMIN BADGE CHECK: Role 'admin' hai toh badge chipkao
        if (role === "admin") {
            const badge = document.createElement("span");
            badge.className = "admin-badge";
            badge.innerHTML = `<i class="fa-solid fa-crown" style="font-size: 0.85em;"></i> ADMIN`;

            // Theme matching style (Teal/Cyan)
            badge.style.cssText = `
                background: rgba(0, 247, 255, 0.15);
                color: #00f7ff;
                border: 1px solid #00f7ff;
                padding: 1px 6px;
                border-radius: 4px;
                font-size: 9px;
                font-weight: 800;
                letter-spacing: 0.5px;
                display: flex;
                align-items: center;
                gap: 3px;
                text-shadow: 0 0 5px rgba(0, 247, 255, 0.3);
            `;
            nameContainer.appendChild(badge);

            // Optional: Bubble par bhi halka sa teal glow dene ke liye
            div.style.borderLeft = "3px solid #00f7ff";
            div.style.background = "linear-gradient(to right, rgba(0, 247, 255, 0.05), transparent)";
        }

        div.appendChild(nameContainer);
    }

    // --- REPLY UI IN CHAT BOX (Line 210 - 232) ---
    if (replyTo) {
        const replyTag = document.createElement("div");
        replyTag.className = "reply-tag";
        // Inline style add kar raha hoon taaki background aur border sahi dikhe
        replyTag.style.background = "rgba(0, 0, 0, 0.3)";
        replyTag.style.borderLeft = "4px solid #00f7ff";
        replyTag.style.padding = "5px 8px";
        replyTag.style.marginBottom = "8px";
        replyTag.style.borderRadius = "6px";
        replyTag.style.cursor = "pointer";

        replyTag.innerHTML = `
            <small style="color: #00f7ff; font-weight: bold; display: block; font-size: 0.75em;">@${replyTo.user}</small>
            <p style="margin: 0; font-size: 0.85em; color: #eee; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px;">${replyTo.text}</p>
        `;

        replyTag.onclick = () => {
            const target = document.querySelector(`[data-id='${replyTo.msgId}']`);
            if (target) {
                target.scrollIntoView({ behavior: "smooth", block: "center" });
                target.classList.add("highlight-msg");
                setTimeout(() => target.classList.remove("highlight-msg"), 2000);
            }
        };
        div.appendChild(replyTag);
    }

// --- PURANA IDENTICAL CODE HATAO AUR SIRF YE RAKHO ---
const msgEl = document.createElement("span"); // ✅ 'div' ki jagah 'span' karo
msgEl.className = "msg-text";

    // Text content set karo
    if (text === "This message was deleted" || text === "🚫 This message was deleted") {
        msgEl.textContent = "🚫 This message was deleted";
        msgEl.style.fontStyle = "italic";
        msgEl.style.opacity = "0.6";
    } else {
        msgEl.textContent = text;
    }

    // IMPORTANT: msgEl ko message bubble (div) ke andar daalo
    div.appendChild(msgEl);

    // --- META (TIME & STATUS) ---
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

    // --- REACTION POPUP (WhatsApp Style) ---
    const reactContainer = document.createElement("div");
    reactContainer.className = "reaction-popup";

    const emojiList = ["❤️", "👍", "😂", "😮", "😢", "🔥", "👏", "🎉", "💯"];
    emojiList.forEach(emoji => {
        const btn = document.createElement("span");
        btn.className = "reaction-emoji";
        btn.textContent = emoji;

        const reactedUsers = reactions?.[emoji] || [];
        if (reactedUsers.includes(window.currentUser)) {
            btn.style.background = "rgba(0, 247, 255, 0.25)";
            btn.style.borderRadius = "50%";
        }

        btn.onclick = (e) => {
            e.stopPropagation();
            if (!messageId || !ws || ws.readyState !== WebSocket.OPEN) return;
            ws.send(JSON.stringify({ type: "react", room: "public", msgId: messageId, emoji }));
            reactContainer.classList.remove("show");
        };
        reactContainer.appendChild(btn);
    });

    // 🚩 IMPORTANT: reactContainer ko bubble mein add karo
    div.appendChild(reactContainer);

    function showReactionPopup() {
        document.querySelectorAll(".reaction-popup.show").forEach(el => el.classList.remove("show"));
        const rect = div.getBoundingClientRect();

        // Vertical positioning
        if (rect.top < 120) {
            reactContainer.style.top = "110%";
            reactContainer.style.bottom = "auto";
        } else {
            reactContainer.style.bottom = "120%";
            reactContainer.style.top = "auto";
        }

        // Horizontal positioning
        if (isMe) {
            reactContainer.style.left = "auto";
            reactContainer.style.right = "5px"; 
        } else {
            reactContainer.style.right = "auto";
            reactContainer.style.left = "5px";
        }

        reactContainer.classList.add("show");
        if (window.navigator.vibrate) window.navigator.vibrate(20);
    }

    let touchStartX = 0;
    let touchStartY = 0;
    let touchMoveX = 0;
    let pressTimer;

    div.addEventListener("touchstart", (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchMoveX = touchStartX;
        pressTimer = setTimeout(showReactionPopup, 500);
    }, { passive: true });
    /* --- ISKO REPLACE KARO (Line 336 to 363) --- */
    div.addEventListener("touchmove", (e) => {
        let currentX = e.touches[0].clientX;
        let currentY = e.touches[0].clientY;
        const diffX = currentX - touchStartX;
        const diffY = currentY - touchStartY;

        if (Math.abs(diffX) < 10 && Math.abs(diffY) < 10) return;

        if (Math.abs(diffY) > Math.abs(diffX)) {
            clearTimeout(pressTimer);
            div.style.transform = "translateX(0px)";
            return;
        }

        clearTimeout(pressTimer);

        // ✅ NEW: Check if message is already deleted to prevent visual swipe
        const isDeletedNow = text.includes("deleted") || div.querySelector(".msg-text")?.textContent.includes("deleted");

        // Swipe limit visual feedback
        if (diffX > 0 && diffX < 80) { // Right swipe (Reply) - Hamesha chalega
            div.style.transform = `translateX(${diffX}px)`;
            div.style.transition = "none";
        } else if (diffX < 0 && diffX > -80 && isMe && !isDeletedNow) { // ✅ Left swipe (Delete) - Sirf tab jab delete na ho
            div.style.transform = `translateX(${diffX}px)`;
            div.style.transition = "none";
        }

        touchMoveX = currentX;
    }, { passive: true });


    // Isko Line 368 se 412 ki jagah paste karein
    div.addEventListener("touchend", () => {
        clearTimeout(pressTimer);
        const diff = touchMoveX - touchStartX;

        // 1. Right Swipe -> Reply
        if (diff > 70) {
            currentReplyData = { msgId: messageId, user: user, text: text };
            const replyUserEl = document.getElementById("replyUser");
            const replyTextEl = document.getElementById("replyText");
            const replyPreviewEl = document.getElementById("replyPreview");

            if (replyUserEl && replyTextEl && replyPreviewEl) {
                replyUserEl.textContent = user;
                replyTextEl.textContent = text;
                replyPreviewEl.classList.remove("hidden");
                input.focus();
                if (window.navigator.vibrate) window.navigator.vibrate(15);
            }
        } 
        // 2. Left Swipe -> Delete
        else if (diff < -70 && isMe) {
            const isAlreadyDeleted = text.includes("deleted") || div.querySelector(".msg-text")?.textContent.includes("deleted");
            if (!isAlreadyDeleted) {
                if (confirm("Delete for everyone?")) {
                    ws.send(JSON.stringify({ type: "delete-msg", msgId: messageId }));
                    if (window.navigator.vibrate) window.navigator.vibrate(20);
                }
            }
        }

        // ✅ Reset Position: Ye hamesha execute hoga, swipe freeze nahi hoga
        div.style.transition = "transform 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28)";
        div.style.transform = "translateX(0px)";

        touchStartX = 0;
        touchMoveX = 0;
    });

    wrapper.appendChild(div);

    const wasAtBottom = Math.abs(chat.scrollHeight - chat.scrollTop - chat.clientHeight) < 50;

    if (isHistory) {
        chat.prepend(wrapper);
    } else {
        chat.appendChild(wrapper);
    }

    if (!isHistory && chat.children.length > 200) { 
        chat.removeChild(chat.firstChild);
    }

    if (isHistory) {
        if (typeof historyLoaded === 'undefined' || !historyLoaded) {
            chat.scrollTop = chat.scrollHeight;
            window.historyLoaded = true;
        }
    } else {
        if (wasAtBottom || isMe) {
            setTimeout(() => {
                chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
            }, 50);
        } else {
            if (typeof unseenCount !== 'undefined') {
                unseenCount++;
                if (typeof updateNewMsgBtn === 'function') updateNewMsgBtn();
            }
        }
    }

    lastMessageUser = user;
    lastMessageTime = time;
} // <--- Function closing brace


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
  // Agar text khali hai toh return kar jao
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

  // 1. Payload taiyar karo
  const payload = {
    type: "chat",
    room: "public",
    text: text,
    messageId: Date.now() 
  };

  // 2. IMPORTANT: Agar user reply de raha hai, toh attach karo
  if (currentReplyData && currentReplyData.msgId) {
    payload.replyTo = {
      msgId: currentReplyData.msgId,
      user: currentReplyData.user,
      text: currentReplyData.text
    };
  }

  // 3. Server ko bhejo
  ws.send(JSON.stringify(payload));

  // 4. UI Clean up (Message bhejne ke baad hi reset karo)
  input.value = "";

  // Reply data clear karo taaki agla message normal jaye
  currentReplyData = null; 

  // Preview hide karo
  const preview = document.getElementById("replyPreview");
  if (preview) {
    preview.classList.add("hidden");
  }

  if (typeof playSendSound === "function") playSendSound();
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

    // ✅ YE WALA BLOCK YAHAN DAAREIN (handleWSMessage ke shuruat mein)
    if (data.type === "ban-list") {
        const banContent = document.getElementById("banListContent");
        if (!banContent) return;
        
        banContent.innerHTML = ""; 
        
        if (!data.users || data.users.length === 0) {
            banContent.innerHTML = `<p style="color: #64748b; text-align: center; padding: 20px;">No users banned yet.</p>`;
        } else {
            data.users.forEach(user => {
                const row = document.createElement("div");
                row.style.cssText = "display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.05); padding: 10px; border-radius: 10px; margin-bottom: 8px;";
                
                row.innerHTML = `
                    <div style="overflow: hidden; text-align: left;">
                        <div style="color: white; font-weight: bold; font-size: 0.9em;">${user.name}</div>
                        <div style="color: #94a3b8; font-size: 0.75em;">${user.email}</div>
                    </div>
                    <button class="real-unban-btn" 
                            style="background: #10b981; color: white; border: none; padding: 5px 10px; border-radius: 6px; font-size: 12px; font-weight: bold; cursor: pointer;">
                        Unban
                    </button>
                `;

                // ✅ Direct Listener lagao (Inline onclick se behtar hai)
                row.querySelector(".real-unban-btn").addEventListener("click", () => {
                    window.sendAdminAction(user.email, user.name, 'unban');
                });

                banContent.appendChild(row);
            });

        }
        return; // ✅ Ye zaroori hai taaki aage ka chat logic na chale
    }
    // --------------------------------------------------

    // ... Tera purana Kick/Ban Notice wala code yahan se shuru hoga ...


    // 🚀 1. BAN / KICK OVERLAY LOGIC (Add this here)
    if (data.type === "kick-notice" || data.type === "ban-notice") {
        const typeTitle = data.type === "ban-notice" ? "⛔ PERMANENTLY BANNED" : "⚠️ KICKED FROM CHAT";
        const message = data.type === "ban-notice" 
            ? "Your access has been permanently revoked for violating community guidelines." 
            : "You have been kicked from the current session by an admin.";

        // Poori screen ko naye design se replace kar do
        document.body.innerHTML = `
            <div style="height: 100vh; background: #0a0f1e; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; font-family: 'Segoe UI', Roboto, sans-serif; padding: 20px; overflow: hidden;">
                <div style="background: rgba(255, 71, 87, 0.05); border: 1px solid rgba(255, 71, 87, 0.3); padding: 40px; border-radius: 24px; box-shadow: 0 0 40px rgba(255, 71, 87, 0.1); max-width: 450px; width: 100%;">
                    <div style="font-size: 50px; margin-bottom: 20px;">🚫</div>
                    <h1 style="color: #ff4757; font-size: 1.8rem; margin-bottom: 15px; font-weight: 800; letter-spacing: -0.5px;">${typeTitle}</h1>
                    <p style="font-size: 1rem; color: #cbd5e1; line-height: 1.6; margin-bottom: 25px;">${message}</p>
                    
                    <div style="background: rgba(0, 247, 255, 0.03); border: 1px dashed rgba(0, 247, 255, 0.3); padding: 20px; border-radius: 16px; margin-bottom: 25px;">
                        <p style="margin: 0 0 10px 0; color: #94a3b8; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 1px;">Appeal this action</p>
                        <a href="mailto:support@yourdomain.com" style="color: #00f7ff; font-weight: bold; text-decoration: none; font-size: 1.1rem; word-break: break-all;">📩 support@yourdomain.com</a>
                    </div>

                    <button onclick="window.location.href='/login'" style="background: #1e293b; color: white; border: 1px solid #334155; padding: 12px 24px; border-radius: 12px; cursor: pointer; font-weight: 600; transition: 0.3s; width: 100%;">Return to Login</button>
                </div>
            </div>
        `;
        
        // Browser se data saaf karo taaki wo wapas na ghuse
        localStorage.removeItem("chatUser");
        if(ws) ws.close(); 
        return; // Important: Iske neeche ka koi code mat chalao
    }

    // --- Iske neeche tera purana code shuru hoga (if (data.type === "me") etc.) ---
if (data.type === "me") {
  window.currentUser = data.name || data.email;
  window.currentEmail = data.email; // ✅ Ye line add karo sidebar check ke liye
  window.currentUserRole = data.role || "user"; // ✅ YE LINE ADD KARO
  window.currentAvatar = data.avatar || "";
  localStorage.setItem("chatUser", window.currentUser);
  // ✅ YE ADD KARO: Agar user admin nahi hai, toh Manage Ban button gayab kar do
  const banBtn = document.getElementById("openBanListBtn");
  if (banBtn) {
      banBtn.style.display = (window.currentUserRole === "admin") ? "block" : "none";
  }
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

    // 🆕 Sidebar update logic
    if (data.type === "online-users-list") {
      // Top bar wala count update karo
      const onlineEl = document.getElementById("online");
      if (onlineEl) onlineEl.textContent = `${data.count} Live`;

      // Sidebar ki list update karo
      onlineUsersList = data.users;
      updateSidebarUI(); 
    }

    if (data.type === "history") {
      removeHistoryLoader(); // <--- Ye line add karo
      // 1. Purani height save kar lo (Scroll freeze ke liye)
      const oldScrollHeight = chat.scrollHeight;

if (data.messages && data.messages.length > 0) {
        // Sabse purane message ka time save karo agli request ke liye
        oldestMessageTime = data.messages[0].time;

        // Messages ko reverse karke addMessage call karo
data.messages.forEach(msg => {
    // addMessage parameters: user, text, isHistory, time, messageId, reactions, status, avatar, replyTo, role
    addMessage(
        msg.user, 
        msg.text, 
        true,                // isHistory (Important)
        msg.time, 
        msg._id, 
        msg.reactions, 
        msg.status || "server", 
        msg.avatar, 
        msg.replyTo, 
        msg.role,            // ✅ Ye ab sahi 10th position par hai
        msg.email
    );
});


        // 2. Scroll Position Maintain Karo (MAGIC STEP)
        if (!data.isInitial) {
          const newScrollHeight = chat.scrollHeight;
          chat.scrollTop = newScrollHeight - oldScrollHeight;
        }
      }

      // Agar messages 30 se kam aaye hain (Jo humne server pe limit rakhi hai), matlab aur history nahi hai
      if (data.messages.length < 30) historyEndReached = true;

      loadingHistory = false;
      historyLoaded = true;
    }


if (data.type === "chat") {
   removeTypingIndicator();

   const isMe =
     (data.msg.user || "").trim().toLowerCase() ===
     (window.currentUser || "").trim().toLowerCase();

addMessage(
  data.msg.user,
  data.msg.text,
  false,               // isHistory
  data.msg.time,
  data.msg._id,
  data.msg.reactions,
  data.msg.status || "server",
  data.msg.avatar,
  data.msg.replyTo,
  data.msg.role || "user", // ✅ Agar server se role na aaye toh default 'user' rahe
 data.msg.email // ✅ YE 11th POSITION PAR ADD KARO
);



   updateMessageStatus(data.msg._id, 'seen');

    // 🔊 Sound play logic (Updated)
    if (data.msg.user === "SYSTEM") {
        // SYSTEM message ke liye alert bajao
        const alertSound = new Audio("alert.mp3");
        alertSound.play().catch(() => {});
    } else {
        // Normal messages ke liye purana logic
        if (isMe) {
            playSendSound();
        } else {
            playReceiveSound();
        }
    }

}

    if (data.type === "chat-update") updateMessage(data.msg);
    if (data.type === "status-update") updateMessageStatus(data.msgId, data.state);
    // --- HANDLE MESSAGE DELETION ---
    if (data.type === "msg-deleted") {
      const msgDiv = document.querySelector(`[data-id='${data.msgId}']`);
      if (msgDiv) {
        const textEl = msgDiv.querySelector(".msg-text");
        if (textEl) {
          textEl.textContent = "🚫 This message was deleted";
          textEl.style.fontStyle = "italic";
          textEl.style.opacity = "0.6";
        }
        // Reaction popup hata do taaki delete ke baad koi react na kare
        const popup = msgDiv.querySelector(".reaction-popup");
        if (popup) popup.remove();

        // Meta data (ticks) hata do
        const status = msgDiv.querySelector(".status");
        if (status) status.remove();
      }
    }
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
 function showHistoryLoader() {
   if (document.getElementById("historyLoader")) return;
   const loader = document.createElement("div");
   loader.id = "historyLoader";
   loader.innerHTML = `
  <div class="loader-capsule">
    <div class="spinner"></div>
    <span class="loader-text">Loading History...</span>
  </div>
`;

   chat.prepend(loader); // Sabse upar dikhayenge
 }

 function removeHistoryLoader() {
   const loader = document.getElementById("historyLoader");
   if (loader) loader.remove();
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
      const atBottom = chat.scrollHeight - scrollTop <= chat.clientHeight + 10;

      if (atBottom) { 
        unseenCount = 0; 
        updateNewMsgBtn(); 
      }

      // Jab user top ke paas ho (80px), purani history mangwao
      const nearTop = scrollTop <= 80;
      if (nearTop && !loadingHistory && !historyEndReached) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          loadingHistory = true;
           showHistoryLoader(); // <--- Ye line add karo
          // oldestMessageTime bhej rahe hain server ko
          ws.send(JSON.stringify({ 
            type: "history", 
            room: "public", 
            beforeTime: oldestMessageTime 
          }));
        }
      }
      scrollTicking = false;
    });
  }, { passive: true });


  // Global click to close popups
  document.addEventListener("click", () => {
    document.querySelectorAll(".reaction-popup.show").forEach(el => el.classList.remove("show"));
  });
 // DOMContentLoaded ke andar kahin bhi add kar do
 document.getElementById("cancelReply").onclick = () => {
     currentReplyData = null;
     document.getElementById("replyPreview").classList.add("hidden");
 };
/* ================= PROFILE MODAL LOGIC (UPDATED) ================= */
window.openProfile = function(name, avatar, role = "user", email = "") {
    const modal = document.getElementById("userModal");
    const mName = document.getElementById("modalName");
    const mAvatar = document.getElementById("modalAvatar");
    const mEmail = document.getElementById("modalEmail");
    const adminActions = document.getElementById("adminActions"); 

    if (modal && mName && mAvatar) {
        mName.textContent = name;
        mAvatar.src = avatar || "logo.png";
        
        if (role === "admin") {
            mEmail.innerHTML = `<span style="color: #00f7ff; font-weight: bold;">👑 Server Owner / Admin</span>`;
        } else {
            mEmail.textContent = "Community Member";
            mEmail.style.color = "#aaa";
        }

        // 🛡️ ADMIN CONTROLS
        if (window.currentUserRole === "admin" && email !== window.currentEmail) {
            adminActions.innerHTML = `
                <div class="admin-btn-group" style="margin-top: 20px; display: flex; gap: 10px; justify-content: center; width: 100%;">
                    <button id="kickBtnNode" class="btn-kick" style="background: #ff9800; color: white; border: none; padding: 10px 15px; border-radius: 8px; font-weight: bold; cursor: pointer;">
                        Kick
                    </button>
                    <button id="banBtnNode" class="btn-ban" style="background: #f44336; color: white; border: none; padding: 10px 15px; border-radius: 8px; font-weight: bold; cursor: pointer;">
                        Ban User
                    </button>
                </div>
            `;

            // ✅ NAYA TARIKA: Direct Event Listeners lagao (Inline onclick ki jagah)
            document.getElementById("kickBtnNode").addEventListener("click", () => {
                window.sendAdminAction(email, name, 'kick');
            });
            document.getElementById("banBtnNode").addEventListener("click", () => {
                window.sendAdminAction(email, name, 'ban');
            });

        } else {
            adminActions.innerHTML = "";
        }
        
        modal.classList.remove("hidden");
    }
};


// ✅ Modal close button logic
const closeModalBtn = document.getElementById("closeModal");
if (closeModalBtn) {
    closeModalBtn.onclick = () => {
        document.getElementById("userModal").classList.add("hidden");
    };
}

// 🚀 Server ko request bhejne wala function
window.sendAdminAction = function(email, name, action) {
    if (!email || email === "undefined") return alert("Error: User email missing!");
    
    const confirmMsg = action === 'ban' ? `PERMANENTLY BAN ${name}?` : `Kick ${name} from chat?`;
    if (!confirm(confirmMsg)) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
       // ✅ SAHI JAGAH YE HAI (Admin Action ke andar)
          alert("Action " + action + " sent for " + email); 
        ws.send(JSON.stringify({
            type: "admin-action",
            targetEmail: email,
            targetName: name,
            action: action
        }));
        document.getElementById("userModal").classList.add("hidden");
    }
};

  /* ================= SIDEBAR UI RENDERER ================= */
  function updateSidebarUI() {
    const sidebarContainer = document.querySelector(".sidebar-content"); // Check karo ye ID/Class tere HTML mein ho
    if (!sidebarContainer) return;

    sidebarContainer.innerHTML = ""; // Purani list saaf karo

    onlineUsersList.forEach(user => {
      const userRow = document.createElement("div");
      userRow.className = "sidebar-user-row";
      
      // Agar wo khud hai (Me), toh thoda alag dikhao (Optional)
      const isMe = user.email === window.currentEmail; // Make sure currentEmail set ho

      userRow.innerHTML = `
        <div class="sidebar-avatar-wrapper">
          <img src="${user.avatar || 'default-avatar.png'}" class="sidebar-avatar" onerror="this.src='default-avatar.png'">
          <span class="online-status-dot"></span>
        </div>
        <div class="sidebar-user-info">
          <span class="sidebar-user-name">${user.name}</span>
          <span class="sidebar-user-status">Online</span>
        </div>
      `;

      // Click karne par us bande ka profile modal khul jaye
      userRow.onclick = () => {
        if (typeof window.openProfile === "function") {
          // Humne sidebar data mein role pehle hi bhej diya hai
          window.openProfile(user.name, user.avatar, user.role, user.email); // ✅ email add kiya
        }
      };

      sidebarContainer.appendChild(userRow);
    });
  }

/* ================= SIDEBAR TOGGLE (INSIDE 3-DOT) ================= */
const toggleBtn = document.getElementById("toggleSidebar");
const sidebar = document.querySelector(".sidebar");

if (toggleBtn && sidebar) {
  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    sidebar.classList.toggle("active");
    if(menuDropdown) menuDropdown.classList.remove("show");
  });

  // ✅ YE ADD KARO: Sidebar ke bahar click karne par sidebar band ho jaye
  document.addEventListener("click", (e) => {
    if (sidebar.classList.contains("active") && !sidebar.contains(e.target) && e.target !== toggleBtn) {
      sidebar.classList.remove("active");
    }
  });
}

/* ================= BAN MANAGEMENT UI LOGIC ================= */
const banModal = document.getElementById("banListModal");
const openBanBtn = document.getElementById("openBanListBtn");
const closeBanBtn = document.getElementById("closeBanList");
const banContent = document.getElementById("banListContent");

// 1. Modal kholte hi server se list maango
if(openBanBtn) {
    openBanBtn.onclick = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "get-ban-list" }));
            banModal.classList.remove("hidden");
        } // <--- Ye IF ka bracket hai
    }; // <--- Ye onclick ka bracket hai
}

// 2. Modal Band karna
if(closeBanBtn) closeBanBtn.onclick = () => banModal.classList.add("hidden");

// --- AB YAHAN DOMContentLoaded KO BAND KARO ---
}); // <--- Ye line 1 DOMContentLoaded wala bracket hai



// 2. iOS Safari aur baki browsers par "Double Tap to Zoom" ko JS se rokna
document.addEventListener('touchstart', function (event) {
    if (event.touches.length > 1) {
        event.preventDefault(); 
    }
}, { passive: false }); // <--- Check karo ye false hona chahiye

let lastTouchEnd = 0;
document.addEventListener('touchend', function (event) {
    let now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) {
        event.preventDefault(); 
    }
    lastTouchEnd = now;
}, { passive: false }); // <--- Yahan bhi false add kar do safety ke liye
/* ================= SECURITY & ANTI-ANNOYING FEATURES ================= */

// 1. Right Click (Context Menu) Block
document.addEventListener('contextmenu', (e) => {
    // Input field par right click allow rakhte hain taaki paste kar sakein agar zaroorat ho
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
    }
}, false);

// 2. Zoom Block (Ctrl + Plus/Minus/Wheel)
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
        e.preventDefault();
    }
}, { passive: false });

document.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
        e.preventDefault();
    }
}, { passive: false });

// 3. Inspect Element & DevTools Shortcuts Block
document.addEventListener('keydown', (e) => {
    // F12 block
    if (e.key === 'F12') {
        e.preventDefault();
    }
    // Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, Ctrl+U (View Source)
    if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) {
        e.preventDefault();
    }
    if (e.ctrlKey && e.key === 'u') {
        e.preventDefault();
    }
});
/* ================= ANTI-INSPECT TRAP ================= */

// 1. Debugger Trap: Ise uncomment tabhi karna jab site live ho
setInterval(() => {
    // debugger; 
}, 1000);

// 2. Smart Resize Detection (Sirf Desktop ke liye)
window.addEventListener('resize', () => {
    // Mobile par keyboard khulne par height change hoti hai, 
    // isliye width check zaroori hai Inspect Element pakadne ke liye.
    const threshold = 200;
    const isDevToolsOpen = (window.outerWidth - window.innerWidth) > threshold || 
                           (window.outerHeight - window.innerHeight) > threshold;

    // Sirf tab blur karo jab screen ka size kaafi bada ho (Desktop)
    if (window.innerWidth > 768 && isDevToolsOpen) {
        document.body.style.filter = "blur(15px)";
        document.body.style.pointerEvents = "none"; // Click bhi block kar do
    } else {
        document.body.style.filter = "none";
        document.body.style.pointerEvents = "auto";
    }
}); // <--- Yahan pehle function khatam ho raha tha, ab Event Listener bhi band hai.
