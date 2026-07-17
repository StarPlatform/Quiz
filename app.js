/* ============================================================
   Untai — app.js
   Struktur database (Realtime Database):

   /usernames/{usernameLower}      -> uid                (index pencarian & keunikan)
   /users/{uid}                    -> { username, usernameLower, passwordHash, createdAt }
   /userChats/{uid}/{chatId}       -> { partnerId, partnerUsername, lastMessage, lastTimestamp }
   /chats/{chatId}/messages/{id}   -> { senderId, senderUsername, text, timestamp }

   chatId = [uidA, uidB] diurutkan lalu digabung dengan "_"
   ============================================================ */

const SESSION_KEY = "untai_session";

let currentUser = null;      // { uid, username }
let currentChatId = null;
let currentPartner = null;   // { uid, username }
let messagesRef = null;
let searchDebounce = null;

// ---------- Helpers ----------

function $(id) { return document.getElementById(id); }

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function hashPassword(password) {
  const enc = new TextEncoder().encode(password);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function normalizeUsername(name) {
  return name.trim().toLowerCase();
}

function isValidUsername(name) {
  return /^[a-z0-9._]{3,20}$/.test(name);
}

function getChatId(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}

const AVATAR_COLORS = ["#128C7E", "#0B4F4A", "#8E5A2E", "#5B5F97", "#B5486B", "#3B6F8C", "#7A6E3D"];

function colorForName(name) {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

function initialsFor(name) {
  return (name.trim()[0] || "?").toUpperCase();
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function formatDay(ts) {
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return "Hari ini";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Kemarin";
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

// ---------- Session ----------

function saveSession(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// ---------- Screen switching ----------

function showAuthScreen() {
  $("app-screen").classList.add("hidden");
  $("auth-screen").classList.remove("hidden");
}

function showAppScreen() {
  $("auth-screen").classList.add("hidden");
  $("app-screen").classList.remove("hidden");
}

// ---------- Auth tabs ----------

document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    $("login-form").classList.toggle("hidden", target !== "login");
    $("register-form").classList.toggle("hidden", target !== "register");
    $("login-error").textContent = "";
    $("register-error").textContent = "";
  });
});

// ---------- Register ----------

$("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = $("register-error");
  const btn = $("register-submit");
  errorEl.textContent = "";

  const displayName = $("register-name").value.trim();
  const usernameRaw = $("register-username").value.trim();
  const usernameLower = normalizeUsername(usernameRaw);
  const password = $("register-password").value;

  if (!displayName) return (errorEl.textContent = "Nama tampilan wajib diisi.");
  if (!isValidUsername(usernameLower)) {
    return (errorEl.textContent = "ID harus 3–20 karakter: huruf kecil, angka, titik, atau garis bawah.");
  }
  if (password.length < 6) return (errorEl.textContent = "Kata sandi minimal 6 karakter.");

  btn.disabled = true;
  btn.textContent = "Memproses…";

  try {
    const existing = await db.ref("usernames/" + usernameLower).get();
    if (existing.exists()) {
      errorEl.textContent = "ID ini sudah dipakai. Coba ID lain.";
      return;
    }

    const passwordHash = await hashPassword(password);
    const newUserRef = db.ref("users").push();
    const uid = newUserRef.key;

    await newUserRef.set({
      username: displayName,
      usernameLower: usernameLower,
      passwordHash: passwordHash,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });

    await db.ref("usernames/" + usernameLower).set(uid);

    const user = { uid, username: displayName, usernameLower };
    saveSession(user);
    enterApp(user);
  } catch (err) {
    console.error(err);
    errorEl.textContent = "Gagal mendaftar. Periksa koneksi/konfigurasi Firebase.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Buat akun";
  }
});

