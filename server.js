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
                currentGameMode: null // 현재 무슨 게임인지 저장
            };
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

    /* [수정 제안] */
    socket.on('click_action', () => {
        const roomName = socket.roomName;
        const room = rooms[roomName];
        // 게임이 실행 중이고, 현재 모드가 'CLICK'일 때만 점수 증가
        if (!room || !room.isGameRunning || room.currentGameMode !== 'CLICK') return;
        
        room.users[socket.id].score += 1;
        io.to(roomName).emit('update_users', room.users);
    });

    // 공 피하기 탈락 신호 (새로 추가)
    socket.on('player_dead', () => {
    const roomName = socket.roomName;
    const room = rooms[roomName];
    if (!room || !room.isGameRunning || room.currentGameMode !== 'AVOID') return;

    room.users[socket.id].isDead = true;
    io.to(roomName).emit('update_users', room.users);

    const userIds = Object.keys(room.users);
    const aliveUsers = userIds.filter(id => !room.users[id].isDead);

    // [수정된 로직]
    if (aliveUsers.length === 1) {
        // 마지막 한 명이 남으면 그 사람이 우승! 즉시 종료
        io.to(roomName).emit('chat_message', { user: '시스템', text: `최후의 생존자 ${room.users[aliveUsers[0]].userName}님 승리!` });
        endGame(roomName);
    } else if (aliveUsers.length === 0) {
        // 다 같이 죽어버린 경우
        io.to(roomName).emit('chat_message', { user: '시스템', text: '모두 전멸했습니다...' });
        endGame(roomName);
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

            // --- 🎲 랜덤 게임 선택 로직 ---
            const modes = ['CLICK', 'AVOID'];
            room.currentGameMode = modes[Math.floor(Math.random() * modes.length)];
            const duration = (room.currentGameMode === 'CLICK') ? 10 : 30; // 클릭은 10초, 피하기는 30초
            // ---------------------------

            userIds.forEach(id => {
                room.users[id].score = 0;
                room.users[id].isDead = false;
            });

            io.to(roomName).emit('update_users', room.users);

            // 클라이언트에 모드와 시간 전달
            io.to(roomName).emit('game_start', { mode: room.currentGameMode, duration: duration });
            
            const modeText = room.currentGameMode === 'CLICK' ? '🔥 광클 대결! 🔥' : '🏃 빨간 공 피하기! 🏃';
            io.to(roomName).emit('chat_message', { user: '시스템', text: modeText });

            room.gameTimeout = setTimeout(() => {
                endGame(roomName);
            }, duration * 1000);
        }, 3000);
    }
}

function endGame(roomName) {
    const room = rooms[roomName];
    if (!room) return;

    if (!room || !room.isGameRunning) return; // [CHECK] 이미 종료된 경우 중복 실행 방지

    // [CHECK] 예약되어 있던 타이머가 있다면 취소 (조기 종료 시 필요)
    if (room.gameTimeout) {
        clearTimeout(room.gameTimeout);
        room.gameTimeout = null;
    }

    const mode = room.currentGameMode;
    room.isGameRunning = false;
    room.currentGameMode = null;

    let maxScore = -1, winners = [];

    if (mode === 'CLICK') {
        // 기존 클릭 게임 승자 방식
        for (const id in room.users) {
            const user = room.users[id];
            user.ready = false; 
            if (user.score > maxScore) { maxScore = user.score; winners = [user.userName]; }
            else if (user.score === maxScore) winners.push(user.userName);
        }
    } else {
        // 공 피하기 승자 방식 (안 죽은 사람 모두 우승)
        for (const id in room.users) {
            const user = room.users[id];
            user.ready = false;
            if (!user.isDead) winners.push(user.userName);
        }
        maxScore = "생존"; 
    }

    io.to(roomName).emit('update_users', room.users);
    io.to(roomName).emit('game_over', { winners, maxScore, mode });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 서버 실행 중: 포트 ${PORT}`));