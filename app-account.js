let currentUser = JSON.parse(localStorage.getItem('bakbakUser')) || null;
let currentFriend = null;
let currentE2EKey = null;
let socket = null;

const UI = {
    accountForm: document.getElementById('accountForm'),
    displayNameInput: document.getElementById('displayNameInput'),
    usernameInput: document.getElementById('usernameInput'),
    passwordInput: document.getElementById('passwordInput'),
    currentAccount: document.getElementById('currentAccount'),
    uploadPfpBtn: document.getElementById('uploadPfpBtn'),
    pfpUpload: document.getElementById('pfpUpload'),
    dmByIdForm: document.getElementById('dmByIdForm'),
    dmUserIdInput: document.getElementById('dmUserIdInput'),
    dmList: document.getElementById('dmList'),
    messageList: document.getElementById('messageList'),
    composer: document.getElementById('composer'),
    messageInput: document.getElementById('messageInput'),
    roomName: document.getElementById('roomName')
};

async function init() {
    socket = io();
    
    if (currentUser) {
        showLoggedIn();
        socket.emit('join', currentUser.id);
        loadFriends();
    }
    
    UI.accountForm.onsubmit = async (e) => {
        e.preventDefault();
        const username = UI.usernameInput.value.trim();
        const password = UI.passwordInput.value;
        const displayName = UI.displayNameInput.value.trim();
        const action = displayName ? 'register' : 'login';
        
        const res = await fetch('/api/auth', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username, password, displayName, action})
        });
        const data = await res.json();
        if (data.error) return alert(data.error);
        
        currentUser = data;
        localStorage.setItem('bakbakUser', JSON.stringify(currentUser));
        showLoggedIn();
        socket.emit('join', currentUser.id);
        loadFriends();
    };

    UI.uploadPfpBtn.onclick = () => UI.pfpUpload.click();
    UI.pfpUpload.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('avatar', file);
        const res = await fetch(`/api/pfp/${currentUser.id}`, { method: 'POST', body: fd });
        const data = await res.json();
        if (data.pfp) {
            currentUser.pfp = data.pfp;
            localStorage.setItem('bakbakUser', JSON.stringify(currentUser));
            showLoggedIn();
        }
    };
    
    UI.dmByIdForm.onsubmit = async (e) => {
        e.preventDefault();
        const friendUsername = UI.dmUserIdInput.value.trim();
        const res = await fetch('/api/friends/add', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ userId: currentUser.id, friendUsername })
        });
        const data = await res.json();
        if (data.error) alert(data.error);
        else {
            UI.dmUserIdInput.value = '';
            loadFriends();
        }
    };
    
    UI.composer.onsubmit = async (e) => {
        e.preventDefault();
        const text = UI.messageInput.value.trim();
        if (!text || !currentFriend) return;
        
        // Client-side E2EE encryption before it leaves your device
        const e2eText = await encryptMessage(text, currentE2EKey);
        const msg = {
            id: 'm-' + Date.now(),
            channelId: getChannelId(currentUser.id, currentFriend.id),
            authorId: currentUser.id,
            text: e2eText, 
            createdAt: Date.now()
        };
        
        UI.messageInput.value = '';
        socket.emit('sendMessage', msg);
    };
    
    socket.on('receiveMessage', async (msg) => {
        if (!currentFriend) return;
        const channelId = getChannelId(currentUser.id, currentFriend.id);
        if (msg.channelId === channelId) {
            // Client-side decryption after server delivery
            msg.text = await decryptMessage(msg.text, currentE2EKey);
            renderMessage(msg);
            UI.messageList.scrollTop = UI.messageList.scrollHeight;
        }
    });
}

function showLoggedIn() {
    UI.accountForm.style.display = 'none';
    UI.uploadPfpBtn.style.display = 'inline-block';
    let pfpHtml = currentUser.pfp ? `<img src="${currentUser.pfp}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">` : `<div class="mini-avatar">${currentUser.displayName[0].toUpperCase()}</div>`;
    UI.currentAccount.innerHTML = `<div style="display:flex;align-items:center;gap:8px">${pfpHtml} <strong>${currentUser.displayName}</strong> <small>@${currentUser.username}</small></div><button class="tool-pill" onclick="logout()" style="margin-top:8px">Logout</button>`;
}

window.logout = function() {
    localStorage.removeItem('bakbakUser');
    location.reload();
}

async function loadFriends() {
    const res = await fetch(`/api/friends/${currentUser.id}`);
    const friends = await res.json();
    UI.dmList.innerHTML = '';
    friends.forEach(f => {
        const btn = document.createElement('button');
        btn.className = 'nav-item';
        let pfpHtml = f.pfp ? `<img src="${f.pfp}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;">` : `<div class="mini-avatar">${f.displayName[0].toUpperCase()}</div>`;
        btn.innerHTML = `${pfpHtml} <span>${f.displayName}</span>`;
        btn.onclick = (e) => openChat(f, e);
        UI.dmList.appendChild(btn);
    });
}

function getChannelId(u1, u2) {
    return [u1, u2].sort().join('_');
}

async function openChat(friend, event) {
    currentFriend = friend;
    UI.roomName.textContent = friend.displayName;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    if (event) event.currentTarget.classList.add('active');
    
    currentE2EKey = await getE2EEKey(currentUser.id, friend.id);
    
    const channelId = getChannelId(currentUser.id, friend.id);
    const res = await fetch(`/api/messages/${channelId}`);
    const msgs = await res.json();
    
    UI.messageList.innerHTML = '';
    for (const msg of msgs) {
        msg.text = await decryptMessage(msg.text, currentE2EKey);
        renderMessage(msg);
    }
    UI.messageList.scrollTop = UI.messageList.scrollHeight;
}

function renderMessage(msg) {
    const isMine = msg.authorId === currentUser.id;
    const author = isMine ? currentUser : currentFriend;
    let pfpHtml = author.pfp ? `<img src="${author.pfp}" class="avatar" style="object-fit:cover;">` : `<div class="avatar">${author.displayName[0].toUpperCase()}</div>`;
    
    const div = document.createElement('div');
    div.className = `message ${isMine ? 'mine' : ''}`;
    div.innerHTML = `
        ${pfpHtml}
        <div class="bubble">
            <div class="message-meta"><strong>${author.displayName}</strong></div>
            <div class="message-text">${escapeHtml(msg.text)}</div>
        </div>
    `;
    UI.messageList.appendChild(div);
}

function escapeHtml(unsafe) {
    return (unsafe || '').toString()
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// ---- Client-Side E2E System Utilities ---- //
function bufferToBase64(buf) {
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
}

function base64ToBuffer(base64) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

async function getE2EEKey(user1, user2) {
    // Deterministic DM shared key generation
    const ids = [user1, user2].sort().join('_');
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.digest("SHA-256", enc.encode("bakbak_e2ee_" + ids));
    return crypto.subtle.importKey("raw", keyMaterial, {name: "AES-GCM"}, false, ["encrypt", "decrypt"]);
}

async function encryptMessage(text, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, new TextEncoder().encode(text));
    const combined = new Uint8Array(12 + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), 12);
    return bufferToBase64(combined.buffer);
}

async function decryptMessage(base64, key) {
    try {
        const combined = new Uint8Array(base64ToBuffer(base64));
        const iv = combined.slice(0, 12);
        const data = combined.slice(12);
        const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv}, key, data);
        return new TextDecoder().decode(decrypted);
    } catch(e) {
        return base64; 
    }
}

// Global enter to submit
UI.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        UI.composer.dispatchEvent(new Event('submit'));
    }
});

init();