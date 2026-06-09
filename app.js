// State Management
let socket = null;
let currentScreen = 'auth'; // auth, chats, chat-active
let activeTheme = 'discord'; // discord, crimson, cyber
let isConnected = false;
let isAuthenticating = false;

// Client state variables (matching Android/Desktop app state)
let currentUserNickname = '';
let currentUserCode = '';
let currentUserAvatar = '';
let currentUserEmail = '';
let isWakeupEnabled = false;
let chatsList = []; // list of friends / chats [{username, code, avatar, online}]
let activeChat = null; // {username, code, avatar}
let localMessages = {}; // local reactive message history keyed by room code (string)
let serverUrl = 'wss://renabile-node-storage.onrender.com';

// Local storage session keys
const STORAGE_KEY_USER = "pwa_username";
const STORAGE_KEY_HASH = "pwa_password_hash";
const STORAGE_KEY_THEME = "pwa_theme";
const STORAGE_KEY_WAKEUP = "pwa_wakeup";
const STORAGE_KEY_SERVER = "pwa_server_url";

// SHA-256 Helper block (Standard Native Web Crypto)
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Sound notification initializer
const wakeupAudio = document.getElementById('sound-wakeup');
function playWakeupSound() {
    if (isWakeupEnabled && wakeupAudio) {
        wakeupAudio.currentTime = 0;
        wakeupAudio.play().catch(e => console.log("Sound locked by Safari policy:", e));
    }
}

// Initialize Application UI events
document.addEventListener("DOMContentLoaded", () => {
    loadCachedSettings();
    initThemePicker();
    setupAuthForm();
    setupNavigation();
    setupModals();
    
    // Register Service Worker for PWA
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("sw.js")
            .then(reg => console.log("Service Worker registered successfully:", reg.scope))
            .catch(err => console.error("Service Worker registration failed:", err));
    }
    
    // Auto-login session check
    const savedUser = localStorage.getItem(STORAGE_KEY_USER);
    const savedHash = localStorage.getItem(STORAGE_KEY_HASH);
    if (savedUser && savedHash) {
        console.log("Found cached credentials, attempting silent background auto-auth...");
        currentUserNickname = savedUser;
        showScreen('chats');
        connectWebSocket();
    } else {
        showScreen('auth');
    }
});

// Load variables from localStorage
function loadCachedSettings() {
    activeTheme = localStorage.getItem(STORAGE_KEY_THEME) || 'discord';
    setTheme(activeTheme);
    
    isWakeupEnabled = localStorage.getItem(STORAGE_KEY_WAKEUP) === 'true';
    document.getElementById('set-wakeup').checked = isWakeupEnabled;
    
    const customUrl = localStorage.getItem(STORAGE_KEY_SERVER);
    if (customUrl) {
        serverUrl = customUrl;
        document.getElementById('auth-server-url').value = customUrl;
    }
}

// Theme applicator
function setTheme(theme) {
    activeTheme = theme;
    localStorage.setItem(STORAGE_KEY_THEME, theme);
    
    const appEl = document.getElementById('app');
    appEl.className = '';
    appEl.classList.add(`theme-${theme}`);
    
    // Set matching meta theme Color
    let metaColor = '#0c1014';
    if (theme === 'crimson') metaColor = '#120508';
    if (theme === 'cyber') metaColor = '#14001e';
    document.querySelector('meta[name="theme-color"]').setAttribute('content', metaColor);
}

function initThemePicker() {
    const btns = document.querySelectorAll('.theme-btn');
    btns.forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-theme') === activeTheme) {
            btn.classList.add('active');
        }
        btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setTheme(btn.getAttribute('data-theme'));
        });
    });
}

function updateStatusBanner(online) {
    isConnected = online;
    const banner = document.getElementById('status-banner');
    const text = document.getElementById('status-text');
    if (online) {
        banner.className = 'status-banner online';
        text.innerText = 'В сети';
    } else {
        banner.className = 'status-banner offline';
        text.innerText = 'Соединение прервано. Попытка восстановить...';
    }
}

