'use client';

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

type User = {
  id: string;
  username: string;
}

type Message = {
  id: string;
  username: string;
  content: string;
  timestamp: Date | string;
  type: 'user' | 'system';
}

export default function SocketDemo() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [username, setUsername] = useState('');
  const [isUsernameSet, setIsUsernameSet] = useState(false);
  const [socket, setSocket] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [users, setUsers] = useState<User[]>([]);

  // Refs for socket event handlers — avoids calling setState synchronously
  // inside the effect body (which the lint rule forbids).
  const isConnectedRef = useRef(isConnected);
  const isConnectedSetterRef = useRef(setIsConnected);
  const messagesSetterRef = useRef(setMessages);
  const usersSetterRef = useRef(setUsers);
  const isUsernameSetSetterRef = useRef(setIsUsernameSet);
  const inputMessageSetterRef = useRef(setInputMessage);

  useEffect(() => {
    isConnectedRef.current = isConnected;
    isConnectedSetterRef.current = setIsConnected;
    messagesSetterRef.current = setMessages;
    usersSetterRef.current = setUsers;
    isUsernameSetSetterRef.current = setIsUsernameSet;
    inputMessageSetterRef.current = setInputMessage;
  });

  const handleConnect = (socketInstance: any) => {
    isConnectedSetterRef.current(true);
  };

  const handleDisconnect = () => {
    isConnectedSetterRef.current(false);
  };

  const handleMessage = (msg: Message) => {
    messagesSetterRef.current(prev => [...prev, msg]);
  };

  const handleUserJoined = (data: { user: User; message: Message }) => {
    messagesSetterRef.current(prev => [...prev, data.message]);
    usersSetterRef.current(prev => {
      if (!prev.find(u => u.id === data.user.id)) {
        return [...prev, data.user];
      }
      return prev;
    });
  };

  const handleUserLeft = (data: { user: User; message: Message }) => {
    messagesSetterRef.current(prev => [...prev, data.message]);
    usersSetterRef.current(prev => prev.filter(u => u.id !== data.user.id));
  };

  const handleUsersList = (data: { users: User[] }) => {
    usersSetterRef.current(data.users);
  };

  const socketInstanceRef = useRef<any>(null);

  useEffect(() => {
    // Connect to websocket server
    // Never use PORT in the URL, always use XTransformPort
    // Connect to the standalone example service on port 3003.
    const socketInstance = io('http://localhost:3003', {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000
    })
    socketInstance.on('disconnect', handleDisconnect);
    socketInstance.on('message', handleMessage);
    socketInstance.on('user-joined', handleUserJoined);
    socketInstance.on('user-left', handleUserLeft);
    socketInstance.on('users-list', handleUsersList);

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  const handleJoin = () => {
    if (socketInstanceRef.current && username.trim() && isConnectedRef.current) {
      socketInstanceRef.current.emit('join', { username: username.trim() });
      isUsernameSetSetterRef.current(true);
    }
  };

  const sendMessage = () => {
    if (socketInstanceRef.current && inputMessage.trim() && username.trim()) {
      socketInstanceRef.current.emit('message', {
        content: inputMessage.trim(),
        username: username.trim()
      });
      inputMessageSetterRef.current('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            WebSocket Demo
            <span className={`text-sm px-2 py-1 rounded ${isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isUsernameSet ? (
            <div className="space-y-2">
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleJoin();
                  }
                }}
                placeholder="Enter your username..."
                disabled={!isConnected}
                className="flex-1"
              />
              <Button
                onClick={handleJoin}
                disabled={!isConnected || !username.trim()}
                className="w-full"
              >
                Join Chat
              </Button>
            </div>
          ) : (
            <>
              <ScrollArea className="h-80 w-full border rounded-md p-4">
                <div className="space-y-2">
                  {messages.length === 0 ? (
                    <p className="text-gray-500 text-center">No messages yet</p>
                  ) : (
                    messages.map((msg) => (
                      <div key={msg.id} className="border-b pb-2 last:border-b-0">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <p className={`text-sm font-medium ${msg.type === 'system'
                                ? 'text-blue-600 italic'
                                : 'text-gray-700'
                              }`}>
                              {msg.username}
                            </p>
                            <p className={`${msg.type === 'system'
                                ? 'text-blue-500 italic'
                                : 'text-gray-900'
                              }`}>
                              {msg.content}
                            </p>
                          </div>
                          <span className="text-xs text-gray-500">
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>

              <div className="flex space-x-2">
                <Input
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type a message..."
                  disabled={!isConnected}
                  className="flex-1"
                />
                <Button
                  onClick={sendMessage}
                  disabled={!isConnected || !inputMessage.trim()}
                >
                  Send
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
