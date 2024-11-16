const express = require('express');
const app = express();
const http = require('http').Server(app);
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

const io = new Server(http);
const rooms = new Map();
const socketRooms = new Map();

app.use(express.static('public'));
app.use(express.json());
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

function cleanupRoom(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;

    if (!room.activeUsers || Date.now() - room.lastActivity > 24 * 60 * 60 * 1000) {
        rooms.delete(roomId);
        io.in(roomId).disconnectSockets(true);
    }

    if (!room.activeUsers || Date.now() - room.lastActivity > 23 * 60 * 60 * 1000) {
        io.to(roomId).emit('system-message', {
            message: 'Room will be deleted in 1 hour due to inactivity'
        });
    }
}

app.post('/create-room', (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });

    const roomId = crypto.randomBytes(4).toString('hex');
    rooms.set(roomId, {
        password,
        messages: [],
        createdAt: Date.now(),
        activeUsers: 0,
        lastActivity: Date.now(),
        users: new Map()
    });
    
    res.json({ roomId });
});

app.post('/verify-room', (req, res) => {
    const { roomId, password, username } = req.body;
    const room = rooms.get(roomId);
    
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
    if (!username?.trim()) return res.status(400).json({ success: false, error: 'Username required' });
    if (Array.from(room.users.values()).includes(username)) {
        return res.status(400).json({ success: false, error: 'Username taken' });
    }
    
    res.json({ 
        success: room.password === password,
        error: room.password !== password ? 'Incorrect password' : null
    });
});

io.on('connection', (socket) => {
    socket.on('join-room', ({ roomId, username }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.users.set(socket.id, username);
            socket.join(roomId);
            socketRooms.set(socket.id, roomId);
            room.activeUsers++;
            room.lastActivity = Date.now();

            io.to(roomId).emit('user-joined', {
                message: `${username} joined`,
                system: true
            });

            io.to(roomId).emit('user-list', {
                users: Array.from(room.users.values())
            });
        }
    });

    socket.on('chat-message', ({ roomId, message }) => {
        const room = rooms.get(roomId);
        if (room) {
            const messageData = {
                content: message,
                timestamp: Date.now(),
                sender: room.users.get(socket.id),
                senderSocketId: socket.id
            };
            room.lastActivity = Date.now();
            io.to(roomId).emit('chat-message', messageData);
        }
    });

    socket.on('disconnect', () => {
        const roomId = socketRooms.get(socket.id);
        if (roomId) {
            const room = rooms.get(roomId);
            if (room) {
                const username = room.users.get(socket.id);
                room.users.delete(socket.id);
                room.activeUsers--;

                io.to(roomId).emit('user-left', {
                    message: `${username} left`,
                    system: true
                });

                io.to(roomId).emit('user-list', {
                    users: Array.from(room.users.values())
                });
                
                cleanupRoom(roomId);
            }
            socketRooms.delete(socket.id);
        }
    });

    socket.on('typing', (roomId) => {
        const room = rooms.get(roomId);
        if (room) {
            socket.to(roomId).emit('user-typing', {
                username: room.users.get(socket.id),
                isTyping: true
            });
        }
    });

    socket.on('stop-typing', (roomId) => {
        const room = rooms.get(roomId);
        if (room) {
            socket.to(roomId).emit('user-typing', {
                username: room.users.get(socket.id),
                isTyping: false
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
