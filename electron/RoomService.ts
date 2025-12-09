import { WebSocketServer, WebSocket } from "ws"
import { AddressInfo } from "net"

type RoomCode = string

interface Room {
  code: RoomCode
  createdAt: number
  lastActive: number
  clients: Set<WebSocket>
  status: "active" | "closed"
}

interface JoinPayload {
  type: "join"
  code: RoomCode
  userId: string
}

interface ChatPayload {
  type: "chat"
  code: RoomCode
  userId: string
  message: string
}

type IncomingPayload = JoinPayload | ChatPayload

export class RoomService {
  private rooms: Map<RoomCode, Room> = new Map()
  private userRoom: Map<string, RoomCode> = new Map()
  private wss: WebSocketServer | null = null
  private cleanupInterval: NodeJS.Timeout | null = null
  private readonly ttlMs = 10 * 60 * 1000 // 10 minutes inactivity
  private port: number | null = null

  public start(): number {
    if (this.wss) return this.port as number

    this.wss = new WebSocketServer({ port: 0 })
    this.wss.on("connection", (ws) => this.handleConnection(ws))

    const addr = this.wss.address() as AddressInfo
    this.port = addr.port

    // periodic cleanup
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000)

    return this.port
  }

  public stop(): void {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval)
    this.cleanupInterval = null
    this.rooms.forEach((room) => {
      room.clients.forEach((c) => c.close())
    })
    this.rooms.clear()
    this.userRoom.clear()
    if (this.wss) this.wss.close()
    this.wss = null
    this.port = null
  }

  public getPort(): number | null {
    return this.port
  }

  public createRoom(): RoomCode {
    this.start()
    let code: RoomCode
    do {
      code = Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, "0")
    } while (this.rooms.has(code))

    const now = Date.now()
    this.rooms.set(code, {
      code,
      createdAt: now,
      lastActive: now,
      clients: new Set(),
      status: "active"
    })
    return code
  }

  public validateRoom(code: RoomCode): boolean {
    const room = this.rooms.get(code)
    return !!room && room.status === "active"
  }

  private handleConnection(ws: WebSocket) {
    ws.on("message", (data) => {
      try {
        const payload: IncomingPayload = JSON.parse(data.toString())
        if (payload.type === "join") {
          this.handleJoin(ws, payload)
        } else if (payload.type === "chat") {
          this.handleChat(ws, payload)
        }
      } catch (err) {
        // ignore malformed
      }
    })

    ws.on("close", () => {
      this.removeClient(ws)
    })
  }

  private handleJoin(ws: WebSocket, payload: JoinPayload) {
    const { code, userId } = payload
    const room = this.rooms.get(code)
    if (!room || room.status !== "active") {
      ws.send(JSON.stringify({ type: "error", message: "Room not found or inactive." }))
      return
    }

    const existing = this.userRoom.get(userId)
    if (existing && existing !== code) {
      ws.send(JSON.stringify({ type: "error", message: "User already in another room." }))
      return
    }

    // attach meta
    ;(ws as any).__roomCode = code
    ;(ws as any).__userId = userId

    this.userRoom.set(userId, code)
    room.clients.add(ws)
    room.lastActive = Date.now()

    ws.send(JSON.stringify({ type: "joined", code }))
    this.broadcast(room, { type: "system", message: `User joined room ${code}` })
  }

  private handleChat(ws: WebSocket, payload: ChatPayload) {
    const { code, userId, message } = payload
    const room = this.rooms.get(code)
    if (!room || room.status !== "active") {
      ws.send(JSON.stringify({ type: "error", message: "Room not found or inactive." }))
      return
    }
    if ((ws as any).__roomCode !== code) {
      ws.send(JSON.stringify({ type: "error", message: "You are not in this room." }))
      return
    }
    room.lastActive = Date.now()
    this.broadcast(room, { type: "chat", userId, message, ts: Date.now() })
  }

  private broadcast(room: Room, payload: any) {
    const msg = JSON.stringify(payload)
    room.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(msg)
    })
  }

  private removeClient(ws: WebSocket) {
    const code = (ws as any).__roomCode as RoomCode | undefined
    const userId = (ws as any).__userId as string | undefined
    if (!code || !userId) return
    const room = this.rooms.get(code)
    if (room) {
      room.clients.delete(ws)
      this.userRoom.delete(userId)
      if (room.clients.size === 0) {
        room.lastActive = Date.now()
      }
    }
  }

  private cleanup() {
    const now = Date.now()
    const stale: RoomCode[] = []
    this.rooms.forEach((room, code) => {
      if (room.clients.size === 0 && now - room.lastActive > this.ttlMs) {
        stale.push(code)
      }
    })
    stale.forEach((code) => {
      this.rooms.delete(code)
    })
  }
}

export const roomService = new RoomService()

