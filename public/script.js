/**
 * MovieTime Watch Party � Client Script (player.html)
 * ────────────────────────────────────────────────────
 * Socket.io sync � WebRTC voice � YouTube Iframe API
 * Floating chat panel � Speaking detection � Unread badge
 * Secure video streaming via token � Auto-delete on video end
 */

/* ══════════ INIT ══════════ */
const params = new URLSearchParams(location.search);
const ROOM_ID = params.get('room');
const USERNAME = localStorage.getItem('mt_username');
if (!ROOM_ID || !USERNAME) { location.href = 'index.html'; }

const socket = io();

/* ── DOM refs ── */
const videoWrap      = document.getElementById('videoWrap');
const syncToast      = document.getElementById('syncToast');
const chatToast      = document.getElementById('chatToast');
const roomIdDisplay  = document.getElementById('roomIdDisplay');
const roomNameEl     = document.getElementById('roomNameEl');
const usernameEl     = document.getElementById('usernameEl');
const userCountEl    = document.getElementById('userCountEl');
const chatMessages   = document.getElementById('chatMessages');
const chatInput      = document.getElementById('chatInput');
const chatSendBtn    = document.getElementById('chatSendBtn');
const copyBtn        = document.getElementById('copyBtn');
const usersBtn       = document.getElementById('usersBtn');
const leaveBtn       = document.getElementById('leaveBtn');
const micBtn         = document.getElementById('micBtn');
const speakerBtn     = document.getElementById('speakerBtn');
const usersPopup     = document.getElementById('usersPopup');
const leavePopup     = document.getElementById('leavePopup');
const userListContainer = document.getElementById('userListContainer');

/* Panel DOM refs */
const chatFab       = document.getElementById('chatFab');
const chatBadge     = document.getElementById('chatBadge');
const panelOverlay  = document.getElementById('panelOverlay');
const chatPanel     = document.getElementById('chatPanel');
const panelClose    = document.getElementById('panelClose');
const panelNav      = document.getElementById('panelNav');
const panelSlider   = document.getElementById('panelSlider');
const panelTrack    = document.getElementById('panelTrack');
const panelViewport = document.getElementById('panelViewport');
const voiceUserList = document.getElementById('voiceUserList');

/* ── State ── */
let videoEl = null;
let ytPlayer = null;
let videoType = null;
let videoToken = null; // Secure token for streaming
let isSyncing = false;
let syncTimer = null;
let micOn = true;
let speakerOn = true;
let localStream = null;
let panelOpen = false;
let unreadCount = 0;
let currentUsers = [];
const peerConnections = {};
const remoteAudios = {};
const mutedUsers = {};
const speakingState = {};
let localAnalyser = null;
let localSpeaking = false;
let chatToastTimer = null;
let screenStreamSent = false; // Guard: prevent sending stream tracks multiple times
let chatToastQueue = []; // Queue for chat toast messages
let chatToastShowing = false;

/* ── Quality / Bitrate settings (LOCKED — no auto adaptation) ── */
const isMobile = /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent);
const QUALITY_PRESETS = {
  '480p':  { bitrate: 800000,  scaleDown: 1.0, label: '480p',  badge: 'SD', maxFps: 30 },
  '720p':  { bitrate: 1500000, scaleDown: 1.0, label: '720p',  badge: 'HD', maxFps: 30 },
  '1080p': { bitrate: 2500000, scaleDown: 1.0, label: '1080p', badge: 'HD', maxFps: 30 }
};
let currentQuality = '720p'; // Default locked quality
let currentLockedBitrate = QUALITY_PRESETS['720p'].bitrate; // Tracks the active bitrate

/* ── Screen Share State ── */
let isScreenCreator = false;
let screenStream = null;
const screenPeerConnections = {};
let screenActive = false;
const screenWaiting = document.getElementById('screenWaiting');
const screenShareControls = document.getElementById('screenShareControls');
const startScreenShareBtn = document.getElementById('startScreenShareBtn');
const stopScreenShareBtn = document.getElementById('stopScreenShareBtn');
const ssStatus = document.getElementById('ssStatus');

/* Helper: set syncing flag with auto-clear */
function startSyncing() {
  isSyncing = true;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { isSyncing = false; }, 500);
}

/* ══════════ DISPLAY SETUP ══════════ */
roomIdDisplay.textContent = ROOM_ID;
usernameEl.textContent = USERNAME;

/* ══════════ COPY ROOM ID ══════════ */
copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(ROOM_ID).then(() => {
    copyBtn.textContent = '✅';
    copyBtn.classList.add('copied');
    setTimeout(() => { copyBtn.textContent = '\uD83D\uDCCB'; copyBtn.classList.remove('copied'); }, 1500);
  });
});

/* ══════════════════════════════════════
   CHAT PANEL � OPEN / CLOSE / BADGE
   ══════════════════════════════════════ */
function openPanel() {
  panelOpen = true;
  chatPanel.classList.add('open');
  panelOverlay.classList.add('show');
  unreadCount = 0;
  chatBadge.classList.remove('visible');
  chatBadge.textContent = '';
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function closePanel() {
  panelOpen = false;
  chatPanel.classList.remove('open');
  panelOverlay.classList.remove('show');
}

chatFab.addEventListener('click', openPanel);
panelClose.addEventListener('click', closePanel);
panelOverlay.addEventListener('click', closePanel);

function incrementBadge() {
  if (panelOpen) return;
  unreadCount++;
  chatBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
  chatBadge.classList.add('visible');
}

/* ── Panel tabs (Chat / Voice) ── */
let panelTabActive = 0;
const panelTabBtns = panelNav.querySelectorAll('.tab-btn');

function setPanelTab(index) {
  panelTabActive = index;
  panelTrack.style.transform = `translateX(-${index * 50}%)`;
  panelSlider.classList.toggle('right', index === 1);
  panelTabBtns.forEach((b, i) => b.classList.toggle('active', i === index));
  if (index === 1) renderVoiceUserList();
}
panelTabBtns.forEach(b => b.addEventListener('click', () => setPanelTab(+b.dataset.tab)));

/* Touch swipe for panel tabs */
let psx = 0, psy = 0, pdrag = false;
panelViewport.addEventListener('touchstart', e => {
  psx = e.touches[0].clientX; psy = e.touches[0].clientY; pdrag = true;
}, { passive: true });
panelViewport.addEventListener('touchend', e => {
  if (!pdrag) return; pdrag = false;
  const dx = e.changedTouches[0].clientX - psx;
  const dy = e.changedTouches[0].clientY - psy;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
    if (dx < 0 && panelTabActive === 0) setPanelTab(1);
    else if (dx > 0 && panelTabActive === 1) setPanelTab(0);
  }
}, { passive: true });