// ---------- Login ----------

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = $("login-error");
  const btn = $("login-submit");
  errorEl.textContent = "";

  const usernameLower = normalizeUsername($("login-username").value);
  const password = $("login-password").value;

  btn.disabled = true;
  btn.textContent = "Memproses…";

  try {
    const uidSnap = await db.ref("usernames/" + usernameLower).get();
    if (!uidSnap.exists()) {
      errorEl.textContent = "ID atau kata sandi salah.";
      return;
    }
    const uid = uidSnap.val();
    const userSnap = await db.ref("users/" + uid).get();
    if (!userSnap.exists()) {
      errorEl.textContent = "ID atau kata sandi salah.";
      return;
    }
    const userData = userSnap.val();
    const passwordHash = await hashPassword(password);
    if (passwordHash !== userData.passwordHash) {
      errorEl.textContent = "ID atau kata sandi salah.";
      return;
    }

    const user = { uid, username: userData.username, usernameLower: userData.usernameLower };
    saveSession(user);
    enterApp(user);
  } catch (err) {
    console.error(err);
    errorEl.textContent = "Gagal masuk. Periksa koneksi/konfigurasi Firebase.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Masuk";
  }
});

// ---------- Logout ----------

$("logout-btn").addEventListener("click", () => {
  if (messagesRef) messagesRef.off();
  clearSession();
  currentUser = null;
  currentChatId = null;
  currentPartner = null;
  $("login-form").reset();
  $("register-form").reset();
  showAuthScreen();
});

// ---------- Enter app ----------

function enterApp(user) {
  currentUser = user;
  $("me-name").textContent = user.username;
  $("me-id").textContent = "@" + user.usernameLower;
  const avatar = $("me-avatar");
  avatar.textContent = initialsFor(user.username);
  avatar.style.background = colorForName(user.username);

  showAppScreen();
  listenToChatList();
}

// ---------- Search users ----------

$("search-input").addEventListener("input", () => {
  const query = normalizeUsername($("search-input").value);
  clearTimeout(searchDebounce);
  const resultsEl = $("search-results");

  if (!query) {
    resultsEl.classList.add("hidden");
    resultsEl.innerHTML = "";
    return;
  }

  resultsEl.classList.remove("hidden");
  resultsEl.innerHTML = '<div class="search-loading">Mencari…</div>';

  searchDebounce = setTimeout(async () => {
    try {
      const snap = await db.ref("usernames")
        .orderByKey()
        .startAt(query)
        .endAt(query + "\uf8ff")
        .limitToFirst(15)
        .get();

      resultsEl.innerHTML = "";

      if (!snap.exists()) {
        resultsEl.innerHTML = '<div class="search-empty">Tidak ada ID yang cocok.</div>';
        return;
      }

      const entries = Object.entries(snap.val()).filter(([uname, uid]) => uid !== currentUser.uid);

      if (entries.length === 0) {
        resultsEl.innerHTML = '<div class="search-empty">Tidak ada ID yang cocok.</div>';
        return;
      }

      for (const [usernameLower, uid] of entries) {
        const userSnap = await db.ref("users/" + uid).get();
        const userData = userSnap.val();
        if (!userData) continue;

        const item = document.createElement("div");
        item.className = "search-result-item";
        item.innerHTML = `
          <div class="avatar" style="background:${colorForName(userData.username)}">${initialsFor(userData.username)}</div>
          <div class="result-info">
            <div class="result-name">${escapeHtml(userData.username)}</div>
            <div class="result-id">@${escapeHtml(usernameLower)}</div>
          </div>
        `;
        item.addEventListener("click", () => {
          openChat({ uid, username: userData.username, usernameLower });
          resultsEl.classList.add("hidden");
          $("search-input").value = "";
        });
        resultsEl.appendChild(item);
      }
    } catch (err) {
      console.error(err);
      resultsEl.innerHTML = '<div class="search-empty">Pencarian gagal.</div>';
    }
  }, 300);
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) {
    $("search-results").classList.add("hidden");
  }
});

// ---------- Chat list (sidebar) ----------

