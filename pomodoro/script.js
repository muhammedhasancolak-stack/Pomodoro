const CIRCUMFERENCE = 2 * Math.PI * 126; // r = 126 -> ~791.68

const DEFAULT_SETTINGS = {
    pomodoro: 25,
    shortBreak: 5,
    longBreak: 15,
    longBreakInterval: 4,
    autoStartBreaks: false,
    autoStartPomodoros: false,
    soundEnabled: true
};

const MODE_LABELS = {
    pomodoro: 'Odaklanma',
    shortBreak: 'Kısa Mola',
    longBreak: 'Uzun Mola'
};

// State
let settings = loadFromStorage('pomo_settings', DEFAULT_SETTINGS);
let stats = loadFromStorage('pomo_stats', { completedPomodoros: 0, totalFocusMinutes: 0 });
let tasks = loadFromStorage('pomo_tasks', []);
let activeTaskId = loadFromStorage('pomo_active_task', null);

let currentMode = 'pomodoro';
let totalSeconds = settings.pomodoro * 60;
let remainingSeconds = totalSeconds;
let isRunning = false;
let timerInterval = null;
let endTime = null;
let sessionCount = stats.completedPomodoros + 1;

// DOM Elements
const body = document.body;
const modeTabs = document.querySelectorAll('.mode-tab');
const timeDisplay = document.getElementById('timeDisplay');
const sessionLabel = document.getElementById('sessionLabel');
const progressRingBar = document.getElementById('progressRingBar');
const startPauseBtn = document.getElementById('startPauseBtn');
const startPauseText = document.getElementById('startPauseText');
const resetBtn = document.getElementById('resetBtn');
const skipBtn = document.getElementById('skipBtn');

const completedPomodorosEl = document.getElementById('completedPomodoros');
const totalFocusMinutesEl = document.getElementById('totalFocusMinutes');

const taskForm = document.getElementById('taskForm');
const taskInput = document.getElementById('taskInput');
const taskEstInput = document.getElementById('taskEstInput');
const taskList = document.getElementById('taskList');
const clearCompletedBtn = document.getElementById('clearCompletedBtn');

const soundToggleBtn = document.getElementById('soundToggleBtn');
const soundOnIcon = document.getElementById('soundOnIcon');
const soundOffIcon = document.getElementById('soundOffIcon');

const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');

const pomodoroInput = document.getElementById('pomodoroInput');
const shortBreakInput = document.getElementById('shortBreakInput');
const longBreakInput = document.getElementById('longBreakInput');
const longBreakIntervalInput = document.getElementById('longBreakIntervalInput');
const autoStartBreaksInput = document.getElementById('autoStartBreaksInput');
const autoStartPomodorosInput = document.getElementById('autoStartPomodorosInput');

// Web Audio API Ses Sentezleyici
let audioCtx = null;

function getAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
}

function playClickSound() {
    if (!settings.soundEnabled) return;
    try {
        const ctx = getAudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.04);

        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.04);
    } catch (_) {}
}

function playAlarmChime() {
    if (!settings.soundEnabled) return;
    try {
        const ctx = getAudioContext();
        const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
        notes.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const startTime = ctx.currentTime + idx * 0.16;

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, startTime);

            gain.gain.setValueAtTime(0.001, startTime);
            gain.gain.linearRampToValueAtTime(0.22, startTime + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.55);

            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + 0.55);
        });
    } catch (_) {}
}

// Yardımcı Fonksiyonlar
function loadFromStorage(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
        return fallback;
    }
}

function saveToStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Görünüm Güncelleme
function updateDisplay() {
    const formatted = formatTime(remainingSeconds);
    timeDisplay.textContent = formatted;
    document.title = `${formatted} - ${MODE_LABELS[currentMode]} | PomoFocus`;

    const progress = totalSeconds > 0 ? (totalSeconds - remainingSeconds) / totalSeconds : 0;
    const offset = CIRCUMFERENCE * progress;
    progressRingBar.style.strokeDashoffset = offset;

    const activeTask = tasks.find(t => t.id === activeTaskId);
    if (activeTask) {
        sessionLabel.textContent = `🎯 ${activeTask.title}`;
    } else if (currentMode === 'pomodoro') {
        sessionLabel.textContent = `#${sessionCount} Odaklanma Zamanı`;
    } else if (currentMode === 'shortBreak') {
        sessionLabel.textContent = 'Kısa bir nefes al ☕';
    } else {
        sessionLabel.textContent = 'Uzun dinlenme zamanı 🌿';
    }
}

function updateStatsUI() {
    completedPomodorosEl.textContent = stats.completedPomodoros;
    totalFocusMinutesEl.textContent = `${stats.totalFocusMinutes} dk`;
}

