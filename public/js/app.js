// app.js code full and final
let ws;
document.addEventListener("DOMContentLoaded", () =>{

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
document.addEventListener("click", () =>{
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
//  let ws;
  let localUptime = 0;       // 🆕 Uptime store karne ke liye
  let uptimeInterval = null; // 🆕 Timer control karne ke liye
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
/* ================= CHAT SOUNDS (UPDATED PATH) ================= */
const sendSound = new Audio("assets/audio/send.mp3");
const receiveSound = new Audio("assets/audio/received.mp3");

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

// --- Line 127 se 137 ke beech isse badlein ---
    ws.onclose = () => {
      // 🛑 Connection band toh timer bhi band
      if (uptimeInterval) {
        clearInterval(uptimeInterval);
        uptimeInterval = null;
      }

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
// Isline ko replace karo
function addMessage(user, text, isHistory = false, time = Date.now(), messageId = null, reactions = {}, status = "server", avatar = "", replyTo = null, role = "user", email = "") {

    if (messageId && renderedMessages.has(messageId)) return;
    if (messageId) renderedMessages.add(messageId);

    const isMe = (user || "").trim().toLowerCase() === (window.currentUser || "").trim().toLowerCase();
    const wrapper = document.createElement("div");
    wrapper.className = isMe ? "message-row me" : "message-row";

    // ----------------- DATE SEPARATOR (UPDATED) -----------------
    const messageDate = new Date(time);
    const messageDateStr = messageDate.toDateString();

    let existingDate = chat.querySelector(`.date-separator[data-date="${messageDateStr}"]`);

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
        else dateDiv.textContent = messageDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

        dateWrapperOuter.appendChild(dateDiv);

        if (isHistory) {
            // History load ho rahi hai toh date ko sabse upar (top) par rakho
            chat.prepend(dateWrapperOuter);
        } else {
            // Live message aa raha hai toh date ko niche (bottom) par rakho
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
    // 1. Text Content Handling (No Media)
    const msgEl = document.createElement("span");
    msgEl.className = "msg-text";

    if (text === "This message was deleted" || text === "🚫 This message was deleted") {
        msgEl.textContent = "🚫 This message was deleted";
        msgEl.style.fontStyle = "italic";
        msgEl.style.opacity = "0.6";
        div.appendChild(msgEl);
    } else if (text && text.trim() !== "") {
        // Simple text message handle karein
        msgEl.textContent = text;
        div.appendChild(msgEl);
    }

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
} //<--- Function closing brace
function updateMessage(msg) {
    if (!msg) return;
    const mId = msg._id || msg.id;
    if (!mId) return;

    const messageDiv = document.querySelector(`[data-id="${mId}"]`);
    if (!messageDiv) return;

    let wrapper = messageDiv.querySelector(".msg-reactions-wrapper");
    if (!wrapper) {
        wrapper = document.createElement("div");
        wrapper.className = "msg-reactions-wrapper";
        messageDiv.appendChild(wrapper);
    }

    wrapper.innerHTML = ""; 
    
    // GAP FIX: Reaction nahi toh space nahi
    if (!msg.reactions || Object.keys(msg.reactions).length === 0) {
        messageDiv.style.marginBottom = "4px"; 
        wrapper.style.display = "none";
        return;
    }

    // Reaction aane par smooth gap
    messageDiv.style.marginBottom = "20px"; 
    messageDiv.style.position = "relative";
    messageDiv.style.overflow = "visible";
    wrapper.style.display = "flex";

    wrapper.style.cssText = `
        position: absolute;
        bottom: -12px;
        display: flex;
        align-items: center;
        z-index: 100;
        cursor: pointer;
        pointer-events: auto;
        background: rgba(11, 20, 26, 0.6);
        border-radius: 12px;
        padding: 2px 4px;
    `;

    const isMe = messageDiv.classList.contains('me');
    wrapper.style.right = isMe ? "8px" : "auto";
    wrapper.style.left = isMe ? "auto" : "8px";

    const reactionEntries = Object.entries(msg.reactions).filter(([_, users]) => users.length > 0);
    
    // WhatsApp Stacking (Overlap)
    reactionEntries.slice(0, 3).forEach(([emoji, users], index) => {
        const pill = document.createElement("span");
        pill.style.cssText = `
            background: #202c33;
            border: 1.5px solid #0b141a;
            border-radius: 50%;
            width: 18px;
            height: 18px;
            display: flex;
            justify-content: center;
            align-items: center;
            font-size: 11px;
            margin-left: ${index === 0 ? "0" : "-6px"};
            box-shadow: 0 1px 3px rgba(0,0,0,0.5);
        `;
        pill.innerText = emoji;
        wrapper.appendChild(pill);
    });

    const totalCount = reactionEntries.reduce((sum, [_, users]) => sum + users.length, 0);
    if (totalCount > 1) {
        const countBadge = document.createElement("span");
        countBadge.style.cssText = `color: #00e5ff; font-size: 10px; margin-left: 5px; font-weight: bold;`;
        countBadge.innerText = totalCount;
        wrapper.appendChild(countBadge);
    }

    // Click to Open Telegram Style Popup
    wrapper.onclick = (e) => {
        e.stopPropagation();
        showTelegramStyleReactions(msg.reactions);
    };
}

// 🚩 TELEGRAM STYLE POPUP (WITH NAMES & THEME MATCH)
function showTelegramStyleReactions(reactions) {
    const oldBox = document.getElementById("reaction-detail-popup");
    if (oldBox) oldBox.remove();

    const detailBox = document.createElement("div");
    detailBox.id = "reaction-detail-popup";
    
    // Theme colors matching your "Isophilia" screenshot (Cyan/Neon)
    detailBox.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%) scale(0.9);
        background: rgba(15, 25, 30, 0.95);
        backdrop-filter: blur(10px);
        padding: 12px;
        border-radius: 20px;
        z-index: 2000;
        min-width: 220px;
        max-width: 280px;
        border: 1px solid #00e5ff;
        box-shadow: 0 0 20px rgba(0, 229, 255, 0.3);
        color: white;
        transition: transform 0.2s ease;
    `;

    let contentHtml = `<div style="text-align:center; font-size: 13px; color: #00e5ff; margin-bottom: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">Reactions</div>`;
    
    contentHtml += `<div style="max-height: 250px; overflow-y: auto; padding-right: 5px;">`;

    Object.entries(reactions).forEach(([emoji, users]) => {
        if(users.length > 0) {
            users.forEach(userName => {
                // Formatting name: Agar email hai toh '@' se pehle wala part lo
                const displayName = userName.split('@')[0]; 
                
                contentHtml += `
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; background: rgba(255,255,255,0.05); padding: 8px 12px; border-radius: 12px;">
                    <span style="font-size: 14px; color: #fff;">${displayName}</span>
                    <span style="font-size: 16px;">${emoji}</span>
                </div>`;
            });
        }
    });
    
    contentHtml += `</div>`;

    detailBox.innerHTML = contentHtml;
    document.body.appendChild(detailBox);

    // Animation Effect
    setTimeout(() => { detailBox.style.transform = "translateX(-50%) scale(1)"; }, 10);

    // Click outside to close (Telegram style)
    const closeListener = (e) => {
        if (!detailBox.contains(e.target)) {
            detailBox.style.transform = "translateX(-50%) scale(0.9)";
            detailBox.style.opacity = "0";
            setTimeout(() => detailBox.remove(), 200);
            window.removeEventListener('click', closeListener);
        }
    };
    
    setTimeout(() => { window.addEventListener('click', closeListener); }, 100);
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
     // 🛡️ Mute Check: Agar input disabled hai toh message mat bhejo
  if (input.disabled) {
      console.error("Tu muted hai bhai!");
      return;
  }

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
input.addEventListener("input", () =>{
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

// 🆕 Function to update only the seconds on screen
function updateLiveUptimeDisplay(seconds) {
    const uptimeElem = document.getElementById("liveUptimeDisplay");
    if (!uptimeElem) return;

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    // Format: 0h 0m 0s (Tujhe jaisa pasand ho)
    uptimeElem.innerText = `${hrs}h ${mins}m ${secs}s`;
}


  function handleWSMessage(event) {
    const data = JSON.parse(event.data);

// handleWSMessage ke andar 'all-members-list' block
if (data.type === "all-members-list") {

    // ✅ SAFE TIMER LOGIC: Purane timer ko pehle clear karo
    if (data.uptime !== undefined) {
        if (uptimeInterval) {
            clearInterval(uptimeInterval);
            uptimeInterval = null;
        }

        localUptime = data.uptime;

        // Naya fresh timer shuru
        uptimeInterval = setInterval(() => {
            localUptime++;
            updateLiveUptimeDisplay(localUptime);
        }, 1000);
    }


    // 📊 2. STATS UPDATE (Iske andar id="liveUptimeDisplay" zaroori hai)
    const statsContainer = document.getElementById("adminStatsBar");
    if (statsContainer && data.stats) {
        const hrs = Math.floor(data.uptime / 3600);
        const mins = Math.floor((data.uptime % 3600) / 60);
        const secs = data.uptime % 60;
        const uptimeStr = `${hrs}h ${mins}m ${secs}s`;

        statsContainer.innerHTML = `
            <div style="background: rgba(0,0,0,0.3); padding: 5px; border-radius: 8px; text-align: center; border: 1px solid rgba(0, 247, 255, 0.2);">
                <span style="display:block; font-size: 0.6rem; color: #00f7ff; text-transform: uppercase;">Uptime</span>
                <strong id="liveUptimeDisplay" style="font-size: 0.8rem; color: #fff;">${uptimeStr}</strong>
            </div>
            <div style="background: rgba(0,0,0,0.3); padding: 5px; border-radius: 8px; text-align: center; border: 1px solid rgba(0, 247, 255, 0.2);">
                <span style="display:block; font-size: 0.6rem; color: #00f7ff; text-transform: uppercase;">Online</span>
                <strong style="font-size: 0.8rem; color: #fff;">${data.stats.online}</strong>
            </div>
            <div style="background: rgba(0,0,0,0.3); padding: 5px; border-radius: 8px; text-align: center; border: 1px solid rgba(0, 247, 255, 0.2);">
                <span style="display:block; font-size: 0.6rem; color: #00f7ff; text-transform: uppercase;">Msgs</span>
                <strong style="font-size: 0.8rem; color: #fff;">${data.stats.messages}</strong>
            </div>
            <div style="background: rgba(0,0,0,0.3); padding: 5px; border-radius: 8px; text-align: center; border: 1px solid rgba(239, 68, 68, 0.2);">
                <span style="display:block; font-size: 0.6rem; color: #ef4444; text-transform: uppercase;">Banned</span>
                <strong style="font-size: 0.8rem; color: #fff;">${data.stats.banned}</strong>
            </div>
        `;
    }

    // 2. MEMBERS LIST (Wahi purana styling jo tune diya tha)
    const container = document.getElementById("banListContent");
    if (!container) return;
    container.innerHTML = ""; 

    if (!data.users || data.users.length === 0) {
        container.innerHTML = `<tr><td style="text-align: center; padding: 20px; color: #64748b; font-size: 0.8rem;">No members found.</td></tr>`;
    } else {
        data.users.forEach(user => {
            const tr = document.createElement("tr");

            const muteText = user.isMuted ? "Unmute" : "Mute";
            const banText = user.isBanned ? "Unban" : "Ban";

            // BILKUL WAHI PURANA STYLE JO TUNE DIYA THA
            tr.innerHTML = `
                <td style="padding: 7px; display: flex; align-items: center; gap: 8px; width: 130px; min-width: 130px;">
                    <div class="avatar-wrapper" style="position: relative;">
                        <img src="${user.avatar || 'logo.png'}" style="width: 32px; height: 32px; min-width: 32px; border-radius: 50%; object-fit: cover; border: 1px solid #00f7ff;">
                        <span style="position: absolute; bottom: 0; right: 0; width: 8px; height: 8px; border-radius: 50%; background: ${user.isOnline ? '#22c55e' : '#64748b'}; border: 2px solid #020202; box-shadow: ${user.isOnline ? '0 0 8px #22c55e' : 'none'};"></span>
                    </div>
                    <div style="overflow: hidden; flex: 1;">
                        <div style="color: #fff; font-weight: bold; font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">${user.name}</div>
                        <div style="color: #64748b; font-size: 0.6rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">${user.email}</div>
                    </div>
                </td>
                <td style="padding: 5px; text-align: left;">
                    <div style="display: flex; gap: 3px; justify-content: flex-start; margin-left: -15px;">
                        <button class="btn-mute" style="padding: 5px 9px; border-radius: 6px; border: 1px solid rgba(0,247,255,0.4); background: linear-gradient(135deg, #020202 0%, #001f3f 40%, #0074D9 100%); color: white; font-size: 9px; cursor: pointer; font-weight: bold; white-space: nowrap;">${muteText}</button>
                        <button class="btn-kick" style="padding: 5px 9px; border-radius: 6px; border: none; background: linear-gradient(135deg, #020202 0%, #001f3f 40%, #f59e0b 100%); color: white; font-size: 9px; cursor: pointer; font-weight: bold;">Kick</button>
                        <button class="btn-ban" style="padding: 5px 9px; border-radius: 6px; border: none; background: linear-gradient(135deg, #020202 0%, #450a0a 40%, #ef4444 100%); color: white; font-size: 9px; cursor: pointer; font-weight: bold; white-space: nowrap;">${banText}</button>
                    </div>
                </td>`;

            // Admin Action Events
            tr.querySelector(".btn-mute").onclick = () => window.sendAdminAction(user.email, user.name, user.isMuted ? 'unmute' : 'mute');
            tr.querySelector(".btn-kick").onclick = () => window.sendAdminAction(user.email, user.name, 'kick');
            tr.querySelector(".btn-ban").onclick = () => window.sendAdminAction(user.email, user.name, user.isBanned ? 'unban' : 'ban');

            container.appendChild(tr);
        });
    }
    return;
}


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
// 🤐 MUTE / UNMUTE LOGIC
if (data.type === "mute-notice") {
    // Sahi ID 'messageInput' use kar rahe hain yahan
    const inputField = document.getElementById("messageInput"); 
    const sendBtn = document.getElementById("sendBtn");

    if (inputField) { // Check lagana achi baat hai
        if (data.isMuted) {
            inputField.disabled = true;
            inputField.value = ""; // Mute hote hi likha hua text saaf kar do
            inputField.placeholder = "🤐 Admin has muted you...";
            inputField.style.background = "rgba(255, 0, 0, 0.05)"; // Halka red tint (optional)

            if(sendBtn) {
                sendBtn.style.pointerEvents = "none";
                sendBtn.style.opacity = "0.5";
            }
        } else {
            inputField.disabled = false;
            inputField.placeholder = "Type a message...";
            inputField.style.background = "transparent";

            if(sendBtn) {
                sendBtn.style.pointerEvents = "auto";
                sendBtn.style.opacity = "1";
            }
        }
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
// Line 838 ke upar add karein
if (data.type === "all-reports-list") {
    const container = document.getElementById("banListContent"); // Hum isi container ko reuse kar rahe hain
    const title = document.querySelector("#banListModal h3"); // Modal ki heading change karne ke liye
    if(title) title.innerText = "🚨 User Reports";

    if (!container) return;
    container.innerHTML = "";

    if (data.reports.length === 0) {
        container.innerHTML = `<tr><td colspan="2" style="text-align:center; padding:20px; color:#aaa;">No reports found.</td></tr>`;
    } else {
        data.reports.forEach(rep => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td style="padding: 10px; color: #fff; font-size: 0.75rem; border-bottom: 1px solid #333;">
                    <strong style="color: #ff4757;">Target: ${rep.targetName}</strong><br>
                    <small>By: ${rep.reportedBy}</small>
                </td>
                <td style="padding: 10px; color: #cbd5e1; font-size: 0.7rem; border-bottom: 1px solid #333;">
                    ${rep.reason}
                    <div style="margin-top:5px;">
                        <button onclick="window.sendAdminAction('${rep.targetEmail}', '${rep.targetName}', 'ban')" style="background:red; color:white; border:none; padding:3px 8px; border-radius:4px; font-size:8px;">Ban User</button>
                    </div>
                </td>
            `;
            container.appendChild(tr);
        });
    }
    document.getElementById("banListModal").classList.remove("hidden");
    return;
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
    removeHistoryLoader();
    const oldScrollHeight = chat.scrollHeight;

    if (data.messages && data.messages.length > 0) {
        oldestMessageTime = data.messages[0].time;

        // --- MAGIC HERE: Messages ko pehle hi reverse kar do ---
        // Taaki loop sahi order mein chale aur prepend sahi se ho
        const reversedMsgs = [...data.messages].reverse(); 

        reversedMsgs.forEach(msg => {
            addMessage(
                msg.user, 
                msg.text, 
                true, // isHistory
                msg.time, 
                msg._id, 
                msg.reactions, 
                msg.status || "server", 
                msg.avatar, 
                msg.replyTo, 
                msg.role,
                msg.email
            );
        });

        if (!data.isInitial) {
            const newScrollHeight = chat.scrollHeight;
            chat.scrollTop = newScrollHeight - oldScrollHeight;
        }
    }
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
  false,               
  data.msg.time,
  data.msg._id,
  data.msg.reactions,
  data.msg.status || "server",
  data.msg.avatar,
  data.msg.replyTo,
  data.msg.role || "user", 
  data.msg.email,
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

// Dono types ko handle karo
if (data.type === "chat-update" || data.type === "reaction-update") {
    // Agar server reactions bhej raha hai toh use msg object jaisa format kar lo
    const msgData = data.msg || { _id: data.msgId, reactions: data.reactions };
    updateMessage(msgData);
}

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

/* ================= PROFILE MODAL LOGIC (CLEANED) ================= */
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

        // Profile ke andar se humne buttons hata diye hain kyunki aapko Manage Panel mein chahiye.
        adminActions.innerHTML = ""; 

        // --- REPORT BUTTON LOGIC START ---
        // --- REPORT BUTTON LOGIC (CONTROLLED BY INDEX) ---
        const reportBtn = document.getElementById("manualReportBtn");

        if (reportBtn) {
            reportBtn.style.display = "block"; // Button ko dikhao
            
            reportBtn.onclick = () => {
                const reason = prompt(`Why are you reporting ${name}? (Min 10 characters)`);
                if (reason) {
                    if (reason.length < 10) {
                        alert("Reason is too short! Please provide more details.");
                        return;
                    }
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: "report-user",
                            targetEmail: email,
                            targetName: name,
                            reason: reason,
                            reportedBy: window.currentUser
                        }));
                        alert("Report sent to admin!");
                        modal.classList.add("hidden");
                    }
                }
            };
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

