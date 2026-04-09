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
            rooms[roomName] = { 
                users: {}, 
                isGameRunning: false, 
                isCountdown: false,
                currentGameMode: null,
                gameTimeout: null,
                reactionTimer: null
            };
        }

        rooms[roomName].users[socket.id] = { userName, ready: false, score: 0, isDead: false };
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
            socket.emit('chat_message', { user: '시스템', text: '최소 2명이 있어야 게임이 시작됩니다.' });
        }

        checkGameStart(roomName);
    });

    socket.on('click_action', () => {
        const roomName = socket.roomName;
        const room = rooms[roomName];
        if (!room || !room.isGameRunning || room.currentGameMode !== 'CLICK') return;
        room.users[socket.id].score += 1;
        io.to(roomName).emit('update_users', room.users);
    });

    socket.on('player_dead', () => {
        const roomName = socket.roomName;
        const room = rooms[roomName];
        if (!room || !room.isGameRunning || room.currentGameMode !== 'AVOID') return;

        room.users[socket.id].isDead = true;
        io.to(roomName).emit('update_users', room.users);

        const userIds = Object.keys(room.users);
        const aliveUsers = userIds.filter(id => !room.users[id].isDead);

        if (aliveUsers.length <= 1) {
            endGame(roomName);
        }
    });

    socket.on('reaction_result', (resultTime) => {
        const roomName = socket.roomName;
        const room = rooms[roomName];
        if (!room || !room.isGameRunning || room.currentGameMode !== 'REACTION') return;

        if (resultTime === -1) {
            room.users[socket.id].score = 99999;
            endGame(roomName, socket.id); // 부정 출발 즉시 종료
        } else {
            room.users[socket.id].score = resultTime;
            endGame(roomName); // 정상 클릭 즉시 종료
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
        
        const modes = ['CLICK', 'AVOID', 'REACTION'];
        room.currentGameMode = modes[Math.floor(Math.random() * modes.length)];
        
        // 카운트다운 시작 전 게임 타입 전송 (클라이언트에서 캔버스 등을 세팅하기 위해)
        io.to(roomName).emit('game_selected', room.currentGameMode);
        io.to(roomName).emit('game_countdown', 3);

        setTimeout(() => {
            if (!rooms[roomName]) return;
            room.isCountdown = false;
            room.isGameRunning = true;

            let duration = 10;
            if (room.currentGameMode === 'AVOID') duration = 30;
            if (room.currentGameMode === 'REACTION') duration = 15;

            userIds.forEach(id => {
                room.users[id].score = (room.currentGameMode === 'REACTION' ? 9999 : 0);
                room.users[id].isDead = false;
            });

            io.to(roomName).emit('update_users', room.users);
            io.to(roomName).emit('game_start', { mode: room.currentGameMode, duration: duration });
            
            if (room.currentGameMode === 'REACTION') {
                const randomDelay = Math.random() * 4000 + 2000; 
                room.reactionTimer = setTimeout(() => {
                    if (room.isGameRunning && room.currentGameMode === 'REACTION') {
                        io.to(roomName).emit('reaction_go');
                    }
                }, randomDelay);
            }

            room.gameTimeout = setTimeout(() => {
                endGame(roomName);
            }, duration * 1000);
        }, 3000);
    }
}

function endGame(roomName, foulerId = null) {
    const room = rooms[roomName];
    if (!room || !room.isGameRunning) return;

    if (room.gameTimeout) clearTimeout(room.gameTimeout);
    if (room.reactionTimer) clearTimeout(room.reactionTimer);

    const mode = room.currentGameMode;
    room.isGameRunning = false;
    room.currentGameMode = null;

<<<<<<< Updated upstream
    let winners = [];
    let bestResult = Infinity;
=======
    const { winners,winnerIds, bestResult } = resolveWinners(room, mode, foulerId);
>>>>>>> Stashed changes

    if (foulerId && mode === 'REACTION') {
        // 부정출발자 제외 모두 승리
        for (const id in room.users) {
            if (id !== foulerId) winners.push(room.users[id].userName);
        }
        bestResult = "실격";
    } else {
        if (mode === 'CLICK') {
            let maxScore = -1;
            for (const id in room.users) {
                const user = room.users[id];
                if (user.score > maxScore) { maxScore = user.score; winners = [user.userName]; }
                else if (user.score === maxScore) winners.push(user.userName);
            }
            bestResult = maxScore;
        } else if (mode === 'AVOID') {
            for (const id in room.users) {
                const user = room.users[id];
                if (!user.isDead) winners.push(user.userName);
            }
            bestResult = "생존";
        } else if (mode === 'REACTION') {
            for (const id in room.users) {
                const user = room.users[id];
                if (user.score > 0 && user.score < bestResult) {
                    bestResult = user.score;
                    winners = [user.userName];
                } else if (user.score > 0 && user.score === bestResult) {
                    winners.push(user.userName);
                }
            }
        }
    }

<<<<<<< Updated upstream
    for (const id in room.users) room.users[id].ready = false;
    
    io.to(roomName).emit('game_over', { 
        winners, 
        maxScore: bestResult === Infinity ? "없음" : bestResult, 
=======
    io.to(roomName).emit('game_over', {
        winners,
        winnerIds,
        maxScore: bestResult,
>>>>>>> Stashed changes
        mode,
        foulerId 
    });
    io.to(roomName).emit('update_users', room.users);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 서버 실행 중: 포트 ${PORT}`));