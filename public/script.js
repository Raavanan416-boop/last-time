/**
 * MovieTime Watch Party â€” Client Script (player.html)
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Socket.io sync Â· WebRTC voice Â· YouTube Iframe API
 * Floating chat panel Â· Speaking detection Â· Unread badge
 * Secure video streaming via token Â· Auto-delete on video end
 */

/* â•â•â•â•â•â•â•â•â•â• INIT â•â•â•â•â•â•â•â•â•â• */
const params = new URLSearchParams(location.search);
const ROOM_ID = params.get('room');
const USERNAME = localStorage.getItem('mt_username');
if (!ROOM_ID || !USERNAME) { location.href = 'index.html'; }

const socket = io();

/* â”€â”€ DOM refs â”€â”€ */
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

/* â”€â”€ State â”€â”€ */
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

/* ── Quality / Bitrate settings ── */
const QUALITY_PRESETS = {
  auto:   { maxBitrate: 5000000, scaleDown: 1.0, label: 'Auto',   badge: 'HD' },
  high:   { maxBitrate: 5000000, scaleDown: 1.0, label: '1080p',  badge: 'HD' },
  medium: { maxBitrate: 2500000, scaleDown: 1.5, label: '720p',   badge: 'HD' },
  sd:     { maxBitrate: 1200000, scaleDown: 2.0, label: '480p',   badge: 'SD' },
  low:    { maxBitrate: 500000,  scaleDown: 3.0, label: '360p',   badge: 'SD' },
  smooth: { maxBitrate: 1500000, scaleDown: 2.0, label: 'Smooth', badge: 'SD' }
};
let currentQuality = 'auto';
let performanceMode = false; // false = High Quality, true = Smooth Mode

/* â”€â”€ Screen Share State â”€â”€ */
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

/* â•â•â•â•â•â•â•â•â•â• DISPLAY SETUP â•â•â•â•â•â•â•â•â•â• */
roomIdDisplay.textContent = ROOM_ID;
usernameEl.textContent = USERNAME;

/* â•â•â•â•â•â•â•â•â•â• COPY ROOM ID â•â•â•â•â•â•â•â•â•â• */
copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(ROOM_ID).then(() => {
    copyBtn.textContent = 'âœ…';
    copyBtn.classList.add('copied');
    setTimeout(() => { copyBtn.textContent = 'ðŸ“‹'; copyBtn.classList.remove('copied'); }, 1500);
  });
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   CHAT PANEL â€” OPEN / CLOSE / BADGE
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
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

/* â”€â”€ Panel tabs (Chat / Voice) â”€â”€ */
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

/* â”€â”€ Swipe to close panel (swipe right) â”€â”€ */
let panelSx = 0;
chatPanel.addEventListener('touchstart', e => { panelSx = e.touches[0].clientX; }, { passive: true });
chatPanel.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - panelSx;
  if (dx > 80) closePanel();
}, { passive: true });

/* â•â•â•â•â•â•â•â•â•â• JOIN ROOM â•â•â•â•â•â•â•â•â•â• */
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
  // Silently handle â€” no message to user
  console.log('Video auto deleted:', reason);
});

/* â•â•â•â•â•â•â•â•â•â• FILE VIDEO (Streamed via /video/:token) â•â•â•â•â•â•â•â•â•â• */
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

/* â•â•â•â•â•â•â•â•â•â• YOUTUBE PLAYER (FIXED) â•â•â•â•â•â•â•â•â•â• */
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

/* â•â•â•â•â•â•â•â•â•â• SYNC INCOMING â•â•â•â•â•â•â•â•â•â• */
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

/* â•â•â•â•â•â•â•â•â•â• CHAT â•â•â•â•â•â•â•â•â•â• */
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

/* â•â•â•â•â•â•â•â•â•â• EMOJI REACTIONS â•â•â•â•â•â•â•â•â•â• */
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

