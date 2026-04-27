/**
 * MovieTime Watch Party — Client Script (player.html)
 * ────────────────────────────────────────────────────
 * Socket.io sync · WebRTC voice · YouTube Iframe API
 * Floating chat panel · Speaking detection · Unread badge
 * Secure video streaming via token · Auto-delete on video end
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
    setTimeout(() => { copyBtn.textContent = '📋'; copyBtn.classList.remove('copied'); }, 1500);
  });
});

/* ══════════════════════════════════════
   CHAT PANEL — OPEN / CLOSE / BADGE
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
socket.emit('join-room', { roomId: ROOM_ID, username: USERNAME });

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
  }

  renderUserList(info.users);
  renderVoiceUserList();
  initVoice(info.users);
});

socket.on('error-msg', (msg) => {
  alert(msg);
  location.href = 'room.html';
});

// Handle server-side video deletion notification
socket.on('video-deleted', ({ reason }) => {
  // Silently handle — no message to user
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
    div.appendChild(ts);
    if (!isMine) incrementBadge();
  }
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
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

socket.on('emoji-reaction', ({ username, emoji }) => {
  showFloatingEmoji(username, emoji);
});

function showFloatingEmoji(username, emoji) {
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
  emojiFloatContainer.appendChild(group);
  setTimeout(() => group.remove(), 2600);
}

/* ══════════ USER EVENTS ══════════ */
socket.on('user-joined', ({ username: uname, users, userCount }) => {
  userCountEl.textContent = userCount;
  currentUsers = users;
  addChatMsg({ system: true, message: `${uname} joined the party 🎉` });
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
      muteBtn.textContent = micOn ? '🎤' : '🔇';
      muteBtn.addEventListener('click', () => toggleMic());
    } else {
      muteBtn.textContent = isMuted ? '🔇' : '🔊';
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
  socket.emit('leave-room');
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  Object.values(peerConnections).forEach(pc => pc.close());
  location.href = 'room.html';
});
leavePopup.addEventListener('click', e => { if (e.target === leavePopup) leavePopup.classList.remove('show'); });

/* ══════════ WEBRTC VOICE CHAT ══════════ */
const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

async function initVoice(users) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    setupLocalSpeakingDetection(localStream);
    users.forEach(u => {
      if (u.id !== socket.id) createPeerConnection(u.id, true);
    });
  } catch (err) {
    console.warn('Microphone not available:', err);
    micBtn.querySelector('.vc-icon').textContent = '🚫';
    micBtn.querySelector('.vc-label').textContent = 'No Mic';
    micBtn.style.opacity = '0.4';
  }
}

function createPeerConnection(peerId, isInitiator) {
  if (peerConnections[peerId]) return;
  const pc = new RTCPeerConnection(ICE_SERVERS);
  peerConnections[peerId] = pc;
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }
  pc.ontrack = (event) => {
    let audio = remoteAudios[peerId];
    if (!audio) { audio = new Audio(); audio.autoplay = true; remoteAudios[peerId] = audio; }
    audio.srcObject = event.streams[0];
    if (mutedUsers[peerId]) audio.muted = true;
    setupRemoteSpeakingDetection(peerId, event.streams[0]);
  };
  pc.onicecandidate = (event) => {
    if (event.candidate) socket.emit('webrtc-ice-candidate', { to: peerId, candidate: event.candidate });
  };
  pc.onconnectionstatechange = () => {
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
  micBtn.querySelector('.vc-icon').textContent = micOn ? '🎤' : '🔇';
  micBtn.querySelector('.vc-label').textContent = micOn ? 'Mic On' : 'Mic Off';
  micBtn.classList.toggle('muted', !micOn);
  renderVoiceUserList();
}
micBtn.addEventListener('click', toggleMic);

/* ══════════ SPEAKER TOGGLE (ALL) ══════════ */
speakerBtn.addEventListener('click', () => {
  speakerOn = !speakerOn;
  Object.values(remoteAudios).forEach(a => a.muted = !speakerOn);
  speakerBtn.querySelector('.vc-icon').textContent = speakerOn ? '🔊' : '🔈';
  speakerBtn.querySelector('.vc-label').textContent = speakerOn ? 'Speaker On' : 'Speaker Off';
  speakerBtn.classList.toggle('muted', !speakerOn);
  if (videoEl) videoEl.muted = speakerOn;
  if (!speakerOn) { currentUsers.forEach(u => { if (u.id !== socket.id) mutedUsers[u.id] = true; }); }
  else { Object.keys(mutedUsers).forEach(k => delete mutedUsers[k]); }
  renderVoiceUserList();
});
