const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Farb-Palette für bis zu 8 Spieler
const PLAYER_COLORS = [
  { id: "red", hex: "#ff4757", dark: "#2f3542", name: "Rot" },
  { id: "blue", hex: "#1e90ff", dark: "#0f4c81", name: "Blau" },
  { id: "green", hex: "#2ed573", dark: "#1e8449", name: "Grün" },
  { id: "yellow", hex: "#ffa502", dark: "#b77700", name: "Gelb" },
  { id: "purple", hex: "#5352ed", dark: "#3735a8", name: "Violett" },
  { id: "pink", hex: "#ff6b81", dark: "#b83b4e", name: "Rosa" },
  { id: "orange", hex: "#ff6348", dark: "#b33823", name: "Orange" },
  { id: "cyan", hex: "#70a1ff", dark: "#3b68ba", name: "Cyan" }
];

const lobbies = {};

function generatePin() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on("connection", (socket) => {
  console.log(`[VERBINDUNG] User verbunden: ${socket.id}`);

  // 1. Lobby erstellen (Host bekommt Farbe 0 = Rot)
  socket.on("createLobby", ({ username }) => {
    const pin = generatePin();
    const hostColor = PLAYER_COLORS[0];
    
    lobbies[pin] = {
      pin: pin,
      hostId: socket.id,
      currentRound: 0,
      totalRounds: 5,
      selectedGames: ["snake"],
      gameRunning: false,
      players: [
        {
          id: socket.id,
          username: username,
          score: 0,
          currentScore: 0,
          color: hostColor
        }
      ]
    };

    socket.join(pin);
    socket.emit("lobbyCreated", {
      pin: pin,
      players: lobbies[pin].players,
      isHost: true,
      myColor: hostColor
    });

    console.log(`[LOBBY] Lobby ${pin} von ${username} (${hostColor.name}) erstellt.`);
  });

  // 2. Lobby beitreten (Nächste freie Farbe zuteilen)
  socket.on("joinLobby", ({ pin, username }) => {
    const cleanPin = pin.trim().toUpperCase();
    const lobby = lobbies[cleanPin];

    if (!lobby) {
      return socket.emit("errorMsg", "Lobby nicht gefunden!");
    }

    if (lobby.gameRunning) {
      return socket.emit("errorMsg", "Das Spiel hat bereits begonnen!");
    }

    const playerExists = lobby.players.find(p => p.username === username);
    if (playerExists) {
      return socket.emit("errorMsg", "Dieser Name ist bereits vergeben!");
    }

    // Farbe nach Anzahl bisheriger Spieler vergeben
    const colorIndex = lobby.players.length % PLAYER_COLORS.length;
    const assignedColor = PLAYER_COLORS[colorIndex];

    const newPlayer = {
      id: socket.id,
      username: username,
      score: 0,
      currentScore: 0,
      color: assignedColor
    };

    lobby.players.push(newPlayer);
    socket.join(cleanPin);

    // Bestätigung an den neuen Spieler senden
    socket.emit("joinedLobby", {
      pin: cleanPin,
      players: lobby.players,
      myColor: assignedColor
    });

    // Update an alle Spieler
    io.to(cleanPin).emit("updatePlayers", lobby.players);
    console.log(`[LOBBY] ${username} (${assignedColor.name}) ist Lobby ${cleanPin} beigetreten.`);
  });

  // 3. Einstellungen
  socket.on("updateSettings", ({ pin, rounds, selectedGames }) => {
    const lobby = lobbies[pin];
    if (lobby && socket.id === lobby.hostId) {
      lobby.totalRounds = parseInt(rounds, 10) || 5;
      lobby.selectedGames = selectedGames && selectedGames.length > 0 ? selectedGames : ["snake"];
    }
  });

  // 4. Spiel starten
  socket.on("startGame", ({ pin }) => {
    const lobby = lobbies[pin];
    if (!lobby || socket.id !== lobby.hostId) return;

    startNextRound(pin);
  });

  // 5. Punkte-Übermittlung
  socket.on("submitScore", ({ pin, score }) => {
    const lobby = lobbies[pin];
    if (!lobby) return;

    const player = lobby.players.find(p => p.id === socket.id);
    if (player) {
      player.currentScore = score;
      
      const sortedLeaderboard = [...lobby.players].sort((a, b) => b.currentScore - a.currentScore);
      io.to(pin).emit("updateLeaderboard", sortedLeaderboard);
    }
  });

  // 6. Disconnect Handler
  socket.on("disconnect", () => {
    for (const pin in lobbies) {
      const lobby = lobbies[pin];
      const playerIndex = lobby.players.findIndex(p => p.id === socket.id);

      if (playerIndex !== -1) {
        const removedPlayer = lobby.players.splice(playerIndex, 1)[0];
        console.log(`[DISCONNECT] ${removedPlayer.username} hat Lobby ${pin} verlassen.`);

        if (lobby.players.length === 0) {
          delete lobbies[pin];
        } else {
          if (lobby.hostId === socket.id) {
            lobby.hostId = lobby.players[0].id;
            io.to(lobby.hostId).emit("becameHost");
          }
          io.to(pin).emit("updatePlayers", lobby.players);
        }
        break;
      }
    }
  });
});

function startNextRound(pin) {
  const lobby = lobbies[pin];
  if (!lobby) return;

  lobby.currentRound += 1;
  lobby.gameRunning = true;

  lobby.players.forEach(p => p.currentScore = 0);

  const gameIndex = (lobby.currentRound - 1) % lobby.selectedGames.length;
  const currentGame = lobby.selectedGames[gameIndex];

  io.to(pin).emit("gameStarted", {
    round: lobby.currentRound,
    totalRounds: lobby.totalRounds,
    gameType: currentGame
  });

  setTimeout(() => {
    if (lobbies[pin]) {
      lobby.players.forEach(p => {
        p.score += p.currentScore;
      });

      const sortedTotal = [...lobby.players].sort((a, b) => b.score - a.score);
      io.to(pin).emit("roundEnded", {
        round: lobby.currentRound,
        totalRounds: lobby.totalRounds,
        leaderboard: sortedTotal
      });

      lobby.gameRunning = false;
    }
  }, 32000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SERVER] Zizzl-Backend läuft auf Port ${PORT}`);
});
