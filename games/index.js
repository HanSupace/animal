// games/index.js - 게임 모듈 통합 진입점

const { handleClickAction, resolveClickWinner } = require('./clickGame');
const { handlePlayerDead, resolveAvoidWinner } = require('./avoidGame');
const { startReactionGame, handleReactionResult, resolveReactionWinner } = require('./reactionGame');
const { startMemoryGame, startMemoryTurn, handleMemoryCardClick, resolveMemoryWinner, cleanupMemoryGame } = require('./memoryGame');

const GAME_MODES = ['CLICK', 'AVOID', 'REACTION', 'MEMORY'];

const GAME_DURATIONS = {
    CLICK: 10,
    AVOID: 30,
    REACTION: 15,
    MEMORY: 120,
};

// 카드 공개 시간 (메모리 게임 전용)
const MEMORY_REVEAL_SECONDS = 5;

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

        if (room.currentGameMode === 'MEMORY') {
            // ── 메모리 게임 전용 ────────────────────────────────
            // 실제 플레이 제한 시간을 클라이언트에 전달
            // (공개 5초는 별도이므로 duration 그대로 전달)
            io.to(roomName).emit('game_start', {
                mode: room.currentGameMode,
                duration,                        // 실제 플레이 시간 (초)
                revealSeconds: MEMORY_REVEAL_SECONDS,
            });

            startMemoryGame(io, roomName, room);

            // 공개 시간(5초) + 실제 플레이 시간 후 강제 종료
            room.gameTimeout = setTimeout(() => {
                endGame(roomName, null, true); // isTimeout = true
            }, (duration + MEMORY_REVEAL_SECONDS) * 1000);

        } else {
            io.to(roomName).emit('game_start', { mode: room.currentGameMode, duration });

            if (room.currentGameMode === 'REACTION') {
            startReactionGame(io, roomName, room);
            }

            room.gameTimeout = setTimeout(() => {
                endGame(roomName);
            }, duration * 1000);
        }
    }, 3000);
}

function resolveWinners(room, mode, foulerId = null) {
    if (foulerId && mode === 'REACTION') {
        const winners = [];
        const winnerIds = [];
        for (const id in room.users) {
            if (id !== foulerId) {
                winners.push(room.users[id].userName);
                winnerIds.push(id);
            }
        }
        return { winners, winnerIds, bestResult: "실격" };
    }

    if (mode === 'CLICK')    return resolveClickWinner(room);
    if (mode === 'AVOID')    return resolveAvoidWinner(room);
    if (mode === 'REACTION') return resolveReactionWinner(room);
    if (mode === 'MEMORY')   return resolveMemoryWinner(room);

    return { winners: [], winnerIds: [], bestResult: "없음" };
}

module.exports = {
    startRandomGame,
    resolveWinners,
    handleClickAction,
    handlePlayerDead,
    handleReactionResult,
    // MEMORY 전용 핸들러
    handleMemoryCardClick,
    startMemoryTurn,
    cleanupMemoryGame,
};