function send(ws, type, data) {
  ws.send(JSON.stringify({ type, data, id: 0 }));
}

function broadcast(wsSet, type, data) {
  const msg = JSON.stringify({ type, data, id: 0 });
  for (const ws of wsSet) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

module.exports = { send, broadcast };