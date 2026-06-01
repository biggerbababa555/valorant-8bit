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

const RANKS = [
  "Iron", "Bronze", "Silver", "Gold", "Platinum",
  "Diamond", "Ascendant", "Immortal", "Radiant"
];

// Dictionary to store active players: { socketId: playerInfo }
const players = {};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Handle joining the lobby
  socket.on('join_lobby', (data) => {
    const { username, rank, agent } = data;
    
    // Spawn them at a random X coordinate on the screen (e.g. between 300 and 900)
    // Spawn Y is -150 so they fall from the sky (Gravity effect)
    const spawnX = Math.floor(Math.random() * 600) + 300;
    const spawnY = -150;

    // Calculate initial combat stats based on Rank index
    // Diamond (index 5) or above gets 150 Armor, lower get 0 Armor
    const cleanRank = rank || 'Radiant';
    const rankIdx = RANKS.indexOf(cleanRank.split(' ')[0]); // Get base rank name
    const maxArmor = rankIdx >= 5 ? 150 : 0;

    players[socket.id] = {
      id: socket.id,
      username: username || 'Player',
      rank: cleanRank,
      agent: agent || 'jett',
      x: spawnX,
      y: spawnY,
      direction: 'right',
      state: 'stand',
      hp: 100,
      maxArmor: maxArmor,
      armor: maxArmor,
      isBlocking: false,
      isPunching: false,
      isDead: false
    };

    console.log(`Player ${players[socket.id].username} (Rank: ${cleanRank}, Armor: ${maxArmor}) joined.`);

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
    if (player && !player.isDead) {
      player.x = movementData.x;
      player.y = movementData.y;
      player.direction = movementData.direction;
      player.state = movementData.state;

      // Broadcast the updated movement to all other clients
      socket.broadcast.emit('player_moved', player);
    }
  });

  // Handle player combat actions (punching, blocking, gales)
  socket.on('player_action', (actionData) => {
    const player = players[socket.id];
    if (player && !player.isDead) {
      const { action } = actionData; // 'punch' | 'block' | 'unblock'

      if (action === 'block') {
        player.isBlocking = true;
      } else if (action === 'unblock') {
        player.isBlocking = false;
      } else if (action === 'punch') {
        player.isPunching = true;
        // Reset punch state on server after short time
        setTimeout(() => {
          if (players[socket.id]) players[socket.id].isPunching = false;
        }, 150);
      }

      // Broadcast the action to other clients so they can render bubble shields or hits
      socket.broadcast.emit('player_acted', {
        id: socket.id,
        action: action,
        direction: player.direction
      });
    }
  });

  // Handle hit registrations and health/armor deductions
  socket.on('hit_register', (hitData) => {
    const attacker = players[socket.id];
    const target = players[hitData.targetId];

    if (attacker && target && !attacker.isDead && !target.isDead) {
      // Calculate final damage based on block status (Block reduces damage by 75%, meaning 25% passes through)
      let damage = hitData.damage;
      if (target.isBlocking) {
        damage = Math.ceil(damage * 0.25);
        console.log(`Damage blocked by 75%! Attacker: ${attacker.username}, Target: ${target.username}, Original: ${hitData.damage}, Reduced: ${damage}`);
      }

      // Damage distribution: 50% to armor, 50% to health to ensure health decreases when hit
      let hpDamage = damage;
      if (target.armor > 0) {
        const armorDamage = Math.ceil(damage * 0.5);
        hpDamage = damage - armorDamage;

        if (target.armor >= armorDamage) {
          target.armor -= armorDamage;
        } else {
          const remainder = armorDamage - target.armor;
          target.armor = 0;
          hpDamage += remainder;
        }
      }

      // Subtract health
      target.hp -= hpDamage;

      // Ensure stats stay within bounds
      if (target.hp <= 0) {
        target.hp = 0;
        target.isDead = true;
        target.state = 'sit'; // set sit state when dead
        console.log(`Player ${target.username} has been defeated by ${attacker.username}!`);

        // Trigger 10-second automatic respawn cooldown on the server
        setTimeout(() => {
          const respawnedPlayer = players[hitData.targetId];
          if (respawnedPlayer) {
            respawnedPlayer.hp = 100;
            respawnedPlayer.armor = respawnedPlayer.maxArmor;
            respawnedPlayer.isDead = false;
            respawnedPlayer.x = Math.floor(Math.random() * 600) + 300;
            respawnedPlayer.y = -150; // fall from sky spawn
            respawnedPlayer.direction = 'right';
            respawnedPlayer.state = 'stand';

            console.log(`Player ${respawnedPlayer.username} respawned.`);
            io.emit('player_respawned', respawnedPlayer);
          }
        }, 10000);
      }

      // Broadcast the updated target states to all connected players
      io.emit('player_update', target);
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