function listenToChatList() {
  db.ref("userChats/" + currentUser.uid)
    .orderByChild("lastTimestamp")
    .on("value", (snap) => {
      const listEl = $("chat-list");
      const emptyEl = $("chat-list-empty");

      if (!snap.exists()) {
        listEl.innerHTML = "";
        listEl.appendChild(emptyEl);
        return;
      }

      const chats = [];
      snap.forEach(child => {
        chats.push({ chatId: child.key, ...child.val() });
      });
      chats.sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));

      listEl.innerHTML = "";
      chats.forEach(chat => {
        const item = document.createElement("div");
        item.className = "chat-item" + (chat.chatId === currentChatId ? " active" : "");
        item.innerHTML = `
          <div class="avatar" style="background:${colorForName(chat.partnerUsername)}">${initialsFor(chat.partnerUsername)}</div>
          <div class="chat-item-info">
            <div class="chat-item-name">${escapeHtml(chat.partnerUsername)}</div>
            <div class="chat-item-last">${escapeHtml(chat.lastMessage || "")}</div>
          </div>
          <div class="chat-item-meta">
            <div class="chat-item-time">${formatTime(chat.lastTimestamp)}</div>
          </div>
        `;
        item.addEventListener("click", () => {
          openChat({ uid: chat.partnerId, username: chat.partnerUsername, usernameLower: chat.partnerUsernameLower });
        });
        listEl.appendChild(item);
      });
    });
}

// ---------- Open / start a chat ----------

function openChat(partner) {
  currentPartner = partner;
  currentChatId = getChatId(currentUser.uid, partner.uid);

  $("chat-empty").classList.add("hidden");
  $("chat-active").classList.remove("hidden");

  const avatar = $("chat-avatar");
  avatar.textContent = initialsFor(partner.username);
  avatar.style.background = colorForName(partner.username);
  $("chat-header-name").textContent = partner.username;
  $("chat-header-id").textContent = "@" + (partner.usernameLower || "");

  document.querySelectorAll(".chat-item").forEach(el => el.classList.remove("active"));

  // mobile: slide to chat panel
  document.querySelector(".sidebar")?.classList.add("chat-open");
  document.querySelector(".chat-panel")?.classList.add("chat-open");

  listenToMessages();
}

function listenToMessages() {
  if (messagesRef) messagesRef.off();

  messagesRef = db.ref("chats/" + currentChatId + "/messages").orderByChild("timestamp");

  messagesRef.on("value", (snap) => {
    const container = $("messages");
    container.innerHTML = "";

    if (!snap.exists()) return;

    let lastDay = null;
    snap.forEach(child => {
      const msg = child.val();
      const day = formatDay(msg.timestamp || Date.now());

      if (day !== lastDay) {
        const divider = document.createElement("div");
        divider.className = "day-divider";
        divider.innerHTML = `<span>${day}</span>`;
        container.appendChild(divider);
        lastDay = day;
      }

      const isMe = msg.senderId === currentUser.uid;
      const row = document.createElement("div");
      row.className = "bubble-row " + (isMe ? "me" : "other");
      row.innerHTML = `
        <div class="bubble">
          ${escapeHtml(msg.text)}
          <span class="bubble-time">${formatTime(msg.timestamp)}</span>
        </div>
      `;
      container.appendChild(row);
    });

    container.scrollTop = container.scrollHeight;
  });
}

// ---------- Send message ----------

$("message-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("message-input");
  const text = input.value.trim();
  if (!text || !currentChatId) return;

  input.value = "";

  const timestamp = firebase.database.ServerValue.TIMESTAMP;
  const newMsgRef = db.ref("chats/" + currentChatId + "/messages").push();

  try {
    await newMsgRef.set({
      senderId: currentUser.uid,
      senderUsername: currentUser.username,
      text: text,
      timestamp: timestamp
    });

    const previewText = text.length > 40 ? text.slice(0, 40) + "…" : text;

    await db.ref("userChats/" + currentUser.uid + "/" + currentChatId).set({
      partnerId: currentPartner.uid,
      partnerUsername: currentPartner.username,
      partnerUsernameLower: currentPartner.usernameLower || "",
      lastMessage: previewText,
      lastTimestamp: timestamp
    });

    await db.ref("userChats/" + currentPartner.uid + "/" + currentChatId).set({
      partnerId: currentUser.uid,
      partnerUsername: currentUser.username,
      partnerUsernameLower: currentUser.usernameLower || "",
      lastMessage: previewText,
      lastTimestamp: timestamp
    });
  } catch (err) {
    console.error(err);
    alert("Pesan gagal terkirim. Periksa koneksi/konfigurasi Firebase.");
  }
});

// ---------- Boot ----------

(function boot() {
  const session = loadSession();
  if (session && session.uid) {
    enterApp(session);
  } else {
    showAuthScreen();
  }
})();
