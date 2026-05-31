const socket = io();

const state = {
  me: "u-admin",
  db: null,
  activeChat: null,
  uploads: [],
  editingId: null,
  replyTo: null
};

const els = {
  dmList: document.querySelector("#dmList"),
  memberList: document.querySelector("#memberList"),
  userIdList: document.querySelector("#userIdList"),
  messageList: document.querySelector("#messageList"),
  messageInput: document.querySelector("#messageInput"),
  composer: document.querySelector("#composer"),
  roomName: document.querySelector("#roomName"),
  roomTopic: document.querySelector("#roomTopic"),
  pinnedBar: document.querySelector("#pinnedBar"),
  typingLine: document.querySelector("#typingLine"),
  messageCount: document.querySelector("#messageCount"),
  onlineCount: document.querySelector("#onlineCount"),
  dmCount: document.querySelector("#dmCount"),
  attachBtn: document.querySelector("#attachBtn"),
  fileInput: document.querySelector("#fileInput"),
  dropZone: document.querySelector("#dropZone"),
  globalSearch: document.querySelector("#globalSearch"),
  modal: document.querySelector("#modal"),
  modalBody: document.querySelector("#modalBody"),
  closeModal: document.querySelector("#closeModal"),
  mobileMenu: document.querySelector("#mobileMenu"),
  sidebar: document.querySelector(".sidebar"),
  themeToggle: document.querySelector("#themeToggle"),
  dmByIdForm: document.querySelector("#dmByIdForm"),
  dmUserIdInput: document.querySelector("#dmUserIdInput"),
  dmByIdStatus: document.querySelector("#dmByIdStatus")
};

