// reactionGame.js - 반응속도 게임 로직

function startReactionGame(io, roomName, room) {
    const randomDelay = Math.random() * 4000 + 2000;
    room.reactionTimer = setTimeout(() => {
        if (room.isGameRunning && room.currentGameMode === 'REACTION') {
            io.to(roomName).emit('reaction_go');
        }
    }, randomDelay);
}

function handleReactionResult(io, roomName, room, socketId, resultTime, endGame) {
    if (!room || !room.isGameRunning || room.currentGameMode !== 'REACTION') return;
    if (room.isTieBreaker && !room.tiedUsers.includes(socketId)) return;
    if (resultTime === -1) {
        room.users[socketId].score = 99999;
        
    } else {
        room.users[socketId].score = resultTime;
        
    }

    io.to(roomName).emit('update_users', room.users);

    // 2. [수정 포인트] 모든 참가자가 점수를 가졌는지 확인 (멈춤 방지)
    const allResponded = Object.values(room.users).every(user => user.score !== undefined && user.score !== 0);

    // 누군가 성공했거나, 전원이 부정출발/클릭을 완료했다면 종료
    if (resultTime !== -1 || allResponded) {
        endGame(roomName); 
    }
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
        } else if (user.score > 0 && user.score === bestResult) {
            winners.push(user.userName);
            winnerIds.push(id);
        }
    }

    return { winners, winnerIds, bestResult: bestResult === Infinity ? "실패" : bestResult };
}

module.exports = { startReactionGame, handleReactionResult, resolveReactionWinner };
