const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
  res.send('Zizzl Server läuft! 🚀');
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const lobbies = {};

function generatePin() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

io.on('connection', (socket) => {
  console.log(`[+] Neuer Spieler: ${socket.id}`);

  socket.on('createLobby', ({ username }) => {
    let pin = generatePin();
    while (lobbies[pin]) pin = generatePin();

    lobbies[pin] = {
      host: socket.id,
      pin: pin,
      totalRounds: 5,
      currentRound: 0,
      selectedGames: ['snake'],
      players: [
        { id: socket.id, username: username || 'Host', score: 0, currentScore: 0, isHost: true }
      ]
    };

    socket.join(pin);
    socket.emit('lobbyCreated', {
      pin: pin,
      players: lobbies[pin].players,
      isHost: true
    });
  });

  socket.on('joinLobby', ({ pin, username }) => {
    const cleanPin = pin ? pin.toUpperCase().trim() : '';
    const lobby = lobbies[cleanPin];

    if (!lobby) {
      socket.emit('errorMsg', 'Lobby nicht gefunden!');
      return;
    }

    const newPlayer = {
      id: socket.id,
      username: username || 'Spieler',
      score: 0,
      currentScore: 0,
      isHost: false
    };

    lobby.players.push(newPlayer);
    socket.join(cleanPin);

    socket.emit('joinedLobby', {
      pin: cleanPin,
      players: lobby.players,
      isHost: false
    });

    io.to(cleanPin).emit('updatePlayers', lobby.players);
  });

  socket.on('updateSettings', ({ pin, rounds, selectedGames }) => {
    const lobby = lobbies[pin];
    if (lobby && lobby.host === socket.id) {
      lobby.totalRounds = parseInt(rounds, 10);
      lobby.selectedGames = selectedGames || ['snake'];
    }
  });

  socket.on('startGame', ({ pin }) => {
    const lobby = lobbies[pin];
    if (lobby && lobby.host === socket.id) {
      lobby.currentRound = 1;
      const gameToPlay = lobby.selectedGames[0] || 'snake';

      io.to(pin).emit('gameStarted', {
        round: lobby.currentRound,
        totalRounds: lobby.totalRounds,
        gameType: gameToPlay
      });
    }
  });

  socket.on('submitScore', ({ pin, score }) => {
    const lobby = lobbies[pin];
    if (!lobby) return;

    const player = lobby.players.find(p => p.id === socket.id);
    if (player) {
      player.currentScore = score;
      const leaderboard = [...lobby.players].sort((a, b) => (b.currentScore || 0) - (a.currentScore || 0));
      io.to(pin).emit('updateLeaderboard', leaderboard);
    }
  });

  socket.on('disconnect', () => {
    for (const pin in lobbies) {
      const lobby = lobbies[pin];
      const index = lobby.players.findIndex(p => p.id === socket.id);

      if (index !== -1) {
        lobby.players.splice(index, 1);
        if (lobby.players.length === 0) {
          delete lobbies[pin];
        } else {
          if (lobby.host === socket.id) {
            lobby.host = lobby.players[0].id;
            lobby.players[0].isHost = true;
          }
          io.to(pin).emit('updatePlayers', lobby.players);
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Zizzl Backend läuft auf Port ${PORT}`);
});
