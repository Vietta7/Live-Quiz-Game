const { players, games, sockets, genId, genCode } = require('./store');
const { send, broadcast } = require('./utils');

const socketToPlayer = new Map();
const playerPasswords = new Map();

function handleMessage(ws, socketId, msg) {
  const { type, data } = msg;
  switch (type) {
    case 'reg':         return handleReg(ws, socketId, data);
    case 'create_game': return handleCreateGame(ws, socketId, data);
    case 'join_game':   return handleJoinGame(ws, socketId, data);
    case 'start_game': return handleStartGame(ws, socketId, data);
    case 'answer':     return handleAnswer(ws, socketId, data);
    default: break;
  }
}

function handleReg(ws, socketId, data) {
  const { name, password } = data;

  let existing = null;
  for (const [idx, p] of players) {
    if (p.name === name) { existing = [idx, p]; break; }
  }

  if (existing) {
    const [idx] = existing;
    if (playerPasswords.get(idx) !== password) {
      return send(ws, 'reg', { name, index: '', error: true, errorText: 'Wrong password' });
    }
    socketToPlayer.set(socketId, idx);
    return send(ws, 'reg', { name, index: idx, error: false, errorText: '' });
  }

  const index = genId();
  players.set(index, { name, index, score: 0 });
  playerPasswords.set(index, password);
  socketToPlayer.set(socketId, index);
  send(ws, 'reg', { name, index, error: false, errorText: '' });
}

function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return false;
  for (const q of questions) {
    if (typeof q.text !== 'string') return false;
    if (!Array.isArray(q.options) || q.options.length !== 4) return false;
    if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex > 3) return false;
    if (typeof q.timeLimitSec !== 'number' || q.timeLimitSec <= 0) return false;
  }
  return true;
}

function handleCreateGame(ws, socketId, data) {
  const hostId = socketToPlayer.get(socketId);
  if (!hostId) return send(ws, 'error', { errorText: 'Not registered' });

  const { questions } = data;
  if (!validateQuestions(questions)) return send(ws, 'error', { errorText: 'Invalid questions' });

  const gameId = genId();
  let code = genCode();
  while ([...games.values()].some(g => g.code === code)) code = genCode();

  const game = {
    id: gameId,
    code,
    hostId,
    questions: questions.map(q => ({ ...q })),
    players: [],
    currentQuestion: -1,
    status: 'waiting',
    answers: [],
    timers: [],
    pausedAt: null,
    pauseTimeLeft: null,
  };
  games.set(gameId, game);

  send(ws, 'game_created', { gameId, code });
}

function getGameSockets(game) {
  const wsSet = new Set();
  for (const p of game.players) {
    for (const [sid, pid] of socketToPlayer) {
      if (pid === p.index) {
        const ws = sockets.get(sid);
        if (ws && ws.readyState === 1) wsSet.add(ws);
      }
    }
  }

  for (const [sid, pid] of socketToPlayer) {
    if (pid === game.hostId) {
      const ws = sockets.get(sid);
      if (ws && ws.readyState === 1) wsSet.add(ws);
    }
  }
  return wsSet;
}

function handleJoinGame(ws, socketId, data) {
  const playerIndex = socketToPlayer.get(socketId);
  if (!playerIndex) return send(ws, 'error', { errorText: 'Not registered' });

  const { code } = data;
  let game = null;
  for (const g of games.values()) {
    if (g.code === code) { game = g; break; }
  }

  if (!game) return send(ws, 'error', { errorText: 'Game not found' });
  if (game.status !== 'waiting') return send(ws, 'error', { errorText: 'Game already started' });

  const player = players.get(playerIndex);
  if (!game.players.find(p => p.index === playerIndex)) {
    game.players.push({ name: player.name, index: playerIndex, score: 0 });
  }

  send(ws, 'game_joined', { gameId: game.id });

  const allWs = getGameSockets(game);
  broadcast(allWs, 'player_joined', { playerName: player.name, playerCount: game.players.length });
  broadcast(allWs, 'update_players', game.players.map(p => ({ name: p.name, index: p.index, score: p.score })));
}

