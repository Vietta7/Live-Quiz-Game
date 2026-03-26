const players = new Map();
const games = new Map();
const sockets = new Map();

let nextPlayerId = 1;

function genId() { return String(nextPlayerId++); }

function genCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

module.exports = { players, games, sockets, genId, genCode };