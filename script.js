const characters = [
    { name: 'Женя', src: 'images/Женя.png' },
    { name: 'Макс', src: 'images/Макс.png' },
    { name: 'Ярик', src: 'images/Ярик.png' },
    { name: 'Ярчег', src: 'images/Ярчег.jpg' }
];

let peer = null;
let connection = null; 
let myRole = 'spectator'; 
let gameActive = false;

// Host-specific state
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

let localState = null;
let lastProgress = 50; // Track last progress to sync tensing shake animations

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
const debugLog = document.getElementById('debug-log');

// Debug Logging Helper
function logDebug(msg, color = '#00f2fe') {
    console.log(msg);
    if (debugLog) {
        debugLog.innerHTML += `<div style="color: ${color}; border-bottom: 1px solid rgba(255,255,255,0.05); padding: 2px 0;">[${new Date().toLocaleTimeString()}] ${msg}</div>`;
        debugLog.scrollTop = debugLog.scrollHeight;
    }
}

// Global JS Error Handler to display crashes on screen
window.onerror = function (msg, url, lineNo, columnNo, error) {
    logDebug(`КРИТИЧНА ПОМИЛКА: ${msg} (рядок ${lineNo}:${columnNo})`, '#ff4d4d');
    return false;
};

/* ==========================================================================
   HOST GAME FLOW (Player 1)
   ========================================================================== */

function initiateHost() {
    logDebug('Ініціалізація хоста...');
    if (connectStatus) connectStatus.textContent = 'Зв\'язок з хмарним сервером PeerJS...';
    
    const code = Math.floor(1000 + Math.random() * 9000);
    const peerId = `armwrestling-p2p-${code}`;

    peer = new Peer(peerId);

    peer.on('open', (id) => {
        myRole = 'p1';
        hostState.p1Connected = true;
        
        if (roomIndicator) {
            roomIndicator.textContent = `Кімната: ${code}`;
            roomIndicator.classList.remove('hidden');
        }
        if (roleIndicator) {
            roleIndicator.textContent = 'Ви: Гравець 1 (Хост)';
            roleIndicator.style.color = '#4facfe';
        }

        if (connectStatus) {
            connectStatus.innerHTML = `Кімнату створено! Код доступу: <span style="font-size:1.8rem; color:#00f2fe; font-weight:900;">${code}</span><br>Поділіться цим кодом з суперником.`;
        }
        logDebug(`Кімнату створено з кодом ${code}. Очікування підключення...`);
        
        listenForPlayer2();
    });

    peer.on('error', (err) => {
        logDebug(`Помилка PeerJS (Хост): ${err.type} - ${err.message}`, '#ff4d4d');
        if (err.type === 'unavailable-id') {
            initiateHost();
        } else {
            if (connectStatus) connectStatus.textContent = `Помилка: ${err.message}`;
        }
    });
}

function listenForPlayer2() {
    peer.on('connection', (conn) => {
        logDebug(`Отримано запит на підключення від ${conn.peer}`);
        
        if (hostState.gameActive) {
            logDebug('Відхилено підключення (активна гра)');
            conn.on('open', () => {
                conn.send({ type: 'lobby_full' });
                setTimeout(() => conn.close(), 500);
            });
            return;
        }

        // Overwrite connection if not in active match to prevent hanging channels
        if (connection) {
            logDebug('Перепідключення: закриваємо попередній канал з\'єднання.');
            connection.off(); 
            connection.close();
        }

        connection = conn;
        hostState.p2Connected = true;
        hostState.p2Ready = false;
        
        setupHostDataListeners();
    });
}

function setupHostDataListeners() {
    const handleOpen = () => {
        logDebug('З\'єднання з Гравцем 2 встановлено успішно!');
        if (connectScreen) connectScreen.classList.add('hidden');
        if (setupScreen) setupScreen.classList.remove('hidden');
        
        sendStateToP2();
        updateLobbyUI(hostState);
    };

    if (connection.open) {
        handleOpen();
    } else {
        connection.on('open', handleOpen);
    }

    connection.on('data', (data) => {
        logDebug(`Хост отримав дані: ${JSON.stringify(data)}`);
        handleIncomingDataAsHost(data);
    });

    connection.on('error', (err) => {
        logDebug(`Помилка з'єднання: ${err.message}`, '#ff4d4d');
    });

    connection.on('close', () => {
        logDebug('Гравець 2 відключився', '#ff758c');
        alert('Суперник відключився!');
        hostState.p2Connected = false;
        hostState.p2Ready = false;
        resetToLobby();
    });
}

