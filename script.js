const characters = [
    { name: 'Женя', src: 'images/Женя.png' },
    { name: 'Макс', src: 'images/Макс.png' },
    { name: 'Ярик', src: 'images/Ярик.png' },
    { name: 'Ярчег', src: 'images/Ярчег.jpg' }
];

let peer = null;
let connection = null; // DataConnection object
let myRole = 'spectator'; // 'p1' (Host) or 'p2' (Joiner)
let gameActive = false;

// Host-specific state (Host is the single source of truth)
let hostState = {
    p1Connected: false,
    p1CharIndex: 0,
    p1Ready: false,
    p2Connected: false,
    p2CharIndex: 1,
    p2Ready: false,
    progress: 50,
    gameActive: false
};

// UI Elements
const connectScreen = document.getElementById('connect-screen');
const setupScreen = document.getElementById('setup-screen');
const gameScreen = document.getElementById('game-screen');
const resultScreen = document.getElementById('result-screen');
const connectStatus = document.getElementById('connect-status');
const roleIndicator = document.getElementById('role-indicator');
const roomIndicator = document.getElementById('room-indicator');
const lobbyMessage = document.getElementById('lobby-message');
const readyBtn = document.getElementById('ready-btn');

/* ==========================================================================
   HOST GAME FLOW (Player 1)
   ========================================================================== */

function initiateHost() {
    connectStatus.textContent = 'Зв\'язок з хмарним сервером PeerJS...';
    
    // Generate a random 4-digit code
    const code = Math.floor(1000 + Math.random() * 9000);
    const peerId = `armwrestling-p2p-${code}`;

    peer = new Peer(peerId);

    peer.on('open', (id) => {
        myRole = 'p1';
        hostState.p1Connected = true;
        
        // Show room code
        roomIndicator.textContent = `Кімната: ${code}`;
        roomIndicator.classList.remove('hidden');
        roleIndicator.textContent = 'Ви: Гравець 1 (Хост)';
        roleIndicator.style.color = '#4facfe';

        connectStatus.innerHTML = `Кімнату створено! Код доступу: <span style="font-size:1.8rem; color:#00f2fe; font-weight:900;">${code}</span><br>Поділіться цим кодом з суперником.`;
        
        // Host is ready to receive P2 connection
        listenForPlayer2();
    });

    peer.on('error', (err) => {
        console.error('PeerJS Host Error:', err);
        if (err.type === 'unavailable-id') {
            // Retry if ID is somehow taken
            initiateHost();
        } else {
            connectStatus.textContent = `Помилка: ${err.message}`;
        }
    });
}

function listenForPlayer2() {
    peer.on('connection', (conn) => {
        if (hostState.p2Connected) {
            // We already have a Player 2, deny subsequent connections
            conn.on('open', () => {
                conn.send({ type: 'lobby_full' });
                setTimeout(() => conn.close(), 500);
            });
            return;
        }

        connection = conn;
        hostState.p2Connected = true;
        console.log('Player 2 connected');

        // Set up connection event handlers
        setupHostDataListeners();
    });
}

function setupHostDataListeners() {
    connection.on('open', () => {
        // Switch to setup lobby screen
        connectScreen.classList.add('hidden');
        setupScreen.classList.remove('hidden');
        
        // Sync initial state to Player 2
        sendStateToP2();
        updateLobbyUI(hostState);
    });

    connection.on('data', (data) => {
        handleIncomingDataAsHost(data);
    });

    connection.on('close', () => {
        alert('Суперник відключився!');
        hostState.p2Connected = false;
        hostState.p2Ready = false;
        resetToLobby();
    });
}

function sendStateToP2() {
    if (connection && connection.open) {
        connection.send({
            type: 'state_update',
            state: hostState
        });
    }
}