/* ── Swipe to close panel (swipe right) ── */
let panelSx = 0;
chatPanel.addEventListener('touchstart', e => { panelSx = e.touches[0].clientX; }, { passive: true });
chatPanel.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - panelSx;
  if (dx > 80) closePanel();
}, { passive: true });

/* ══════════ JOIN ROOM ══════════ */
{
  const creatorFlag = localStorage.getItem('mt_screen_creator_' + ROOM_ID) === 'true';
  socket.emit('join-room', { roomId: ROOM_ID, username: USERNAME, isScreenCreator: creatorFlag });
}

socket.on('room-info', (info) => {
  roomNameEl.textContent = info.name;
  userCountEl.textContent = info.userCount;
  videoType = info.videoType;
  videoToken = info.videoToken || null;
  currentUsers = info.users;

  // Load video based on type for ALL users
  if (info.videoType === 'file' && info.videoToken) {
    setupFileVideo(info.videoToken);
  } else if (info.videoType === 'youtube' && info.videoId) {
    setupYouTube(info.videoId);
  } else if (info.videoType === 'screen') {
    setupScreenShareRoom(info);
  }

  // Show quality/fullscreen controls ONLY for screen share mode
  // Quality selector is ONLY shown to creator
  updateOverlayControlsVisibility(info.videoType, info.isCreator);

  renderUserList(info.users);
  renderVoiceUserList();
  initVoice(info.users);
});

/* ── Show/hide quality+fullscreen for screen share only ── */
function updateOverlayControlsVisibility(type, isCreator) {
  const overlayControls = document.getElementById('videoOverlayControls');
  if (!overlayControls) return;
  if (type === 'screen') {
    overlayControls.style.display = 'flex';
    // ONLY creator sees quality selector — viewers get fullscreen only
    const qualityWrap = document.querySelector('.quality-btn-wrap');
    if (qualityWrap) {
      qualityWrap.style.display = isCreator ? 'block' : 'none';
    }
  } else {
    // Hide fullscreen + quality for upload/youtube (they have native controls)
    overlayControls.style.display = 'none';
  }
}

socket.on('error-msg', (msg) => {
  alert(msg);
  location.href = 'room.html';
});

// Handle server-side video deletion notification
socket.on('video-deleted', ({ reason }) => {
  // Silently handle � no message to user
  console.log('Video auto deleted:', reason);
});

/* ══════════ FILE VIDEO (Streamed via /video/:token) ══════════ */
function setupFileVideo(token) {
  const v = document.createElement('video');
  v.src = `/video/${token}`; // Secure streaming route
  v.controls = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.controlsList = 'nodownload noplaybackrate';
  v.disablePictureInPicture = true;

  // Block right-click download
  v.addEventListener('contextmenu', e => e.preventDefault());

  videoWrap.prepend(v);
  videoEl = v;

  v.addEventListener('play', () => {
    if (isSyncing) return;
    socket.emit('video-play', { roomId: ROOM_ID, currentTime: v.currentTime });
  });
  v.addEventListener('pause', () => {
    if (isSyncing) return;
    socket.emit('video-pause', { roomId: ROOM_ID, currentTime: v.currentTime });
  });
  v.addEventListener('seeked', () => {
    if (isSyncing) return;
    socket.emit('video-seek', { roomId: ROOM_ID, currentTime: v.currentTime });
  });

  // Auto-delete trigger: video ended
  v.addEventListener('ended', () => {
    socket.emit('video-ended', { roomId: ROOM_ID });
    console.log('Video auto deleted');
  });
}

/* ══════════ YOUTUBE PLAYER (FIXED) ══════════ */
let ytReady = false;
let ytPendingId = null;

window.onYouTubeIframeAPIReady = () => {
  ytReady = true;
  if (ytPendingId) createYTPlayer(ytPendingId);
};

// FIX: Receives videoId directly (already extracted on server)
function setupYouTube(videoId) {
  if (!videoId) { alert('Invalid YouTube video'); return; }
  if (ytReady) createYTPlayer(videoId);
  else ytPendingId = videoId;
}

function createYTPlayer(videoId) {
  const div = document.createElement('div');
  div.id = 'ytplayer';
  videoWrap.prepend(div);

  ytPlayer = new YT.Player('ytplayer', {
    videoId,
    width: '100%',
    playerVars: { autoplay: 0, controls: 1, rel: 0, modestbranding: 1 },
    events: { onStateChange: onYTState }
  });
}

function onYTState(e) {
  if (isSyncing) return;
  if (!ytPlayer || !ytPlayer.getCurrentTime) return;
  const t = ytPlayer.getCurrentTime();
  if (e.data === YT.PlayerState.PLAYING) {
    socket.emit('video-play', { roomId: ROOM_ID, currentTime: t });
  } else if (e.data === YT.PlayerState.PAUSED) {
    socket.emit('video-pause', { roomId: ROOM_ID, currentTime: t });
  }
}

/* ══════════ SYNC INCOMING ══════════ */
function showSyncToast(msg) {
  syncToast.textContent = msg;
  syncToast.classList.add('show');
  setTimeout(() => syncToast.classList.remove('show'), 2000);
}