// WebSocket client connection management
function connectWebSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) return;
    
    console.log(`[WS] Connecting to: ${serverUrl}`);
    socket = new WebSocket(serverUrl);
    
    socket.onopen = () => {
        console.log("[WS] Connected successfully");
        updateStatusBanner(true);
        
        // Auto authenticate on connection open
        const user = localStorage.getItem(STORAGE_KEY_USER);
        const passHash = localStorage.getItem(STORAGE_KEY_HASH);
        if (user && passHash) {
            sendPacket("AUTH", { username: user, password: passHash });
        }
    };
    
    socket.onmessage = (event) => {
        try {
            const packet = JSON.parse(event.data);
            handleIncomingPacket(packet);
        } catch (e) {
            console.error("Failed to parse packet:", e);
        }
    };
    
    socket.onclose = () => {
        updateStatusBanner(false);
        setTimeout(connectWebSocket, 4000); // Reconnect attempt
    };
    
    socket.onerror = (err) => {
        console.error("WS error:", err);
        updateStatusBanner(false);
    };
}

// Packet writing serializer
function sendPacket(type, data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type, data }));
    } else {
        console.warn("Disconnection buffer queue omitted packet:", type);
    }
}

// Navigation & Screen transitions
function showScreen(screenId) {
    currentScreen = screenId;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${screenId}`).classList.add('active');
}

function handleIncomingPacket(packet) {
    const { type, data } = packet;
    console.log(`[WS-IN] Type: ${type}`, data);
    
    switch (type) {
        case "AUTH_OK": {
            isAuthenticating = false;
            currentUserNickname = data.username;
            currentUserCode = data.code;
            currentUserAvatar = data.avatar || '';
            currentUserEmail = data.email || '';
            
            // Apply variables globally
            document.getElementById('my-username-lbl').innerText = currentUserNickname;
            document.getElementById('my-code-lbl').innerText = `#${currentUserCode}`;
            
            // Set Avatar
            setAvatarLayout(document.getElementById('my-avatar-container'), currentUserNickname, currentUserAvatar);
            
            // Sync with profile form
            document.getElementById('set-username').value = currentUserNickname;
            document.getElementById('set-avatar-url').value = currentUserAvatar;
            document.getElementById('set-email').value = currentUserEmail;
            
            showScreen('chats');
            break;
        }
        case "ERROR": {
            isAuthenticating = false;
            alert(`Ошибка сервера: ${data.message || 'Неизвестная ошибка'}`);
            if (currentScreen !== 'auth') {
                logout();
            }
            break;
        }
        case "FRIENDS_LIST": {
            const list = data.list || [];
            chatsList = list;
            renderChatsList();
            
            // If in active chat, update the heading states
            if (activeChat) {
                const refreshed = chatsList.find(c => c.code === activeChat.code);
                if (refreshed) {
                    activeChat = refreshed;
                    document.getElementById('active-chat-status').innerText = refreshed.online ? 'В сети' : 'был(а) в сети недавно';
                    document.getElementById('active-chat-status').className = 'online-status' + (refreshed.online ? ' online' : '');
                }
            }
            break;
        }
        case "MSG_HISTORY": {
            const roomCode = data.room;
            const list = data.history || [];
            localMessages[roomCode] = list;
            
            if (activeChat && activeChat.code === roomCode) {
                renderMessagesFeed();
            }
            break;
        }
        case "MSG": {
            const from = data.from || 'GLOBAL';
            const senderName = data.senderName;
            const text = data.text;
            const time = data.time || getCurrentTimeStr();
            const clientMsgId = data.clientMsgId || '';
            
            const targetRoom = (from === 'GLOBAL' || from === '') ? 'GLOBAL' : from;
            
            if (!localMessages[targetRoom]) {
                localMessages[targetRoom] = [];
            }
            
            // Avoid duplicate additions
            const isDuplicate = localMessages[targetRoom].some(m => m.clientMsgId === clientMsgId && clientMsgId !== '');
            if (!isDuplicate) {
                localMessages[targetRoom].push({
                    roomId: targetRoom,
                    sender: senderName,
                    text: text,
                    time: time,
                    clientMsgId: clientMsgId
                });
                
                // Alert Sound trigger
                if (senderName !== currentUserNickname) {
                    playWakeupSound();
                    
                    // Native API notification fallback
                    if (Notification.permission === "granted") {
                        new Notification(senderName, {
                            body: text.startsWith('[IMAGE]') ? "📷 Изображение" : text,
                            icon: "/icons/icon-192.png"
                        });
                    }
                }
            }
            
            if (activeChat && activeChat.code === targetRoom) {
                renderMessagesFeed();
            }
            break;
        }
    }
}