function updateSoundIcon() {
    if (settings.soundEnabled) {
        soundOnIcon.classList.remove('hidden');
        soundOffIcon.classList.add('hidden');
    } else {
        soundOnIcon.classList.add('hidden');
        soundOffIcon.classList.remove('hidden');
    }
}

// Zamanlayıcı Kontrolleri
function switchMode(mode, autoStart = false) {
    pauseTimer(false);
    currentMode = mode;
    body.setAttribute('data-mode', mode);

    modeTabs.forEach(tab => {
        const isActive = tab.dataset.mode === mode;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', isActive);
    });

    totalSeconds = settings[mode] * 60;
    remainingSeconds = totalSeconds;
    updateDisplay();

    if (autoStart) {
        startTimer();
    }
}

function startTimer() {
    if (isRunning) return;
    isRunning = true;
    startPauseText.textContent = 'DURAKLAT';
    endTime = Date.now() + remainingSeconds * 1000;

    timerInterval = setInterval(() => {
        const diff = Math.round((endTime - Date.now()) / 1000);
        if (diff <= 0) {
            remainingSeconds = 0;
            updateDisplay();
            handleTimerComplete();
        } else {
            remainingSeconds = diff;
            updateDisplay();
        }
    }, 250);
}

function pauseTimer(playSound = true) {
    if (!isRunning) return;
    isRunning = false;
    clearInterval(timerInterval);
    timerInterval = null;
    startPauseText.textContent = 'BAŞLAT';
    if (playSound) playClickSound();
}

function resetTimer() {
    pauseTimer(false);
    totalSeconds = settings[currentMode] * 60;
    remainingSeconds = totalSeconds;
    updateDisplay();
}

function handleTimerComplete() {
    pauseTimer(false);
    playAlarmChime();

    if (currentMode === 'pomodoro') {
        stats.completedPomodoros += 1;
        stats.totalFocusMinutes += settings.pomodoro;
        sessionCount = stats.completedPomodoros + 1;
        saveToStorage('pomo_stats', stats);
        updateStatsUI();

        // Aktif görevin pomodoro sayısını artır
        if (activeTaskId) {
            const task = tasks.find(t => t.id === activeTaskId);
            if (task) {
                task.completedPomos += 1;
                if (task.completedPomos >= task.estimatedPomos) {
                    task.completed = true;
                }
                saveToStorage('pomo_tasks', tasks);
                renderTasks();
            }
        }

        const isLongBreak = stats.completedPomodoros % settings.longBreakInterval === 0;
        const nextMode = isLongBreak ? 'longBreak' : 'shortBreak';
        switchMode(nextMode, settings.autoStartBreaks);
    } else {
        switchMode('pomodoro', settings.autoStartPomodoros);
    }
}

// Görev Yönetimi
function renderTasks() {
    taskList.innerHTML = '';

    if (tasks.length === 0) {
        const emptyEl = document.createElement('li');
        emptyEl.className = 'empty-tasks';
        emptyEl.textContent = 'Henüz görev eklenmedi. Bir görev ekleyip odaklanmaya başla!';
        taskList.appendChild(emptyEl);
        updateDisplay();
        return;
    }

    tasks.forEach(task => {
        const li = document.createElement('li');
        li.className = `task-item ${task.completed ? 'completed' : ''} ${task.id === activeTaskId ? 'active-task' : ''}`;

        const leftDiv = document.createElement('div');
        leftDiv.className = 'task-left';

        const checkBtn = document.createElement('button');
        checkBtn.className = 'task-check';
        checkBtn.innerHTML = '✓';
        checkBtn.setAttribute('aria-label', 'Görevi tamamla');
        checkBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleTaskCompleted(task.id);
        });

        const titleSpan = document.createElement('span');
        titleSpan.className = 'task-title';
        titleSpan.textContent = task.title;

        leftDiv.appendChild(checkBtn);
        leftDiv.appendChild(titleSpan);

        const rightDiv = document.createElement('div');
        rightDiv.className = 'task-right';

        const badge = document.createElement('span');
        badge.className = 'task-badge';
        badge.textContent = `${task.completedPomos}/${task.estimatedPomos} 🍅`;

        const delBtn = document.createElement('button');
        delBtn.className = 'delete-task-btn';
        delBtn.innerHTML = '&times;';
        delBtn.title = 'Görevi Sil';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteTask(task.id);
        });

        rightDiv.appendChild(badge);
        rightDiv.appendChild(delBtn);

        li.appendChild(leftDiv);
        li.appendChild(rightDiv);

        li.addEventListener('click', () => {
            selectActiveTask(task.id);
        });

        taskList.appendChild(li);
    });

    updateDisplay();
}