if (toggleBtn&&sidebar) {
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
const viewReportsBtn = document.getElementById("viewReportsBtn");
const backBtn = document.getElementById("backToManageBtn"); // Naya Back Button
const modalTitle = document.querySelector("#banListModal h3"); // Modal ki Heading
const banContent = document.getElementById("banListContent");

// 1. Modal kholte hi server se list maango
if(openBanBtn) {
    openBanBtn.onclick = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            // ✅ Change here: Purane 'get-ban-list' ko replace karke ye likho
            ws.send(JSON.stringify({ type: "get-all-members" })); 

            // Modal khulne se pehle loader dikha do (Optional but looks professional)
            const container = document.getElementById("banListContent");
            if(container) {
                container.innerHTML = `<tr><td colspan="2" style="text-align:center; padding:20px; color:#6b7280;">Loading members...</td></tr>`;
            }

            banModal.classList.remove("hidden");
        } 
    };
}


// 2. Modal Band karna
if(closeBanBtn) {
    closeBanBtn.onclick = () => {
        banModal.classList.add("hidden");
        // Reset buttons for next time
        if(backBtn) backBtn.classList.add("hidden");
        if(viewReportsBtn) viewReportsBtn.classList.remove("hidden");
        if(modalTitle) modalTitle.innerText = "Manage Users";
    };
}