// User Initials generator
function getInitials(name) {
    if (!name) return "U";
    return name.slice(0, 2).toUpperCase();
}

// Color hash generator matching desktop/android aesthetics
function getAvatarColor(name) {
    if (!name) return "#2481cc";
    const colors = [
        "#f43f5e", "#ec4899", "#d946ef", "#a855f7", "#8b5cf6",
        "#6366f1", "#3b82f6", "#0ea5e9", "#06b6d4", "#14b8a6",
        "#10b981", "#22c55e", "#84cc16", "#eab308", "#f97316"
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % colors.length;
    return colors[idx];
}

// Render Avatar properly with support for images/colors/initials
function setAvatarLayout(element, nickname, avatarUrlSrc) {
    if (!element) return;
    
    element.innerHTML = '';
    
    if (avatarUrlSrc && avatarUrlSrc.trim().startsWith('http')) {
        const img = document.createElement('img');
        img.src = avatarUrlSrc.trim();
        img.alt = nickname;
        img.onerror = () => {
            // fallback
            element.innerHTML = `<span>${getInitials(nickname)}</span>`;
            element.style.backgroundColor = getAvatarColor(nickname);
        };
        element.appendChild(img);
        element.style.backgroundColor = 'transparent';
    } else {
        element.innerHTML = `<span>${getInitials(nickname)}</span>`;
        element.style.backgroundColor = getAvatarColor(nickname);
    }
}

// Time Helper
function getCurrentTimeStr() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// UI Rendering - Chats Main List
function renderChatsList() {
    const container = document.getElementById('chats-list-container');
    container.innerHTML = '';
    
    const searchVal = document.getElementById('chat-search').value.toLowerCase().trim();
    const filtered = chatsList.filter(c => c.username.toLowerCase().includes(searchVal));
    
    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📂</div>
                <h3>Нет результатов</h3>
                <p>Не удалось найти контакты по запросу: "${searchVal}"</p>
            </div>
        `;
        return;
    }
    
    filtered.forEach(chat => {
        const item = document.createElement('div');
        item.className = 'chat-item';
        
        const avatarCell = document.createElement('div');
        avatarCell.className = 'avatar';
        setAvatarLayout(avatarCell, chat.username, chat.avatar);
        
        const detailsCell = document.createElement('div');
        detailsCell.className = 'chat-item-details';
        
        const metaRow = document.createElement('div');
        metaRow.className = 'chat-meta';
        
        const nameNode = document.createElement('span');
        nameNode.className = 'chat-name';
        nameNode.innerText = chat.username;
        if (chat.online) {
            const inlineDot = document.createElement('span');
            inlineDot.className = 'online-indicator';
            nameNode.appendChild(inlineDot);
        }
        
        const timeNode = document.createElement('span');
        timeNode.className = 'chat-time';
        timeNode.innerText = chat.online ? 'в сети' : 'оффлайн';
        
        metaRow.appendChild(nameNode);
        metaRow.appendChild(timeNode);
        
        const lastMsgNode = document.createElement('div');
        lastMsgNode.className = 'chat-last-message';
        lastMsgNode.innerText = `ID: #${chat.code} • Нажмите для общения`;
        
        detailsCell.appendChild(metaRow);
        detailsCell.appendChild(lastMsgNode);
        
        item.appendChild(avatarCell);
        item.appendChild(detailsCell);
        
        item.addEventListener('click', () => {
            selectChat(chat);
        });
        
        container.appendChild(item);
    });
}

// Open active conversation View
function selectChat(chat) {
    activeChat = chat;
    document.getElementById('active-chat-title').innerText = chat.username;
    
    const statusVal = chat.online ? 'В сети' : 'был(а) в сети давно';
    document.getElementById('active-chat-status').innerText = statusVal;
    document.getElementById('active-chat-status').className = 'online-status' + (chat.online ? ' online' : '');
    
    setAvatarLayout(document.getElementById('active-chat-avatar'), chat.username, chat.avatar);
    
    // Request historical room data
    sendPacket("GET_HISTORY", { room: chat.code });
    
    // Clean inputs
    document.getElementById('message-text-input').value = '';
    
    showScreen('chat-active');
}