async function boot() {
  const response = await fetch("api/state");
  state.db = await response.json();
  normalizeDmState();
  renderAll();
  joinActiveChat();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

function normalizeDmState() {
  state.db.chats = (state.db.chats || []).filter(chat => chat.type === "dm");
  state.activeChat = state.db.chats[0]?.id || null;
}

function renderAll() {
  renderDms();
  renderPeople();
  renderMessages();
}

function renderDms() {
  els.dmList.innerHTML = state.db.chats.map(chat => {
    const partner = getDmPartner(chat);
    return `
      <button class="nav-item ${chat.id === state.activeChat ? "active" : ""}" data-chat="${chat.id}">
        <span class="mini-avatar" style="background:${escapeAttr(partner?.theme || "#53bdeb")}">${escapeHtml(partner?.avatar || "@")}</span>
        <span>${escapeHtml(partner?.displayName || chat.name)}</span>
        <small>${escapeHtml(partner?.id || "dm")}</small>
      </button>
    `;
  }).join("") || "<p class='empty-state'>Open a DM by user ID.</p>";
  els.dmCount.textContent = state.db.chats.length;
  updateRoomHeader();
}

function renderPeople() {
  els.memberList.innerHTML = state.db.users.map(user => `
    <div class="member">
      <span class="avatar" style="background:${escapeAttr(user.theme)}">${escapeHtml(user.avatar)}</span>
      <div><strong>${escapeHtml(user.displayName)}</strong><small>${escapeHtml(user.role)} · ${escapeHtml(user.status)}</small></div>
    </div>
  `).join("");

  els.userIdList.innerHTML = state.db.users
    .filter(user => user.id !== state.me)
    .map(user => `<button class="id-chip" data-user-id="${escapeAttr(user.id)}">${escapeHtml(user.id)} <span>${escapeHtml(user.displayName)}</span></button>`)
    .join("");

  els.onlineCount.textContent = state.db.users.filter(user => user.status === "online").length;
}

function renderMessages() {
  const query = els.globalSearch.value.trim().toLowerCase();
  let messages = state.db.messages.filter(message => message.channelId === state.activeChat);
  if (query) {
    messages = state.db.messages.filter(message =>
      (message.text || "").toLowerCase().includes(query) ||
      findUser(message.authorId)?.displayName.toLowerCase().includes(query)
    );
  }
  els.messageList.innerHTML = messages.map(renderMessage).join("") || renderEmptyMessages();
  els.messageCount.textContent = state.db.messages.length;
  renderPinned(messages);
  els.messageList.scrollTop = els.messageList.scrollHeight;
}

function renderEmptyMessages() {
  if (!state.activeChat) return "<div class='empty-state empty-state--center'>Open a DM by user ID to start chatting.</div>";
  return "<div class='empty-state empty-state--center'>No messages here yet.</div>";
}

function renderMessage(message) {
  const user = findUser(message.authorId) || state.db.users[0];
  const mine = message.authorId === state.me;
  const deleted = message.deletedAt;
  const attachments = (message.attachments || []).map(renderAttachment).join("");
  const preview = message.preview ? renderPreview(message.preview) : "";
  const reactions = (message.reactions || []).map(item => `<button class="reaction" data-react="${message.id}" data-emoji="${escapeAttr(item.emoji)}">${escapeHtml(item.emoji)} ${item.count}</button>`).join("");
  return `
    <article class="message ${mine ? "mine" : ""} ${deleted ? "deleted" : ""}" data-message="${message.id}">
      <span class="avatar" style="background:${escapeAttr(user.theme)}">${escapeHtml(user.avatar)}</span>
      <div class="bubble">
        <div class="message-meta">
          <strong>${escapeHtml(user.displayName)}</strong>
          <span>${time(message.createdAt)}</span>
          ${message.editedAt ? "<span>edited</span>" : ""}
          ${message.pinned ? "<span>pinned</span>" : ""}
        </div>
        <div class="message-text">${deleted ? "Message deleted" : linkify(escapeHtml(message.text || ""))}</div>
        ${attachments}${preview}
        <div class="message-actions">
          ${reactions}
          <button data-action="reply">Reply</button>
          <button data-action="react">+ Emoji</button>
          <button data-action="pin">Pin</button>
          <button data-action="forward">Forward</button>
          ${mine && !deleted ? `<button data-action="edit">Edit</button><button data-action="delete">Delete</button>` : ""}
        </div>
      </div>
    </article>
  `;
}

function renderAttachment(file) {
  if (file.type === "image") return `<a class="attachment" href="${escapeAttr(file.url)}" target="_blank"><img src="${escapeAttr(file.url)}" alt="${escapeAttr(file.name)}"></a>`;
  if (file.type === "video") return `<a class="attachment" href="${escapeAttr(file.url)}" target="_blank"><video src="${escapeAttr(file.url)}" controls></video></a>`;
  if (file.type === "audio") return `<div class="attachment"><audio src="${escapeAttr(file.url)}" controls></audio><div class="attachment__file">${escapeHtml(file.name)}</div></div>`;
  return `<a class="attachment attachment__file" href="${escapeAttr(file.url)}" target="_blank">File: ${escapeHtml(file.name)}</a>`;
}

function renderPreview(preview) {
  const media = preview.kind === "image"
    ? `<img src="${escapeAttr(preview.url)}" alt="">`
    : preview.kind === "video"
      ? `<video src="${escapeAttr(preview.url)}" controls muted></video>`
      : "";
  return `<a class="link-preview" href="${escapeAttr(preview.url)}" target="_blank">${media}<div class="preview-body"><strong>${escapeHtml(preview.title)}</strong><small>${escapeHtml(preview.url)}</small></div></a>`;
}

function renderPinned(messages) {
  const pinned = messages.find(message => message.pinned && !message.deletedAt);
  if (!pinned) {
    els.pinnedBar.classList.add("hidden");
    return;
  }
  els.pinnedBar.classList.remove("hidden");
  els.pinnedBar.textContent = `Pinned: ${pinned.text}`;
}

async function sendMessage(event) {
  event.preventDefault();
  const text = els.messageInput.value.trim();
  if (!state.activeChat) {
    setDmStatus("Open a DM before sending.", true);
    return;
  }
  if (!text && !state.uploads.length) return;

  const payload = {
    channelId: state.activeChat,
    authorId: state.me,
    text,
    attachments: state.uploads,
    preview: buildPreview(text),
    replyTo: state.replyTo
  };

  if (state.editingId) {
    socket.emit("message:edit", { id: state.editingId, text });
    state.editingId = null;
  } else {
    socket.emit("message:create", payload);
  }

  state.uploads = [];
  state.replyTo = null;
  els.messageInput.value = "";
  els.messageInput.placeholder = "Message BakBak";
  autosize();
}

async function openDmByUserId(userId) {
  const cleanId = userId.trim();
  if (!cleanId) return;

  const response = await fetch("api/dm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: cleanId, me: state.me })
  });
  const result = await response.json();
  if (!response.ok) {
    setDmStatus(result.error || "Could not open DM.", true);
    return;
  }

  upsertChat(result.chat);
  if (result.user && !findUser(result.user.id)) state.db.users.push(result.user);
  state.activeChat = result.chat.id;
  joinActiveChat();
  setDmStatus(`Opened DM with ${result.user.displayName}.`);
  els.dmUserIdInput.value = "";
  renderAll();
  els.sidebar.classList.remove("open");
  els.messageInput.focus();
}