// Search filter logic
const userSearchInput = document.getElementById("userSearch");
if (userSearchInput) {
    userSearchInput.addEventListener("input", (e) => {
        const term = e.target.value.toLowerCase();
        const rows = document.querySelectorAll("#banListContent tr");

        rows.forEach(row => {
            const text = row.innerText.toLowerCase();
            // Loader row ko ignore karein
            if(row.id === "tableLoader") return;
            row.style.display = text.includes(term) ? "table-row" : "none";
        });
    });
}

if (viewReportsBtn) {
    viewReportsBtn.onclick = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            const container = document.getElementById("banListContent");
            if(container) container.innerHTML = `<tr><td colspan="2" style="text-align:center; padding:20px; color:#aaa;">Fetching reports...</td></tr>`;

            // Server se reports mangwao
            ws.send(JSON.stringify({ type: "get-reports" }));

            // UI Badlo: Report button chupao, Back button dikhao
            viewReportsBtn.classList.add("hidden");
            if(backBtn) backBtn.classList.remove("hidden");
        }
    };
}
if (backBtn) {
    backBtn.onclick = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            // Wapas members ki list maango
            ws.send(JSON.stringify({ type: "get-all-members" }));

            // UI Reset: Back button chupao, Report button dikhao
            backBtn.classList.add("hidden");
            viewReportsBtn.classList.remove("hidden");

            // Heading wapas sahi karo
            if(modalTitle) modalTitle.innerText = "Manage Users";
        }
    };
}