socket.on('video-play', ({ currentTime, from }) => {
  showSyncToast(`${from} pressed play`);
  startSyncing();
  if (videoType === 'file' && videoEl) {
    videoEl.currentTime = currentTime;
    videoEl.play().catch(() => {});
  } else if (videoType === 'youtube' && ytPlayer && ytPlayer.seekTo) {
    ytPlayer.seekTo(currentTime, true);
    ytPlayer.playVideo();
  }
});

socket.on('video-pause', ({ currentTime, from }) => {
  showSyncToast(`${from} paused`);
  startSyncing();
  if (videoType === 'file' && videoEl) {
    videoEl.currentTime = currentTime;
    videoEl.pause();
  } else if (videoType === 'youtube' && ytPlayer && ytPlayer.seekTo) {
    ytPlayer.seekTo(currentTime, true);
    ytPlayer.pauseVideo();
  }
});

socket.on('video-seek', ({ currentTime, from }) => {
  showSyncToast(`${from} seeked`);
  startSyncing();
  if (videoType === 'file' && videoEl) {
    videoEl.currentTime = currentTime;
  } else if (videoType === 'youtube' && ytPlayer && ytPlayer.seekTo) {
    ytPlayer.seekTo(currentTime, true);
  }
});

/* ══════════ CHAT ══════════ */
function formatTime(ts) {
  const d = new Date(ts);
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}

function addChatMsg(data) {
  const div = document.createElement('div');
  const isMine = data.senderId === socket.id;
  const isSystem = data.system;

  if (isSystem) {
    div.className = 'msg system';
    div.textContent = data.message;
  } else {
    div.className = `msg ${isMine ? 'mine' : 'other'}`;
    if (data.id) div.dataset.msgId = data.id;
    const u = document.createElement('div');
    u.className = 'msg-user';
    u.textContent = data.username;
    div.appendChild(u);
    const t = document.createElement('span');
    t.textContent = data.message;
    div.appendChild(t);
    const ts = document.createElement('span');
    ts.className = 'msg-time';
    ts.textContent = formatTime(data.timestamp || Date.now());
    // Seen tick for own messages
    if (isMine && data.id) {
      const tick = document.createElement('span');
      tick.className = 'msg-status sent';
      tick.id = 'tick-' + data.id;
      tick.textContent = ' \u2713';
      ts.appendChild(tick);
    }
    div.appendChild(ts);
    if (!isMine) {
      incrementBadge();
      showTopToast({ user: data.username, message: data.message });
      // Send seen acknowledgement
      if (data.id) {
        socket.emit('message-seen', { messageId: data.id, roomId: ROOM_ID });
      }
    }
  }
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/* -- Seen tick handler -- */
socket.on('message-seen', ({ messageId }) => {
  const tick = document.getElementById('tick-' + messageId);
  if (tick) {
    tick.textContent = ' \u2713\u2713';
    tick.className = 'msg-status seen';
  }
});

/* -- Top Toast Notification (queued, visible in fullscreen) -- */
function showTopToast(data) {
  chatToastQueue.push(data);
  if (!chatToastShowing) processToastQueue();
}
function processToastQueue() {
  if (chatToastQueue.length === 0) { chatToastShowing = false; return; }
  chatToastShowing = true;
  const data = chatToastQueue.shift();
  const toast = document.getElementById('chatToast');
  if (!toast) { chatToastShowing = false; return; }
  toast.textContent = data.user + ': ' + data.message;
  toast.classList.add('show');
  clearTimeout(chatToastTimer);
  chatToastTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => processToastQueue(), 300);
  }, 2500);
}

function sendChat() {
  const msg = chatInput.value.trim();
  if (!msg) return;
  socket.emit('chat-message', { roomId: ROOM_ID, message: msg });
  chatInput.value = '';
}
chatSendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
socket.on('chat-message', addChatMsg);

/* ══════════ EMOJI REACTIONS ══════════ */
const emojiBtn = document.getElementById('emojiBtn');
const emojiPanel = document.getElementById('emojiPanel');
const emojiFloatContainer = document.getElementById('emojiFloatContainer');

emojiBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  emojiPanel.classList.toggle('show');
});
document.addEventListener('click', () => emojiPanel.classList.remove('show'));
emojiPanel.addEventListener('click', e => e.stopPropagation());

document.querySelectorAll('.emoji-pick').forEach(el => {
  el.addEventListener('click', () => {
    const emoji = el.dataset.emoji;
    socket.emit('emoji-reaction', { roomId: ROOM_ID, emoji });
    emojiPanel.classList.remove('show');
  });
});

// Receive emoji from ALL users (server broadcasts to everyone including sender)
socket.on('emoji-reaction', ({ username, emoji }) => {
  showFloatingEmoji(username, emoji);
});

function showFloatingEmoji(username, emoji) {
  // Ensure emoji container is inside videoWrap and visible
  let container = emojiFloatContainer;
  if (!container || !container.parentElement) {
    container = document.getElementById('emojiFloatContainer');
  }
  // Safety: if container is missing, recreate it inside videoWrap
  if (!container) {
    container = document.createElement('div');
    container.id = 'emojiFloatContainer';
    container.className = 'emoji-float-container';
    videoWrap.appendChild(container);
  }
  // Ensure it's inside videoWrap (not displaced by prepend operations)
  if (container.parentElement !== videoWrap) {
    videoWrap.appendChild(container);
  }

  const left = 20 + Math.random() * 60;
  const group = document.createElement('div');
  group.className = 'emoji-float-group';
  group.style.left = left + '%';
  const em = document.createElement('span');
  em.className = 'ef-emoji';
  em.textContent = emoji;
  group.appendChild(em);
  const lbl = document.createElement('span');
  lbl.className = 'ef-label';
  lbl.textContent = `${username} reacted`;
  group.appendChild(lbl);
  container.appendChild(group);
  setTimeout(() => group.remove(), 2600);
}