function handleIncomingDataAsHost(data) {
    if (data.type === 'select_char' && !hostState.p2Ready && !hostState.gameActive) {
        hostState.p2CharIndex = data.index;
        sendStateToP2();
        updateLobbyUI(hostState);
    }

    if (data.type === 'toggle_ready' && !hostState.gameActive) {
        hostState.p2Ready = data.ready;
        sendStateToP2();
        updateLobbyUI(hostState);
        
        checkGameStartConditions();
    }

    if (data.type === 'tap' && hostState.gameActive) {
        // Player 2 taps: decreases progress (moves to right/red)
        hostState.progress -= 2;
        handleGameplayProgress();
    }
}

function checkGameStartConditions() {
    if (hostState.p1Ready && hostState.p2Ready && !hostState.gameActive) {
        hostState.gameActive = true;
        hostState.progress = 50;

        // Broadcast game start signal to P2
        if (connection && connection.open) {
            connection.send({
                type: 'game_start',
                p1CharIndex: hostState.p1CharIndex,
                p2CharIndex: hostState.p2CharIndex
            });
        }
        
        // Start local game
        runStartSequence(hostState.p1CharIndex, hostState.p2CharIndex);
    }
}

function handleGameplayProgress() {
    // Check win conditions
    if (hostState.progress >= 100) {
        hostState.progress = 100;
        
        const winPayload = { type: 'game_over', winner: 'p1', progress: 100 };
        if (connection && connection.open) connection.send(winPayload);
        runEndSequence('p1', 100);
        resetToLobby();
    } else if (hostState.progress <= 0) {
        hostState.progress = 0;
        
        const winPayload = { type: 'game_over', winner: 'p2', progress: 0 };
        if (connection && connection.open) connection.send(winPayload);
        runEndSequence('p2', 0);
        resetToLobby();
    } else {
        // Broadcast progress update
        const progressPayload = { type: 'progress_update', progress: hostState.progress };
        if (connection && connection.open) connection.send(progressPayload);
        updateProgress(hostState.progress);
    }
}

function resetToLobby() {
    hostState.gameActive = false;
    hostState.progress = 50;
    hostState.p1Ready = false;
    hostState.p2Ready = false;
    
    sendStateToP2();
    updateLobbyUI(hostState);
}


/* ==========================================================================
   JOINER GAME FLOW (Player 2)
   ========================================================================== */

function initiateJoiner() {
    const codeInput = document.getElementById('join-code-input').value;
    if (!codeInput || codeInput.length !== 4) {
        alert('Будь ласка, введіть правильний 4-значний код!');
        return;
    }

    connectStatus.textContent = 'Зв\'язок з хмарним сервером PeerJS...';

    // Assign a random ID or let peerjs handle it
    peer = new Peer();

    peer.on('open', (id) => {
        myRole = 'p2';
        roleIndicator.textContent = 'Ви: Гравець 2 (Гість)';
        roleIndicator.style.color = '#ff758c';
        
        connectStatus.textContent = `Підключення до кімнати ${codeInput}...`;

        // Connect to Host peer ID
        const hostPeerId = `armwrestling-p2p-${codeInput}`;
        connection = peer.connect(hostPeerId);

        setupJoinerDataListeners();
    });

    peer.on('error', (err) => {
        console.error('PeerJS Joiner Error:', err);
        connectStatus.textContent = `Помилка: ${err.message}`;
    });
}

function setupJoinerDataListeners() {
    connection.on('open', () => {
        connectScreen.classList.add('hidden');
        setupScreen.classList.remove('hidden');
        lobbyMessage.textContent = 'Підключено! Очікуємо синхронізацію...';
    });

    connection.on('data', (data) => {
        if (data.type === 'lobby_full') {
            alert('Кімната вже заповнена!');
            window.location.reload();
            return;
        }

        if (data.type === 'state_update') {
            localState = data.state;
            updateLobbyUI(data.state);
        }

        if (data.type === 'game_start') {
            runStartSequence(data.p1CharIndex, data.p2CharIndex);
        }

        if (data.type === 'progress_update') {
            updateProgress(data.progress);
        }

        if (data.type === 'game_over') {
            runEndSequence(data.winner, data.progress);
        }
    });

    connection.on('close', () => {
        alert('Хост розірвав з\'єднання!');
        window.location.reload();
    });
}


