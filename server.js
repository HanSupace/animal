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
            rooms[roomName] = { users: {}, isGameRunning: false, isCountdown: false, gameType: null };
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
        
        const userIds = Object.keys(rooms[roomName].users);
        if (user.ready && userIds.length < 2) {
            socket.emit('chat_message', { user: '시스템', text: '최소 2명이 있어야 시작됩니다.' });
        }
        checkGameStart(roomName);
    });

    socket.on('game_action', (score) => {
        const roomName = socket.roomName;
        if (!roomName || !rooms[roomName] || !rooms[roomName].isGameRunning) return;
        
        if (rooms[roomName].gameType === 'click') {
            rooms[roomName].users[socket.id].score += 1;
        } else {
            if (rooms[roomName].users[socket.id].score === 9999) {
                rooms[roomName].users[socket.id].score = score;
                io.to(roomName).emit('update_users', rooms[roomName].users);
                endGame(roomName); // 정상 클릭 시 바로 종료
            }
        }
        io.to(roomName).emit('update_users', rooms[roomName].users);
    });

    // 부정 출발 처리
    socket.on('game_foul', () => {
        const roomName = socket.roomName;
        if (!roomName || !rooms[roomName] || !rooms[roomName].isGameRunning) return;
        
        if (rooms[roomName].gameType === 'reaction') {
            const foulerId = socket.id;
            const winners = [];
            // 부정 출발한 사람 제외하고 모두를 우승자로 설정
            for (const id in rooms[roomName].users) {
                if (id !== foulerId) {
                    winners.push(rooms[roomName].users[id].userName);
                }
            }
            // 실격 점수 부여
            rooms[roomName].users[foulerId].score = 99999;
            endGame(roomName, winners, 99999, foulerId);
        }
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
    if (userIds.length < 2) return; 
    
    const allReady = userIds.every(id => room.users[id].ready);

    if (allReady && !room.isGameRunning && !room.isCountdown) {
        room.isCountdown = true;
        const games = ['click', 'reaction'];
        room.gameType = games[Math.floor(Math.random() * games.length)];
        
        io.to(roomName).emit('game_selected', room.gameType);
        io.to(roomName).emit('game_countdown', 3);

        setTimeout(() => {
            if (!rooms[roomName]) return;
            room.isCountdown = false;
            room.isGameRunning = true;
            userIds.forEach(id => room.users[id].score = (room.gameType === 'click' ? 0 : 9999));
            io.to(roomName).emit('update_users', room.users);

            const duration = (room.gameType === 'click' ? 10 : 15);
            io.to(roomName).emit('game_start', { type: room.gameType, duration });

            if (room.gameType === 'click') {
                setTimeout(() => endGame(roomName), duration * 1000);
            }
        }, 3000);
    }
}

function endGame(roomName, winnersOverride = null, scoreOverride = null, foulerId = null) {
    const room = rooms[roomName];
    if (!room || !room.isGameRunning) return;

    room.isGameRunning = false;
    let winners = winnersOverride || [];
    let bestScore = scoreOverride;

    if (!winnersOverride) {
        if (room.gameType === 'click') {
            bestScore = -1;
            for (const id in room.users) {
                const user = room.users[id];
                if (user.score > bestScore) { bestScore = user.score; winners = [user.userName]; }
                else if (user.score === bestScore && user.score > 0) winners.push(user.userName);
            }
        } else {
            bestScore = 9999;
            for (const id in room.users) {
                const user = room.users[id];
                if (user.score < bestScore && user.score > 0) { bestScore = user.score; winners = [user.userName]; }
                else if (user.score === bestScore && user.score < 9999) winners.push(user.userName);
            }
        }
    }

    for (const id in room.users) room.users[id].ready = false;
    io.to(roomName).emit('update_users', room.users);
    io.to(roomName).emit('game_over', { 
        winners, 
        maxScore: bestScore, 
        type: room.gameType, 
        foulerId: foulerId 
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 서버 실행 중: 포트 ${PORT}`));