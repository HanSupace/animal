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

    if (resultTime === -1) {
        room.users[socketId].score = 99999;
        io.to(roomName).emit('update_users', room.users); 
    } else {
        room.users[socketId].score = resultTime;
        endGame(roomName); 
    }
}

function resolveReactionWinner(room) {
    let winners = [];
    let winnerIds = [];
    let bestResult = Infinity;

    for (const id in room.users) {
        const user = room.users[id];
        if (user.score > 0 && user.score < 9999 && user.score < bestResult) {            bestResult = user.score;
            winners = [user.userName];
            winnerIds = [id];
        } else if (user.score > 0 && user.score === bestResult) {
            winners.push(user.userName);
            winnerIds.push(id);
        }
    }

    return { winners, winnerIds, bestResult: bestResult === Infinity ? "없음" : bestResult };
}

module.exports = { startReactionGame, handleReactionResult, resolveReactionWinner };