function upsertChat(chat) {
  const index = state.db.chats.findIndex(item => item.id === chat.id);
  if (index >= 0) state.db.chats[index] = chat;
  else state.db.chats.push(chat);
}

function joinActiveChat() {
  if (state.activeChat) socket.emit("channel:join", state.activeChat);
}

function setDmStatus(message, isError = false) {
  els.dmByIdStatus.textContent = message;
  els.dmByIdStatus.classList.toggle("error", isError);
}

function buildPreview(text) {
  const url = (text.match(/https?:\/\/\S+/i) || [])[0];
  if (!url) return null;
  const cleanUrl = url.replace(/[),.]+$/, "");
  const image = /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i.test(cleanUrl);
  const video = /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(cleanUrl);
  return {
    url: cleanUrl,
    kind: image ? "image" : video ? "video" : "link",
    title: image ? "Image preview" : video ? "Video preview" : "Link preview"
  };
}

async function uploadFiles(files) {
  for (const file of files) {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("api/upload", { method: "POST", body: form });
    state.uploads.push(await response.json());
  }
  els.messageInput.placeholder = `${state.uploads.length} file(s) ready. Add a caption`;
}

function updateRoomHeader() {
  const chat = state.db.chats.find(item => item.id === state.activeChat);
  const partner = chat ? getDmPartner(chat) : null;
  els.roomName.textContent = partner ? partner.displayName : "Direct messages";
  els.roomTopic.textContent = partner ? `Private DM · ${partner.id}` : "Open a DM by user ID";
}

function getDmPartner(chat) {
  return state.db.users.find(user => chat.members.includes(user.id) && user.id !== state.me) || null;
}

function findUser(id) {
  return state.db.users.find(user => user.id === id);
}

function time(value) {
  return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(value);
}

function linkify(text) {
  return text.replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" target="_blank" rel="noopener">$1</a>`);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function autosize() {
  els.messageInput.style.height = "auto";
  els.messageInput.style.height = `${Math.min(140, els.messageInput.scrollHeight)}px`;
}

function openModal(title, html) {
  els.modalBody.innerHTML = `<h2>${escapeHtml(title)}</h2>${html}`;
  els.modal.showModal();
}

document.addEventListener("click", event => {
  const chatButton = event.target.closest("[data-chat]");
  if (chatButton) {
    state.activeChat = chatButton.dataset.chat;
    joinActiveChat();
    renderDms();
    renderMessages();
    els.sidebar.classList.remove("open");
  }

  const userIdButton = event.target.closest("[data-user-id]");
  if (userIdButton) openDmByUserId(userIdButton.dataset.userId);

  const messageEl = event.target.closest("[data-message]");
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (messageEl && action) {
    const id = messageEl.dataset.message;
    const message = state.db.messages.find(item => item.id === id);
    if (action === "react") socket.emit("message:react", { id, emoji: "👍" });
    if (action === "pin") socket.emit("message:pin", { id });
    if (action === "delete") socket.emit("message:delete", { id });
    if (action === "edit") {
      state.editingId = id;
      els.messageInput.value = message.text;
      els.messageInput.focus();
      autosize();
    }
    if (action === "reply") {
      state.replyTo = id;
      els.messageInput.placeholder = `Replying to ${findUser(message.authorId)?.displayName || "message"}`;
      els.messageInput.focus();
    }
    if (action === "forward") {
      els.messageInput.value = `Forwarded: ${message.text}`;
      els.messageInput.focus();
      autosize();
    }
  }

  const reaction = event.target.closest("[data-react]");
  if (reaction) socket.emit("message:react", { id: reaction.dataset.react, emoji: reaction.dataset.emoji });
});