/* â•â•â•â•â•â•â•â•â•â• USER EVENTS â•â•â•â•â•â•â•â•â•â• */
socket.on('user-joined', ({ username: uname, users, userCount }) => {
  userCountEl.textContent = userCount;
  currentUsers = users;
  addChatMsg({ system: true, message: `${uname} joined the party ðŸŽ‰` });
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

/* â•â•â•â•â•â•â•â•â•â• USER LIST POPUP â•â•â•â•â•â•â•â•â•â• */
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

/* â•â•â•â•â•â•â•â•â•â• VOICE TAB RENDERING â•â•â•â•â•â•â•â•â•â• */
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
      muteBtn.textContent = micOn ? 'ðŸŽ¤' : 'ðŸ”‡';
      muteBtn.addEventListener('click', () => toggleMic());
    } else {
      muteBtn.textContent = isMuted ? 'ðŸ”‡' : 'ðŸ”Š';
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

/* â•â•â•â•â•â•â•â•â•â• LEAVE â•â•â•â•â•â•â•â•â•â• */
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

/* â•â•â•â•â•â•â•â•â•â• WEBRTC VOICE CHAT â•â•â•â•â•â•â•â•â•â• */
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
    micBtn.querySelector('.vc-icon').textContent = 'ðŸš«';
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

/* â•â•â•â•â•â•â•â•â•â• SPEAKING DETECTION â•â•â•â•â•â•â•â•â•â• */
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

/* â•â•â•â•â•â•â•â•â•â• MIC TOGGLE â•â•â•â•â•â•â•â•â•â• */
function toggleMic() {
  if (!localStream) return;
  micOn = !micOn;
  localStream.getAudioTracks().forEach(t => t.enabled = micOn);
  micBtn.querySelector('.vc-icon').textContent = micOn ? 'ðŸŽ¤' : 'ðŸ”‡';
  micBtn.querySelector('.vc-label').textContent = micOn ? 'Mic On' : 'Mic Off';
  micBtn.classList.toggle('muted', !micOn);
  renderVoiceUserList();
}
micBtn.addEventListener('click', toggleMic);

/* â•â•â•â•â•â•â•â•â•â• SPEAKER TOGGLE (ALL) â•â•â•â•â•â•â•â•â•â• */
speakerBtn.addEventListener('click', () => {
  speakerOn = !speakerOn;
  Object.values(remoteAudios).forEach(a => a.muted = !speakerOn);
  speakerBtn.querySelector('.vc-icon').textContent = speakerOn ? 'ðŸ”Š' : 'ðŸ”ˆ';
  speakerBtn.querySelector('.vc-label').textContent = speakerOn ? 'Speaker On' : 'Speaker Off';
  speakerBtn.classList.toggle('muted', !speakerOn);
  if (videoEl) videoEl.muted = speakerOn;
  if (!speakerOn) { currentUsers.forEach(u => { if (u.id !== socket.id) mutedUsers[u.id] = true; }); }
  else { Object.keys(mutedUsers).forEach(k => delete mutedUsers[k]); }
  renderVoiceUserList();
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   SCREEN SHARE SYSTEM (File-based captureStream)
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const SCREEN_ICE = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
]};

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
    if (!ssLocalVideo.src) { ssStatus.textContent = 'âŒ Select a video first'; return; }

    ssStatus.textContent = 'â³ Starting video...';

    // Ensure video is playing first
    ssLocalVideo.muted = false;
    await ssLocalVideo.play();

    // Small delay to ensure video is rendering frames
    await new Promise(r => setTimeout(r, 300));

    // Capture stream from the playing video element
    if (!ssLocalVideo.captureStream && !ssLocalVideo.mozCaptureStream) {
      ssStatus.textContent = 'âŒ Your browser does not support captureStream';
      return;
    }
    screenStream = ssLocalVideo.captureStream ? ssLocalVideo.captureStream(30) : ssLocalVideo.mozCaptureStream();

    // Wait for tracks to be available
    try {
      await waitForStreamTracks(screenStream, 5000);
    } catch {
      console.warn('waitForStreamTracks timed out, proceeding anyway');
    }

    const tracks = screenStream.getTracks();
    console.log(`âœ… captureStream ready â€” ${tracks.length} tracks:`, tracks.map(t => `${t.kind}:${t.readyState}`));

    if (tracks.length === 0) {
      ssStatus.textContent = 'âŒ No tracks captured â€” try a different video file';
      return;
    }

    // Detect video end
    ssLocalVideo.onended = () => { stopScreenShare(); };

    // Update UI
    startScreenShareBtn.style.display = 'none';
    stopScreenShareBtn.style.display = 'inline-flex';
    screenFileInput.disabled = true;
    ssStatus.textContent = 'ðŸ”´ Live â€” Streaming video to room';
    ssStatus.classList.add('live');
    screenActive = true;

    // Notify server
    socket.emit('start-screen-share', { roomId: ROOM_ID });

    // Send stream to all existing viewers
    currentUsers.forEach(u => {
      if (u.id !== socket.id) createScreenPeerForViewer(u.id);
    });
  } catch (err) {
    console.error('Stream start failed:', err);
    ssStatus.textContent = 'âŒ Failed to start â€” ' + (err.message || 'try again');
    setTimeout(() => { ssStatus.textContent = ''; }, 4000);
  }
}

