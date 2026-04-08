const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 정적 파일 제공 폴더 지정 (index.html 파일이 public 폴더 안에 있음)
app.use(express.static(__dirname + '/public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// 방과 유저들의 상태를 저장할 객체
const rooms = {}; 

io.on('connection', (socket) => {
    console.log('유저 접속됨:', socket.id);

    // 1. 방 코드 존재 여부 확인
    socket.on('check_room', (roomCode, callback) => {
        const roomExists = rooms.hasOwnProperty(roomCode);
        callback(roomExists);
    });

    // 2. 방 입장
    socket.on('join_room', ({ roomName, userName }) => {
        socket.join(roomName);
        socket.roomName = roomName;

        // 방이 처음 만들어지는 거라면 방 데이터 초기화
        if (!rooms[roomName]) {
            rooms[roomName] = { 
                users: {}, 
                isGameRunning: false, 
                isCountdown: false 
            };
        }

        // 유저 정보 저장
        rooms[roomName].users[socket.id] = { 
            userName: userName, 
            ready: false, 
            score: 0 
        };

        io.to(roomName).emit('chat_message', { user: '시스템', text: `${userName}님이 입장하셨습니다.` });
        io.to(roomName).emit('update_users', rooms[roomName].users);
    });

    // 3. 준비 상태 토글
    socket.on('toggle_ready', () => {
        const roomName = socket.roomName;
        if (!roomName || !rooms[roomName]) return;
        
        const user = rooms[roomName].users[socket.id];
        user.ready = !user.ready;
        
        io.to(roomName).emit('update_users', rooms[roomName].users);
        checkGameStart(roomName);
    });

    // 4. 클릭 액션 (점수 증가)
    socket.on('click_action', () => {
        const roomName = socket.roomName;
        // 게임이 실행 중일 때만 점수 인정
        if (!roomName || !rooms[roomName] || !rooms[roomName].isGameRunning) return;
        
        rooms[roomName].users[socket.id].score += 1;
        io.to(roomName).emit('update_users', rooms[roomName].users);
    });

    // 5. 채팅 메시지 전송
    socket.on('send_message', (message) => {
        const roomName = socket.roomName;
        if (!roomName || !rooms[roomName]) return;
        
        const userName = rooms[roomName].users[socket.id].userName;
        io.to(roomName).emit('chat_message', { user: userName, text: message });
    });

    // 6. 유저가 스스로 방을 나갈 때
    socket.on('leave_room', () => {
        handleUserLeave(socket);
    });

    // 7. 브라우저 종료 또는 새로고침 등으로 연결이 끊길 때
    socket.on('disconnect', () => {
        console.log('유저 접속 종료:', socket.id);
        handleUserLeave(socket);
    });
});

// --- 공통 및 게임 제어 함수 --- //

// 방 퇴장 공통 처리 함수
function handleUserLeave(socket) {
    const roomName = socket.roomName;
    
    if (roomName && rooms[roomName] && rooms[roomName].users[socket.id]) {
        const userName = rooms[roomName].users[socket.id].userName;
        
        delete rooms[roomName].users[socket.id]; // 방 데이터에서 유저 삭제
        socket.leave(roomName); // socket.io 채널에서 나가기
        socket.roomName = null; // 소켓의 방 정보 초기화

        io.to(roomName).emit('chat_message', { user: '시스템', text: `${userName}님이 퇴장하셨습니다.` });
        io.to(roomName).emit('update_users', rooms[roomName].users);

        if (Object.keys(rooms[roomName].users).length === 0) {
            delete rooms[roomName]; // 아무도 없으면 방 삭제
        } else {
            checkGameStart(roomName); // 남은 인원으로 시작 가능한지 재확인
        }
    }
}

// 게임 시작 조건 확인 및 실행
function checkGameStart(roomName) {
    const room = rooms[roomName];
    if (!room) return;
    
    const userIds = Object.keys(room.users);
    if (userIds.length < 1) return; 
    
    const allReady = userIds.every(id => room.users[id].ready);

    // 모든 인원이 준비되었고, 현재 카운트다운 중이거나 게임 중이 아닐 때 시작
    if (allReady && !room.isGameRunning && !room.isCountdown) {
        room.isCountdown = true; // 카운트다운 상태 돌입
        
        io.to(roomName).emit('game_countdown', 3);
        io.to(roomName).emit('chat_message', { user: '시스템', text: '잠시 후 대결이 시작됩니다!' });

        // 3초 카운트다운 대기 후 게임 시작
        setTimeout(() => {
            if (!rooms[roomName]) return; // 대기 시간 동안 방이 없어졌을 경우 대비
            
            room.isCountdown = false;
            room.isGameRunning = true;
            
            // 모든 유저 점수 0으로 초기화
            userIds.forEach(id => room.users[id].score = 0);
            io.to(roomName).emit('update_users', room.users);

            const duration = 10; // 본 게임 시간: 10초
            io.to(roomName).emit('game_start', duration);
            io.to(roomName).emit('chat_message', { user: '시스템', text: '🔥 대결 시작! 🔥' });

            // 10초 후 게임 종료 함수 호출
            setTimeout(() => endGame(roomName), duration * 1000);
        }, 3000); // 3000ms = 3초
    }
}

// 게임 종료 처리
function endGame(roomName) {
    const room = rooms[roomName];
    if (!room) return;
    
    room.isGameRunning = false;
    let maxScore = -1;
    let winners = [];
    
    // 최고 점수와 우승자 찾기 및 준비 상태 초기화
    for (const id in room.users) {
        const user = room.users[id];
        user.ready = false; 
        
        if (user.score > maxScore) { 
            maxScore = user.score; 
            winners = [user.userName]; 
        } else if (user.score === maxScore) {
            winners.push(user.userName);
        }
    }
    
    io.to(roomName).emit('update_users', room.users);
    io.to(roomName).emit('game_over', { winners, maxScore });
    io.to(roomName).emit('chat_message', { user: '시스템', text: `🏆 우승자: ${winners.join(', ')} (${maxScore}회)` });
}

// 서버 실행 포트 설정
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 서버가 실행되었습니다. 포트: ${PORT}`);
});