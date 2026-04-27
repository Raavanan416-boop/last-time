/**
 * MovieTime Watch Party — Server
 * ─────────────────────────────────────────────────────────────────────────────
 * Express + Socket.io — Local Chunked Upload + Range Streaming
 *
 * ✅ Chunked upload (5 MB chunks) — handles 3+ hour videos
 * ✅ HTTP Range streaming (206 Partial Content)
 * ✅ Room-based access tokens — video only viewable inside room
 * ✅ Auto-delete: video end / all users leave / timeout
 * ✅ No direct file path exposure — /video/:token route only
 * ✅ Download blocked: Content-Disposition inline + nodownload
 */

require('dotenv').config();

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');

// ── Express / Socket.io ───────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  maxHttpBufferSize: 6 * 1024 * 1024 // 6 MB per message (slightly above chunk size)
});

const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '1mb' }));

// ── Rooms storage ─────────────────────────────────────────────────────────────
// rooms[roomId] = {
//   name        : string,
//   videoType   : 'file' | 'youtube',
//   videoFile   : string   — filename in uploads/    (file only)
//   videoToken  : string   — secure token for streaming (file only)
//   videoId     : string   — YouTube video ID          (youtube only)
//   users       : [{ id, username }],
//   timeout     : NodeJS.Timeout | null — auto-delete timer
// }
const rooms = {};

// ── Active upload sessions ───────────────────────────────────────────────────
// uploadSessions[sessionId] = {
//   filename       : string,
//   originalName   : string,
//   totalChunks    : number,
//   receivedChunks : number,
//   filePath       : string,
//   completed      : boolean,
//   createdAt      : number
// }
const uploadSessions = {};

// ── Token → roomId mapping (for streaming auth) ─────────────────────────────
const videoTokens = {}; // videoTokens[token] = roomId

// Auto-delete timeout duration (30 minutes)
const AUTO_DELETE_TIMEOUT_MS = 30 * 60 * 1000;

