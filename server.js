const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const {
    startRandomGame,
    resolveWinners,
    handleClickAction,
    handlePlayerDead,
    handleReactionResult,
} = require('./games');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + '/public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

const rooms = {};

io.on('connection', (socket) => {

    // 방 존재 확인
    socket.on('check_room', (roomCode, callback) => {
        callback(rooms.hasOwnProperty(roomCode));
    });

    // 방 입장
    socket.on('join_room', ({ roomName, userName }) => {
        socket.join(roomName);
        socket.roomName = roomName;

        // 방 없으면 생성
        if (!rooms[roomName]) {
            rooms[roomName] = {
                users: {},
                isGameRunning: false,
                isCountdown: false,
                currentGameMode: null,
                gameTimeout: null,
                reactionTimer: null,
                roomBet: null // 🔥 전체 내기
            };
        }

        // 유저 추가
        rooms[roomName].users[socket.id] = { 
            userName, 
            ready: false, 
            score: 0, 
            isDead: false,
            betType: null // 🔥 개인 선택
        };

        // 🔥 현재 내기 있으면 새로 들어온 사람에게 알려줌
        if (rooms[roomName].roomBet) {
            socket.emit('room_bet_update', rooms[roomName].roomBet);
        }

        io.to(roomName).emit('chat_message', { user: '시스템', text: `${userName}님이 입장하셨습니다.` });
        io.to(roomName).emit('update_users', rooms[roomName].users);
    });

    // 준비 버튼
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

        startRandomGame(io, rooms, roomName, endGame);
    });

    // 클릭 게임
    socket.on('click_action', () => {
        const roomName = socket.roomName;
        handleClickAction(io, roomName, rooms[roomName], socket.id);
    });

    // 공 피하기
    socket.on('player_dead', () => {
        const roomName = socket.roomName;
        handlePlayerDead(io, roomName, rooms[roomName], socket.id, endGame);
    });

    // 반응속도
    socket.on('reaction_result', (resultTime) => {
        const roomName = socket.roomName;
        handleReactionResult(io, roomName, rooms[roomName], socket.id, resultTime, endGame);
    });

    // 채팅
    socket.on('send_message', (message) => {
        const roomName = socket.roomName;
        if (!roomName || !rooms[roomName]) return;

        const userName = rooms[roomName].users[socket.id].userName;
        io.to(roomName).emit('chat_message', { user: userName, text: message });
    });

    // 🔥 내기 선택 (핵심 기능)
    socket.on('select_bet', (bet) => {
        const roomName = socket.roomName;
        if (!roomName || !rooms[roomName]) return;

        const room = rooms[roomName];
        const user = room.users[socket.id];
        if (!user) return;

        user.betType = bet;

        // 🔥 마지막 선택을 방 전체 내기로 설정
        room.roomBet = bet;

        io.to(roomName).emit('room_bet_update', room.roomBet);
        io.to(roomName).emit('update_users', room.users);
    });

    // 게임 선택 메시지 (optional)
    socket.on('game_selected', (mode) => {
        let gameName = "";

        if (mode === "CLICK") gameName = "클릭 게임";
        if (mode === "AVOID") gameName = "공 피하기 게임";
        if (mode === "REACTION") gameName = "반응속도 게임";

        io.to(socket.roomName).emit('chat_message', { user: '시스템', text: `🎮 랜덤 게임: ${gameName}` });
    });

    // 나가기
    socket.on('leave_room', () => handleUserLeave(socket));
    socket.on('disconnect', () => handleUserLeave(socket));
});

// 유저 나가기 처리
function handleUserLeave(socket) {
    const roomName = socket.roomName;

    if (roomName && rooms[roomName] && rooms[roomName].users[socket.id]) {
        const userName = rooms[roomName].users[socket.id].userName;

        delete rooms[roomName].users[socket.id];
        socket.leave(roomName);
        socket.roomName = null;

        io.to(roomName).emit('chat_message', { user: '시스템', text: `${userName}님이 퇴장하셨습니다.` });
        io.to(roomName).emit('update_users', rooms[roomName].users);

        if (Object.keys(rooms[roomName].users).length === 0) {
            delete rooms[roomName];
        } else {
            startRandomGame(io, rooms, roomName, endGame);
        }
    }
}

// 게임 종료
function endGame(roomName, foulerId = null) {
    const room = rooms[roomName];
    if (!room || !room.isGameRunning) return;

    if (room.gameTimeout) clearTimeout(room.gameTimeout);
    if (room.reactionTimer) clearTimeout(room.reactionTimer);

    const mode = room.currentGameMode;
    room.isGameRunning = false;
    room.currentGameMode = null;

    // 🔥 충돌 해결: winnerIds를 받아옵니다.
    const { winners, winnerIds, bestResult } = resolveWinners(room, mode, foulerId);

    for (const id in room.users) {
        room.users[id].ready = false;
    }

    io.to(roomName).emit('game_over', {
        winners,
        winnerIds, // 🔥 필수! 클라이언트로 고유 ID 배열을 보내줍니다.
        maxScore: bestResult,
        mode,
        foulerId
    });

    io.to(roomName).emit('update_users', room.users);
}

// 서버 실행
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 서버 실행 중: 포트 ${PORT}`));