// --- AB YAHAN DOMContentLoaded KO BAND KARO ---
}); //<--- Ye line 1 DOMContentLoaded wala bracket hai



// 2. iOS Safari aur baki browsers par "Double Tap to Zoom" ko JS se rokna
document.addEventListener('touchstart', function (event) {
    if (event.touches.length > 1) {
        event.preventDefault(); 
    }
}, { passive: false }); //<--- Check karo ye false hona chahiye

let lastTouchEnd = 0;
document.addEventListener('touchend', function (event) {
    let now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) {
        event.preventDefault(); 
    }
    lastTouchEnd = now;
}, { passive: false }); //<--- Yahan bhi false add kar do safety ke liye
/* ================= SECURITY&ANTI-ANNOYING FEATURES ================= */

// 1. Right Click (Context Menu) Block
document.addEventListener('contextmenu', (e) =>{
    // Input field par right click allow rakhte hain taaki paste kar sakein agar zaroorat ho
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
    }
}, false);

// 2. Zoom Block (Ctrl + Plus/Minus/Wheel)
document.addEventListener('keydown', (e) =>{
    if (e.ctrlKey && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
        e.preventDefault();
    }
}, { passive: false });

document.addEventListener('wheel', (e) =>{
    if (e.ctrlKey) {
        e.preventDefault();
    }
}, { passive: false });