function sendStateToP2() {
    if (connection && connection.open) {
        logDebug('Відправка оновлення стану Гравцю 2...');
        connection.send({
            type: 'state_update',
            state: hostState
        });
    } else {
        logDebug('Помилка: Спроба відправити стан, але з\'єднання закрите', '#ff4d4d');
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
        hostState.progress -= 2;
        handleGameplayProgress();
    }
}

function checkGameStartConditions() {
    if (hostState.p1Ready && hostState.p2Ready && !hostState.gameActive) {
        logDebug('Початок гри! Обидва гравці готові.');
        hostState.gameActive = true;
        hostState.progress = 50;

        if (connection && connection.open) {
            connection.send({
                type: 'game_start',
                p1CharIndex: hostState.p1CharIndex,
                p2CharIndex: hostState.p2CharIndex
            });
        }
        
        runStartSequence(hostState.p1CharIndex, hostState.p2CharIndex);
    }
}

function handleGameplayProgress() {
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
        const progressPayload = { type: 'progress_update', progress: hostState.progress };
        if (connection && connection.open) connection.send(progressPayload);
        updateProgress(hostState.progress);
    }
}

function resetToLobby() {
    logDebug('Скидання гри в режим лобі');
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

    logDebug(`Підключення як гість до коду ${codeInput}...`);
    if (connectStatus) connectStatus.textContent = 'Зв\'язок з хмарним сервером PeerJS...';

    peer = new Peer();

    peer.on('open', (id) => {
        myRole = 'p2';
        if (roleIndicator) {
            roleIndicator.textContent = 'Ви: Гравець 2 (Гість)';
            roleIndicator.style.color = '#ff758c';
        }
        
        if (connectStatus) connectStatus.textContent = `Підключення до кімнати ${codeInput}...`;

        const hostPeerId = `armwrestling-p2p-${codeInput}`;
        connection = peer.connect(hostPeerId);

        setupJoinerDataListeners();
    });

    peer.on('error', (err) => {
        logDebug(`Помилка PeerJS (Гість): ${err.type} - ${err.message}`, '#ff4d4d');
        if (connectStatus) connectStatus.textContent = `Помилка: ${err.message}`;
    });
}

