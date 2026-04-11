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
                reactionTimer: null,
                roomBet: null,
            };
        }

        rooms[roomName].users[socket.id] = { 
            userName, 
            ready: false, 
            score: 0, 
            winCount: 0, // 🔥 승수 0으로 시작
            isDead: false,
            betType: null 
        };

        if (rooms[roomName].roomBet) {
            socket.emit('room_bet_update', rooms[roomName].roomBet);
        }

        io.to(roomName).emit('chat_message', { user: '시스템', text: `${userName}님이 입장하셨습니다.` });
        io.to(roomName).emit('update_users', rooms[roomName].users);
    });

    socket.on('toggle_ready', () => {
        const roomName = socket.roomName;
        if (!roomName || !rooms[roomName]) return;

        const room = rooms[roomName];
        const user = room.users[socket.id];
        user.ready = !user.ready;

        io.to(roomName).emit('update_users', room.users);

        startRandomGame(io, rooms, roomName, endGame);
    });

    socket.on('click_action', () => {
        handleClickAction(io, socket.roomName, rooms[socket.roomName], socket.id);
    });

    socket.on('player_dead', () => {
        handlePlayerDead(io, socket.roomName, rooms[socket.roomName], socket.id, endGame);
    });

    socket.on('reaction_result', (resultTime) => {
        handleReactionResult(io, socket.roomName, rooms[socket.roomName], socket.id, resultTime, endGame);
    });

    socket.on('send_message', (message) => {
        if (!socket.roomName || !rooms[socket.roomName]) return;
        const userName = rooms[socket.roomName].users[socket.id].userName;
        io.to(socket.roomName).emit('chat_message', { user: userName, text: message });
    });

    socket.on('select_bet', (bet) => {
        const room = rooms[socket.roomName];
        if (!room || !room.users[socket.id]) return;
        room.users[socket.id].betType = bet;
        room.roomBet = bet;
        io.to(socket.roomName).emit('room_bet_update', room.roomBet);
        io.to(socket.roomName).emit('update_users', room.users);
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

        if (Object.keys(rooms[roomName].users).length === 0) {
            delete rooms[roomName];
        } else {
            startRandomGame(io, rooms, roomName, endGame);
        }
    }
}

// 🔥 게임 종료 및 승점 판정 로직
function endGame(roomName, foulerId = null) {
    const room = rooms[roomName];
    if (!room || !room.isGameRunning) return;

    if (room.gameTimeout) clearTimeout(room.gameTimeout);
    if (room.reactionTimer) clearTimeout(room.reactionTimer);

    const mode = room.currentGameMode;
    room.isGameRunning = false;
    room.currentGameMode = null;

    const { winners, winnerIds, bestResult } = resolveWinners(room, mode, foulerId);

    // 단독 우승 시: 승점 추가
    let isFinal = false;
    let finalWinner = null;

    if (winnerIds.length === 1) {
        const wid = winnerIds[0];
        
        // 확실하게 숫자 계산
        room.users[wid].winCount = Number(room.users[wid].winCount || 0) + 1; 

        if (room.users[wid].winCount >= 3) {
            console.log(`🏆 [최종 우승] ${room.users[wid].userName} 3승 달성!!`);
            isFinal = true;
            finalWinner = room.users[wid].userName;
        }
    }

    for (const id in room.users) room.users[id].ready = false;

    io.to(roomName).emit('game_over', {
        winners, winnerIds, maxScore: bestResult, mode, foulerId, isFinal, finalWinner
    });

    if (isFinal) {
        for (const id in room.users) room.users[id].winCount = 0;
        room.roomBet = null;
        io.to(roomName).emit('room_bet_update', null);
    }
    
    io.to(roomName).emit('update_users', room.users);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 서버 실행 중: 포트 ${PORT}`));