/* ══════════ USER EVENTS ══════════ */
socket.on('user-joined', ({ username: uname, users, userCount }) => {
  userCountEl.textContent = userCount;
  currentUsers = users;
  addChatMsg({ system: true, message: `${uname} joined the party \uD83C\uDF89` });
  renderUserList(users);
  renderVoiceUserList();
  if (localStream && uname !== USERNAME) {
    const newUser = users.find(u => u.username === uname);
    if (newUser) createPeerConnection(newUser.id, true);
  }
});

socket.on('user-left', ({ username: uname, users, userCount }) => {
  userCountEl.textContent = userCount;
  currentUsers = users;
  addChatMsg({ system: true, message: `${uname} left the room` });
  renderUserList(users);
  renderVoiceUserList();
});

/* ══════════ USER LIST POPUP ══════════ */
usersBtn.addEventListener('click', () => usersPopup.classList.add('show'));
document.getElementById('closeUsersPopup').addEventListener('click', () => usersPopup.classList.remove('show'));
usersPopup.addEventListener('click', e => { if (e.target === usersPopup) usersPopup.classList.remove('show'); });

function renderUserList(users) {
  userListContainer.innerHTML = '';
  users.forEach(u => {
    const d = document.createElement('div');
    d.className = 'user-list-item';
    d.textContent = u.username + (u.id === socket.id ? ' (You)' : '');
    userListContainer.appendChild(d);
  });
}

/* ══════════ VOICE TAB RENDERING ══════════ */
function renderVoiceUserList() {
  voiceUserList.innerHTML = '';
  currentUsers.forEach(u => {
    const isMe = u.id === socket.id;
    const isSpeaking = isMe ? localSpeaking : !!speakingState[u.id];
    const isMuted = isMe ? !micOn : !!mutedUsers[u.id];

    const item = document.createElement('div');
    item.className = 'voice-user-item' + (isSpeaking ? ' speaking' : '');
    item.dataset.peerId = u.id;

    const avatar = document.createElement('div');
    avatar.className = 'voice-user-avatar';
    avatar.textContent = u.username.charAt(0).toUpperCase();
    item.appendChild(avatar);

    const name = document.createElement('div');
    name.className = 'voice-user-name';
    name.innerHTML = u.username + (isMe ? '<span class="you-tag">(You)</span>' : '');
    item.appendChild(name);

    const muteBtn = document.createElement('button');
    muteBtn.className = 'voice-user-mute-btn' + (isMuted ? ' muted' : '');
    muteBtn.title = isMuted ? 'Unmute' : 'Mute';

    if (isMe) {
      muteBtn.textContent = micOn ? '\uD83C\uDFA4' : '\uD83D\uDD07';
      muteBtn.addEventListener('click', () => toggleMic());
    } else {
      muteBtn.textContent = isMuted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
      muteBtn.addEventListener('click', () => {
        mutedUsers[u.id] = !mutedUsers[u.id];
        if (remoteAudios[u.id]) remoteAudios[u.id].muted = !!mutedUsers[u.id];
        renderVoiceUserList();
      });
    }
    item.appendChild(muteBtn);
    voiceUserList.appendChild(item);
  });
}

/* ══════════ LEAVE ══════════ */
leaveBtn.addEventListener('click', () => leavePopup.classList.add('show'));
document.getElementById('continueBtn').addEventListener('click', () => leavePopup.classList.remove('show'));
document.getElementById('confirmLeaveBtn').addEventListener('click', () => {
  // Stop screen share if creator
  if (isScreenCreator && screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    socket.emit('stop-screen-share', { roomId: ROOM_ID });
  }
  Object.values(screenPeerConnections).forEach(pc => pc.close());
  localStorage.removeItem('mt_screen_creator_' + ROOM_ID);
  socket.emit('leave-room');
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  Object.values(peerConnections).forEach(pc => pc.close());
  location.href = 'room.html';
});
leavePopup.addEventListener('click', e => { if (e.target === leavePopup) leavePopup.classList.remove('show'); });

/* ══════════ WEBRTC VOICE CHAT ══════════ */
/* ── Dynamic ICE config (fetched from server for reliable TURN) ── */
let ICE_CONFIG = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]};

(async function fetchIceServers() {
  try {
    const res = await fetch('/api/ice-servers');
    if (res.ok) {
      const data = await res.json();
      if (data.iceServers && data.iceServers.length > 0) {
        ICE_CONFIG = { iceServers: data.iceServers };
        console.log('[ICE] Loaded ' + data.iceServers.length + ' servers (STUN+TURN)');
      }
    }
  } catch (err) {
    console.warn('[ICE] Fetch failed, STUN only:', err.message);
  }
})();

/* ── ICE Candidate Buffer (fix race condition) ── */
const iceCandidateBuffer = {};
function bufferIceCandidate(id, c) {
  if (!iceCandidateBuffer[id]) iceCandidateBuffer[id] = [];
  iceCandidateBuffer[id].push(c);
}
async function flushIceCandidates(id, pc) {
  const buf = iceCandidateBuffer[id];
  if (!buf || !buf.length) return;
  for (const c of buf) {
    try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e) {}
  }
  delete iceCandidateBuffer[id];
}

async function initVoice(users) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    // Fix: Keep only first audio track to prevent audio stutter
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length > 1) {
      for (let i = 1; i < audioTracks.length; i++) {
        localStream.removeTrack(audioTracks[i]);
        audioTracks[i].stop();
      }
      console.log('[Audio] Trimmed to single audio track');
    }
    setupLocalSpeakingDetection(localStream);
    users.forEach(u => {
      if (u.id !== socket.id) createPeerConnection(u.id, true);
    });
  } catch (err) {
    console.warn('Microphone not available:', err);
    micBtn.querySelector('.vc-icon').textContent = '\uD83D\uDEAB';
    micBtn.querySelector('.vc-label').textContent = 'No Mic';
    micBtn.style.opacity = '0.4';
  }
}