/* ==========================================================================
   COMMON LOBBY AND GAMEPLAY LOGIC
   ========================================================================== */

let localState = null;

function updateLobbyUI(state) {
    localState = state;

    // Player 1 Sync
    const p1Select = document.getElementById('p1-select');
    const controlsP1 = document.getElementById('controls-p1');
    const readyP1 = document.getElementById('ready-p1');

    if (state.p1Connected) {
        document.getElementById('p1-title').textContent = (myRole === 'p1') ? 'Ви (Гравець 1)' : 'Гравець 1';
        document.getElementById('carousel-p1').innerHTML = `<img src="${characters[state.p1CharIndex].src}" alt="${characters[state.p1CharIndex].name}">`;
        
        if (state.p1Ready) {
            readyP1.textContent = 'ГОТОВИЙ';
            readyP1.classList.add('is-ready');
        } else {
            readyP1.textContent = 'НЕ ГОТОВИЙ';
            readyP1.classList.remove('is-ready');
        }

        if (myRole === 'p1' && !state.p1Ready) {
            controlsP1.classList.remove('disabled');
            p1Select.classList.add('active-player');
        } else {
            controlsP1.classList.add('disabled');
            p1Select.classList.remove('active-player');
        }
    }

    // Player 2 Sync
    const p2Select = document.getElementById('p2-select');
    const controlsP2 = document.getElementById('controls-p2');
    const readyP2 = document.getElementById('ready-p2');

    if (state.p2Connected) {
        document.getElementById('p2-title').textContent = (myRole === 'p2') ? 'Ви (Гравець 2)' : 'Гравець 2';
        document.getElementById('carousel-p2').innerHTML = `<img src="${characters[state.p2CharIndex].src}" alt="${characters[state.p2CharIndex].name}">`;

        if (state.p2Ready) {
            readyP2.textContent = 'ГОТОВИЙ';
            readyP2.classList.add('is-ready');
        } else {
            readyP2.textContent = 'НЕ ГОТОВИЙ';
            readyP2.classList.remove('is-ready');
        }

        if (myRole === 'p2' && !state.p2Ready) {
            controlsP2.classList.remove('disabled');
            p2Select.classList.add('active-player');
        } else {
            controlsP2.classList.add('disabled');
            p2Select.classList.remove('active-player');
        }
    } else {
        document.getElementById('p2-title').textContent = 'Гравець 2 (Очікування...)';
        document.getElementById('carousel-p2').innerHTML = '<div class="carousel-placeholder">Очікування підключення...</div>';
        readyP2.textContent = 'НЕ ПІДКЛЮЧЕНО';
        readyP2.classList.remove('is-ready');
        controlsP2.classList.add('disabled');
        p2Select.classList.remove('active-player');
    }

    // Ready button styling
    const amIReady = (myRole === 'p1') ? state.p1Ready : state.p2Ready;
    if (amIReady) {
        readyBtn.textContent = 'СКАСУВАТИ ГОТОВНІСТЬ';
        readyBtn.classList.add('active');
    } else {
        readyBtn.textContent = 'ГОТОВИЙ';
        readyBtn.classList.remove('active');
    }

    // Lobby status updates
    if (!state.p2Connected) {
        lobbyMessage.textContent = 'Очікуємо суперника...';
        readyBtn.classList.add('hidden');
    } else {
        readyBtn.classList.remove('hidden');
        if (!state.p1Ready && !state.p2Ready) {
            lobbyMessage.textContent = 'Оберіть персонажів та натисніть "Готовий"';
        } else if (state.p1Ready && !state.p2Ready) {
            lobbyMessage.textContent = 'Гравець 1 готовий. Очікуємо Гравця 2...';
        } else if (!state.p1Ready && state.p2Ready) {
            lobbyMessage.textContent = 'Гравець 2 готовий. Очікуємо Гравця 1...';
        } else {
            lobbyMessage.textContent = 'Обидва гравці готові! Гра починається...';
        }
    }
}