function sendQuestion(game, questionIndex) {
  const q = game.questions[questionIndex];
  game.currentQuestion = questionIndex;
  game.answers[questionIndex] = new Map();

  const allWs = getGameSockets(game);
  broadcast(allWs, 'question', {
    questionNumber: questionIndex + 1,
    totalQuestions: game.questions.length,
    text: q.text,
    options: q.options,
    timeLimitSec: q.timeLimitSec,
  });

  const timer = setTimeout(() => {
    resolveQuestion(game, questionIndex);
  }, q.timeLimitSec * 1000);

  game.timers[questionIndex] = { timer, startedAt: Date.now(), timeLimitSec: q.timeLimitSec };
}

function handleStartGame(ws, socketId, data) {
  const playerIndex = socketToPlayer.get(socketId);
  if (!playerIndex) return send(ws, 'error', { errorText: 'Not registered' });

  const { gameId } = data;
  const game = games.get(gameId);
  if (!game) return send(ws, 'error', { errorText: 'Game not found' });
  if (game.hostId !== playerIndex) return send(ws, 'error', { errorText: 'Only host can start' });
  if (game.status !== 'waiting') return send(ws, 'error', { errorText: 'Game already started' });

  game.status = 'in_progress';
  sendQuestion(game, 0);
}

function handleAnswer(ws, socketId, data) {
  const playerIndex = socketToPlayer.get(socketId);
  if (!playerIndex) return;

  const { gameId, questionIndex, answerIndex } = data;
  const game = games.get(gameId);
  if (!game || game.status !== 'in_progress') return;
  if (game.currentQuestion !== questionIndex) return;
  if (game.pausedAt !== null) return;

  const answersMap = game.answers[questionIndex];
  if (answersMap.has(playerIndex)) return;

  answersMap.set(playerIndex, { answerIndex, time: Date.now() });
  send(ws, 'answer_accepted', { questionIndex });

  const activePlayers = game.players.filter(p => p.index !== game.hostId);
  if (answersMap.size >= activePlayers.length) {
    const timerObj = game.timers[questionIndex];
    if (timerObj && timerObj.timer) {
      clearTimeout(timerObj.timer);
      timerObj.timer = null;
    }
    resolveQuestion(game, questionIndex);
  }
}

const BASE_POINTS = 1000;

function resolveQuestion(game, questionIndex) {
  if (game._resolving === questionIndex) return;
  game._resolving = questionIndex;

  const q = game.questions[questionIndex];
  const answersMap = game.answers[questionIndex] || new Map();
  const timerObj = game.timers[questionIndex];
  const questionStartedAt = timerObj ? timerObj.startedAt : Date.now();

  const playerResults = [];

  for (const p of game.players) {
    const ans = answersMap.get(p.index);
    let answered = false, correct = false, pointsEarned = 0;

    if (ans !== undefined) {
      answered = true;
      if (ans.answerIndex === q.correctIndex) {
        correct = true;
        const elapsed = (ans.time - questionStartedAt) / 1000;
        const timeRemaining = Math.max(0, q.timeLimitSec - elapsed);
        pointsEarned = Math.round(BASE_POINTS * (timeRemaining / q.timeLimitSec));
      }
    }

    p.score += pointsEarned;
    playerResults.push({ name: p.name, answered, correct, pointsEarned, totalScore: p.score });
  }

  const allWs = getGameSockets(game);
  broadcast(allWs, 'question_result', {
    questionIndex,
    correctIndex: q.correctIndex,
    playerResults,
  });

  const nextIndex = questionIndex + 1;
  if (nextIndex < game.questions.length) {
    setTimeout(() => sendQuestion(game, nextIndex), 2000);
  } else {
    game.status = 'finished';
    const sorted = [...game.players].sort((a, b) => b.score - a.score);
    let rank = 1;
    const scoreboard = sorted.map((p, i) => {
      if (i > 0 && sorted[i - 1].score !== p.score) rank = i + 1;
      return { name: p.name, score: p.score, rank };
    });
    setTimeout(() => broadcast(allWs, 'game_finished', { scoreboard }), 2000);
  }
}
module.exports = { handleMessage, handleDisconnect, socketToPlayer, getGameSockets, validateQuestions, sendQuestion, resolveQuestion};