function createPeerConnection(peerId, isInitiator) {
  if (peerConnections[peerId]) return;
  const pc = new RTCPeerConnection(ICE_CONFIG);
  peerConnections[peerId] = pc;
  if (localStream) {
    // Guard against duplicate track adding
    const existingSenders = pc.getSenders();
    localStream.getTracks().forEach(track => {
      const alreadyAdded = existingSenders.some(s => s.track && s.track.id === track.id);
      if (!alreadyAdded) {
        pc.addTrack(track, localStream);
      }
    });
  }
  pc.ontrack = (event) => {
    let audio = remoteAudios[peerId];
    if (!audio) { audio = new Audio(); audio.autoplay = true; remoteAudios[peerId] = audio; }
    audio.srcObject = event.streams[0];
    if (mutedUsers[peerId]) audio.muted = true;
    setupRemoteSpeakingDetection(peerId, event.streams[0]);
  };
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`[Voice] ICE candidate for ${peerId}:`, event.candidate.type);
      socket.emit('webrtc-ice-candidate', { to: peerId, candidate: event.candidate });
    }
  };
  pc.oniceconnectionstatechange = () => {
    console.log(`[Voice] ICE state for ${peerId}: ${pc.iceConnectionState}`);
    if (pc.iceConnectionState === 'failed') {
      console.log('[Voice] ICE failed, restarting...');
      pc.restartIce();
    }
  };
  pc.onconnectionstatechange = () => {
    console.log(`[Voice] Connection state for ${peerId}: ${pc.connectionState}`);
    if (pc.connectionState === 'connected') {
      console.log(`[Voice] ✅ Connected to ${peerId}`);
    }
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      pc.close(); delete peerConnections[peerId];
      if (remoteAudios[peerId]) { remoteAudios[peerId].srcObject = null; delete remoteAudios[peerId]; }
      delete speakingState[peerId]; renderVoiceUserList();
    }
  };
  if (isInitiator) {
    pc.createOffer().then(offer => { pc.setLocalDescription(offer); socket.emit('webrtc-offer', { to: peerId, offer }); });
  }
}

socket.on('webrtc-offer', async ({ from, offer }) => {
  createPeerConnection(from, false);
  const pc = peerConnections[from];
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('webrtc-answer', { to: from, answer });
});
socket.on('webrtc-answer', async ({ from, answer }) => {
  const pc = peerConnections[from]; if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
});
socket.on('webrtc-ice-candidate', async ({ from, candidate }) => {
  const pc = peerConnections[from]; if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
});

/* ══════════ SPEAKING DETECTION ══════════ */
function setupLocalSpeakingDetection(stream) {
  try {
    const ctx = new AudioContext(); const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser); localAnalyser = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    function check() {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const was = localSpeaking; localSpeaking = avg > 15;
      if (was !== localSpeaking) updateSpeakingUI(socket.id, localSpeaking);
      requestAnimationFrame(check);
    }
    check();
  } catch (err) { console.warn('Speaking detection not available:', err); }
}

function setupRemoteSpeakingDetection(peerId, stream) {
  try {
    const ctx = new AudioContext(); const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    function check() {
      if (!peerConnections[peerId]) return;
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const was = !!speakingState[peerId]; speakingState[peerId] = avg > 15;
      if (was !== speakingState[peerId]) updateSpeakingUI(peerId, speakingState[peerId]);
      requestAnimationFrame(check);
    }
    check();
  } catch (err) { console.warn('Remote speaking detection error:', err); }
}

function updateSpeakingUI(peerId, isSpeaking) {
  const item = voiceUserList.querySelector(`[data-peer-id="${peerId}"]`);
  if (item) item.classList.toggle('speaking', isSpeaking);
}

/* ══════════ MIC TOGGLE ══════════ */
function toggleMic() {
  if (!localStream) return;
  micOn = !micOn;
  localStream.getAudioTracks().forEach(t => t.enabled = micOn);
  micBtn.querySelector('.vc-icon').textContent = micOn ? '\uD83C\uDFA4' : '\uD83D\uDD07';
  micBtn.querySelector('.vc-label').textContent = micOn ? 'Mic On' : 'Mic Off';
  micBtn.classList.toggle('muted', !micOn);
  renderVoiceUserList();
}
micBtn.addEventListener('click', toggleMic);

/* ══════════ SPEAKER TOGGLE (ALL) ══════════ */
speakerBtn.addEventListener('click', () => {
  speakerOn = !speakerOn;
  Object.values(remoteAudios).forEach(a => a.muted = !speakerOn);
  speakerBtn.querySelector('.vc-icon').textContent = speakerOn ? '\uD83D\uDD0A' : '\uD83D\uDD08';
  speakerBtn.querySelector('.vc-label').textContent = speakerOn ? 'Speaker On' : 'Speaker Off';
  speakerBtn.classList.toggle('muted', !speakerOn);
  if (videoEl) videoEl.muted = speakerOn;
  if (!speakerOn) { currentUsers.forEach(u => { if (u.id !== socket.id) mutedUsers[u.id] = true; }); }
  else { Object.keys(mutedUsers).forEach(k => delete mutedUsers[k]); }
  renderVoiceUserList();
});

/* ═══════════════════════════════════════════════════
   SCREEN SHARE SYSTEM (File-based captureStream)
   ═══════════════════════════════════════════════════ */
const screenFileInput = document.getElementById('screenFileInput');
const ssFileName = document.getElementById('ssFileName');
const ssLocalPreviewWrap = document.getElementById('ssLocalPreviewWrap');
const ssLocalVideo = document.getElementById('ssLocalVideo');

