// avoidGame.js - 장애물 피하기 게임 로직

function handlePlayerDead(io, roomName, room, socketId, endGame) {
    if (!room || !room.isGameRunning || room.currentGameMode !== 'AVOID') return;

    room.users[socketId].isDead = true;
    io.to(roomName).emit('update_users', room.users);

    const userIds = Object.keys(room.users);
    const aliveUsers = userIds.filter(id => !room.users[id].isDead);

    if (aliveUsers.length <= 1) {
        endGame(roomName);
    }
}

function resolveAvoidWinner(room) {
    let winners = [];
    let winnerIds = [];

    for (const id in room.users) {
        const user = room.users[id];
        if (!user.isDead) {
            winners.push(user.userName);
            winnerIds.push(id);
        }
    }

    return { winners,winnerIds, bestResult: "생존" };
}

module.exports = { handlePlayerDead, resolveAvoidWinner };
