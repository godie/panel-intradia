import { createServer } from 'http'
import { Server } from 'socket.io'
import {
  isAllowedWebSocketOrigin,
  isValidChatText,
} from '../../mini-services/websocket-security'

const httpServer = createServer()
const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3003")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)
const io = new Server(httpServer, {
  // Keep the server and client on the standard Socket.IO endpoint path.
  path: '/socket.io/',
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: false
  },
  // CORS headers do not protect WebSocket upgrades; enforce Origin here too.
  allowRequest: (req, callback) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    callback(null, isAllowedWebSocketOrigin(origin, allowedOrigins));
  },
  maxHttpBufferSize: 64 * 1024,
  pingTimeout: 60000,
  pingInterval: 25000,
})

interface User {
  id: string
  username: string
}

interface Message {
  id: string
  username: string
  content: string
  timestamp: Date
  type: 'user' | 'system'
}

const users = new Map<string, User>()

const generateMessageId = () => Math.random().toString(36).substr(2, 9)

const createSystemMessage = (content: string): Message => ({
  id: generateMessageId(),
  username: 'System',
  content,
  timestamp: new Date(),
  type: 'system'
})

const createUserMessage = (username: string, content: string): Message => ({
  id: generateMessageId(),
  username,
  content,
  timestamp: new Date(),
  type: 'user'
})

const MAX_USERNAME_LENGTH = 64
const MAX_MESSAGE_LENGTH = 2000

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`)

  socket.on('join', (data: unknown) => {
    if (!data || typeof data !== 'object' || !('username' in data)) return
    const username = data.username
    if (!isValidChatText(username, MAX_USERNAME_LENGTH)) return

    // Create user object; all later messages use this server-owned username.
    const user: User = {
      id: socket.id,
      username: username.trim()
    }
    
    // Add to user list
    users.set(socket.id, user)
    
    // Send join message to all users
    const joinMessage = createSystemMessage(`${username} joined the chat room`)
    io.emit('user-joined', { user, message: joinMessage })
    
    // Send current user list to new user
    const usersList = Array.from(users.values())
    socket.emit('users-list', { users: usersList })
    
    console.log(`${username} joined the chat room, current online users: ${users.size}`)
  })

  socket.on('message', (data: unknown) => {
    if (!data || typeof data !== 'object' || !('content' in data)) return
    const content = data.content
    const user = users.get(socket.id)

    if (user && isValidChatText(content, MAX_MESSAGE_LENGTH)) {
      const message = createUserMessage(user.username, content.trim())
      io.emit('message', message)
      console.log(`${user.username}: ${content.trim()}`)
    }
  })

  socket.on('disconnect', () => {
    const user = users.get(socket.id)
    
    if (user) {
      // Remove from user list
      users.delete(socket.id)
      
      // Send leave message to all users
      const leaveMessage = createSystemMessage(`${user.username} left the chat room`)
      io.emit('user-left', { user: { id: socket.id, username: user.username }, message: leaveMessage })
      
      console.log(`${user.username} left the chat room, current online users: ${users.size}`)
    } else {
      console.log(`User disconnected: ${socket.id}`)
    }
  })

  socket.on('error', (error) => {
    console.error(`Socket error (${socket.id}):`, error)
  })
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM signal, shutting down server...')
  httpServer.close(() => {
    console.log('WebSocket server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('Received SIGINT signal, shutting down server...')
  httpServer.close(() => {
    console.log('WebSocket server closed')
    process.exit(0)
  })
})