function setupScreenShareRoom(info) {
  isScreenCreator = info.isCreator;

  if (isScreenCreator) {
    if (screenShareControls) screenShareControls.style.display = 'block';
    if (screenWaiting) screenWaiting.style.display = 'none';

    screenFileInput.addEventListener('change', () => {
      const file = screenFileInput.files[0];
      if (!file) return;
      ssFileName.textContent = file.name;
      ssFileName.classList.add('has-file');
      const url = URL.createObjectURL(file);
      ssLocalVideo.src = url;
      ssLocalVideo.load();
      ssLocalPreviewWrap.style.display = 'block';
      startScreenShareBtn.disabled = false;
      // Reset if re-selecting file
      if (screenActive) stopScreenShare();
    });

    startScreenShareBtn.addEventListener('click', startScreenShare);
    stopScreenShareBtn.addEventListener('click', stopScreenShare);
  } else {
    if (screenShareControls) screenShareControls.style.display = 'none';
    if (info.screenActive) {
      socket.emit('request-screen-stream', { roomId: ROOM_ID });
      if (screenWaiting) screenWaiting.style.display = 'none';
    } else {
      if (screenWaiting) screenWaiting.style.display = 'flex';
    }
  }
}

/* Wait until the stream actually has tracks (captureStream can be empty initially) */
function waitForStreamTracks(stream, timeoutMs) {
  return new Promise((resolve, reject) => {
    const tracks = stream.getTracks();
    if (tracks.length > 0) { resolve(stream); return; }
    const timer = setTimeout(() => { reject(new Error('Timed out waiting for stream tracks')); }, timeoutMs || 5000);
    stream.addEventListener('addtrack', function onTrack() {
      if (stream.getTracks().length > 0) {
        clearTimeout(timer);
        stream.removeEventListener('addtrack', onTrack);
        resolve(stream);
      }
    });
  });
}

async function startScreenShare() {
  try {
    if (!ssLocalVideo.src) { ssStatus.textContent = '❌ Select a video first'; return; }

    ssStatus.textContent = '⏳ Starting video...';

    // Ensure video is playing first
    ssLocalVideo.muted = false;
    await ssLocalVideo.play();

    // Small delay to ensure video is rendering frames
    await new Promise(r => setTimeout(r, 300));

    // Capture stream from the playing video element
    if (!ssLocalVideo.captureStream && !ssLocalVideo.mozCaptureStream) {
      ssStatus.textContent = '❌ Your browser does not support captureStream';
      return;
    }
    // Capture at stable 30fps — NO adaptive reduction
    const captureFrameRate = 30;
    screenStream = ssLocalVideo.captureStream ? ssLocalVideo.captureStream(captureFrameRate) : ssLocalVideo.mozCaptureStream();
    console.log(`[Stream] Captured at ${ssLocalVideo.videoWidth}x${ssLocalVideo.videoHeight} @${captureFrameRate}fps`);
    screenStreamSent = false; // Reset guard for new stream

    // Wait for tracks to be available
    try {
      await waitForStreamTracks(screenStream, 5000);
    } catch {
      console.warn('waitForStreamTracks timed out, proceeding anyway');
    }

    const tracks = screenStream.getTracks();
    console.log('[Screen] captureStream ready - ' + tracks.length + ' tracks:', tracks.map(t => `${t.kind}:${t.readyState}`));

    if (tracks.length === 0) {
      ssStatus.textContent = '\u274C No tracks captured - try a different video file';
      return;
    }

    // Detect video end
    ssLocalVideo.onended = () => { stopScreenShare(); };

    // Update UI
    startScreenShareBtn.style.display = 'none';
    stopScreenShareBtn.style.display = 'inline-flex';
    screenFileInput.disabled = true;
    ssStatus.textContent = '\uD83D\uDD34 Live \u2014 Streaming video to room';
    ssStatus.classList.add('live');
    screenActive = true;

    // Notify server
    socket.emit('start-screen-share', { roomId: ROOM_ID });

    // Send stream to all existing viewers
    currentUsers.forEach(u => {
      if (u.id !== socket.id) createScreenPeerForViewer(u.id);
    });

    // NO adaptive lag monitoring — quality is LOCKED by creator only
  } catch (err) {
    console.error('Stream start failed:', err);
    ssStatus.textContent = '\u274C Failed to start - ' + (err.message || 'try again');
    setTimeout(() => { ssStatus.textContent = ''; }, 4000);
  }
}

function stopScreenShare() {
  if (ssLocalVideo) { ssLocalVideo.pause(); ssLocalVideo.onended = null; }

  // Close all screen peer connections
  Object.values(screenPeerConnections).forEach(pc => { try { pc.close(); } catch {} });
  Object.keys(screenPeerConnections).forEach(k => delete screenPeerConnections[k]);

  screenStream = null; // Don't stop tracks  they belong to captureStream/video element

  startScreenShareBtn.style.display = 'inline-flex';
  stopScreenShareBtn.style.display = 'none';
  screenFileInput.disabled = false;
  ssStatus.textContent = '';
  ssStatus.classList.remove('live');
  screenActive = false;
  socket.emit('stop-screen-share', { roomId: ROOM_ID });
}

function createScreenPeerForViewer(viewerId) {
  // Clean up existing connection
  if (screenPeerConnections[viewerId]) {
    try { screenPeerConnections[viewerId].close(); } catch {}
    delete screenPeerConnections[viewerId];
  }

  const pc = new RTCPeerConnection(ICE_CONFIG);
  screenPeerConnections[viewerId] = pc;

  // ✅ Add tracks ONCE per peer � prevent duplicate track sending
  if (screenStream) {
    const existingSenders = pc.getSenders();
    const tracks = screenStream.getTracks();
    console.log(`[Screen] Adding ${tracks.length} tracks to peer for ${viewerId}`);
    tracks.forEach(track => {
      const alreadyAdded = existingSenders.some(s => s.track && s.track.id === track.id);
      if (!alreadyAdded) {
        pc.addTrack(track, screenStream);
      }
    });
  }

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit('screen-ice-candidate', { to: viewerId, candidate: e.candidate });
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`[Screen] ICE: ${pc.iceConnectionState} (peer: ${viewerId})`);
    if (pc.iceConnectionState === 'failed') {
      console.log('[Screen] ICE failed, restarting...');
      pc.restartIce();
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`[Screen] Connection: ${pc.connectionState} (peer: ${viewerId})`);
    if (pc.connectionState === 'connected') {
      // Apply LOCKED bitrate once connection is fully established
      applyLockedBitrate(pc);
    }
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      try { pc.close(); } catch {}
      delete screenPeerConnections[viewerId];
    }
  };

  // Create and send offer
  pc.createOffer({
    offerToReceiveAudio: false,
    offerToReceiveVideo: false
  }).then(offer => {
    return pc.setLocalDescription(offer);
  }).then(() => {
    socket.emit('screen-offer', { to: viewerId, offer: pc.localDescription });
    console.log(`[Screen] Sent offer to ${viewerId}`);
    // Apply locked bitrate early as a fallback
    setTimeout(() => applyLockedBitrate(pc), 1000);
  }).catch(err => {
    console.error('[Screen] Failed to create offer:', err);
  });
}

