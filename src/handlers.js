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

function handleDisconnect(socketId) {
}

module.exports = { handleMessage, handleDisconnect, socketToPlayer, getGameSockets, validateQuestions };