function stopScreenShare() {
  if (ssLocalVideo) { ssLocalVideo.pause(); ssLocalVideo.onended = null; }

  // Close all screen peer connections
  Object.values(screenPeerConnections).forEach(pc => { try { pc.close(); } catch {} });
  Object.keys(screenPeerConnections).forEach(k => delete screenPeerConnections[k]);

  screenStream = null; // Don't stop tracks â€” they belong to captureStream/video element

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

  const pc = new RTCPeerConnection(SCREEN_ICE);
  screenPeerConnections[viewerId] = pc;

  // Add all tracks from the captured stream
  if (screenStream) {
    const tracks = screenStream.getTracks();
    console.log(`Adding ${tracks.length} tracks to peer for ${viewerId}`);
    tracks.forEach(track => {
      pc.addTrack(track, screenStream);
    });
  }

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit('screen-ice-candidate', { to: viewerId, candidate: e.candidate });
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`ICE state for ${viewerId}: ${pc.iceConnectionState}`);
    if (pc.iceConnectionState === 'failed') {
      console.log('ICE failed, restarting...');
      pc.restartIce();
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`Connection state for ${viewerId}: ${pc.connectionState}`);
    if (pc.connectionState === 'connected') {
      // Apply HD bitrate once connection is fully established
      applyBitrate(pc);
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
    console.log(`Sent screen offer to ${viewerId}`);
    // Also apply bitrate early as a fallback
    setTimeout(() => applyBitrate(pc), 1000);
  }).catch(err => {
    console.error('Failed to create offer:', err);
  });
}

// â”€â”€ Creator: server asks to send stream to a new viewer â”€â”€
socket.on('send-screen-to-viewer', ({ viewerId }) => {
  if (!isScreenCreator || !screenStream) return;
  console.log('Server requested stream for viewer:', viewerId);
  createScreenPeerForViewer(viewerId);
});

