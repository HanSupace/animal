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

        startRandomGame(io, rooms, roomName, endGame);
    });

    socket.on('click_action', () => {
        const roomName = socket.roomName;
        handleClickAction(io, roomName, rooms[roomName], socket.id);
    });

    socket.on('player_dead', () => {
        const roomName = socket.roomName;
        handlePlayerDead(io, roomName, rooms[roomName], socket.id, endGame);
    });

    socket.on('reaction_result', (resultTime) => {
        const roomName = socket.roomName;
        handleReactionResult(io, roomName, rooms[roomName], socket.id, resultTime, endGame);
    });

    socket.on('send_message', (message) => {
        const roomName = socket.roomName;
        if (!roomName || !rooms[roomName]) return;
        const userName = rooms[roomName].users[socket.id].userName;
        io.to(roomName).emit('chat_message', { user: userName, text: message });
    });

    socket.on('game_selected', (mode) => {
        let gameName = "";

        if (mode === "CLICK") gameName = "클릭 게임";
        if (mode === "AVOID") gameName = "공 피하기 게임";
        if (mode === "REACTION") gameName = "반응속도 게임";

        addChatMessage(`🎮 랜덤 게임: ${gameName}`);
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
        else startRandomGame(io, rooms, roomName, endGame);
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

    const { winners, bestResult } = resolveWinners(room, mode, foulerId);

    for (const id in room.users) room.users[id].ready = false;

    io.to(roomName).emit('game_over', {
        winners,
        maxScore: bestResult,
        mode,
        foulerId
    });
    io.to(roomName).emit('update_users', room.users);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 서버 실행 중: 포트 ${PORT}`));
