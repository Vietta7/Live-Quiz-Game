const WebSocket = require('ws');
const { sockets } = require('./store');
const { handleMessage } = require('./handlers');

let _nextSocketId = 1;

function startServer() {
  const PORT = process.env.PORT || 3000;
  const wss = new WebSocket.Server({ port: PORT });

  wss.on('listening', () => {
    console.log(`WebSocket server started at ws://localhost:${PORT}`);
  });

  wss.on('connection', (ws) => {
    const socketId = String(_nextSocketId++);
    sockets.set(socketId, ws);
    ws._socketId = socketId;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleMessage(ws, socketId, msg);
      } catch {
      }
    });

    ws.on('close', () => {
      const { handleDisconnect } = require('./handlers');
      handleDisconnect(socketId);
      sockets.delete(socketId);
    });
  });
}

module.exports = { startServer };