document.addEventListener("DOMContentLoaded", () => {

let ws;
let reconnectDelay = 2000;
let oldestMessageId = null;
function connectWS() {
  ws = new WebSocket(
    (location.protocol === "https:" ? "wss://" : "ws://") + location.host
  );

ws.onopen = () => {
  reconnectDelay = 2000;

  // 🔥 ADD THIS — temporary self id
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
  console.log("WS reconnecting...");
  setTimeout(connectWS, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
};
}

connectWS();

  const chat = document.getElementById("chat");
// ✅ smooth scroll helper
function scrollToBottomSmooth() {
  chat.scrollTo({
    top: chat.scrollHeight,
    behavior: "smooth"
  });
} 
 const input = document.getElementById("messageInput");
  const sendBtn = document.getElementById("sendBtn");
  const newMsgBtn = document.getElementById("newMsgBtn");
const renderedMessages = new Set(); 

let unseenCount = 0;
let historyLoaded = false;
let loadingHistory = false;
let historyEndReached = false;
  // ===== Add Message =====
  function addMessage(user, text, isHistory = false, time = Date.now(), messageId = null, reactions = {}) {
// 🚫 prevent duplicate render
if (messageId && renderedMessages.has(messageId)) return;
if (messageId) renderedMessages.add(messageId);

// 👇 current user identify karo (top me ek baar define karo)
const div = document.createElement("div");
const isMe =
  user?.trim().toLowerCase() ===

  window.currentUser?.trim().toLowerCase();

div.className = isMe ? "message sent" : "message received";

    const nameEl = document.createElement("div");
    nameEl.className = "name";
    nameEl.textContent = user;
    div.appendChild(nameEl);

    const msgEl = document.createElement("div");
    msgEl.className = "msg-text";
    msgEl.textContent = text;
    div.appendChild(msgEl);

    // ===== Reaction Buttons =====
    const reactContainer = document.createElement("div");
    reactContainer.style.marginTop = "5px";

    ["❤️","👍","😂"].forEach(emoji => {
      const btn = document.createElement("button");
      btn.textContent = emoji + (reactions[emoji] ? ` ${reactions[emoji]}` : "");
      btn.style.marginRight = "5px";

btn.onclick = () => {
  if (!messageId) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({
          type: "react",
          room: "public",
          msgId: messageId,
          emoji
        }));
      };

      reactContainer.appendChild(btn);
    });

    div.appendChild(reactContainer);

    const timeEl = document.createElement("span");
    timeEl.className = "timestamp";
    timeEl.textContent = new Date(time).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
div.appendChild(timeEl);

div.dataset.id = messageId;
if (isHistory && messageId) {
  oldestMessageId = messageId;
}

// 🔥 MUST HAVE — bottom check BEFORE append
const wasAtBottom =
  chat.scrollTop + chat.clientHeight >= chat.scrollHeight - 20;

chat.appendChild(div);

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
    /* Scroll logic
    if (isHistory && !historyLoaded) {
      scrollToBottomSmooth();
      historyLoaded = true;
    } else if (!isHistory) {
      const atBottom =
        chat.scrollHeight - chat.scrollTop <= chat.clientHeight + 5;

      if (atBottom) {
      scrollToBottomSmooth();
      } else {
        unseenCount++;
        updateNewMsgBtn();
      }
    }*/
/*if (isHistory && !historyLoaded) {
  scrollToBottomSmooth();
  historyLoaded = true;
} else if (!isHistory) {
  if (wasAtBottom) {
    scrollToBottomSmooth();
  } else {
    unseenCount++;
    updateNewMsgBtn();
  }
}*/
  }

  // ===== Update Reaction (chat-update) =====
  function updateMessage(msg) {
    const messageDiv = document.querySelector(`[data-id='${msg._id}']`);
    if (!messageDiv) return;

    const buttons = messageDiv.querySelectorAll("button");
    buttons.forEach(btn => {
      const emoji = btn.textContent.split(" ")[0];
      const count = msg.reactions?.[emoji] || 0;
      btn.textContent = emoji + (count ? ` ${count}` : "");
    });
  }

  // ===== Send Message =====
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

  // ===== WebSocket Messages =====
function handleWSMessage(event) {
  const data = JSON.parse(event.data);
// ✅ SET CURRENT USER FROM SERVER
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

  // 🔥 if still unknown, guess from first message
data.messages.forEach(msg => {
      addMessage(
        msg.user,
        msg.text,
        true,
        msg.time,
        msg._id,
        msg.reactions
      );
    });
if (data.messages.length < 500) {
  historyEndReached = true;
}
  }

 /* if (data.type === "chat") {
    addMessage(
      data.msg.user,
      data.msg.text,
      false,
      data.msg.time,
      data.msg._id,
      data.msg.reactions
    );
  }*/
if (data.type === "chat") {

  // 🔥 AUTO detect current user
  addMessage(
    data.msg.user,
    data.msg.text,
    false,
    data.msg.time,
    data.msg._id,
    data.msg.reactions
  );
}

  if (data.type === "chat-update") {
    updateMessage(data.msg);
  }
}

  // ===== New Message Button =====
  function updateNewMsgBtn() {
    if (unseenCount > 0) {
      newMsgBtn.textContent = `${unseenCount} new message(s) ⬇`;
      newMsgBtn.classList.remove("hidden");
    } else {
      newMsgBtn.classList.add("hidden");
    }
  }

chat.addEventListener("scroll", () => {
  const atBottom =
    chat.scrollHeight - chat.scrollTop <= chat.clientHeight + 5;

  if (atBottom) {
    unseenCount = 0;
    updateNewMsgBtn();
  }

// 🔥 LOAD MORE HISTORY WHEN TOP
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

});