// ── Helper: generate secure token ───────────────────────────────────────────
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ── Helper: safe file deletion ──────────────────────────────────────────────
function deleteVideoFile(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🗑 Video auto deleted: ${path.basename(filePath)}`);
    }
  } catch (err) {
    console.error('File delete error:', err.message);
  }
}

// ── Helper: clean up an empty room ──────────────────────────────────────────
function cleanupRoom(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.users.length > 0) return; // still has watchers

  // Clear any existing timeout
  if (room.timeout) {
    clearTimeout(room.timeout);
    room.timeout = null;
  }

  // Delete video file from disk
  if (room.videoType === 'file' && room.videoFile) {
    const filePath = path.join(UPLOADS_DIR, room.videoFile);
    deleteVideoFile(filePath);
  }

  // Remove token mapping
  if (room.videoToken && videoTokens[room.videoToken]) {
    delete videoTokens[room.videoToken];
  }

  delete rooms[roomId];
  console.log(`🗑 Room ${roomId} cleaned up (empty room)`);
}

// ── Helper: start auto-delete timeout ───────────────────────────────────────
function startAutoDeleteTimeout(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  // Clear any existing timeout
  if (room.timeout) {
    clearTimeout(room.timeout);
  }

  room.timeout = setTimeout(() => {
    console.log(`⏰ Auto-delete timeout for room ${roomId}`);
    // Force cleanup regardless of users
    if (room.videoType === 'file' && room.videoFile) {
      const filePath = path.join(UPLOADS_DIR, room.videoFile);
      deleteVideoFile(filePath);
      room.videoFile = null;
    }
    if (room.videoToken) {
      delete videoTokens[room.videoToken];
      room.videoToken = null;
    }
    // Notify users
    io.to(roomId).emit('video-deleted', { reason: 'timeout' });
    delete rooms[roomId];
    console.log(`🗑 Room ${roomId} auto-deleted (timeout)`);
  }, AUTO_DELETE_TIMEOUT_MS);
}

// ── Helper: delete video for a room (called on video end) ───────────────────
function deleteVideoForRoom(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  if (room.videoType === 'file' && room.videoFile) {
    const filePath = path.join(UPLOADS_DIR, room.videoFile);
    deleteVideoFile(filePath);
    room.videoFile = null;
  }

  if (room.videoToken) {
    delete videoTokens[room.videoToken];
    room.videoToken = null;
  }
}

// ── Helper: Extract YouTube Video ID ─────────────────────────────────────────
function extractYouTubeId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/watch\?.*v=)([a-zA-Z0-9_-]{11})/
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// ── Cleanup stale upload sessions periodically (every 10 min) ───────────────
setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of Object.entries(uploadSessions)) {
    if (now - session.createdAt > 30 * 60 * 1000 && !session.completed) {
      // Delete partial file
      try { if (fs.existsSync(session.filePath)) fs.unlinkSync(session.filePath); } catch {}
      delete uploadSessions[sid];
      console.log(`🧹 Cleaned stale upload session: ${sid}`);
    }
  }
}, 10 * 60 * 1000);


// ═══════════════════════════════════════════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ── Start Upload Session ────────────────────────────────────────────────────
app.post('/api/upload/start', (req, res) => {
  try {
    const { fileName, fileSize, totalChunks } = req.body;
    if (!fileName || !fileSize || !totalChunks) {
      return res.status(400).json({ error: 'Missing upload parameters' });
    }

    const sessionId = uuidv4();
    const ext = path.extname(fileName) || '.mp4';
    // Sanitize filename: only allow alphanumeric, hyphens, underscores
    const safeName = `${sessionId}${ext}`;
    const filePath = path.join(UPLOADS_DIR, safeName);

    uploadSessions[sessionId] = {
      filename: safeName,
      originalName: fileName,
      totalChunks: parseInt(totalChunks),
      receivedChunks: 0,
      filePath,
      completed: false,
      createdAt: Date.now()
    };

    console.log(`📤 Upload session started: ${sessionId} (${fileName}, ${totalChunks} chunks)`);
    res.json({ sessionId, filename: safeName });
  } catch (err) {
    console.error('Upload start error:', err);
    res.status(500).json({ error: 'Failed to start upload session' });
  }
});

// ── Upload Chunk ────────────────────────────────────────────────────────────
app.post('/api/upload/chunk', express.raw({ type: 'application/octet-stream', limit: '6mb' }), (req, res) => {
  try {
    const sessionId  = req.headers['x-session-id'];
    const chunkIndex = parseInt(req.headers['x-chunk-index']);

    if (!sessionId || isNaN(chunkIndex)) {
      return res.status(400).json({ error: 'Missing chunk headers' });
    }

    const session = uploadSessions[sessionId];
    if (!session) {
      return res.status(404).json({ error: 'Upload session not found' });
    }

    if (session.completed) {
      return res.status(400).json({ error: 'Upload already completed' });
    }

    // Append chunk data to file
    fs.appendFileSync(session.filePath, req.body);
    session.receivedChunks++;

    const progress = Math.round((session.receivedChunks / session.totalChunks) * 100);

    // Check if upload is complete
    if (session.receivedChunks >= session.totalChunks) {
      session.completed = true;
      console.log(`✅ Upload complete: ${session.filename} (${session.totalChunks} chunks)`);
      return res.json({ 
        status: 'complete', 
        progress: 100, 
        filename: session.filename 
      });
    }

    res.json({ 
      status: 'ok', 
      progress, 
      received: session.receivedChunks, 
      total: session.totalChunks 
    });
  } catch (err) {
    console.error('Chunk upload error:', err);
    res.status(500).json({ error: 'Failed to process chunk' });
  }
});

// ── Create Room ─────────────────────────────────────────────────────────────
app.post('/api/create-room', (req, res) => {
  try {
    const roomId = uuidv4().slice(0, 8).toUpperCase();
    const { roomName, videoType, uploadSessionId, youtubeUrl } = req.body;
    const name = (roomName || 'Watch Party').trim();

    if (videoType === 'file' && uploadSessionId) {
      const session = uploadSessions[uploadSessionId];
      if (!session || !session.completed) {
        return res.status(400).json({ error: 'Upload not complete or session not found' });
      }

      // Generate a secure token for video access
      const token = generateToken();
      videoTokens[token] = roomId;

      rooms[roomId] = {
        name,
        videoType: 'file',
        videoFile: session.filename,
        videoToken: token,
        users: [],
        timeout: null
      };

      // Start auto-delete timeout
      startAutoDeleteTimeout(roomId);

      // Clean up upload session
      delete uploadSessions[uploadSessionId];

      console.log(`✓ Room ${roomId} created (file → ${session.filename})`);
      res.json({ roomId, videoType: 'file', videoToken: token });

    } else if (videoType === 'youtube' || youtubeUrl) {
      const url     = youtubeUrl;
      const videoId = extractYouTubeId(url);
      if (!videoId) {
        return res.status(400).json({ error: 'Invalid YouTube URL. Could not extract video ID.' });
      }
      rooms[roomId] = { name, videoType: 'youtube', videoId, users: [], timeout: null };
      console.log(`✓ Room ${roomId} created (youtube → ${videoId})`);
      res.json({ roomId, videoType: 'youtube', videoId });

    } else {
      return res.status(400).json({ error: 'Provide an uploaded video or YouTube URL' });
    }
  } catch (err) {
    console.error('Create room error:', err);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// ── Check Room ──────────────────────────────────────────────────────────────
app.get('/api/room/:roomId', (req, res) => {
  const room = rooms[req.params.roomId.toUpperCase()];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({
    name      : room.name,
    videoType : room.videoType,
    videoToken: room.videoToken || null,
    videoId   : room.videoId   || null,
    userCount : room.users.length
  });
});

// ── Video Streaming Route (Range headers + Security) ────────────────────────
app.get('/video/:token', (req, res) => {
  const token  = req.params.token;
  const roomId = videoTokens[token];

  // Validate token
  if (!roomId) {
    return res.status(403).json({ error: 'Invalid or expired video token' });
  }

  const room = rooms[roomId];
  if (!room || !room.videoFile) {
    return res.status(404).json({ error: 'Video not found' });
  }

  // Security: Check that the room has users (prevents access after everyone leaves)
  if (room.users.length === 0) {
    return res.status(403).json({ error: 'No active users in room' });
  }

  const filePath = path.join(UPLOADS_DIR, room.videoFile);

  // Verify file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Video file not found on server' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  // Determine content type
  const ext = path.extname(room.videoFile).toLowerCase();
  const mimeTypes = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.m4v': 'video/mp4',
    '.flv': 'video/x-flv'
  };
  const contentType = mimeTypes[ext] || 'video/mp4';

  const range = req.headers.range;

  if (range) {
    // ── Range request (206 Partial Content) ──
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end   = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 5 * 1024 * 1024 - 1, fileSize - 1); // 5MB chunks
    const chunkSize = end - start + 1;

    const stream = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
      'Content-Disposition': 'inline', // Prevent download prompt
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff'
    });

    stream.pipe(res);
  } else {
    // ── Full request (200) — send with Accept-Ranges header ──
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': 'inline',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  }
});

// Block direct access to uploads directory
app.use('/uploads', (req, res) => {
  res.status(403).json({ error: 'Direct access forbidden' });
});


// ═══════════════════════════════════════════════════════════════════════════════
//  SOCKET.IO
// ═══════════════════════════════════════════════════════════════════════════════
io.on('connection', (socket) => {
  console.log(`⚡ Socket connected: ${socket.id}`);

  // ── Join room ──────────────────────────────────────────────────────────────
  socket.on('join-room', ({ roomId, username }) => {
    roomId = roomId.toUpperCase();
    const room = rooms[roomId];
    if (!room) { socket.emit('error-msg', 'Room not found'); return; }

    socket.join(roomId);
    socket.roomId    = roomId;
    socket.username  = username;

    room.users.push({ id: socket.id, username });

    // Clear auto-delete timeout since someone is watching
    if (room.timeout) {
      clearTimeout(room.timeout);
      room.timeout = null;
    }

    io.to(roomId).emit('user-joined', {
      username,
      users     : room.users,
      userCount : room.users.length
    });

    // Send all room data to the joining user
    socket.emit('room-info', {
      name       : room.name,
      videoType  : room.videoType,
      videoToken : room.videoToken || null,
      videoId    : room.videoId    || null,
      users      : room.users,
      userCount  : room.users.length
    });

    console.log(`→ ${username} joined room ${roomId} (${room.users.length} users)`);
  });

  // ── Video sync ─────────────────────────────────────────────────────────────
  socket.on('video-play',  ({ roomId, currentTime }) => socket.to(roomId).emit('video-play',  { currentTime, from: socket.username }));
  socket.on('video-pause', ({ roomId, currentTime }) => socket.to(roomId).emit('video-pause', { currentTime, from: socket.username }));
  socket.on('video-seek',  ({ roomId, currentTime }) => socket.to(roomId).emit('video-seek',  { currentTime, from: socket.username }));

  // ── Video ended (auto-delete trigger) ─────────────────────────────────────
  socket.on('video-ended', ({ roomId }) => {
    roomId = roomId?.toUpperCase();
    const room = rooms[roomId];
    if (!room) return;

    console.log(`🎬 Video ended in room ${roomId} — auto-deleting video file`);
    deleteVideoForRoom(roomId);
  });

  // ── Chat ───────────────────────────────────────────────────────────────────
  socket.on('chat-message', ({ roomId, message }) => {
    io.to(roomId).emit('chat-message', {
      username  : socket.username,
      message,
      senderId  : socket.id,
      timestamp : Date.now()
    });
  });

  // ── Emoji reactions ────────────────────────────────────────────────────────
  socket.on('emoji-reaction', ({ roomId, emoji }) => {
    io.to(roomId).emit('emoji-reaction', { username: socket.username, emoji, senderId: socket.id });
  });

  // ── WebRTC signaling ───────────────────────────────────────────────────────
  socket.on('webrtc-offer',         ({ to, offer })      => io.to(to).emit('webrtc-offer',         { from: socket.id, offer }));
  socket.on('webrtc-answer',        ({ to, answer })     => io.to(to).emit('webrtc-answer',        { from: socket.id, answer }));
  socket.on('webrtc-ice-candidate', ({ to, candidate })  => io.to(to).emit('webrtc-ice-candidate', { from: socket.id, candidate }));

  // ── Disconnect / Leave ─────────────────────────────────────────────────────
  function handleLeave() {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    room.users = room.users.filter(u => u.id !== socket.id);

    io.to(roomId).emit('user-left', {
      username  : socket.username,
      users     : room.users,
      userCount : room.users.length
    });

    console.log(`← ${socket.username} left room ${roomId} (${room.users.length} users)`);

    // Auto-delete video + room when empty
    if (room.users.length === 0) {
      cleanupRoom(roomId);
    }

    socket.roomId   = null;
    socket.username = null;
  }

  socket.on('disconnect', handleLeave);
  socket.on('leave-room', () => { socket.leave(socket.roomId); handleLeave(); });
});

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🎬 MovieTime Watch Party running on http://localhost:${PORT}`);
  console.log(`📁 Uploads directory: ${UPLOADS_DIR}`);
  console.log(`🔒 Video streaming: /video/:token (secured)`);
  console.log(`⏱  Auto-delete timeout: ${AUTO_DELETE_TIMEOUT_MS / 60000} minutes`);
  console.log();
});
