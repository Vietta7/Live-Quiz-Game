const { players, games, sockets, genId, genCode } = require('./store');
const { send, broadcast } = require('./utils');

const socketToPlayer = new Map();
const playerPasswords = new Map();

function handleMessage(ws, socketId, msg) {
  const { type, data } = msg;
  switch (type) {
    case 'reg': return handleReg(ws, socketId, data);
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
    const [idx, p] = existing;
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

function handleDisconnect(socketId) {
}

module.exports = { handleMessage, handleDisconnect, socketToPlayer };