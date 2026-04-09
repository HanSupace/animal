// games/index.js - 게임 모듈 통합 진입점

const { handleClickAction, resolveClickWinner } = require('./clickGame');
const { handlePlayerDead, resolveAvoidWinner } = require('./avoidGame');
const { startReactionGame, handleReactionResult, resolveReactionWinner } = require('./reactionGame');

const GAME_MODES = ['CLICK', 'AVOID', 'REACTION'];

const GAME_DURATIONS = {
    CLICK: 10,
    AVOID: 30,
    REACTION: 15,
};

function getRandomMode() {
    return GAME_MODES[Math.floor(Math.random() * GAME_MODES.length)];
}

function getInitialScore(mode) {
    return mode === 'REACTION' ? 9999 : 0;
}

function startRandomGame(io, rooms, roomName, endGame) {
    const room = rooms[roomName];
    if (!room) return;
    const userIds = Object.keys(room.users);
    if (userIds.length < 2) return;

    const allReady = userIds.every(id => room.users[id].ready);
    if (!allReady || room.isGameRunning || room.isCountdown) return;

    room.isCountdown = true;
    room.currentGameMode = getRandomMode();

    io.to(roomName).emit('game_selected', room.currentGameMode);
    io.to(roomName).emit('game_countdown', 3);

    setTimeout(() => {
        if (!rooms[roomName]) return;
        room.isCountdown = false;
        room.isGameRunning = true;

        const duration = GAME_DURATIONS[room.currentGameMode];

        userIds.forEach(id => {
            room.users[id].score = getInitialScore(room.currentGameMode);
            room.users[id].isDead = false;
        });

        io.to(roomName).emit('update_users', room.users);
        io.to(roomName).emit('game_start', { mode: room.currentGameMode, duration });

        if (room.currentGameMode === 'REACTION') {
            startReactionGame(io, roomName, room);
        }

        room.gameTimeout = setTimeout(() => {
            endGame(roomName);
        }, duration * 1000);
    }, 3000);
}

function resolveWinners(room, mode, foulerId = null) {
    if (foulerId && mode === 'REACTION') {
        const winners = [];
        for (const id in room.users) {
            if (id !== foulerId) winners.push(room.users[id].userName);
        }
        return { winners, bestResult: "실격" };
    }

    if (mode === 'CLICK') return resolveClickWinner(room);
    if (mode === 'AVOID') return resolveAvoidWinner(room);
    if (mode === 'REACTION') return resolveReactionWinner(room);

    return { winners: [], bestResult: "없음" };
}

module.exports = {
    startRandomGame,
    resolveWinners,
    handleClickAction,
    handlePlayerDead,
    handleReactionResult,
};
