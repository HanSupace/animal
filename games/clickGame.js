// clickGame.js - 클릭 게임 로직

function handleClickAction(io, roomName, room, socketId) {
    if (!room || !room.isGameRunning || room.currentGameMode !== 'CLICK') return;

    room.users[socketId].score += 1;
    io.to(roomName).emit('update_users', room.users);
}

function resolveClickWinner(room) {
    let winners = [];
    let winnerIds = [];
    let maxScore = -1;

    for (const id in room.users) {
        const user = room.users[id];
        if (user.score > maxScore) {
            maxScore = user.score;
            winners = [user.userName];
            winnerIds = [id];
        } else if (user.score === maxScore) {
            winners.push(user.userName);
            winnerIds.push(id);
        }
    }

    return { winners,winnerIds, bestResult: maxScore };
}

module.exports = { handleClickAction, resolveClickWinner };
