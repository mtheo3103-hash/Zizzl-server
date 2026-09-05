const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// Healthcheck Route für Render
app.get('/', (req, res) => {
  res.send('Zizzl Server läuft! 🚀');
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Erlaubt Zugriff von deiner GitHub Pages Website
    methods: ["GET", "POST"]
  }
});

// Speicher für alle aktiven Lobbys
const lobbies = {};

// Generiert einen zufälligen 4-stelligen Game-PIN (z.B. Z8B2)
function generatePin() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Ohne verwirrende Zeichen wie 0/O oder 1/I
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

io.on('connection', (socket) => {
  console.log(`[+] Neuer Spieler verbunden: ${socket.id}`);

  // 1. LOBBY ERSTELLEN (HOST)
  socket.on('createLobby', ({ username }) => {
    let pin = generatePin();
    while (lobbies[pin]) {
      pin = generatePin(); // Stelle sicher, dass der PIN eindeutig ist
    }

    lobbies[pin] = {
      host: socket.id,
      pin: pin,
      totalRounds: 5,
      currentRound: 0,
      players: [
        { id: socket.id, username: username || 'Host', score: 0, isHost: true }
      ]
    };

    socket.join(pin);
    socket.emit('lobbyCreated', {
      pin: pin,
      players: lobbies[pin].players,
      isHost: true
    });

    console.log(`[LOBBY] Erstellt mit PIN ${pin} von ${username}`);
  });

  // 2. LOBBY BEITRETEN (SPIELER)
  socket.on('joinLobby', ({ pin, username }) => {
    const cleanPin = pin ? pin.toUpperCase().trim() : '';
    const lobby = lobbies[cleanPin];

    if (!lobby) {
      socket.emit('errorMsg', 'Lobby nicht gefunden! Bitte PIN prüfen.');
      return;
    }

    const newPlayer = {
      id: socket.id,
      username: username || 'Spieler',
      score: 0,
      isHost: false
    };

    lobby.players.push(newPlayer);
    socket.join(cleanPin);

    // Bestätigung an den neu beigetretenen Spieler
    socket.emit('joinedLobby', {
      pin: cleanPin,
      players: lobby.players,
      isHost: false
    });

    // Alle anderen in der Lobby benachrichtigen
    io.to(cleanPin).emit('updatePlayers', lobby.players);
    console.log(`[LOBBY] ${username} ist Lobby ${cleanPin} beigetreten`);
  });

  // 3. EINSTELLUNGEN ÄNDERN (HOST)
  socket.on('updateSettings', ({ pin, rounds }) => {
    const lobby = lobbies[pin];
    if (lobby && lobby.host === socket.id) {
      lobby.totalRounds = parseInt(rounds, 10);
      io.to(pin).emit('settingsUpdated', { totalRounds: lobby.totalRounds });
    }
  });

  // 4. SPIEL STARTEN (HOST)
  socket.on('startGame', ({ pin }) => {
    const lobby = lobbies[pin];
    if (lobby && lobby.host === socket.id) {
      lobby.currentRound = 1;
      io.to(pin).emit('gameStarted', {
        round: lobby.currentRound,
        totalRounds: lobby.totalRounds
      });
      console.log(`[GAME] Spiel in Lobby ${pin} gestartet!`);
    }
  });

  // 5. DISCONNECT HANDLER (Wenn jemand den Tab schließt)
  socket.on('disconnect', () => {
    console.log(`[-] Verbindung getrennt: ${socket.id}`);
    
    // Durchsuche alle Lobbys und entferne den Spieler
    for (const pin in lobbies) {
      const lobby = lobbies[pin];
      const playerIndex = lobby.players.findIndex(p => p.id === socket.id);

      if (playerIndex !== -1) {
        lobby.players.splice(playerIndex, 1);

        // Wenn die Lobby leer ist -> Löschen
        if (lobby.players.length === 0) {
          delete lobbies[pin];
          console.log(`[LOBBY] Lobby ${pin} gelöscht (keine Spieler mehr).`);
        } else {
          // Wenn der Host gegangen ist -> Neuen Host ernennen
          if (lobby.host === socket.id) {
            lobby.host = lobby.players[0].id;
            lobby.players[0].isHost = true;
            io.to(lobby.players[0].id).emit('youAreHost');
          }
          // Alle verbliebenen Spieler aktualisieren
          io.to(pin).emit('updatePlayers', lobby.players);
        }
        break;
      }
    }
  });
});

// Port für Render ( Render setzt automatisch process.env.PORT )
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Zizzl Backend läuft auf Port ${PORT}`);
});