// ── Creator: server asks to send stream to a new viewer ──
socket.on('send-screen-to-viewer', ({ viewerId }) => {
  if (!isScreenCreator || !screenStream) return;
  console.log('Server requested stream for viewer:', viewerId);
  createScreenPeerForViewer(viewerId);
});

// ── Viewer: receive screen offer from creator ──
socket.on('screen-offer', async ({ from, offer }) => {
  if (isScreenCreator) return;
  console.log('Received screen offer from creator:', from);

  // Clean up existing
  if (screenPeerConnections[from]) {
    try { screenPeerConnections[from].close(); } catch {}
    delete screenPeerConnections[from];
  }

  const pc = new RTCPeerConnection(ICE_CONFIG);
  screenPeerConnections[from] = pc;

  pc.ontrack = (event) => {
    console.log('Received track from creator:', event.track.kind, event.track.readyState);
    if (screenWaiting) screenWaiting.style.display = 'none';

    let v = document.getElementById('screenVideo');
    if (!v) {
      v = document.createElement('video');
      v.id = 'screenVideo';
      v.autoplay = true;
      v.playsInline = true;
      v.controls = true; // Enable controls for viewers
      v.controlsList = 'nodownload noplaybackrate';
      v.style.cssText = 'width:100%;aspect-ratio:16/9;display:block;background:#000;max-height:80vh';
      videoWrap.prepend(v);
      videoEl = v;
      updateQualityBadge();
    }
    v.srcObject = event.streams[0];
    // Ensure audio plays � handle autoplay policy
    v.muted = false;
    v.play().catch(() => {
      // Autoplay blocked � try muted first, then unmute on user interaction
      v.muted = true;
      v.play().catch(() => {});
      const unmute = () => { v.muted = false; document.removeEventListener('click', unmute); };
      document.addEventListener('click', unmute, { once: true });
    });
  };

  pc.onicecandidate = e => {
    if (e.candidate) socket.emit('screen-ice-candidate', { to: from, candidate: e.candidate });
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`[Screen] Viewer ICE state: ${pc.iceConnectionState}`);
    if (pc.iceConnectionState === 'failed') {
      console.log('[Screen] Viewer ICE failed, attempting restart...');
      pc.restartIce();
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`[Screen] Viewer connection state: ${pc.connectionState}`);
    if (pc.connectionState === 'connected') {
      console.log('[Screen] ✅ Viewer connected to creator stream');
    }
    if (pc.connectionState === 'failed') {
      try { pc.close(); } catch {}
      delete screenPeerConnections[from];
      // Auto-retry: request stream again after brief delay
      console.log('[Screen] Connection failed, retrying in 2s...');
      setTimeout(() => {
        socket.emit('request-screen-stream', { roomId: ROOM_ID });
      }, 2000);
    }
    if (pc.connectionState === 'disconnected') {
      // Wait a moment before cleanup � transient disconnects can recover
      setTimeout(() => {
        if (pc.connectionState === 'disconnected') {
          try { pc.close(); } catch {}
          delete screenPeerConnections[from];
          // Try reconnect
          socket.emit('request-screen-stream', { roomId: ROOM_ID });
        }
      }, 3000);
    }
  };

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('screen-answer', { to: from, answer: pc.localDescription });
    console.log('Sent screen answer to creator');
  } catch (err) {
    console.error('Failed to handle screen offer:', err);
  }
});

// ── Creator: receive answer from viewer ──
socket.on('screen-answer', async ({ from, answer }) => {
  const pc = screenPeerConnections[from];
  if (!pc) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    await flushIceCandidates(from, pc);
    console.log('Set remote description from viewer:', from);
  } catch (err) {
    console.error('Failed to set answer:', err);
  }
});

// ── ICE candidates for screen share ──
socket.on('screen-ice-candidate', async ({ from, candidate }) => {
  const pc = screenPeerConnections[from];
  if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
    bufferIceCandidate(from, candidate);
    return;
  }
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.warn('ICE candidate error:', err);
  }
});

// ── Screen share started notification ──
socket.on('screen-share-started', ({ creatorName }) => {
  if (!isScreenCreator) {
    if (screenWaiting) screenWaiting.style.display = 'none';
    socket.emit('request-screen-stream', { roomId: ROOM_ID });
  }
  showSyncToast(`${creatorName} started streaming video`);
});

// ── Screen share stopped notification ──
socket.on('screen-share-stopped', ({ reason }) => {
  if (!isScreenCreator) {
    const v = document.getElementById('screenVideo');
    if (v) { v.srcObject = null; v.remove(); }
    if (screenWaiting) screenWaiting.style.display = 'flex';
    Object.values(screenPeerConnections).forEach(pc => { try { pc.close(); } catch {} });
    Object.keys(screenPeerConnections).forEach(k => delete screenPeerConnections[k]);
  }
  showSyncToast(reason === 'creator-left' ? 'Host left - stream ended' : 'Video stream stopped');
});