// Function to shift character selection
function changeChar(direction) {
    if (gameActive) return;
    
    let currentIdx = (myRole === 'p1') ? hostState.p1CharIndex : localState.p2CharIndex;
    let newIndex = (currentIdx + direction + characters.length) % characters.length;

    if (myRole === 'p1') {
        hostState.p1CharIndex = newIndex;
        sendStateToP2();
        updateLobbyUI(hostState);
    } else if (myRole === 'p2') {
        connection.send({
            type: 'select_char',
            index: newIndex
        });
    }
}

// Toggle ready status
function toggleReady() {
    if (myRole === 'p1') {
        hostState.p1Ready = !hostState.p1Ready;
        sendStateToP2();
        updateLobbyUI(hostState);
        checkGameStartConditions();
    } else if (myRole === 'p2') {
        connection.send({
            type: 'toggle_ready',
            ready: !localState.p2Ready
        });
    }
}

// Global screen tap event listener during active gameplay
const arenaTapZone = document.getElementById('arena-tap-zone');

arenaTapZone.addEventListener('mousedown', registerTap);
arenaTapZone.addEventListener('touchstart', (e) => {
    e.preventDefault(); // Prevents double click zooms or scrolls on mobile devices
    registerTap();
});

function registerTap() {
    if (!gameActive) return;

    if (myRole === 'p1') {
        // Player 1 taps: increases progress (moves to left/blue)
        hostState.progress += 2;
        handleGameplayProgress();
    } else if (myRole === 'p2') {
        // Player 2 taps: sends command to Host
        connection.send({ type: 'tap' });
    }
}

function runStartSequence(p1Index, p2Index) {
    setupScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');

    // Populate visual details
    document.getElementById('p1-img').src = characters[p1Index].src;
    document.getElementById('p1-game-name').textContent = characters[p1Index].name;
    document.getElementById('p2-img').src = characters[p2Index].src;
    document.getElementById('p2-game-name').textContent = characters[p2Index].name;

    updateProgress(50);

    // Run 3, 2, 1 Countdown
    let count = 3;
    const countdownEl = document.getElementById('countdown');
    countdownEl.textContent = count;
    countdownEl.classList.remove('hidden');
    gameActive = false;

    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            countdownEl.textContent = count;
        } else if (count === 0) {
            countdownEl.textContent = 'БІЙ!';
        } else {
            clearInterval(interval);
            countdownEl.classList.add('hidden');
            gameActive = true;
        }
    }, 1000);
}

function updateProgress(progress) {
    const bar = document.getElementById('progress-bar');
    if (window.innerHeight > window.innerWidth) {
        // Portrait mode
        bar.style.height = progress + '%';
        bar.style.width = '100%';
    } else {
        // Landscape mode
        bar.style.width = progress + '%';
        bar.style.height = '100%';
    }
}

function runEndSequence(winnerRole, finalProgress) {
    gameActive = false;
    updateProgress(finalProgress);

    setTimeout(() => {
        gameScreen.classList.add('hidden');
        resultScreen.classList.remove('hidden');

        const winnerText = document.getElementById('winner-text');
        const winnerImg = document.getElementById('winner-img');

        let winnerName = 'Невідомо';
        let winnerSrc = '';

        let stateObj = (myRole === 'p1') ? hostState : localState;

        if (winnerRole === 'p1') {
            winnerName = characters[stateObj.p1CharIndex].name;
            winnerSrc = characters[stateObj.p1CharIndex].src;
        } else {
            winnerName = characters[stateObj.p2CharIndex].name;
            winnerSrc = characters[stateObj.p2CharIndex].src;
        }

        winnerText.textContent = `${winnerName} ПЕРЕМІГ!`;
        winnerImg.src = winnerSrc;

        // Automatically return to lobby after 4 seconds
        setTimeout(() => {
            resultScreen.classList.add('hidden');
            setupScreen.classList.remove('hidden');
        }, 4000);

    }, 500); // Small delay to let the winning bar fully animate
}

// Responsive updates to scaling
window.addEventListener('resize', () => {
    let stateObj = (myRole === 'p1') ? hostState : localState;
    if (stateObj) {
        updateProgress(stateObj.progress);
    }
});
