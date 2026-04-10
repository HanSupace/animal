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
                isTieBreaker: false,
                tiedUsers: []
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

        if (room.isTieBreaker) {
            // 🔥 타이브레이커 대기 중일 때: 무승부자들(tiedUsers)이 모두 창을 닫고 레디했는지 확인!
            const allTiedReady = room.tiedUsers.every(id => room.users[id] && room.users[id].ready);
            
            if (allTiedReady && !room.isGameRunning && !room.isCountdown) {
                room.isGameRunning = true;
                
                // 재대결 시작 전 깔끔하게 레디 상태 초기화
                for (const id in room.users) {
                    room.users[id].ready = false; 
                }
                io.to(roomName).emit('update_users', room.users);
                
                // 타이브레이커 화면으로 전환!
                io.to(roomName).emit('tie_breaker_start', { tiedUserIds: room.tiedUsers });
                
                const { startReactionGame } = require('./games/reactionGame');
                startReactionGame(io, roomName, room);
                room.gameTimeout = setTimeout(() => { endGame(roomName); }, 15000);
            }
        } else {
            // 🔥 일반 대기 중일 때: 2명 이상 레디하면 게임 시작
            const userIds = Object.keys(room.users);
            if (user.ready && userIds.length < 2) {
                socket.emit('chat_message', { user: '시스템', text: '최소 2명이 있어야 게임이 시작됩니다.' });
            }
            startRandomGame(io, rooms, roomName, endGame);
        }
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

    // 1. 무승부 시: 데스매치
    if (winnerIds.length > 1) {
        console.log(`[무승부 발생] ${winners.join(', ')} -> 데스매치 팝업 대기`);
        room.isTieBreaker = true;
        room.tiedUsers = winnerIds;
        room.currentGameMode = 'REACTION'; // 다음 게임은 반응속도로 고정
        
        for (const id in room.users) {
            room.users[id].score = 9999;
            room.users[id].ready = false; // 레디 초기화
        }

        // 클라이언트로 전송하여 "무승부!" 팝업을 먼저 띄웁니다.
        io.to(roomName).emit('game_over', {
            winners, winnerIds, maxScore: bestResult, mode, foulerId, isFinal: false, finalWinner: null
        });
        
        io.to(roomName).emit('update_users', room.users);
        return; // 여기서 멈추고 유저들이 팝업창을 닫기를 기다립니다.
    }

    // 2. 단독 우승 시: 승점 추가
    room.isTieBreaker = false;
    room.tiedUsers = [];
    let isFinal = false;
    let finalWinner = null;

    if (winnerIds.length === 1) {
        const wid = winnerIds[0];
        
        // 확실하게 숫자 계산
        room.users[wid].winCount = Number(room.users[wid].winCount || 0) + 1; 
        
        // 🔥 터미널에서 점수가 오르는 걸 직접 확인할 수 있습니다!
        console.log(`✅ [승점 획득] ${room.users[wid].userName} 님이 1승 추가! (현재 총 ${room.users[wid].winCount}승)`);

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
        for (const id in room.users) room.users[id].winCount = 0; // 최종 승리 시 리셋
    }
    
    io.to(roomName).emit('update_users', room.users);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 서버 실행 중: 포트 ${PORT}`));