// UI Rendering - Messages Feed
function renderMessagesFeed() {
    const container = document.getElementById('messages-scroller');
    container.innerHTML = '';
    
    if (!activeChat) return;
    const roomHistory = localMessages[activeChat.code] || [];
    
    if (roomHistory.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📝</div>
                <h3>История чата пуста</h3>
                <p>Здесь пока нет сообщений. Начните беседу первыми!</p>
            </div>
        `;
        return;
    }
    
    roomHistory.forEach(msg => {
// Detect alignment (outgoing vs incoming)
        const isMy = msg.sender === currentUserNickname;
        
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${isMy ? 'outgoing' : 'incoming'}`;
        
        const sender = document.createElement('span');
        sender.className = 'message-sender';
        sender.innerText = msg.sender;
        
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        
        // Parse message structure (Standard image embedding fallback)
        if (msg.text && msg.text.startsWith('[IMAGE]:')) {
            const src = msg.text.substring(8);
            const img = document.createElement('img');
            img.src = src;
            img.className = 'img-msg';
            img.alt = "Отправленное фото";
            img.onerror = () => { img.style.display = 'none'; };
            bubble.appendChild(img);
        } else {
            const bodySpan = document.createElement('span');
            bodySpan.innerText = msg.text || '';
            bubble.appendChild(bodySpan);
        }
        
        const meta = document.createElement('div');
        meta.className = 'message-meta';
        meta.innerText = msg.time || '';
        if (msg.isPending) {
            meta.innerText += " • ...";
        }
        bubble.appendChild(meta);
        
        if (!isMy) {
            wrapper.appendChild(sender);
        }
        wrapper.appendChild(bubble);
        container.appendChild(wrapper);
    });
    
    // Auto-scroll to lowest bounds
    container.scrollTop = container.scrollHeight;
}

// Authentication trigger events
function setupAuthForm() {
    const form = document.getElementById('auth-form');
    const loginTab = document.getElementById('tab-login');
    const registerTab = document.getElementById('tab-register');
    const regFields = document.getElementById('register-only-fields');
    const submitBtn = document.getElementById('btn-auth-submit');
    
    let activeTab = 'login'; // login, register
    
    loginTab.addEventListener('click', (e) => {
        e.preventDefault();
        activeTab = 'login';
        loginTab.classList.add('active');
        registerTab.classList.remove('active');
        regFields.classList.add('hidden');
        submitBtn.innerText = 'Войти в аккаунт';
    });
    
    registerTab.addEventListener('click', (e) => {
        e.preventDefault();
        activeTab = 'register';
        registerTab.classList.add('active');
        loginTab.classList.remove('active');
        regFields.classList.remove('hidden');
        submitBtn.innerText = 'Создать аккаунт';
    });
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const rawUser = document.getElementById('auth-username').value.trim();
        const rawPass = document.getElementById('auth-password').value.trim();
        const rawMail = document.getElementById('auth-email').value.trim();
        const wsUrl = document.getElementById('auth-server-url').value.trim();
        
        if (!rawUser || !rawPass) {
            alert("Пожалуйста, заполните логин и пароль!");
            return;
        }
        
        // Save server URL preference
        serverUrl = wsUrl;
        localStorage.setItem(STORAGE_KEY_SERVER, wsUrl);
        
        isAuthenticating = true;
        submitBtn.innerText = 'Авторизация...';
        
        // Connection loop
        connectWebSocket();
        
        // Encrypt hash
        const passHash = await sha256(rawPass);
        
        localStorage.setItem(STORAGE_KEY_USER, rawUser);
        localStorage.setItem(STORAGE_KEY_HASH, passHash);
        
        // Wait for connection to open, if not already
        const sendCredentials = () => {
            if (activeTab === 'login') {
                sendPacket("AUTH", { username: rawUser, password: passHash });
            } else {
                sendPacket("REG", { username: rawUser, password: passHash, email: rawMail });
            }
        };
        
        if (socket.readyState === WebSocket.OPEN) {
            sendCredentials();
        } else {
            // Buffer wait hook
            const cachedInterval = setInterval(() => {
                if (socket.readyState === WebSocket.OPEN) {
                    sendCredentials();
                    clearInterval(cachedInterval);
                }
            }, 300);
            
            // Timeout escape Hatch
            setTimeout(() => {
                clearInterval(cachedInterval);
                if (isAuthenticating) {
                    isAuthenticating = false;
                    submitBtn.innerText = activeTab === 'login' ? 'Войти в аккаунт' : 'Создать аккаунт';
                    alert("Превышено время ожидания сервера. Проверьте адрес WebSocket!");
                }
            }, 8000);
        }
    });
    
    // Toggle WebSocket configuration config panel
    document.getElementById('toggle-server-config').addEventListener('click', () => {
        const el = document.getElementById('server-config-inputs');
        el.classList.toggle('show');
    });
}

