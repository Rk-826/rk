// Minimal in-memory room + chat server (HTTP + WebSocket)
// Run with: node room-server.js
// Expose via ngrok for remote users: ngrok http 4000
const http = require("http")
const { WebSocketServer } = require("ws")
const { randomUUID } = require("crypto")

const PORT = process.env.PORT || 4000
const rooms = new Map() // code -> { clients: Set<WebSocket>, lastActive: number, messages: any[] }
// Removed TTL - rooms never expire, only cleared when server stops

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, ngrok-skip-browser-warning"
  })
  res.end(JSON.stringify(body))
}

function createCode() {
  // Always use code "0000" for the 2-user setup
  const code = "0000"
  if (!rooms.has(code)) {
    rooms.set(code, { clients: new Set(), lastActive: Date.now(), messages: [] })
  }
  return code
}

function validate(code) {
  return rooms.has(code)
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    return json(res, 204, {})
  }
  if (req.method === "POST" && req.url === "/api/rooms/create") {
    const code = createCode()
    return json(res, 200, { code })
  }
  const match = req.url.match(/^\/api\/rooms\/(\d{4})$/)
  if (req.method === "GET" && match) {
    const code = match[1]
    return json(res, 200, { valid: validate(code) })
  }
  json(res, 404, { error: "Not found" })
})

const wss = new WebSocketServer({ noServer: true })

wss.on("connection", (ws, request, roomCode, userId) => {
  const room = rooms.get(roomCode)
  if (!room) {
    ws.send(JSON.stringify({ type: "error", message: "Room not found" }))
    return ws.close()
  }
  // Allow up to 10 connections
  if (room.clients.size >= 10) {
    ws.send(JSON.stringify({ type: "error", message: "Room is full" }))
    return ws.close()
  }

  room.clients.add(ws)
  room.lastActive = Date.now()

  ws.send(JSON.stringify({ type: "joined", code: roomCode }))
  // Send existing history to the new client
  if (room.messages.length) {
    ws.send(JSON.stringify({ type: "history", messages: room.messages }))
  }
  broadcast(room, { type: "system", message: `User ${userId.slice(0, 4)} joined`, ts: Date.now() })

  ws.on("message", (data) => {
    try {
      const payload = JSON.parse(data.toString())
      // Handle join message (allows clients to re-join if needed)
      if (payload.type === "join") {
        console.log(`[${roomCode}] Client ${userId.slice(0, 4)} sent join message (already in room)`)
        return
      }
      if (payload.type === "chat" && payload.message) {
        room.lastActive = Date.now()
        const msg = {
          type: "chat",
          code: roomCode,
          userId,
          message: payload.message,
          ts: Date.now()
        }
        room.messages.push(msg)
        console.log(`[${roomCode}] ${userId.slice(0, 4)}: ${msg.message}`)
        broadcast(room, msg)
      } else if (payload.type === "image" && payload.image) {
        room.lastActive = Date.now()
        const msg = {
          type: "image",
          code: roomCode,
          userId,
          image: payload.image,
          ts: Date.now()
        }
        room.messages.push(msg)
        console.log(`[${roomCode}] ${userId.slice(0, 4)}: [image]`)
        broadcast(room, msg)
      }
    } catch (e) {
      // ignore malformed
    }
  })

  ws.on("close", () => {
    room.clients.delete(ws)
    room.lastActive = Date.now()
  })
})

function broadcast(room, payload) {
  const msg = JSON.stringify(payload)
  for (const client of room.clients) {
    if (client.readyState === client.OPEN) {
      client.send(msg)
    }
  }
}

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`)
  if (url.pathname !== "/ws") {
    socket.destroy()
    return
  }
  const code = url.searchParams.get("code")
  const userId = url.searchParams.get("userId") || randomUUID()
  console.log("WS upgrade", {
    host: request.headers.host,
    origin: request.headers.origin,
    code,
    userId: userId ? userId.slice(0, 8) : null
  })
  if (!code || !validate(code)) {
    socket.destroy()
    return
  }
  // Reflect CORS-like permissive headers during upgrade for proxies that surface them
  request.headers["access-control-allow-origin"] = "*"
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request, code, userId)
  })
})

// Room cleanup removed - rooms persist until server shuts down

server.listen(PORT, () => {
  console.log(`Room server running on http://localhost:${PORT}`)
})