function addTask(title, estimatedPomos) {
    const newTask = {
        id: Date.now().toString(),
        title: title.trim(),
        estimatedPomos: Math.max(1, parseInt(estimatedPomos, 10) || 1),
        completedPomos: 0,
        completed: false
    };
    tasks.push(newTask);
    if (!activeTaskId) {
        activeTaskId = newTask.id;
        saveToStorage('pomo_active_task', activeTaskId);
    }
    saveToStorage('pomo_tasks', tasks);
    renderTasks();
}

function toggleTaskCompleted(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    task.completed = !task.completed;
    saveToStorage('pomo_tasks', tasks);
    renderTasks();
}

function deleteTask(id) {
    tasks = tasks.filter(t => t.id !== id);
    if (activeTaskId === id) {
        const nextTask = tasks.find(t => !t.completed) || tasks[0];
        activeTaskId = nextTask ? nextTask.id : null;
        saveToStorage('pomo_active_task', activeTaskId);
    }
    saveToStorage('pomo_tasks', tasks);
    renderTasks();
}

function selectActiveTask(id) {
    activeTaskId = activeTaskId === id ? null : id;
    saveToStorage('pomo_active_task', activeTaskId);
    renderTasks();
}

// Event Listeners
startPauseBtn.addEventListener('click', () => {
    playClickSound();
    if (isRunning) {
        pauseTimer(false);
    } else {
        startTimer();
    }
});

resetBtn.addEventListener('click', () => {
    playClickSound();
    resetTimer();
});

skipBtn.addEventListener('click', () => {
    playClickSound();
    handleTimerComplete();
});

modeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const targetMode = tab.dataset.mode;
        if (targetMode !== currentMode) {
            playClickSound();
            switchMode(targetMode, false);
        }
    });
});

taskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!taskInput.value.trim()) return;
    addTask(taskInput.value, taskEstInput.value);
    taskInput.value = '';
    taskEstInput.value = '1';
});

clearCompletedBtn.addEventListener('click', () => {
    tasks = tasks.filter(t => !t.completed);
    if (!tasks.some(t => t.id === activeTaskId)) {
        activeTaskId = tasks[0] ? tasks[0].id : null;
        saveToStorage('pomo_active_task', activeTaskId);
    }
    saveToStorage('pomo_tasks', tasks);
    renderTasks();
});

soundToggleBtn.addEventListener('click', () => {
    settings.soundEnabled = !settings.soundEnabled;
    saveToStorage('pomo_settings', settings);
    updateSoundIcon();
    if (settings.soundEnabled) playClickSound();
});

// Ayarlar Modalı
settingsBtn.addEventListener('click', () => {
    pomodoroInput.value = settings.pomodoro;
    shortBreakInput.value = settings.shortBreak;
    longBreakInput.value = settings.longBreak;
    longBreakIntervalInput.value = settings.longBreakInterval;
    autoStartBreaksInput.checked = settings.autoStartBreaks;
    autoStartPomodorosInput.checked = settings.autoStartPomodoros;
    settingsModal.classList.remove('hidden');
});

closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        settingsModal.classList.add('hidden');
    }
});

saveSettingsBtn.addEventListener('click', () => {
    settings.pomodoro = Math.min(120, Math.max(1, parseInt(pomodoroInput.value, 10) || 25));
    settings.shortBreak = Math.min(60, Math.max(1, parseInt(shortBreakInput.value, 10) || 5));
    settings.longBreak = Math.min(90, Math.max(1, parseInt(longBreakInput.value, 10) || 15));
    settings.longBreakInterval = Math.min(12, Math.max(2, parseInt(longBreakIntervalInput.value, 10) || 4));
    settings.autoStartBreaks = autoStartBreaksInput.checked;
    settings.autoStartPomodoros = autoStartPomodorosInput.checked;

    saveToStorage('pomo_settings', settings);
    settingsModal.classList.add('hidden');

    if (!isRunning) {
        totalSeconds = settings[currentMode] * 60;
        remainingSeconds = totalSeconds;
        updateDisplay();
    }
});

// Klavye Kısayolları
document.addEventListener('keydown', (e) => {
    const tag = document.activeElement.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || !settingsModal.classList.contains('hidden')) {
        if (e.key === 'Escape' && !settingsModal.classList.contains('hidden')) {
            settingsModal.classList.add('hidden');
        }
        return;
    }

    if (e.code === 'Space') {
        e.preventDefault();
        playClickSound();
        if (isRunning) pauseTimer(false);
        else startTimer();
    } else if (e.key.toLowerCase() === 'r') {
        playClickSound();
        resetTimer();
    }
});

// Başlangıç
updateSoundIcon();
updateStatsUI();
renderTasks();
updateDisplay();