// Navigation flow hooks
function setupNavigation() {
    // Back to chats
    document.getElementById('btn-chat-back').addEventListener('click', () => {
        activeChat = null;
        showScreen('chats');
    });
    
    // Dynamic search filter keyup
    document.getElementById('chat-search').addEventListener('input', () => {
        renderChatsList();
    });
    
    // Send message triggers
    const sendBtn = document.getElementById('btn-send-message');
    const msgInput = document.getElementById('message-text-input');
    
    const sendRoutine = () => {
        const text = msgInput.value.trim();
        if (!text || !activeChat) return;
        
        const tempId = Math.random().toString(36).substring(3, 11);
        sendPacket("MSG", {
            to: activeChat.code,
            text: text,
            fromCode: currentUserCode,
            clientMsgId: tempId
        });
        
        // Optimistic rendering
        if (!localMessages[activeChat.code]) {
            localMessages[activeChat.code] = [];
        }
        localMessages[activeChat.code].push({
            roomId: activeChat.code,
            sender: currentUserNickname,
            text: text,
            time: getCurrentTimeStr(),
            clientMsgId: tempId,
            isPending: true
        });
        
        renderMessagesFeed();
        msgInput.value = '';
    };
    
    sendBtn.addEventListener('click', sendRoutine);
    msgInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendRoutine();
        }
    });
    
    // Clear Chat room logs
    document.getElementById('btn-clear-chat').addEventListener('click', () => {
        if (!activeChat) return;
        if (confirm("Вы действительно хотите удалить все сообщения чата с сервера?")) {
            sendPacket("CLEAR_HISTORY", { room: activeChat.code });
            localMessages[activeChat.code] = [];
            renderMessagesFeed();
        }
    });
}

