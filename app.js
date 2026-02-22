document.addEventListener("DOMContentLoaded", () => {

/* ================= GLOBAL STATE ================= */

let ws;
let reconnectDelay = 2000;
let oldestMessageId = null;

let unseenCount = 0;
let historyLoaded = false;
let loadingHistory = false;
let historyEndReached = false;

const renderedMessages = new Set();

const chat = document.getElementById("chat");
const input = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const newMsgBtn = document.getElementById("newMsgBtn");

/* ================= HELPERS ================= */

function scrollToBottomSmooth() {
  chat.scrollTo({
    top: chat.scrollHeight,
    behavior: "smooth"
  });
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ================= WEBSOCKET ================= */

function connectWS() {
  ws = new WebSocket(
    (location.protocol === "https:" ? "wss://" : "ws://") + location.host
  );

  ws.onopen = () => {
    reconnectDelay = 2000;

    if (!window.currentUser) {
      window.currentUser = localStorage.getItem("chatUser") || null;
    }

    ws.send(JSON.stringify({
      type: "join",
      room: "public",
      user: window.currentUser
    }));

    ws.send(JSON.stringify({
      type: "history",
      room: "public",
      beforeId: null
    }));
  };

  ws.onmessage = handleWSMessage;

  ws.onclose = () => {
    setTimeout(connectWS, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
  };
}

connectWS();

/* ================= ADD MESSAGE ================= */

function addMessage(
  user,
  text,
  isHistory = false,
  time = Date.now(),
  messageId = null,
  reactions = {},
  status = "server"
) {

  if (messageId && renderedMessages.has(messageId)) return;
  if (messageId) renderedMessages.add(messageId);

  const div = document.createElement("div");
  if (messageId) div.dataset.id = messageId;

  const isMe =
    (user || "").trim().toLowerCase() ===
    (window.currentUser || "").trim().toLowerCase();

  div.className = isMe ? "message sent" : "message received";
  div.style.position = "relative";

  /* ===== NAME ===== */
  const nameEl = document.createElement("div");
  nameEl.className = "name";
  nameEl.textContent = user || "Unknown";
  div.appendChild(nameEl);

  /* ===== TEXT ===== */
  const msgEl = document.createElement("div");
  msgEl.className = "msg-text";
  msgEl.textContent = text;
  div.appendChild(msgEl);

  /* ===== META (TIME + STATUS) ===== */

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
      <svg class="tick small" viewBox="0 0 20 20">
        <polyline points="4 11 8 15 16 6" />
      </svg>
      <svg class="tick big hidden" viewBox="0 0 20 20">
        <polyline points="4 11 8 15 16 6" />
      </svg>
    `;

    meta.appendChild(statusEl);
    setStatusVisual(statusEl, status);
  }

  div.appendChild(meta);

  /* ===== REACTION POPUP ===== */

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

      ws.send(JSON.stringify({
        type: "react",
        room: "public",
        msgId: messageId,
        emoji
      }));

      reactContainer.classList.remove("show");
    };

    reactContainer.appendChild(btn);
  });

  div.appendChild(reactContainer);

  /* ===== LONG PRESS ===== */

  let pressTimer;

  function showReactionPopup() {
    document.querySelectorAll(".reaction-popup.show")
      .forEach(el => el.classList.remove("show"));

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

  div.addEventListener("touchstart", () => {
    pressTimer = setTimeout(showReactionPopup, 400);
  });

  div.addEventListener("touchend", () => {
    clearTimeout(pressTimer);
  });

  div.addEventListener("mousedown", () => {
    pressTimer = setTimeout(showReactionPopup, 400);
  });

  div.addEventListener("mouseup", () => {
    clearTimeout(pressTimer);
  });

  /* ===== APPEND / PREPEND ===== */

  const wasAtBottom =
    chat.scrollTop + chat.clientHeight >= chat.scrollHeight - 20;

  if (isHistory) {
    const prevHeight = chat.scrollHeight;
    chat.prepend(div);
    const newHeight = chat.scrollHeight;
    chat.scrollTop += newHeight - prevHeight;
  } else {
    chat.appendChild(div);
  }

  if (isHistory && !historyLoaded) {
    scrollToBottomSmooth();
    historyLoaded = true;
  } else if (!isHistory) {
    if (wasAtBottom) {
      scrollToBottomSmooth();
    } else {
      unseenCount++;
      updateNewMsgBtn();
    }
  }
}

/* ================= REACTION UPDATE ================= */

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
    } else {
      el.style.background = "transparent";
    }
  });
}

/* ================= STATUS CONTROL ================= */

function setStatusVisual(statusEl, state) {
  const small = statusEl.querySelector(".tick.small");
  const big = statusEl.querySelector(".tick.big");

  big.classList.add("hidden");
  statusEl.classList.remove("seen");

  if (state === "delivered") {
    big.classList.remove("hidden");
  }

  if (state === "seen") {
    big.classList.remove("hidden");
    statusEl.classList.add("seen");
  }
}

function updateMessageStatus(msgId, state) {
  const messageDiv = document.querySelector(`[data-id='${msgId}']`);
  if (!messageDiv) return;

  const statusEl = messageDiv.querySelector(".status");
  if (!statusEl) return;

  setStatusVisual(statusEl, state);
}

/* ================= SEND ================= */

function sendMessage() {
  const text = input.value.trim();
  if (!text) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({
    type: "chat",
    room: "public",
    text
  }));

  input.value = "";
}

sendBtn.addEventListener("click", sendMessage);
input.addEventListener("keydown", e => {
  if (e.key === "Enter") sendMessage();
});

/* ================= WS HANDLER ================= */

function handleWSMessage(event) {

  const data = JSON.parse(event.data);

  if (data.type === "me") {
    window.currentUser = data.email;
    localStorage.setItem("chatUser", data.email);
    return;
  }

  if (data.type === "online-users") {
    document.getElementById("online").textContent =
      `${data.count} Live`;
  }

  if (data.type === "history") {

    if (data.messages.length > 0) {
      oldestMessageId = data.messages[0]._id;
    }

    data.messages.forEach(msg => {
      addMessage(
        msg.user,
        msg.text,
        true,
        msg.time,
        msg._id,
        msg.reactions,
        msg.status || "server"
      );
    });

    if (data.messages.length < 500) {
      historyEndReached = true;
    }
  }

  if (data.type === "chat") {
    addMessage(
      data.msg.user,
      data.msg.text,
      false,
      data.msg.time,
      data.msg._id,
      data.msg.reactions,
      data.msg.status || "server"
    );
  }

  if (data.type === "chat-update") {
    updateMessage(data.msg);
  }

  if (data.type === "status-update") {
    updateMessageStatus(data.msgId, data.state);
  }
}

/* ================= NEW MESSAGE BUTTON ================= */

function updateNewMsgBtn() {
  if (unseenCount > 0) {
    newMsgBtn.textContent = `${unseenCount} new message(s) ⬇`;
    newMsgBtn.classList.remove("hidden");
  } else {
    newMsgBtn.classList.add("hidden");
  }
}

newMsgBtn.addEventListener("click", () => {
  scrollToBottomSmooth();
  unseenCount = 0;
  updateNewMsgBtn();
});

/* ================= SCROLL ================= */

chat.addEventListener("scroll", () => {

  const atBottom =
    chat.scrollHeight - chat.scrollTop <= chat.clientHeight + 5;

  if (atBottom) {
    unseenCount = 0;
    updateNewMsgBtn();
  }

  if (chat.scrollTop === 0 && !loadingHistory && !historyEndReached) {

    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    loadingHistory = true;

    ws.send(JSON.stringify({
      type: "history",
      room: "public",
      beforeId: oldestMessageId
    }));

    setTimeout(() => {
      loadingHistory = false;
    }, 1000);
  }
});

/* ===== GLOBAL CLICK CLOSE POPUP ===== */

document.addEventListener("click", () => {
  document.querySelectorAll(".reaction-popup.show")
    .forEach(el => el.classList.remove("show"));
});

});