// ── When new user joins a screen room, creator sends them the stream ──
socket.on('user-joined', ({ username: uname, users }) => {
  if (isScreenCreator && screenStream && screenActive) {
    const nu = users.find(u => u.username === uname && u.id !== socket.id);
    if (nu) {
      console.log('New viewer joined, sending stream to:', nu.id);
      // Small delay to ensure socket is fully joined
      setTimeout(() => createScreenPeerForViewer(nu.id), 500);
    }
  }
});

/* ═══════════ BITRATE CONTROL (LOCKED — NO AUTO ADAPTATION) ═══════════ */

/**
 * Apply LOCKED bitrate to a single peer connection.
 * Both minBitrate and maxBitrate are set EQUAL to prevent
 * any automatic quality adaptation by the browser/WebRTC.
 * Uses SINGLE encoding only — no simulcast.
 */
async function applyLockedBitrate(pc) {
  try {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (!sender) { console.warn('No video sender found'); return; }

    const params = sender.getParameters();
    // Force SINGLE encoding — no simulcast
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    // Remove any extra encodings (prevent simulcast)
    while (params.encodings.length > 1) {
      params.encodings.pop();
    }

    // LOCK bitrate: min === max to prevent auto-adaptation
    params.encodings[0].maxBitrate = currentLockedBitrate;
    params.encodings[0].minBitrate = currentLockedBitrate;
    params.encodings[0].scaleResolutionDownBy = 1.0;
    // Stable 30fps for all
    params.encodings[0].maxFramerate = 30;
    // Do NOT use adaptive degradation
    params.degradationPreference = 'maintain-framerate';

    await sender.setParameters(params);

    console.log(`[Quality] LOCKED Bitrate: ${(currentLockedBitrate / 1000000).toFixed(1)} Mbps | FPS: 30 | Quality: ${currentQuality}`);
  } catch (err) {
    console.warn('Failed to set locked bitrate:', err);
  }
}

/**
 * Set locked quality — ONLY called by creator.
 * Changes bitrate for all peer connections and syncs to all viewers.
 */
function setLockedQuality(qualityKey) {
  const preset = QUALITY_PRESETS[qualityKey];
  if (!preset) return;

  currentQuality = qualityKey;
  currentLockedBitrate = preset.bitrate;

  // Apply to all active screen peer connections
  Object.values(screenPeerConnections).forEach(pc => applyLockedBitrate(pc));
  updateQualityBadge();

  // Update selector UI
  document.querySelectorAll('.quality-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.quality === qualityKey);
  });

  // Close quality panel
  const qp = document.getElementById('qualityPanel');
  if (qp) qp.classList.remove('show');

  showSyncToast(`Quality: ${preset.label}`);

  // Sync locked bitrate to all users in room (server validates creator)
  socket.emit('quality-change', { roomId: ROOM_ID, bitrate: preset.bitrate, label: preset.label });
}

/**
 * Receive quality change from creator (viewers apply it).
 * ONLY shown as toast when creator actually clicked — not auto.
 */
socket.on('quality-change', ({ bitrate, label, from }) => {
  // Apply the locked bitrate from creator
  currentLockedBitrate = bitrate;
  // Find matching preset for UI update
  const matchKey = Object.keys(QUALITY_PRESETS).find(k => QUALITY_PRESETS[k].bitrate === bitrate);
  if (matchKey) currentQuality = matchKey;

  // Apply to all active screen peer connections (viewers)
  Object.values(screenPeerConnections).forEach(pc => applyLockedBitrate(pc));
  updateQualityBadge();

  document.querySelectorAll('.quality-option').forEach(opt => {
    const optPreset = QUALITY_PRESETS[opt.dataset.quality];
    opt.classList.toggle('active', optPreset && optPreset.bitrate === bitrate);
  });

  // Only show message when creator actually clicks (this event only fires on real click)
  showSyncToast(`${from} changed quality to ${label}`);
});

function updateQualityBadge() {
  const badge = document.getElementById('qualityBadge');
  if (!badge) return;
  const preset = QUALITY_PRESETS[currentQuality] || QUALITY_PRESETS['720p'];
  badge.textContent = preset.badge;
  badge.className = 'quality-badge ' + (preset.badge === 'HD' ? 'hd' : 'sd');
}

/* ═══════════ FULLSCREEN (uses videoWrap for overlay persistence) ═══════════ */
function toggleFullscreen() {
  // Fullscreen the container (videoWrap) so overlay-ui (toast, emoji) persists
  const target = videoWrap;
  if (!target) return;

  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document).catch(() => {});
  } else {
    const fn = target.requestFullscreen || target.webkitRequestFullscreen || target.msRequestFullscreen;
    if (fn) fn.call(target).catch(() => {});
  }
}

// Double-tap to fullscreen on mobile
let lastTapTime = 0;
videoWrap.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTapTime < 300) {
    e.preventDefault();
    toggleFullscreen();
  }
  lastTapTime = now;
});

// Fullscreen button click
const fsBtn = document.getElementById('fullscreenBtn');
if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);

// Quality settings button (CREATOR ONLY — visibility controlled by updateOverlayControlsVisibility)
const qualityBtn = document.getElementById('qualityBtn');
const qualityPanel = document.getElementById('qualityPanel');
if (qualityBtn && qualityPanel) {
  qualityBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    qualityPanel.classList.toggle('show');
  });
  document.addEventListener('click', () => qualityPanel.classList.remove('show'));
  qualityPanel.addEventListener('click', e => e.stopPropagation());
  qualityPanel.querySelectorAll('.quality-option').forEach(opt => {
    opt.addEventListener('click', () => setLockedQuality(opt.dataset.quality));
  });
}

// Listen for fullscreen changes to update icon
document.addEventListener('fullscreenchange', updateFullscreenIcon);
document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);

function updateFullscreenIcon() {
  const btn = document.getElementById('fullscreenBtn');
  if (!btn) return;
  const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
  btn.textContent = isFS ? '⛌' : '⛶';
  btn.title = isFS ? 'Exit Fullscreen' : 'Fullscreen';
}