// Modals Setup
function setupModals() {
    const dialogAddFriend = document.getElementById('dialog-add-friend');
    const dialogMedia = document.getElementById('dialog-media');
    const dialogSettings = document.getElementById('dialog-settings');
    
    // Add Friend UI triggers
    document.getElementById('btn-add-friend-ui').addEventListener('click', () => {
        document.getElementById('add-friend-code').value = '';
        dialogAddFriend.classList.remove('hidden');
    });
    document.getElementById('btn-add-friend-cancel').addEventListener('click', () => {
        dialogAddFriend.classList.add('hidden');
    });
    document.getElementById('btn-add-friend-submit').addEventListener('click', () => {
        const code = document.getElementById('add-friend-code').value.trim();
        if (code.length !== 4 || isNaN(code)) {
            alert("Код должен состоять из 4х цифр!");
            return;
        }
        sendPacket("ADD_FRIEND", { code });
        dialogAddFriend.classList.add('hidden');
    });
    
    // Add Media UI triggers
    document.getElementById('btn-send-media').addEventListener('click', () => {
        document.getElementById('media-url-input').value = '';
        dialogMedia.classList.remove('hidden');
    });
    document.getElementById('btn-media-cancel').addEventListener('click', () => {
        dialogMedia.classList.add('hidden');
    });
    document.getElementById('btn-media-submit').addEventListener('click', () => {
        const urlStr = document.getElementById('media-url-input').value.trim();
        if (!urlStr || !urlStr.startsWith('http')) {
            alert("Пожалуйста, введите корректный адрес картинки!");
            return;
        }
        
        if (activeChat) {
            const tempId = Math.random().toString(36).substring(3, 11);
            const packetTextPayload = `[IMAGE]:${urlStr}`;
            
            sendPacket("MSG", {
                to: activeChat.code,
                text: packetTextPayload,
                fromCode: currentUserCode,
                clientMsgId: tempId
            });
            
            // Optimistic insert
            if (!localMessages[activeChat.code]) {
                localMessages[activeChat.code] = [];
            }
            localMessages[activeChat.code].push({
                roomId: activeChat.code,
                sender: currentUserNickname,
                text: packetTextPayload,
                time: getCurrentTimeStr(),
                isPending: true,
                clientMsgId: tempId
            });
            renderMessagesFeed();
        }
        
        dialogMedia.classList.add('hidden');
    });
    
    // Profile settings modals triggers
    document.getElementById('btn-open-settings').addEventListener('click', () => {
        document.getElementById('set-username').value = currentUserNickname;
        document.getElementById('set-avatar-url').value = currentUserAvatar;
        document.getElementById('set-email').value = currentUserEmail;
        document.getElementById('set-password').value = '';
        
        document.getElementById('settings-my-username-lbl').innerText = currentUserNickname;
        document.getElementById('settings-my-code-lbl').innerText = `#${currentUserCode}`;
        setAvatarLayout(document.getElementById('settings-my-avatar'), currentUserNickname, currentUserAvatar);
        
        dialogSettings.classList.remove('hidden');
    });
    document.getElementById('btn-close-settings').addEventListener('click', () => {
        dialogSettings.classList.add('hidden');
    });
    
    // Save settings handler
    document.getElementById('btn-save-settings').addEventListener('click', async () => {
        const newNick = document.getElementById('set-username').value.trim();
        const newAvatar = document.getElementById('set-avatar-url').value.trim();
        const newEmail = document.getElementById('set-email').value.trim();
        const newPass = document.getElementById('set-password').value.trim();
        
        if (!newNick) {
            alert("Имя (Никнейм) не может быть пустым!");
            return;
        }
        
        let updatePasswordHash = "";
        if (newPass.length > 0) {
            updatePasswordHash = await sha256(newPass);
            localStorage.setItem(STORAGE_KEY_HASH, updatePasswordHash);
        }
        
        // Sync local variables
        currentUserNickname = newNick;
        currentUserAvatar = newAvatar;
        currentUserEmail = newEmail;
        
        // Sync wakeup alarm preference
        isWakeupEnabled = document.getElementById('set-wakeup').checked;
        localStorage.setItem(STORAGE_KEY_WAKEUP, isWakeupEnabled);
        
        // Persist local store
        localStorage.setItem(STORAGE_KEY_USER, newNick);
        
        // Send profile update payload
        sendPacket("UPDATE_PROFILE", {
            username: newNick,
            password: updatePasswordHash,
            avatar: newAvatar,
            email: newEmail,
            wakeupEnabled: isWakeupEnabled
        });
        
        // Re-align layouts locally immediately
        document.getElementById('my-username-lbl').innerText = currentUserNickname;
        setAvatarLayout(document.getElementById('my-avatar-container'), currentUserNickname, currentUserAvatar);
        
        alert("Изменения сохранены!");
        dialogSettings.classList.add('hidden');
    });
    
    // Logout action click
    document.getElementById('btn-logout').addEventListener('click', () => {
        logout();
    });
}

function logout() {
    localStorage.removeItem(STORAGE_KEY_USER);
    localStorage.removeItem(STORAGE_KEY_HASH);
    
    currentUserNickname = '';
    currentUserCode = '';
    currentUserAvatar = '';
    chatsList = [];
    activeChat = null;
    localMessages = {};
    
    if (socket) {
        socket.close();
    }
    
    document.getElementById('auth-username').value = '';
    document.getElementById('auth-password').value = '';
    
    const settingsModal = document.getElementById('dialog-settings');
    if (settingsModal) settingsModal.classList.add('hidden');
    
    showScreen('auth');
}

// Global browser capability notifications registration
if ("Notification" in window) {
    if (Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }
}
