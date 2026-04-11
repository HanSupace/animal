// ============================================================
//  memoryGame.js  –  서버 사이드 메모리 카드 게임 모듈
//  기존 clickGame, avoidGame, reactionGame 구조와 동일한 방식
// ============================================================

'use strict';

const EMOJIS = ['🍎','🍌','🍇','🍓','🍒','🍋','🍑','🍍'];
const GRID_SIZE = 16;       // 4×4 = 16장
const TURN_TIME_LIMIT = 10; // 턴당 제한 시간 (초) — 매칭 성공 시에만 리셋

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ── 턴 타이머 정리 헬퍼 ──────────────────────────────────
function clearTurnTimer(ms) {
    if (ms.turnTimer) {
        clearTimeout(ms.turnTimer);
        ms.turnTimer = null;
    }
}

// ── 턴 타이머 시작 ───────────────────────────────────────
// 턴이 시작되거나 매칭 성공으로 연속 턴이 될 때만 호출.
// 카드 클릭 여부와 무관하게 TURN_TIME_LIMIT 초 내에
// 매칭을 성공하지 못하면 자동으로 턴이 넘어간다.
function startTurnTimer(io, rooms, roomName, ms) {
    clearTurnTimer(ms);

    ms.turnTimer = setTimeout(() => {
        const room = rooms[roomName];
        if (!room?.memoryState || !room.isGameRunning) return;

        const expiredTurn = ms.currentTurn;

        // 열린 카드가 있으면 상태 초기화
        ms.flipped = [];
        ms.locked = false;

        io.to(roomName).emit('memory_turn_timeout', { expiredTurn });

        // 다음 플레이어로 턴 전환
        const userIds = Object.keys(room.users);
        const currentIdx = userIds.indexOf(expiredTurn);
        ms.currentTurn = userIds[(currentIdx + 1) % userIds.length];

        emitTurnChange(io, roomName, room, ms, rooms);
    }, TURN_TIME_LIMIT * 1000);
}

// ── memory_turn_change 이벤트 발송 + 턴 타이머 시작 ──────
function emitTurnChange(io, roomName, room, ms, rooms) {
    io.to(roomName).emit('memory_turn_change', {
        currentTurn: ms.currentTurn,
        currentName: room.users[ms.currentTurn]?.userName || '',
        turnTimeLimit: TURN_TIME_LIMIT, // 클라이언트 카운트다운 UI용
    });

    startTurnTimer(io, rooms, roomName, ms);
}

// ── 게임 시작: deck 생성 후 클라이언트로 전송 ─────────────
function startMemoryGame(io, roomName, room) {
    const deck = shuffle([...EMOJIS, ...EMOJIS]);

    room.memoryState = {
        deck,
        matched: new Set(),
        flipped: [],
        currentTurn: null,
        locked: false,
        scores: {},
        turnTimer: null,
    };

    for (const id in room.users) {
        room.memoryState.scores[id] = 0;
        room.users[id].score = 0;
    }

    // 덱 정보 전송 → 클라이언트가 5초 공개 처리
    io.to(roomName).emit('memory_init', { deck });
}

// ── 5초 공개 완료 후 첫 턴 결정 ──────────────────────────
function startMemoryTurn(io, rooms, roomName) {
    const room = rooms[roomName];
    if (!room || !room.memoryState) return;

    const userIds = Object.keys(room.users);
    const firstId = userIds[Math.floor(Math.random() * userIds.length)];
    room.memoryState.currentTurn = firstId;

    emitTurnChange(io, roomName, room, room.memoryState, rooms);
}

// ── 카드 클릭 처리 ────────────────────────────────────────
function handleMemoryCardClick(io, rooms, roomName, socketId, cardIndex, endGame) {
    const room = rooms[roomName];
    if (!room || !room.memoryState || !room.isGameRunning) return;

    const ms = room.memoryState;

    if (ms.currentTurn !== socketId) return;
    if (ms.locked) return;
    if (ms.matched.has(cardIndex)) return;
    if (ms.flipped.includes(cardIndex)) return;

    // ✅ 카드 클릭 시 타이머를 건드리지 않음
    //    → 턴 시작 시각부터 흐른 시간이 그대로 유지됨

    ms.flipped.push(cardIndex);

    io.to(roomName).emit('memory_card_flipped', {
        index: cardIndex,
        emoji: ms.deck[cardIndex],
    });

    if (ms.flipped.length === 2) {
        ms.locked = true;
        const [a, b] = ms.flipped;

        setTimeout(() => {
            if (!rooms[roomName]?.memoryState) return;

            if (ms.deck[a] === ms.deck[b]) {
                // ── 매칭 성공 ──────────────────────────────────
                ms.matched.add(a);
                ms.matched.add(b);
                ms.scores[socketId] = (ms.scores[socketId] || 0) + 1;
                room.users[socketId].score = ms.scores[socketId];

                io.to(roomName).emit('memory_match', {
                    indices: [a, b],
                    playerId: socketId,
                    scores: ms.scores,
                });
                io.to(roomName).emit('update_users', room.users);

                ms.flipped = [];
                ms.locked = false;

                // 모든 카드 완성 → 게임 종료
                if (ms.matched.size === GRID_SIZE) {
                    clearTurnTimer(ms);
                    if (room.gameTimeout) clearTimeout(room.gameTimeout);
                    endGame(roomName);
                    return;
                }

                // ✅ 매칭 성공 시에만 타이머 리셋 + 같은 플레이어 연속 진행
                emitTurnChange(io, roomName, room, ms, rooms);

            } else {
                // ── 매칭 실패 → 카드 덮고 턴 교체 ─────────────
                io.to(roomName).emit('memory_no_match', { indices: [a, b] });

                ms.flipped = [];
                ms.locked = false;

                // ✅ 실패 시 타이머 리셋 없이 다음 플레이어로 넘김
                const userIds = Object.keys(room.users);
                const currentIdx = userIds.indexOf(socketId);
                ms.currentTurn = userIds[(currentIdx + 1) % userIds.length];

                emitTurnChange(io, roomName, room, ms, rooms);
            }
        }, 900);
    }
}

// ── 게임 강제 종료 시 타이머 정리 ────────────────────────
function cleanupMemoryGame(room) {
    if (room.memoryState) {
        clearTurnTimer(room.memoryState);
    }
}

// ── 승자 결정 ─────────────────────────────────────────────
function resolveMemoryWinner(room) {
    const ms = room.memoryState;
    if (!ms) return { winners: [], winnerIds: [], bestResult: '없음' };

    let bestScore = -1;
    let winnerIds = [];

    for (const id in ms.scores) {
        const s = ms.scores[id];
        if (s > bestScore) { bestScore = s; winnerIds = [id]; }
        else if (s === bestScore) { winnerIds.push(id); }
    }

    const winners = winnerIds.map(id => room.users[id]?.userName || id);
    return { winners, winnerIds, bestResult: bestScore };
}

module.exports = {
    startMemoryGame,
    startMemoryTurn,
    handleMemoryCardClick,
    resolveMemoryWinner,
    cleanupMemoryGame,
};