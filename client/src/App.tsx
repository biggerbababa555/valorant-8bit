import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface Player {
  id: string;
  username: string;
  rank: string;
  agent: string;
  x: number;
  y: number;
  direction: 'left' | 'right';
  state: 'stand' | 'walk' | 'run' | 'sit';
  hp: number;
  maxArmor: number;
  armor: number;
  isBlocking: boolean;
  isPunching: boolean;
  isDead: boolean;
}

const RANKS = [
  'Iron', 'Bronze', 'Silver', 
  'Gold', 'Platinum', 'Diamond', 
  'Ascendant', 'Immortal', 'Radiant'
];

interface PunchFX {
  x: number;
  y: number;
  direction: 'left' | 'right';
  age: number;
  maxAge: number;
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [selectedRank, setSelectedRank] = useState('Radiant');
  const [selectedAgent, setSelectedAgent] = useState<'jett' | 'phoenix' | 'omen'>('jett');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [playersList, setPlayersList] = useState<Player[]>([]);
  const [localPlayer, setLocalPlayer] = useState<Player | null>(null);
  const [respawnTimer, setRespawnTimer] = useState<number>(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playersListRef = useRef<Player[]>([]);
  const localPlayerRef = useRef<Player | null>(null);
  const punchEffectsRef = useRef<PunchFX[]>([]);

  // Keep refs up to date for the canvas loop to access latest lists without closure stale state
  useEffect(() => {
    playersListRef.current = playersList;
  }, [playersList]);

  useEffect(() => {
    localPlayerRef.current = localPlayer;
  }, [localPlayer]);

  // Respawn countdown timer
  useEffect(() => {
    if (respawnTimer <= 0) return;
    const interval = setInterval(() => {
      setRespawnTimer((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [respawnTimer]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    // Connect to server
    const serverUrl = import.meta.env.VITE_SERVER_URL || 
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
        ? 'http://localhost:3001' 
        : `http://${window.location.hostname}:3001`);
    const newSocket = io(serverUrl);

    newSocket.on('connect', () => {
      console.log('Connected to server');
      newSocket.emit('join_lobby', {
        username: username,
        rank: selectedRank,
        agent: selectedAgent
      });
    });

    newSocket.on('lobby_joined', (data: { self: Player; players: Player[] }) => {
      setLocalPlayer(data.self);
      setPlayersList(data.players);
      setIsLoggedIn(true);
      setSocket(newSocket);
    });

    newSocket.on('player_joined', (player: Player) => {
      setPlayersList((prev) => [...prev, player]);
    });

    newSocket.on('player_moved', (updatedPlayer: Player) => {
      setPlayersList((prev) =>
        prev.map((p) => (p.id === updatedPlayer.id ? { ...p, ...updatedPlayer } : p))
      );
    });

    // Handle online combat actions of other players
    newSocket.on('player_acted', (actedData: { id: string; action: string; direction: 'left' | 'right' }) => {
      const { id, action } = actedData;

      // Sync punch state for remote players to switch to attack sprite visually
      if (action === 'punch') {
        setPlayersList((prev) =>
          prev.map((p) => {
            if (p.id === id) {
              return { ...p, isPunching: true };
            }
            return p;
          })
        );
        // Reset punching state after 150ms
        setTimeout(() => {
          setPlayersList((prev) =>
            prev.map((p) => {
              if (p.id === id) {
                return { ...p, isPunching: false };
              }
              return p;
            })
          );
        }, 150);
      }

      // Sync block state locally for defense sprite drawing
      setPlayersList((prev) =>
        prev.map((p) => {
          if (p.id === id) {
            if (action === 'block') return { ...p, isBlocking: true };
            if (action === 'unblock') return { ...p, isBlocking: false };
          }
          return p;
        })
      );
    });

    // Update target player health/armor/death state
    newSocket.on('player_update', (updatedPlayer: Player) => {
      if (newSocket.id && updatedPlayer.id === newSocket.id) {
        setLocalPlayer((prev) => prev ? { ...prev, ...updatedPlayer } : null);
        if (updatedPlayer.isDead) {
          setRespawnTimer(10); // Start 10 seconds death screen
        }
      } else {
        setPlayersList((prev) =>
          prev.map((p) => (p.id === updatedPlayer.id ? { ...p, ...updatedPlayer } : p))
        );
      }
    });

    // Handle respawning and resetting stats
    newSocket.on('player_respawned', (respawnedPlayer: Player) => {
      if (newSocket.id && respawnedPlayer.id === newSocket.id) {
        setLocalPlayer(respawnedPlayer);
        setRespawnTimer(0); // clear death countdown
      } else {
        setPlayersList((prev) =>
          prev.map((p) => (p.id === respawnedPlayer.id ? respawnedPlayer : p))
        );
      }
    });

    newSocket.on('player_left', (id: string) => {
      setPlayersList((prev) => prev.filter((p) => p.id !== id));
    });

    newSocket.on('disconnect', () => {
      setIsLoggedIn(false);
      setLocalPlayer(null);
    });
  };

  // Game canvas loop
  useEffect(() => {
    if (!isLoggedIn || !localPlayer || !canvasRef.current || !socket) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 1280;
    canvas.height = 720;

    // Loading background map
    const bgImage = new Image();
    bgImage.src = '/map/ascent.jpg';

    // Loading Jett, Phoenix & Omen sprites
    const sprites: Record<string, Record<string, HTMLImageElement>> = {
      jett: {},
      phoenix: {},
      omen: {}
    };
    const agents = ["jett", "phoenix", "omen"];
    const states = ["stand", "walk", "run", "sit", "atk", "def"];

    agents.forEach((agent) => {
      states.forEach((state) => {
        // Phoenix and Omen do not have atk/def assets, skip loading them to prevent console 404 errors
        if ((state === 'atk' || state === 'def') && agent !== 'jett') {
          return;
        }
        const img = new Image();
        img.src = `/assets/${agent}/${agent}-${state}.png`;
        sprites[agent][state] = img;
      });
    });

    // Local player state - initialize from ref to prevent stale values and frequent useEffect restarts
    const initialPlayer = localPlayerRef.current || localPlayer;
    let px = initialPlayer.x;
    let py = initialPlayer.y;
    let pvy = 0;
    let pdir = localPlayer.direction;
    let pstate = localPlayer.state;
    let pBlocking = false;
    let pDead = false;
    let punchCooldown = 0;

    const gravity = 0.4;
    const groundY = 465; // feet position
    const spriteSize = 90; // draw size (square ratio)

    // Track keyboard keys
    const keys: Record<string, boolean> = {};

    const handleKeyDown = (e: KeyboardEvent) => {
      if (pDead) return; // ignore keys when dead

      const key = e.key.toLowerCase();
      keys[key] = true;

      // Block default browser shortcut combinations (e.g. crouch Ctrl + move right D triggers Ctrl+D)
      if (e.ctrlKey && key !== 'r') {
        e.preventDefault();
      }

      // Prevent scrolling / default actions for space, arrows, control, W
      if (
        [
          "arrowup",
          "arrowdown",
          "arrowleft",
          "arrowright",
          " ",
          "control",
          "w",
          "j",
          "k"
        ].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
      }

      // ATTACK TRIGGERS: Press J to attack/punch
      if (key === 'j' && punchCooldown <= 0 && !pBlocking) {
        punchCooldown = 18; // 18 frames attack cooldown
        socket.emit('player_action', { action: 'punch' });

        // Push local punch FX
        punchEffectsRef.current.push({
          x: px,
          y: py,
          direction: pdir,
          age: 0,
          maxAge: 8
        });

        // Attack hit check (Client side)
        // Diamond+ (index >= 5) deals 15 damage, below deals 10 damage
        const rankIndex = RANKS.indexOf(selectedRank);
        const damage = rankIndex >= 5 ? 15 : 10;

        const currentOthers = playersListRef.current;
        currentOthers.forEach((target) => {
          if (!target.isDead) {
            const xDist = Math.abs(px - target.x);
            const yDist = Math.abs(py - target.y);

            // Verify facing direction and close range hitbox (Distance <= 95px)
            const correctDirection = pdir === 'right' ? target.x >= px : target.x <= px;
            if (correctDirection && xDist <= 95 && yDist <= 50) {
              console.log(`[HIT] Emitting hit_register on target ${target.username} (dist: ${Math.round(xDist)}px, damage: ${damage})`);
              socket.emit('hit_register', {
                targetId: target.id,
                damage: damage
              });
            }
          }
        });
      }

      // BLOCK TRIGGERS: Hold K to block
      if (key === 'k' && !pBlocking) {
        pBlocking = true;
        socket.emit('player_action', { action: 'block' });
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keys[key] = false;

      // BLOCK TRIGGERS: Release K to unblock
      if (key === 'k') {
        pBlocking = false;
        socket.emit('player_action', { action: 'unblock' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Frame loops
    let animationId: number;
    let lastSentState = { x: px, y: py, direction: pdir, state: pstate };

    const updateGame = () => {
      // Access up-to-date localPlayer reactive values
      const currentLocal = localPlayerRef.current;
      pDead = currentLocal ? currentLocal.isDead : false;

      if (punchCooldown > 0) punchCooldown--;

      // 1. Calculate physics and controls (only if alive)
      let horizontalSpeed = 0;
      let nextState: Player['state'] = 'stand';

      // Double level platform configuration (Clean full-width steps)
      // Upper Level: Y = 275 (walkable across the entire map)
      // Base Ground: Y = 465
      const baseGroundY = groundY;
      const platformY = 275;
      let currentGroundY = baseGroundY;

      if (py <= platformY + 10) {
        currentGroundY = platformY;
      } else {
        currentGroundY = baseGroundY;
      }

      if (pDead) {
        nextState = 'sit'; // sits down when dead
        pBlocking = false;
      } else if (pBlocking) {
        nextState = 'sit'; // crouch visual when blocking
        horizontalSpeed = 0; // cannot walk when blocking
      } else {
        // Normal horizontal walking logic
        const leftPressed = keys['a'] || keys['arrowleft'];
        const rightPressed = keys['d'] || keys['arrowright'];

        if (leftPressed || rightPressed) {
          pdir = leftPressed ? 'left' : 'right';

          // Calculate speed dynamically based on selected rank index (Iron = 0, Radiant = 8)
          const rankIndex = RANKS.indexOf(selectedRank);
          const rankIdx = rankIndex >= 0 ? rankIndex : 0;
          
          const baseWalkSpeed = 1.5;
          const baseRunSpeed = 3.5;
          const walkSpeed = baseWalkSpeed + rankIdx * 0.35;
          const runSpeed = baseRunSpeed + rankIdx * 0.65;

          if (keys['shift']) {
            horizontalSpeed = walkSpeed;
            nextState = 'walk';
          } else {
            horizontalSpeed = runSpeed;
            nextState = 'run';
          }

          if (leftPressed) {
            px -= horizontalSpeed;
          } else {
            px += horizontalSpeed;
          }
        }

        // Drop Down: Pressing 'S' or 'ArrowDown' on upper floor
        const dropPressed = keys['s'] || keys['arrowdown'];
        if (py === platformY && dropPressed) {
          py = platformY + 15;
          currentGroundY = baseGroundY;
          pvy = 2;
        }

        // Automatic Step-up at far left (X <= 120) or far right (X >= 1160)
        if (py >= baseGroundY - 5 && py <= baseGroundY + 5) {
          const atLeftEdge = px <= 120;
          const atRightEdge = px >= 1160;
          if ((atLeftEdge || atRightEdge) && !dropPressed) {
            py = platformY;
            currentGroundY = platformY;
            pvy = 0;
          }
        }

        // Jump logic
        const jumpPressed = keys['w'] || keys['arrowup'] || keys[' '];
        const isGrounded = py === currentGroundY;
        if (jumpPressed && isGrounded && !dropPressed) {
          pvy = -11;
          py += pvy;
        }
      }

      // Bound checking
      if (px < 30) px = 30;
      if (px > canvas.width - 30) px = canvas.width - 30;

      pstate = nextState;

      // Gravity and falling logic
      if (py < currentGroundY) {
        pvy += gravity;
        py += pvy;

        if (py >= currentGroundY) {
          py = currentGroundY;
          pvy = 0;
        }
      } else {
        py = currentGroundY;
        pvy = 0;
      }

      // 2. Network synchronization
      if (
        !pDead && (
          px !== lastSentState.x ||
          py !== lastSentState.y ||
          pdir !== lastSentState.direction ||
          pstate !== lastSentState.state
        )
      ) {
        socket.emit('player_move', {
          x: Math.round(px),
          y: Math.round(py),
          direction: pdir,
          state: pstate
        });
        
        lastSentState = { x: px, y: py, direction: pdir, state: pstate };
      }

      // 3. Render Background & Scene
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (bgImage.complete) {
        ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = '#080c10';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // 4. Draw Other Players
      const currentOthers = playersListRef.current;
      currentOthers.forEach((p) => {
        drawPlayerSprite(ctx, p, sprites, spriteSize);
      });

      // 5. Draw Local Player
      const selfPlayer: Player = {
        id: socket.id || 'me',
        username: username,
        rank: selectedRank,
        agent: selectedAgent,
        x: px,
        y: py,
        direction: pdir,
        state: pstate,
        hp: currentLocal ? currentLocal.hp : 100,
        maxArmor: currentLocal ? currentLocal.maxArmor : 0,
        armor: currentLocal ? currentLocal.armor : 0,
        isBlocking: pBlocking,
        isPunching: punchCooldown > 12,
        isDead: pDead
      };
      drawPlayerSprite(ctx, selfPlayer, sprites, spriteSize, true);



      animationId = requestAnimationFrame(updateGame);
    };

    animationId = requestAnimationFrame(updateGame);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      cancelAnimationFrame(animationId);
    };
  }, [isLoggedIn, socket]);

  // Helper method to draw sprites & combat bars
  const drawPlayerSprite = (
    ctx: CanvasRenderingContext2D,
    player: Player,
    sprites: Record<string, Record<string, HTMLImageElement>>,
    size: number,
    isLocal: boolean = false,
  ) => {
    // Compute renderState with priority: dead -> block -> punch -> normal movement
    let renderState: string = player.state;
    if (player.isDead) {
      renderState = 'sit';
    } else if (player.isBlocking) {
      renderState = 'def';
    } else if (player.isPunching) {
      renderState = 'atk';
    }

    // If player is dead, draw them transparent/sitting
    if (player.isDead) {
      ctx.globalAlpha = 0.5;
    }

    let sprite = sprites[player.agent]?.[renderState];
    
    // Safe fallbacks for agents who do not have custom atk or def sprites (Phoenix & Omen) or if the image fails to load
    if (!sprite || !sprite.complete || sprite.naturalWidth === 0) {
      if (renderState === 'def') {
        sprite = sprites[player.agent]?.['sit']; // fallback to crouch (sit) for blocking
      } else if (renderState === 'atk') {
        sprite = sprites[player.agent]?.['stand']; // fallback to stand for punching
      }
    }

    if (sprite && sprite.complete) {
      ctx.save();
      const x = player.x;
      const y = player.y;

      if (player.direction === 'left') {
        ctx.translate(x, y);
        ctx.scale(-1, 1);
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
      } else {
        ctx.translate(x, y);
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
      }
      ctx.restore();
    }

    ctx.globalAlpha = 1.0; // reset alpha

    const x = player.x;
    const y = player.y;

    // Render username tag
    ctx.save();
    ctx.textAlign = 'center';
    
    // Draw username tag above the health/armor bars
    ctx.font = 'bold 13px "Outfit", sans-serif';
    ctx.fillStyle = isLocal ? '#00f0ff' : '#ffffff';
    ctx.fillText(player.username, x, y - size / 2 - 22);

    // Draw HP & Armor Status Bars (positioned under the username)
    if (!player.isDead) {
      const barWidth = 60;
      const barHeight = 5;
      const barX = x - barWidth / 2;
      const barY = y - size / 2 - 12;

      // 1. HP bar background and fill (Vibrant Green)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(barX, barY, barWidth, barHeight);

      const hpPct = Math.max(0, Math.min(1, player.hp / 100));
      ctx.fillStyle = '#39ff14'; // Solid green health bar
      ctx.fillRect(barX, barY, barWidth * hpPct, barHeight);

      // 2. Armor Bar (Only if player.maxArmor > 0) - Renders as a separate smaller bar below the HP bar in white color
      if (player.maxArmor > 0) {
        const armorBarHeight = 3;
        const armorBarY = barY + barHeight + 2;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(barX, armorBarY, barWidth, armorBarHeight);

        const armorPct = Math.max(0, Math.min(1, player.armor / player.maxArmor));
        ctx.fillStyle = '#ffffff'; // White armor bar
        ctx.fillRect(barX, armorBarY, barWidth * armorPct, armorBarHeight);
      }
    }
    
    ctx.restore();
  };

  return (
    <div className="app-container">
      {!isLoggedIn ? (
        <>
          <div className="title-container">
            <h1 className="main-title">VALORANT <span>8-BIT</span></h1>
            <div className="subtitle">MULTIPLAYER RETRO LOBBY</div>
          </div>

          <form className="login-card" onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">YOUR NICKNAME</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. TenZ"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={15}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">SELECT YOUR RANK</label>
              <div className="rank-select-grid">
                {RANKS.map((rank) => (
                  <div
                    key={rank}
                    className={`rank-option ${selectedRank === rank ? "active" : ""}`}
                    onClick={() => setSelectedRank(rank)}
                  >
                    <img
                      src={`/rank/${rank.toLowerCase()}.png`}
                      alt={rank}
                      style={{
                        width: "28px",
                        height: "28px",
                        imageRendering: "pixelated",
                        marginBottom: "4px",
                      }}
                    />
                    <div className="rank-name">{rank}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">SELECT YOUR AGENT</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                <div
                  className={`rank-option ${selectedAgent === 'jett' ? 'active' : ''}`}
                  onClick={() => setSelectedAgent('jett')}
                  style={{ flexDirection: 'row', gap: '8px', padding: '10px', justifyContent: 'flex-start' }}
                >
                  <img
                    src="/assets/jett/jett-stand.png"
                    alt="Jett"
                    style={{ width: '32px', height: '32px', objectFit: 'contain', imageRendering: 'pixelated', borderRadius: '4px' }}
                  />
                  <div style={{ textAlign: 'left' }}>
                    <div className="agent-name" style={{ fontSize: '0.85rem', fontWeight: 800 }}>JETT</div>
                    <div style={{ fontSize: '0.65rem', color: '#8c8b88' }}>DUELIST</div>
                  </div>
                </div>

                <div
                  className={`rank-option ${selectedAgent === 'phoenix' ? 'active' : ''}`}
                  onClick={() => setSelectedAgent('phoenix')}
                  style={{ flexDirection: 'row', gap: '8px', padding: '10px', justifyContent: 'flex-start' }}
                >
                  <img
                    src="/assets/phoenix/phoenix-stand.png"
                    alt="Phoenix"
                    style={{ width: '32px', height: '32px', objectFit: 'contain', imageRendering: 'pixelated', borderRadius: '4px' }}
                  />
                  <div style={{ textAlign: 'left' }}>
                    <div className="agent-name" style={{ fontSize: '0.85rem', fontWeight: 800 }}>PHOENIX</div>
                    <div style={{ fontSize: '0.65rem', color: '#8c8b88' }}>DUELIST</div>
                  </div>
                </div>

                <div
                  className={`rank-option ${selectedAgent === 'omen' ? 'active' : ''}`}
                  onClick={() => setSelectedAgent('omen')}
                  style={{ flexDirection: 'row', gap: '8px', padding: '10px', justifyContent: 'flex-start' }}
                >
                  <img
                    src="/assets/omen/omen-stand.png"
                    alt="Omen"
                    style={{ width: '32px', height: '32px', objectFit: 'contain', imageRendering: 'pixelated', borderRadius: '4px' }}
                  />
                  <div style={{ textAlign: 'left' }}>
                    <div className="agent-name" style={{ fontSize: '0.85rem', fontWeight: 800 }}>OMEN</div>
                    <div style={{ fontSize: '0.65rem', color: '#8c8b88' }}>CONTROLLER</div>
                  </div>
                </div>
              </div>
            </div>

            <button type="submit" className="btn-valorant">
              JOIN SERVER LOBBY
            </button>
          </form>
        </>
      ) : (
        <div className="lobby-view" style={{ position: 'relative' }}>
          {/* Immersive Death Overlay */}
          {localPlayer?.isDead && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              background: 'rgba(10, 12, 16, 0.88)',
              zIndex: 1000,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              backdropFilter: 'grayscale(100%) blur(5px)',
              WebkitBackdropFilter: 'grayscale(100%) blur(5px)'
            }}>
              <div style={{
                fontFamily: 'Silkscreen, monospace',
                fontSize: '3rem',
                fontWeight: 'bold',
                color: '#ff4655',
                textShadow: '0 0 15px rgba(255, 70, 85, 0.6)',
                letterSpacing: '2px',
                marginBottom: '16px'
              }}>
                YOU WERE DEFEATED
              </div>
              <div style={{
                fontFamily: 'Silkscreen, monospace',
                fontSize: '1.2rem',
                color: '#00f0ff',
                letterSpacing: '1px',
                textShadow: '0 0 8px rgba(0, 240, 255, 0.4)'
              }}>
                RESPAWNING IN <span style={{ fontSize: '2rem', color: '#fff', fontWeight: 'bold' }}>{respawnTimer}</span> SECONDS...
              </div>
            </div>
          )}

          <div className="canvas-wrapper">
            <canvas ref={canvasRef} className="game-canvas"></canvas>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
