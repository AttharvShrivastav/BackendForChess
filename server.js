const WebSocket = require('ws');

// Use an environment variable for the port or default to 8080 if not set
const PORT = process.env.PORT || 8080;

const wss = new WebSocket.Server({ port: PORT });

const clients = [];

let gameState = {
  board: Array(5).fill(null).map(() => Array(5).fill(null)),
  players: {},
  currentPlayer: null,
};

function initializeGame(playerAPieces, playerBPieces) {
  gameState = {
    board: Array(5).fill(null).map(() => Array(5).fill(null)),
    players: {
      'A': { pieces: playerAPieces, eliminated: [] },
      'B': { pieces: playerBPieces, eliminated: [] }
    },
    currentPlayer: 'A',
  };

  placePiecesOnBoard();
}

function placePiecesOnBoard() {
  for (const player in gameState.players) {
    gameState.players[player].pieces.forEach(piece => {
      const { x, y } = piece.position;
      gameState.board[y][x] = piece.id;
    });
  }
}

function broadcastGameState() {
  const message = JSON.stringify({ type: 'gameState', state: gameState });
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Function to move Player A's piece
function movePlayerAPiece(piece, move) {
  let { x, y } = piece.position;

  switch (piece.type) {
    case 'P': // Pawn moves 1 block
      switch (move) {
        case 'L': x -= 1; break;
        case 'R': x += 1; break;
        case 'F': y += 1; break; // Forward decreases y for Player A
        case 'B': y -= 1; break; // Backward increases y for Player A
        default: return null;
      }
      break;
    case 'H1': // Hero1 moves 2 blocks straight
      switch (move) {
        case 'L': x -= 2; break;
        case 'R': x += 2; break;
        case 'F': y += 2; break; // Forward decreases y by 2 for Player A
        case 'B': y -= 2; break; // Backward increases y by 2 for Player A
        default: return null;
      }
      break;
    case 'H2': // Hero2 moves 2 blocks diagonally
      switch (move) {
        case 'FL': x -= 2; y += 2; break; // Forward-Left decreases y for Player A
        case 'FR': x += 2; y += 2; break; // Forward-Right decreases y for Player A
        case 'BL': x -= 2; y -= 2; break; // Backward-Left increases y for Player A
        case 'BR': x += 2; y -= 2; break; // Backward-Right increases y for Player A
        default: return null;
      }
      break;
    default: return null;
  }

  return { x, y };
}

// Function to move Player B's piece
function movePlayerBPiece(piece, move) {
  let { x, y } = piece.position;

  switch (piece.type) {
    case 'P': // Pawn moves 1 block
      switch (move) {
        case 'L': x -= 1; break;
        case 'R': x += 1; break;
        case 'F': y -= 1; break; // Forward increases y for Player B
        case 'B': y += 1; break; // Backward decreases y for Player B
        default: return null;
      }
      break;
    case 'H1': // Hero1 moves 2 blocks straight
      switch (move) {
        case 'L': x -= 2; break;
        case 'R': x += 2; break;
        case 'F': y -= 2; break; // Forward increases y by 2 for Player B
        case 'B': y += 2; break; // Backward decreases y by 2 for Player B
        default: return null;
      }
      break;
    case 'H2': // Hero2 moves 2 blocks diagonally
      switch (move) {
        case 'FL': x -= 2; y -= 2; break; // Forward-Left increases y for Player B
        case 'FR': x += 2; y -= 2; break; // Forward-Right increases y for Player B
        case 'BL': x -= 2; y += 2; break; // Backward-Left decreases y for Player B
        case 'BR': x += 2; y += 2; break; // Backward-Right decreases y for Player B
        default: return null;
      }
      break;
    default: return null;
  }

  return { x, y };
}

// Function to process a player's move
function processMove(player, pieceId, move) {
  const piece = gameState.players[player].pieces.find(p => p.id === pieceId);
  if (!piece) return false; // Invalid piece

  const newPosition = player === 'A' ? movePlayerAPiece(piece, move) : movePlayerBPiece(piece, move);
  if (!newPosition) return false; // Invalid move

  const { x, y } = piece.position;
  const { x: newX, y: newY } = newPosition;

  // Check if the move is out of bounds
  if (!isPositionWithinBounds(newX, newY)) {
    return false;
  }

  // Handle captures and collisions
  if (!handleCapturesAndCollisions(player, piece, x, y, newX, newY)) {
    return false;
  }

  // Update the board
  gameState.board[y][x] = null; // Clear old position
  piece.position = { x: newX, y: newY }; // Update piece position
  gameState.board[newY][newX] = piece.id; // Set new position on the board

  // Check if the game is over after the move
  if (checkGameOver()) return false;

  return true;
}

// Function to check if a position is within the 5x5 grid bounds
function isPositionWithinBounds(x, y) {
  return x >= 0 && x < 5 && y >= 0 && y < 5;
}

// Function to handle captures and collisions
function handleCapturesAndCollisions(player, piece, x, y, newX, newY) {
  const opponentPlayer = player === 'A' ? 'B' : 'A';
  const path = calculatePath(x, y, newX, newY);

  for (const playerId in gameState.players) {
    const playerPieces = gameState.players[playerId].pieces;
    for (let i = 0; i < playerPieces.length; i++) {
      const p = playerPieces[i];

      if (p.position.x === newX && p.position.y === newY) {
        if (playerId === player) return false; // Prevent friendly fire
        playerPieces.splice(i, 1); // Capture opponent's piece
        break;
      }

      // Check if Hero1 or Hero2 kills pieces in the path
      if ((piece.type === 'H1' || piece.type === 'H2') && path.some(pos => pos.x === p.position.x && pos.y === p.position.y)) {
        if (playerId === opponentPlayer) {
          playerPieces.splice(i, 1); // Capture opponent's piece in path
          i--; // Re-check current index due to splice
        } else {
          return false; // Hero cannot move through friendly pieces
        }
      }
    }
  }

  return true;
}

// Function to calculate the path of movement
function calculatePath(x, y, newX, newY) {
  const path = [];
  const dx = Math.sign(newX - x); // Direction X
  const dy = Math.sign(newY - y); // Direction Y
  let cx = x + dx;
  let cy = y + dy;

  while (cx !== newX || cy !== newY) {
    path.push({ x: cx, y: cy });
    cx += dx;
    cy += dy;
  }

  return path;
}

// Function to check if the game is over
function checkGameOver() {
  for (const player in gameState.players) {
    if (gameState.players[player].pieces.length === 0) {
      broadcastGameOver(player === 'A' ? 'B' : 'A'); // Opposite player wins
      return true;
    }
  }
  return false;
}

// Function to broadcast the game over message
function broadcastGameOver(winner) {
  const message = JSON.stringify({ type: 'gameOver', winner });
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// WebSocket server connection event
wss.on('connection', (ws) => {
  clients.push(ws);
  console.log('New client connected');

  // Listen for messages from the client
  ws.on('message', (message) => {
    const { type, data } = JSON.parse(message);
    console.log('Received message:', type, data);

    if (type === 'initialize') {
      initializeGame(data.playerA, data.playerB);
      broadcastGameState();
    } else if (type === 'move') {
      const { player, pieceId, move } = data;
      if (player === gameState.currentPlayer) {
        const validMove = processMove(player, pieceId, move);
        if (validMove) {
          gameState.currentPlayer = gameState.currentPlayer === 'A' ? 'B' : 'A';
          broadcastGameState();
        } else {
          ws.send(JSON.stringify({ type: 'invalidMove' }));
        }
      } else {
        ws.send(JSON.stringify({ type: 'outOfTurn' }));
      }
    }
  });

  // Handle client disconnection
  ws.on('close', () => {
    console.log('Client disconnected');
    const index = clients.indexOf(ws);
    if (index !== -1) {
      clients.splice(index, 1);
    }
  });
});

console.log(`WebSocket server is running on ws://localhost:${PORT}`);
