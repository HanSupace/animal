const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + '/public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

const rooms = {}; 

io.on('connection', (socket) => {
    socket.on('check_room', (roomCode, callback) => {
        callback(rooms.hasOwnProperty(roomCode));
    });

    socket.on('join_room', ({ roomName, userName }) => {
        socket.join(roomName);
        socket.roomName = roomName;

        if (!rooms[roomName]) {
            rooms[roomName] = { users: {}, isGameRunning: false, isCountdown: false };
        }

        rooms[roomName].users[socket.id] = { userName, ready: false, score: 0 };
        io.to(roomName).emit('chat_message', { user: '시스템', text: `${userName}님이 입장하셨습니다.` });
        io.to(roomName).emit('update_users', rooms[roomName].users);
    });

    socket.on('toggle_ready', () => {
        const roomName = socket.roomName;
        if (!roomName || !rooms[roomName]) return;
        const user = rooms[roomName].users[socket.id];
        user.ready = !user.ready;
        io.to(roomName).emit('update_users', rooms[roomName].users);
        
        // 준비를 눌렀을 때 혼자라면 안내 메시지 전송
        const userIds = Object.keys(rooms[roomName].users);
        if (user.ready && userIds.length < 2) {
            socket.emit('chat_message', { user: '시스템', text: '최소 2명이 있어야 게임이 시작됩니다.' });
        }

        checkGameStart(roomName);
    });

    socket.on('click_action', () => {
        const roomName = socket.roomName;
        if (!roomName || !rooms[roomName] || !rooms[roomName].isGameRunning) return;
        rooms[roomName].users[socket.id].score += 1;
        io.to(roomName).emit('update_users', rooms[roomName].users);
    });

    socket.on('send_message', (message) => {
        const roomName = socket.roomName;
        if (!roomName || !rooms[roomName]) return;
        const userName = rooms[roomName].users[socket.id].userName;
        io.to(roomName).emit('chat_message', { user: userName, text: message });
    });

    socket.on('leave_room', () => handleUserLeave(socket));
    socket.on('disconnect', () => handleUserLeave(socket));
});

function handleUserLeave(socket) {
    const roomName = socket.roomName;
    if (roomName && rooms[roomName] && rooms[roomName].users[socket.id]) {
        const userName = rooms[roomName].users[socket.id].userName;
        delete rooms[roomName].users[socket.id];
        socket.leave(roomName);
        socket.roomName = null;
        io.to(roomName).emit('chat_message', { user: '시스템', text: `${userName}님이 퇴장하셨습니다.` });
        io.to(roomName).emit('update_users', rooms[roomName].users);
        if (Object.keys(rooms[roomName].users).length === 0) delete rooms[roomName];
        else checkGameStart(roomName);
    }
}

function checkGameStart(roomName) {
    const room = rooms[roomName];
    if (!room) return;
    const userIds = Object.keys(room.users);
    
    // 2명 미만이면 시작 안 함
    if (userIds.length < 2) return; 
    
    const allReady = userIds.every(id => room.users[id].ready);

    if (allReady && !room.isGameRunning && !room.isCountdown) {
        room.isCountdown = true;
        io.to(roomName).emit('game_countdown', 3);
        io.to(roomName).emit('chat_message', { user: '시스템', text: '잠시 후 대결이 시작됩니다!' });

        setTimeout(() => {
            if (!rooms[roomName]) return;
            room.isCountdown = false;
            room.isGameRunning = true;
            userIds.forEach(id => room.users[id].score = 0);
            io.to(roomName).emit('update_users', room.users);

            const duration = 10; 
            io.to(roomName).emit('game_start', duration);
            io.to(roomName).emit('chat_message', { user: '시스템', text: '🔥 대결 시작! 🔥' });

            setTimeout(() => endGame(roomName), duration * 1000);
        }, 3000);
    }
}

function endGame(roomName) {
    const room = rooms[roomName];
    if (!room) return;
    room.isGameRunning = false;
    let maxScore = -1, winners = [];
    for (const id in room.users) {
        const user = room.users[id];
        user.ready = false; 
        if (user.score > maxScore) { maxScore = user.score; winners = [user.userName]; }
        else if (user.score === maxScore) winners.push(user.userName);
    }
    io.to(roomName).emit('update_users', room.users);
    io.to(roomName).emit('game_over', { winners, maxScore });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 서버 실행 중: 포트 ${PORT}`));