function setupJoinerDataListeners() {
    const handleOpen = () => {
        logDebug('Встановлено з\'єднання з Хостом!');
        if (connectScreen) connectScreen.classList.add('hidden');
        if (setupScreen) setupScreen.classList.remove('hidden');
        if (lobbyMessage) lobbyMessage.textContent = 'Підключено! Очікуємо синхронізацію...';
    };

    if (connection.open) {
        handleOpen();
    } else {
        connection.on('open', handleOpen);
    }

    connection.on('data', (data) => {
        logDebug(`Гість отримав дані: ${JSON.stringify(data)}`);
        
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

    connection.on('error', (err) => {
        logDebug(`Помилка з'єднання: ${err.message}`, '#ff4d4d');
    });

    connection.on('close', () => {
        logDebug('Хост розірвав з\'єднання', '#ff758c');
        alert('Хост розірвав з\'єднання!');
        window.location.reload();
    });
}


/* ==========================================================================
   COMMON LOBBY AND GAMEPLAY LOGIC
   ========================================================================== */

function updateLobbyUI(state) {
    if (!state) return;
    localState = state;

    // Player 1 Sync
    const p1Select = document.getElementById('p1-select');
    const controlsP1 = document.getElementById('controls-p1');
    const readyP1 = document.getElementById('ready-p1');

    if (state.p1Connected) {
        const p1Title = document.getElementById('p1-title');
        const carouselP1 = document.getElementById('carousel-p1');
        
        if (p1Title) p1Title.textContent = (myRole === 'p1') ? 'Ви (Гравець 1)' : 'Гравець 1';
        if (carouselP1) carouselP1.innerHTML = `<img src="${characters[state.p1CharIndex].src}" alt="${characters[state.p1CharIndex].name}">`;
        
        if (readyP1) {
            if (state.p1Ready) {
                readyP1.textContent = 'ГОТОВИЙ';
                readyP1.classList.add('is-ready');
            } else {
                readyP1.textContent = 'НЕ ГОТОВИЙ';
                readyP1.classList.remove('is-ready');
            }
        }

        if (controlsP1) {
            if (myRole === 'p1' && !state.p1Ready) {
                controlsP1.classList.remove('disabled');
                if (p1Select) p1Select.classList.add('active-player');
            } else {
                controlsP1.classList.add('disabled');
                if (p1Select) p1Select.classList.remove('active-player');
            }
        }
    }

    // Player 2 Sync
    const p2Select = document.getElementById('p2-select');
    const controlsP2 = document.getElementById('controls-p2');
    const readyP2 = document.getElementById('ready-p2');

    if (state.p2Connected) {
        const p2Title = document.getElementById('p2-title');
        const carouselP2 = document.getElementById('carousel-p2');

        if (p2Title) p2Title.textContent = (myRole === 'p2') ? 'Ви (Гравець 2)' : 'Гравець 2';
        if (carouselP2) carouselP2.innerHTML = `<img src="${characters[state.p2CharIndex].src}" alt="${characters[state.p2CharIndex].name}">`;

        if (readyP2) {
            if (state.p2Ready) {
                readyP2.textContent = 'ГОТОВИЙ';
                readyP2.classList.add('is-ready');
            } else {
                readyP2.textContent = 'НЕ ГОТОВИЙ';
                readyP2.classList.remove('is-ready');
            }
        }

        if (controlsP2) {
            if (myRole === 'p2' && !state.p2Ready) {
                controlsP2.classList.remove('disabled');
                if (p2Select) p2Select.classList.add('active-player');
            } else {
                controlsP2.classList.add('disabled');
                if (p2Select) p2Select.classList.remove('active-player');
            }
        }
    } else {
        const p2Title = document.getElementById('p2-title');
        const carouselP2 = document.getElementById('carousel-p2');
        if (p2Title) p2Title.textContent = 'Гравець 2 (Очікування...)';
        if (carouselP2) carouselP2.innerHTML = '<div class="carousel-placeholder">Очікування підключення...</div>';
        if (readyP2) {
            readyP2.textContent = 'НЕ ПІДКЛЮЧЕНО';
            readyP2.classList.remove('is-ready');
        }
        if (controlsP2) controlsP2.classList.add('disabled');
        if (p2Select) p2Select.classList.remove('active-player');
    }

    // Ready button styling
    if (readyBtn) {
        const amIReady = (myRole === 'p1') ? state.p1Ready : state.p2Ready;
        if (amIReady) {
            readyBtn.textContent = 'СКАСУВАТИ ГОТОВНІСТЬ';
            readyBtn.classList.add('active');
        } else {
            readyBtn.textContent = 'ГОТОВИЙ';
            readyBtn.classList.remove('active');
        }
    }

    // Lobby status updates
    if (lobbyMessage) {
        if (!state.p2Connected) {
            lobbyMessage.textContent = 'Очікуємо суперника...';
            if (readyBtn) readyBtn.classList.add('hidden');
        } else {
            if (readyBtn) readyBtn.classList.remove('hidden');
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
}

// Function to shift character selection
function changeChar(direction) {
    if (gameActive) return;
    
    let currentIdx = (myRole === 'p1') ? hostState.p1CharIndex : (localState ? localState.p2CharIndex : 1);
    let newIndex = (currentIdx + direction + characters.length) % characters.length;

    logDebug(`Зміна персонажа на індекс ${newIndex}`);

    if (myRole === 'p1') {
        hostState.p1CharIndex = newIndex;
        sendStateToP2();
        updateLobbyUI(hostState);
    } else if (myRole === 'p2') {
        if (connection && connection.open) {
            connection.send({
                type: 'select_char',
                index: newIndex
            });
        }
    }
}

// Toggle ready status
function toggleReady() {
    logDebug('Клік на кнопку "Готовий"');
    
    if (myRole === 'p1') {
        hostState.p1Ready = !hostState.p1Ready;
        logDebug(`Хост перемикає готовність: ${hostState.p1Ready}`);
        sendStateToP2();
        updateLobbyUI(hostState);
        checkGameStartConditions();
    } else if (myRole === 'p2') {
        const isReadyNow = localState ? !localState.p2Ready : true;
        logDebug(`Гість надсилає статус готовності: ${isReadyNow}`);
        if (connection && connection.open) {
            connection.send({
                type: 'toggle_ready',
                ready: isReadyNow
            });
        } else {
            logDebug('Помилка: з\'єднання закрите при кліку готовий', '#ff4d4d');
        }
    }
}

// Global screen tap event listener during active gameplay
const arenaTapZone = document.getElementById('arena-tap-zone');
if (arenaTapZone) {
    arenaTapZone.addEventListener('mousedown', registerTap);
    arenaTapZone.addEventListener('touchstart', (e) => {
        e.preventDefault(); 
        registerTap();
    });
}

function registerTap() {
    if (!gameActive) return;

    if (myRole === 'p1') {
        hostState.progress += 2;
        handleGameplayProgress();
    } else if (myRole === 'p2') {
        if (connection && connection.open) {
            connection.send({ type: 'tap' });
        }
    }
}

// Local visual tensing animation trigger
function triggerTenseAnimation(player) {
    const wrapper = document.querySelector(`#wrestler-${player} .wrestler-body-wrapper`);
    if (wrapper) {
        wrapper.classList.remove('tensing');
        void wrapper.offsetWidth; 
        wrapper.classList.add('tensing');
        
        setTimeout(() => {
            wrapper.classList.remove('tensing');
        }, 150);
    }
}

function runStartSequence(p1Index, p2Index) {
    if (setupScreen) setupScreen.classList.add('hidden');
    if (gameScreen) gameScreen.classList.remove('hidden');

    const p1Img = document.getElementById('p1-img');
    const p1Name = document.getElementById('p1-game-name');
    const p2Img = document.getElementById('p2-img');
    const p2Name = document.getElementById('p2-game-name');

    if (p1Img) p1Img.src = characters[p1Index].src;
    if (p1Name) p1Name.textContent = characters[p1Index].name;
    if (p2Img) p2Img.src = characters[p2Index].src;
    if (p2Name) p2Name.textContent = characters[p2Index].name;

    lastProgress = 50;
    updateProgress(50);

    let count = 3;
    const countdownEl = document.getElementById('countdown');
    if (countdownEl) {
        countdownEl.textContent = count;
        countdownEl.classList.remove('hidden');
    }
    gameActive = false;

    const interval = setInterval(() => {
        count--;
        if (countdownEl) {
            if (count > 0) {
                countdownEl.textContent = count;
            } else if (count === 0) {
                countdownEl.textContent = 'БІЙ!';
            } else {
                clearInterval(interval);
                countdownEl.classList.add('hidden');
                gameActive = true;
                logDebug('БІЙ почався!');
            }
        } else {
            clearInterval(interval);
            gameActive = true;
        }
    }, 1000);
}

function updateProgress(progress) {
    const armAssembly = document.getElementById('arm-assembly');
    if (armAssembly) {
        const angle = (50 - progress) * 1.15;
        armAssembly.style.transform = `rotate(${angle}deg)`;
    }

    const glow = document.getElementById('arms-glow');
    if (glow) {
        const intensity = Math.abs(50 - progress) / 50;
        glow.style.opacity = intensity * 0.8;
    }

    // Real-world arm wrestling physics body tilt & shift calculations
    const shiftFactor = 0.5; // Up to 25px translation
    const rotFactor = 0.16;   // Up to 8 degrees rotation
    
    const p1x = (progress - 50) * shiftFactor;
    const p1rot = (progress - 50) * rotFactor;
    
    const p2x = (progress - 50) * shiftFactor;
    const p2rot = (progress - 50) * rotFactor;

    const wrestlerP1 = document.getElementById('wrestler-p1');
    const wrestlerP2 = document.getElementById('wrestler-p2');

    if (wrestlerP1) {
        wrestlerP1.style.setProperty('--p1-x', `${p1x}px`);
        wrestlerP1.style.setProperty('--p1-rot', `${p1rot}deg`);
    }
    if (wrestlerP2) {
        wrestlerP2.style.setProperty('--p2-x', `${p2x}px`);
        wrestlerP2.style.setProperty('--p2-rot', `${p2rot}deg`);
    }

    // Trigger physical strain vibration depending on who tapped
    if (progress > lastProgress) {
        triggerTenseAnimation('p1');
    } else if (progress < lastProgress) {
        triggerTenseAnimation('p2');
    }

    lastProgress = progress;
}

function runEndSequence(winnerRole, finalProgress) {
    gameActive = false;
    updateProgress(finalProgress);

    setTimeout(() => {
        if (gameScreen) gameScreen.classList.add('hidden');
        if (resultScreen) resultScreen.classList.remove('hidden');

        const winnerText = document.getElementById('winner-text');
        const winnerImg = document.getElementById('winner-img');

        let winnerName = 'Невідомо';
        let winnerSrc = '';

        let stateObj = (myRole === 'p1') ? hostState : localState;
        if (stateObj) {
            if (winnerRole === 'p1') {
                winnerName = characters[stateObj.p1CharIndex].name;
                winnerSrc = characters[stateObj.p1CharIndex].src;
            } else {
                winnerName = characters[stateObj.p2CharIndex].name;
                winnerSrc = characters[stateObj.p2CharIndex].src;
            }
        }

        if (winnerText) winnerText.textContent = `${winnerName} ПЕРЕМІГ!`;
        if (winnerImg) winnerImg.src = winnerSrc;
        logDebug(`Кінець гри. Переможець: ${winnerName}`);

        setTimeout(() => {
            if (resultScreen) resultScreen.classList.add('hidden');
            if (setupScreen) setupScreen.classList.remove('hidden');
        }, 4000);

    }, 500);
}

window.addEventListener('resize', () => {
    let stateObj = (myRole === 'p1') ? hostState : localState;
    if (stateObj) {
        updateProgress(stateObj.progress);
    }
});
