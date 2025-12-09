// file: src/components/SubscribedApp.tsx
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import Queue from "../_pages/Queue"
import Solutions from "../_pages/Solutions"
import { useToast } from "../contexts/toast"
import { v4 as uuidv4 } from "uuid"

// Simple HTTP+WS room server location (use ngrok URL if remote)
const ROOM_SERVER = import.meta.env.VITE_ROOM_SERVER_URL || "http://localhost:4000"

interface SubscribedAppProps {
  credits: number
  currentLanguage: string
  setLanguage: (language: string) => void
}

type View = "queue" | "solutions" | "debug"
type ChatMessage = { userId: string; message: string; ts: number; type: "chat" | "system" }

const SubscribedApp: React.FC<SubscribedAppProps> = ({
  credits,
  currentLanguage,
  setLanguage
}) => {
  const queryClient = useQueryClient()
  const [view, setView] = useState<View>("queue")
  const containerRef = useRef<HTMLDivElement>(null)
  const { showToast } = useToast()

  // Room/chat state
  const [joinCode, setJoinCode] = useState("")
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [ws, setWs] = useState<WebSocket | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [userId] = useState(() => uuidv4())
  const [joinError, setJoinError] = useState<string>("")
  const [isJoining, setIsJoining] = useState(false)
  const [pendingMessage, setPendingMessage] = useState("")

  // Cleanup websocket on unmount
  useEffect(() => {
    return () => {
      if (ws) ws.close()
    }
  }, [ws])

  const handleJoinRoom = async () => {
    setJoinError("")
    if (!joinCode || joinCode.length !== 4) {
      setJoinError("Enter a 4-digit code.")
      return
    }
    setIsJoining(true)
    try {
      const res = await fetch(`${ROOM_SERVER}/api/rooms/${joinCode}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const validation = await res.json()
      if (!validation.valid) {
        setJoinError("Invalid or inactive code.")
        return
      }
      const wsBase = new URL(ROOM_SERVER)
      wsBase.protocol = wsBase.protocol === "https:" ? "wss:" : "ws:"
      const socket = new WebSocket(
        `${wsBase.origin}/ws?code=${joinCode}&userId=${userId}`
      )
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: "join", code: joinCode, userId }))
      }
      socket.onmessage = (evt) => {
        const payload = JSON.parse(evt.data)
        console.log("Chat message received:", payload)
        if (payload.type === "error") {
          setJoinError(payload.message || "Join failed.")
          return
        }
        if (payload.type === "joined") {
          setRoomCode(joinCode)
          setMessages((prev) => [
            ...prev,
            { type: "system", message: "Joined room", userId, ts: Date.now() }
          ])
          showToast("Joined room", `Code ${joinCode}`, "success")
        }
        if (payload.type === "chat") {
          setMessages((prev) => [...prev, payload])
        }
        if (payload.type === "system") {
          setMessages((prev) => [...prev, { ...payload, ts: Date.now() }])
        }
      }
      socket.onclose = () => {
        setRoomCode(null)
        setMessages([])
      }
      setWs((prev) => {
        if (prev) prev.close()
        return socket
      })
    } catch (err) {
      setJoinError("Failed to join room.")
    } finally {
      setIsJoining(false)
    }
  }

  const handleSendMessage = (text?: string) => {
    const message = (text ?? pendingMessage).trim()
    if (!message || !ws || ws.readyState !== WebSocket.OPEN || !roomCode) return
    ws.send(JSON.stringify({ type: "chat", code: roomCode, userId, message }))
    setPendingMessage("")
  }

  // Let's ensure we reset queries etc. if some electron signals happen
  useEffect(() => {
    const cleanup = window.electronAPI.onResetView(() => {
      queryClient.invalidateQueries({
        queryKey: ["screenshots"]
      })
      queryClient.invalidateQueries({
        queryKey: ["problem_statement"]
      })
      queryClient.invalidateQueries({
        queryKey: ["solution"]
      })
      queryClient.invalidateQueries({
        queryKey: ["new_solution"]
      })
      setView("queue")
    })

    return () => {
      cleanup()
    }
  }, [])

  // Dynamically update the window size
  useEffect(() => {
    if (!containerRef.current) return

    const updateDimensions = () => {
      if (!containerRef.current) return
      const height = containerRef.current.scrollHeight || 600
      const width = containerRef.current.scrollWidth || 800
      window.electronAPI?.updateContentDimensions({ width, height })
    }

    // Force initial dimension update immediately
    updateDimensions()
    
    // Set a fallback timer to ensure dimensions are set even if content isn't fully loaded
    const fallbackTimer = setTimeout(() => {
      window.electronAPI?.updateContentDimensions({ width: 800, height: 600 })
    }, 500)

    const resizeObserver = new ResizeObserver(updateDimensions)
    resizeObserver.observe(containerRef.current)

    // Also watch DOM changes
    const mutationObserver = new MutationObserver(updateDimensions)
    mutationObserver.observe(containerRef.current, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    })

    // Do another update after a delay to catch any late-loading content
    const delayedUpdate = setTimeout(updateDimensions, 1000)

    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      clearTimeout(fallbackTimer)
      clearTimeout(delayedUpdate)
    }
  }, [view])

  // Listen for events that might switch views or show errors
  useEffect(() => {
    const cleanupFunctions = [
      window.electronAPI.onSolutionStart(() => {
        setView("solutions")
      }),
      window.electronAPI.onUnauthorized(() => {
        queryClient.removeQueries({
          queryKey: ["screenshots"]
        })
        queryClient.removeQueries({
          queryKey: ["solution"]
        })
        queryClient.removeQueries({
          queryKey: ["problem_statement"]
        })
        setView("queue")
      }),
      window.electronAPI.onResetView(() => {
        queryClient.removeQueries({
          queryKey: ["screenshots"]
        })
        queryClient.removeQueries({
          queryKey: ["solution"]
        })
        queryClient.removeQueries({
          queryKey: ["problem_statement"]
        })
        setView("queue")
      }),
      window.electronAPI.onResetView(() => {
        queryClient.setQueryData(["problem_statement"], null)
      }),
      window.electronAPI.onProblemExtracted((data: any) => {
        if (view === "queue") {
          queryClient.invalidateQueries({
            queryKey: ["problem_statement"]
          })
          queryClient.setQueryData(["problem_statement"], data)
        }
      }),
      window.electronAPI.onSolutionError((error: string) => {
        showToast("Error", error, "error")
      })
    ]
    return () => cleanupFunctions.forEach((fn) => fn())
  }, [view])

  return (
    <div ref={containerRef} className="min-h-0">
      {/* Join Room */}
      <div className="bg-white/5 border border-white/10 rounded-md p-3 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.slice(0, 4))}
            maxLength={4}
            placeholder="Enter 4-digit room code"
            className="bg-black/30 border border-white/10 rounded px-2 py-1 text-sm text-white w-32"
          />
          <button
            onClick={handleJoinRoom}
            disabled={isJoining}
            className="bg-white/10 hover:bg-white/20 text-white text-sm px-3 py-1 rounded"
          >
            {isJoining ? "Joining..." : "Join Room"}
          </button>
          {roomCode && <span className="text-xs text-white/70">In room {roomCode}</span>}
        </div>
        {joinError && <div className="text-xs text-red-300 mt-1">{joinError}</div>}
        {roomCode && (
          <div className="mt-2 space-y-2">
            <div className="max-h-32 overflow-y-auto text-xs bg-black/30 border border-white/5 rounded p-2">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={m.type === "system" ? "text-white/60" : "text-white"}
                  style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace" }}
                >
                  {m.type === "chat" ? `${m.userId.slice(0, 4)}: ${m.message}` : m.message}
                </div>
              ))}
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
                    handleSendMessage()
                  }
                }}
              />
              <button
                onClick={() => handleSendMessage()}
                className="bg-white/10 hover:bg-white/20 text-white text-sm px-3 py-1 rounded"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>

      {view === "queue" ? (
        <Queue
          setView={setView}
          credits={credits}
          currentLanguage={currentLanguage}
          setLanguage={setLanguage}
        />
      ) : view === "solutions" ? (
        <Solutions
          setView={setView}
          credits={credits}
          currentLanguage={currentLanguage}
          setLanguage={setLanguage}
        />
      ) : null}
    </div>
  )
}

export default SubscribedApp
