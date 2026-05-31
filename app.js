const socket = io();

const state = {
  me: "u-admin",
  db: null,
  activeChannel: "ch-general",
  activeServer: "srv-bakbak",
  uploads: [],
  editingId: null,
  replyTo: null
};

const els = {
  serverRail: document.querySelector("#serverRail"),
  channelList: document.querySelector("#channelList"),
  dmList: document.querySelector("#dmList"),
  memberList: document.querySelector("#memberList"),
  eventList: document.querySelector("#eventList"),
  pollBox: document.querySelector("#pollBox"),
  messageList: document.querySelector("#messageList"),
  messageInput: document.querySelector("#messageInput"),
  composer: document.querySelector("#composer"),
  roomName: document.querySelector("#roomName"),
  roomTopic: document.querySelector("#roomTopic"),
  pinnedBar: document.querySelector("#pinnedBar"),
  typingLine: document.querySelector("#typingLine"),
  messageCount: document.querySelector("#messageCount"),
  onlineCount: document.querySelector("#onlineCount"),
  attachBtn: document.querySelector("#attachBtn"),
  fileInput: document.querySelector("#fileInput"),
  dropZone: document.querySelector("#dropZone"),
  globalSearch: document.querySelector("#globalSearch"),
  modal: document.querySelector("#modal"),
  modalBody: document.querySelector("#modalBody"),
  closeModal: document.querySelector("#closeModal"),
  mobileMenu: document.querySelector("#mobileMenu"),
  sidebar: document.querySelector(".sidebar"),
  themeToggle: document.querySelector("#themeToggle")
};

async function boot() {
  const response = await fetch("/api/state");
  state.db = await response.json();
  renderAll();
  socket.emit("channel:join", state.activeChannel);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}

function renderAll() {
  renderServers();
  renderChannels();
  renderPeople();
  renderEvents();
  renderPoll();
  renderMessages();
}

function renderServers() {
  els.serverRail.innerHTML = state.db.servers.map(server => `
    <button class="server-icon ${server.id === state.activeServer ? "active" : ""}" data-server="${server.id}" title="${escapeHtml(server.name)}">${escapeHtml(server.icon)}</button>
  `).join("");
}

function renderChannels() {
  const server = getServer();
  els.channelList.innerHTML = server.channels.map(channel => `
    <button class="nav-item ${channel.id === state.activeChannel ? "active" : ""}" data-channel="${channel.id}">
      <span>${channelIcon(channel.type)}</span><span>${escapeHtml(channel.name)}</span><small>${escapeHtml(channel.type)}</small>
    </button>
  `).join("");

  els.dmList.innerHTML = state.db.chats.map(chat => `
    <button class="nav-item ${chat.id === state.activeChannel ? "active" : ""}" data-channel="${chat.id}">
      <span>${chat.type === "dm" ? "@" : "◌"}</span><span>${escapeHtml(chat.name)}</span><small>${escapeHtml(chat.type)}</small>
    </button>
  `).join("");
  updateRoomHeader();
}

function renderPeople() {
  els.memberList.innerHTML = state.db.users.map(user => `
    <div class="member">
      <span class="avatar" style="background:${escapeAttr(user.theme)}">${escapeHtml(user.avatar)}</span>
      <div><strong>${escapeHtml(user.displayName)}</strong><small>${escapeHtml(user.role)} · ${escapeHtml(user.status)}</small></div>
    </div>
  `).join("");
  els.onlineCount.textContent = state.db.users.filter(user => user.status === "online").length;
}

function renderEvents() {
  els.eventList.innerHTML = state.db.events.map(event => `
    <div><strong>${escapeHtml(event.title)}</strong><br><span>${escapeHtml(event.startsAt)} · #${escapeHtml(event.channel)}</span></div>
  `).join("");
}

function renderPoll() {
  const poll = state.db.polls[0];
  const max = Math.max(...poll.votes, 1);
  els.pollBox.innerHTML = `<strong>${escapeHtml(poll.question)}</strong>` + poll.options.map((option, index) => `
    <div class="poll-option">
      <span>${escapeHtml(option)} · ${poll.votes[index]}</span>
      <div class="poll-bar"><span style="width:${Math.round((poll.votes[index] / max) * 100)}%"></span></div>
    </div>
  `).join("");
}

function renderMessages() {
  const query = els.globalSearch.value.trim().toLowerCase();
  let messages = state.db.messages.filter(message => message.channelId === state.activeChannel);
  if (query) {
    messages = state.db.messages.filter(message =>
      (message.text || "").toLowerCase().includes(query) ||
      findUser(message.authorId)?.displayName.toLowerCase().includes(query)
    );
  }
  els.messageList.innerHTML = messages.map(renderMessage).join("");
  els.messageCount.textContent = state.db.messages.length;
  renderPinned(messages);
  els.messageList.scrollTop = els.messageList.scrollHeight;
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
          <button data-action="react">＋Emoji</button>
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
  return `<a class="attachment attachment__file" href="${escapeAttr(file.url)}" target="_blank">📎 ${escapeHtml(file.name)}</a>`;
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
  if (!text && !state.uploads.length) return;
  const payload = {
    channelId: state.activeChannel,
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
  autosize();
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
    const response = await fetch("/api/upload", { method: "POST", body: form });
    state.uploads.push(await response.json());
  }
  els.messageInput.placeholder = `${state.uploads.length} file(s) ready. Add a caption`;
}

function updateRoomHeader() {
  const channel = findChannel(state.activeChannel);
  const chat = state.db.chats.find(item => item.id === state.activeChannel);
  els.roomName.textContent = channel ? `${channel.type === "text" ? "#" : ""}${channel.name}` : chat?.name || "BakBak";
  els.roomTopic.textContent = channel?.topic || (chat ? `${chat.type.toUpperCase()} chat` : "Community chat");
}

function channelIcon(type) {
  return { text: "#", voice: "☎", video: "▣", announcement: "!", forum: "?" }[type] || "#";
}

function getServer() {
  return state.db.servers.find(server => server.id === state.activeServer) || state.db.servers[0];
}

function findChannel(id) {
  return state.db.servers.flatMap(server => server.channels).find(channel => channel.id === id);
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
  const channelButton = event.target.closest("[data-channel]");
  if (channelButton) {
    state.activeChannel = channelButton.dataset.channel;
    socket.emit("channel:join", state.activeChannel);
    renderChannels();
    renderMessages();
    els.sidebar.classList.remove("open");
  }

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

document.querySelector("#voiceBtn").addEventListener("click", () => openModal("Voice room", "<p>Voice, push-to-talk, noise suppression, activity detection, and recording controls are represented here for the production RTC layer.</p><div class='feature-tags'><span>Muted</span><span>Push-to-talk</span><span>Noise suppression</span><span>Recording off</span></div>"));
document.querySelector("#videoBtn").addEventListener("click", () => openModal("Video stage", "<p>Group video calls and live streaming can connect to WebRTC/Twilio/LiveKit from this surface.</p>"));
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
    openModal(title, "<p>This panel is ready for AI chatbot, summaries, translation, smart search, voice-to-text, text-to-speech, moderation assistance, bot API keys, and webhooks.</p>");
  });
});

els.composer.addEventListener("submit", sendMessage);
els.attachBtn.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", event => uploadFiles(event.target.files));
els.messageInput.addEventListener("input", () => {
  autosize();
  socket.emit("typing", { channelId: state.activeChannel, name: "Aemni" });
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
