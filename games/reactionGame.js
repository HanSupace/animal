// reactionGame.js - 반응속도 게임 로직

function startReactionGame(io, roomName, room) {
    room.reactionEnded = false;

    const randomDelay = Math.random() * 4000 + 2000;
    room.reactionTimer = setTimeout(() => {
        if (room.isGameRunning && room.currentGameMode === 'REACTION') {
            io.to(roomName).emit('reaction_go');
        }
    }, randomDelay);
}

function handleReactionResult(io, roomName, room, socketId, resultTime, endGame) {
    if (!room || !room.isGameRunning || room.currentGameMode !== 'REACTION') return;

    if (room.currentGameMode === 'REACTION' && room.reactionEnded) return; // 🔥

    if (room.users[socketId].isDead) return;

    // 🔥 부정출발
    if (resultTime === -1) {
        room.users[socketId].isDead = true;
        room.users[socketId].score = 99999;

        io.to(socketId).emit('reaction_eliminated');
        io.to(roomName).emit('update_users', room.users);

        const aliveUsers = Object.values(room.users).filter(u => !u.isDead);
        if (aliveUsers.length <= 1) {
            room.reactionEnded = true;
            endGame(roomName);
        }
        return;
    }

    // 🔥 첫 클릭 처리 (여기서 게임 끝냄)
    room.reactionEnded = true;

    // ⭐ 1. 먼저 즉시 브로드캐스트 (지연 제거 핵심)
    io.to(roomName).emit('reaction_first_click', { winnerId: socketId });

    // ⭐ 2. 서버 상태 업데이트
    room.users[socketId].score = resultTime;

    for (const id in room.users) {
        if (id !== socketId) {
            room.users[id].isDead = true;
            room.users[id].score = 99999;
        }
    }

    // ⭐ 3. 상태 반영
    io.to(roomName).emit('update_users', room.users);

    // ⭐ 4. 바로 종료
    endGame(roomName);
}

function resolveReactionWinner(room) {
    let winners = [];
    let winnerIds = [];
    let bestResult = Infinity;

    for (const id in room.users) {
        const user = room.users[id];
        if (user.score > 0 && user.score < 99999 && user.score < bestResult) {
            bestResult = user.score;
            winners = [user.userName];
            winnerIds = [id];
        }
        // 동점은 없음 - 먼저 누른 1명만 winner
    }

    return { winners, winnerIds, bestResult: bestResult === Infinity ? "실패" : bestResult };
}

module.exports = { startReactionGame, handleReactionResult, resolveReactionWinner };
