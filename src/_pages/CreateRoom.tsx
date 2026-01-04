import { useEffect, useState, useRef } from "react"
import { v4 as uuidv4 } from "uuid"
import { Button } from "../components/ui/button"
import { Card } from "../components/ui/card"
import { Input } from "../components/ui/input"

// Simple HTTP+WS room server location (deployed on Render)
const ROOM_SERVER = (
  "https://rk-zj7q.onrender.com"
).replace(/\/+$/, "")

const fetchJson = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "ngrok-skip-browser-warning": "true",
      ...(init?.headers || {})
    },
    cache: "no-store",
    ...init
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 160)}`)
  }
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(
      `Invalid JSON from ${url} (status ${res.status}): ${text.slice(0, 160)}`
    )
  }
}

export function CreateRoom() {
  const [code, setCode] = useState<string>("")
  const [error, setError] = useState<string>("")
  const [loading, setLoading] = useState<boolean>(false)
  const [ws, setWs] = useState<WebSocket | null>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [joinError, setJoinError] = useState<string>("")
  const [isJoining, setIsJoining] = useState(false)
  const [userId] = useState(() => uuidv4())
  const [pendingMessage, setPendingMessage] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const generate = async () => {
    setLoading(true)
    setError("")
    try {
      const data = await fetchJson(`${ROOM_SERVER}/api/rooms/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      })
      setCode(data.code)
    } catch (err) {
      console.error("createRoom failed:", err)
      setError("Failed to create room. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    generate()
    return () => {
      if (ws) ws.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const joinRoom = async () => {
    setJoinError("")
    if (!code || code.length !== 4) {
      setJoinError("Invalid code.")
      return
    }
    setIsJoining(true)
    try {
      const validation = await fetchJson(`${ROOM_SERVER}/api/rooms/${code}`)
      if (!validation.valid) {
        setJoinError("Invalid or inactive code.")
        return
      }
      const wsBase = new URL(ROOM_SERVER)
      wsBase.protocol = wsBase.protocol === "https:" ? "wss:" : "ws:"
      const socket = new WebSocket(`${wsBase.origin}/ws?code=${code}&userId=${userId}`)
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: "join", code, userId }))
      }
      socket.onmessage = (evt) => {
        const payload = JSON.parse(evt.data)
        console.log("Chat message received:", payload)
        if (payload.type === "error") {
          setJoinError(payload.message || "Join failed.")
          return
        }
        if (payload.type === "joined") {
          setMessages((prev) => [
            ...prev,
            { type: "system", message: "Joined room", userId, ts: Date.now() }
          ])
          // Notify main process about room connection for Ctrl+. functionality
          if (window.electronAPI?.setRoomConnection) {
            window.electronAPI.setRoomConnection({
              code,
              userId,
              roomServer: ROOM_SERVER
            }).catch(console.error)
          }
        }
        if (payload.type === "history" && Array.isArray(payload.messages)) {
          setMessages(payload.messages)
        }
        if (payload.type === "chat" || payload.type === "system" || payload.type === "image") {
          if (payload.type === "image") {
            console.log("Received image payload", payload)
          }
          setMessages((prev) => [...prev, payload])
        }
      }
      socket.onclose = () => {
        setJoinError("Connection closed.")
        // Clear room connection in main process
        if (window.electronAPI?.clearRoomConnection) {
          window.electronAPI.clearRoomConnection().catch(console.error)
        }
      }
      setWs((prev) => {
        if (prev) prev.close()
        return socket
      })
    } catch (err) {
      console.error("joinRoom failed:", err)
      setJoinError("Failed to join room.")
    } finally {
      setIsJoining(false)
    }
  }

  const sendMessage = () => {
    const text = pendingMessage.trim()
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: "chat", code, userId, message: text }))
    setPendingMessage("")
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <Card className="bg-white/5 border border-white/10 p-6 w-full max-w-xl space-y-4">
        <h1 className="text-xl font-semibold mb-2">Create Room</h1>
        <p className="text-sm text-white/70 mb-4">
          A unique 4-digit room code is generated for you. Share it with the other user to start a private session.
        </p>
        <div className="flex items-center gap-3 mb-3">
          <Input readOnly value={code} className="text-center text-2xl tracking-widest bg-white/10 border-white/20" />
          <Button onClick={generate} disabled={loading}>
            {loading ? "Generating..." : "Regenerate"}
          </Button>
        </div>
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        <p className="text-xs text-white/60">
          Codes auto-expire after inactivity. Keep this window open until the other user joins.
        </p>

        {/* Join + chat inline so creator can also chat */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2">
            <Button onClick={joinRoom} disabled={isJoining || !code}>
              {isJoining ? "Connecting..." : "Join this room"}
            </Button>
            <span className="text-xs text-white/60">You join as {userId.slice(0, 4)}</span>
          </div>
          {joinError && <div className="text-xs text-red-300">{joinError}</div>}
          {messages.length > 0 && (
            <div className="space-y-2">
              <div className="max-h-96 overflow-y-auto text-xs bg-black/30 border border-white/5 rounded p-2 space-y-2">
                {messages.map((m, idx) => (
                  <div
                    key={idx}
                    className={m.type === "system" ? "text-white/60" : "text-white"}
                    style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace" }}
                  >
                    {m.type === "chat"
                      ? `${m.userId?.slice(0, 4) || "user"}: ${m.message}`
                      : m.type === "image"
                      ? (
                        <div className="space-y-1">
                          <div>{`${m.userId?.slice(0, 4) || "user"}: [screenshot]`}</div>
                          <img
                            src={
                              m.image?.startsWith("data:")
                                ? m.image
                                : `data:image/png;base64,${m.image ?? ""}`
                            }
                            alt="shared screenshot"
                            className="max-w-full rounded border border-white/10 bg-black/40"
                          />
                        </div>
                      )
                      : m.message}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              <div className="flex gap-2">
                <textarea
                  value={pendingMessage}
                  onChange={(e) => setPendingMessage(e.target.value)}
                  placeholder="Message (Enter for newline, Ctrl/Cmd+Enter to send)"
                  className="bg-black/30 border border-white/10 rounded px-2 py-1 text-sm text-white flex-1 resize-y min-h-[70px]"
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                      e.preventDefault()
                      sendMessage()
                    }
                  }}
                />
                <button
                  onClick={sendMessage}
                  className="bg-white/10 hover:bg-white/20 text-white text-sm px-3 py-1 rounded"
                >
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

