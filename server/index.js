import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

// Serve static assets or simple health check
app.get('/health', (req, res) => {
  res.send('Server is running healthy!');
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*', // Allow all origins for development
    methods: ['GET', 'POST']
  }
});

// Dictionary to store active players: { socketId: playerInfo }
const players = {};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Handle joining the lobby
  socket.on('join_lobby', (data) => {
    const { username, rank, agent } = data;
    
    // Spawn them at a random X coordinate on the screen (e.g. between 150 and 650)
    // Spawn Y is -150 so they fall from the sky (Gravity effect)
    const spawnX = Math.floor(Math.random() * 500) + 150;
    const spawnY = -150;

    players[socket.id] = {
      id: socket.id,
      username: username || 'Player',
      rank: rank || 'Iron 1',
      agent: agent || 'jett',
      x: spawnX,
      y: spawnY,
      direction: 'right',
      state: 'stand'
    };

    console.log(`Player ${players[socket.id].username} joined the lobby.`);

    // Send the joining player their own data and current players list
    socket.emit('lobby_joined', {
      self: players[socket.id],
      players: Object.values(players).filter(p => p.id !== socket.id)
    });

    // Broadcast to other players that a new player has joined
    socket.broadcast.emit('player_joined', players[socket.id]);
  });

  // Handle player movement and state changes
  socket.on('player_move', (movementData) => {
    const player = players[socket.id];
    if (player) {
      player.x = movementData.x;
      player.y = movementData.y;
      player.direction = movementData.direction;
      player.state = movementData.state;

      // Broadcast the updated movement to all other clients
      socket.broadcast.emit('player_moved', player);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    if (players[socket.id]) {
      const username = players[socket.id].username;
      delete players[socket.id];
      console.log(`Player ${username} left the lobby.`);
      
      // Notify other clients
      io.emit('player_left', socket.id);
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