document.querySelector("#voiceBtn").addEventListener("click", () => openModal("Voice call", "<p>Voice calling controls are ready for the production RTC layer.</p><div class='feature-tags'><span>Muted</span><span>Push-to-talk</span><span>Noise suppression</span><span>Recording off</span></div>"));
document.querySelector("#videoBtn").addEventListener("click", () => openModal("Video call", "<p>Group video calls and live streaming can connect to WebRTC/Twilio/LiveKit from this surface.</p>"));
document.querySelector("#screenBtn").addEventListener("click", () => openModal("Screen share", "<p>Screen sharing permission starts from this control in supported browsers.</p>"));
document.querySelector("#profileBtn").addEventListener("click", () => openModal("Profile", "<p><strong>Aemni</strong><br>@aemni<br>Owner · Online</p><div class='feature-tags'><span>Banner</span><span>Bio</span><span>Social links</span><span>Custom theme</span></div>"));
document.querySelector("#gifBtn").addEventListener("click", () => {
  els.messageInput.value += " https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif";
  els.messageInput.focus();
});
document.querySelector("#voiceNoteBtn").addEventListener("click", () => openModal("Voice note", "<p>Use the upload button for audio files now. Browser microphone recording can be added with MediaRecorder next.</p>"));

document.querySelectorAll("[data-smart]").forEach(button => {
  button.addEventListener("click", () => {
    const title = button.textContent;
    openModal(title, "<p>This panel is ready for AI summaries, translation, smart search, voice-to-text, text-to-speech, moderation assistance, bot API keys, and webhooks.</p>");
  });
});

els.dmByIdForm.addEventListener("submit", event => {
  event.preventDefault();
  openDmByUserId(els.dmUserIdInput.value);
});
els.composer.addEventListener("submit", sendMessage);
els.attachBtn.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", event => uploadFiles(event.target.files));
els.messageInput.addEventListener("input", () => {
  autosize();
  if (state.activeChat) socket.emit("typing", { channelId: state.activeChat, name: "Aemni" });
});
els.globalSearch.addEventListener("input", renderMessages);
els.closeModal.addEventListener("click", () => els.modal.close());
els.mobileMenu.addEventListener("click", () => els.sidebar.classList.toggle("open"));
els.themeToggle.addEventListener("click", () => document.body.classList.toggle("light"));

document.addEventListener("dragover", event => {
  event.preventDefault();
  els.dropZone.classList.add("visible");
});
document.addEventListener("dragleave", () => els.dropZone.classList.remove("visible"));
document.addEventListener("drop", async event => {
  event.preventDefault();
  els.dropZone.classList.remove("visible");
  await uploadFiles(event.dataTransfer.files);
});

socket.on("message:new", message => {
  state.db.messages.push(message);
  renderMessages();
});
socket.on("message:updated", message => {
  const index = state.db.messages.findIndex(item => item.id === message.id);
  if (index >= 0) state.db.messages[index] = message;
  renderMessages();
});
socket.on("typing", data => {
  els.typingLine.textContent = `${data.name} is typing...`;
  clearTimeout(window.typingTimer);
  window.typingTimer = setTimeout(() => { els.typingLine.textContent = ""; }, 1200);
});
socket.on("presence", () => {
  els.onlineCount.textContent = Number(els.onlineCount.textContent || 2);
});

boot();