// 3. Inspect Element&DevTools Shortcuts Block
document.addEventListener('keydown', (e) =>{
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

// Is code ko App.js ki sabse aakhri line ke niche rakho (DOMContentLoaded se bahar)
window.sendAdminAction = function(email, name, action) {
    // Check if email is valid
    if (!email || email === "undefined" || email === "null") {
        alert("Error: User email is missing for this action!");
        return;
    }

    const messages = {
        'ban': `🚫 PERMANENTLY BAN ${name}?`,
        'kick': `⚠️ Kick ${name} from chat?`,
        'mute': `🤐 Mute ${name}?`,
        'unmute': `🔊 Unmute ${name}?`,
        'unban': `✅ Unban ${name}?`
    };

    if (!confirm(messages[action] || `Perform ${action} on ${name}?`)) return;

    // Yahan ensure karo ki 'ws' variable accessible ho
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: "admin-action",
            targetEmail: email,
            targetName: name,
            action: action
        }));
        // Modal hide karne ka logic (optional)
        const banModal = document.getElementById("banListModal");
        if(banModal) banModal.classList.add("hidden");

        console.log(`✅ Action ${action} sent for ${email}`);
    } else {
        alert("Connection lost! Reconnecting...");
    }
};

/* ================= ANTI-INSPECT TRAP ================= */

// 1. Debugger Trap: Ise uncomment tabhi karna jab site live ho
setInterval(() =>{
    // debugger; 
}, 1000);

// 2. Smart Resize Detection (Sirf Desktop ke liye)
window.addEventListener('resize', () =>{
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
}); //<--- Yahan pehle function khatam ho raha tha, ab Event Listener bhi band hai.