// â”€â”€ Viewer: receive screen offer from creator â”€â”€
socket.on('screen-offer', async ({ from, offer }) => {
  if (isScreenCreator) return;
  console.log('Received screen offer from creator:', from);

  // Clean up existing
  if (screenPeerConnections[from]) {
    try { screenPeerConnections[from].close(); } catch {}
    delete screenPeerConnections[from];
  }

  const pc = new RTCPeerConnection(SCREEN_ICE);
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
    // Ensure audio plays â€” handle autoplay policy
    v.muted = false;
    v.play().catch(() => {
      // Autoplay blocked â€” try muted first, then unmute on user interaction
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
    console.log(`Viewer ICE state: ${pc.iceConnectionState}`);
  };

  pc.onconnectionstatechange = () => {
    console.log(`Viewer connection state: ${pc.connectionState}`);
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      try { pc.close(); } catch {}
      delete screenPeerConnections[from];
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

// â”€â”€ Creator: receive answer from viewer â”€â”€
socket.on('screen-answer', async ({ from, answer }) => {
  const pc = screenPeerConnections[from];
  if (!pc) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    console.log('Set remote description from viewer:', from);
  } catch (err) {
    console.error('Failed to set answer:', err);
  }
});

// â”€â”€ ICE candidates for screen share â”€â”€
socket.on('screen-ice-candidate', async ({ from, candidate }) => {
  const pc = screenPeerConnections[from];
  if (!pc) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.warn('ICE candidate error:', err);
  }
});

// â”€â”€ Screen share started notification â”€â”€
socket.on('screen-share-started', ({ creatorName }) => {
  if (!isScreenCreator) {
    if (screenWaiting) screenWaiting.style.display = 'none';
    socket.emit('request-screen-stream', { roomId: ROOM_ID });
  }
  showSyncToast(`${creatorName} started streaming video`);
});

// â”€â”€ Screen share stopped notification â”€â”€
socket.on('screen-share-stopped', ({ reason }) => {
  if (!isScreenCreator) {
    const v = document.getElementById('screenVideo');
    if (v) { v.srcObject = null; v.remove(); }
    if (screenWaiting) screenWaiting.style.display = 'flex';
    Object.values(screenPeerConnections).forEach(pc => { try { pc.close(); } catch {} });
    Object.keys(screenPeerConnections).forEach(k => delete screenPeerConnections[k]);
  }
  showSyncToast(reason === 'creator-left' ? 'Host left â€” stream ended' : 'Video stream stopped');
});

// â”€â”€ When new user joins a screen room, creator sends them the stream â”€â”€
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

/* ═══════════ BITRATE CONTROL ═══════════ */
async function applyBitrate(pc) {
  try {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (!sender) { console.warn('No video sender found'); return; }

    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }

    const effectiveQuality = performanceMode ? 'smooth' : currentQuality;
    const preset = QUALITY_PRESETS[effectiveQuality] || QUALITY_PRESETS.auto;

    params.encodings[0].maxBitrate = preset.maxBitrate;
    params.encodings[0].scaleResolutionDownBy = preset.scaleDown || 1.0;

    // Prevent browser from degrading quality
    if (preset.scaleDown <= 1.0) {
      params.degradationPreference = 'maintain-resolution';
    } else {
      params.degradationPreference = 'maintain-framerate';
    }

    await sender.setParameters(params);

    // Debug logs
    console.log(`[Quality] Bitrate: ${(preset.maxBitrate / 1000000).toFixed(1)} Mbps | Scale: ${preset.scaleDown}x | Mode: ${preset.label}`);
    console.log(`[Quality] Tracks:`, pc.getSenders().map(s => s.track ? `${s.track.kind}:${s.track.readyState}` : 'null'));
  } catch (err) {
    console.warn('Failed to set bitrate:', err);
  }
}

function changeQuality(quality) {
  currentQuality = quality;
  performanceMode = (quality === 'smooth');
  const preset = QUALITY_PRESETS[quality];
  // Apply to all active screen peer connections
  Object.values(screenPeerConnections).forEach(pc => applyBitrate(pc));
  updateQualityBadge();
  // Update selector UI
  document.querySelectorAll('.quality-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.quality === quality);
  });
  // Update performance mode toggle
  const perfToggle = document.getElementById('perfModeToggle');
  if (perfToggle) perfToggle.classList.toggle('active', performanceMode);
  // Close quality panel
  const qp = document.getElementById('qualityPanel');
  if (qp) qp.classList.remove('show');
  showSyncToast(`Quality: ${preset.label}`);
}

function updateQualityBadge() {
  const badge = document.getElementById('qualityBadge');
  if (!badge) return;
  const effectiveQuality = performanceMode ? 'smooth' : currentQuality;
  const preset = QUALITY_PRESETS[effectiveQuality] || QUALITY_PRESETS.auto;
  badge.textContent = preset.badge;
  badge.className = 'quality-badge ' + (preset.badge === 'HD' ? 'hd' : 'sd');
}

/* ═══════════ FULLSCREEN ═══════════ */
function toggleFullscreen() {
  const target = document.getElementById('screenVideo') || videoEl;
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

// Quality settings button
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
    opt.addEventListener('click', () => changeQuality(opt.dataset.quality));
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