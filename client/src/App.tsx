import React, { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";

interface Player {
  id: string;
  username: string;
  rank: string;
  agent: string;
  x: number;
  y: number;
  direction: "left" | "right";
  state: "stand" | "walk" | "run" | "sit";
}

const RANKS = [
  "Iron",
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Diamond",
  "Ascendant",
  "Immortal",
  "Radiant",
];

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [selectedRank, setSelectedRank] = useState("Radiant");
  const [selectedAgent, setSelectedAgent] = useState<"jett" | "phoenix">("jett");
  const [socket, setSocket] = useState<Socket | null>(null);
  const [playersList, setPlayersList] = useState<Player[]>([]);
  const [localPlayer, setLocalPlayer] = useState<Player | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playersListRef = useRef<Player[]>([]);

  // Keep ref up to date for the canvas loop to access the latest players list without closure stale state
  useEffect(() => {
    playersListRef.current = playersList;
  }, [playersList]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    // Connect to server
    const serverUrl = import.meta.env.VITE_SERVER_URL || 
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
        ? 'http://localhost:3001' 
        : `http://${window.location.hostname}:3001`);
    const newSocket = io(serverUrl);

    newSocket.on("connect", () => {
      console.log("Connected to server");
      newSocket.emit("join_lobby", {
        username: username,
        rank: selectedRank,
        agent: selectedAgent,
      });
    });

    newSocket.on(
      "lobby_joined",
      (data: { self: Player; players: Player[] }) => {
        setLocalPlayer(data.self);
        setPlayersList(data.players);
        setIsLoggedIn(true);
        setSocket(newSocket);
      },
    );

    newSocket.on("player_joined", (player: Player) => {
      setPlayersList((prev) => [...prev, player]);
    });

    newSocket.on("player_moved", (updatedPlayer: Player) => {
      setPlayersList((prev) =>
        prev.map((p) => (p.id === updatedPlayer.id ? updatedPlayer : p)),
      );
    });

    newSocket.on("player_left", (id: string) => {
      setPlayersList((prev) => prev.filter((p) => p.id !== id));
    });

    newSocket.on("disconnect", () => {
      setIsLoggedIn(false);
      setLocalPlayer(null);
    });
  };



  // Game canvas loop
  useEffect(() => {
    if (!isLoggedIn || !localPlayer || !canvasRef.current || !socket) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 1280;
    canvas.height = 720;

    // Loading background map
    const bgImage = new Image();
    bgImage.src = "/map/ascent.jpg";

    // Loading Jett & Phoenix sprites
    const sprites: Record<string, Record<string, HTMLImageElement>> = {
      jett: {},
      phoenix: {}
    };
    const agents = ["jett", "phoenix"];
    const states = ["stand", "walk", "run", "sit"];

    agents.forEach((agent) => {
      states.forEach((state) => {
        const img = new Image();
        img.src = `/assets/${agent}/${agent}-${state}.png`;
        sprites[agent][state] = img;
      });
    });



    // Local player state
    let px = localPlayer.x;
    let py = localPlayer.y;
    let pvy = 0;
    let pdir = localPlayer.direction;
    let pstate = localPlayer.state;
    const gravity = 0.4;
    const groundY = 465; // feet position (even higher up in 720px height)
    const spriteSize = 90; // draw size (square ratio)

    // Track keyboard keys
    const keys: Record<string, boolean> = {};

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keys[key] = true;

      // Prevent scrolling / default actions for space, arrows, control
      if (
        [
          "arrowup",
          "arrowdown",
          "arrowleft",
          "arrowright",
          " ",
          "control",
        ].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keys[key] = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // Frame loops
    let animationId: number;
    let lastSentState = { x: px, y: py, direction: pdir, state: pstate };

    const updateGame = () => {
      // 1. Calculate physics and controls
      let horizontalSpeed = 0;
      let nextState: Player["state"] = "stand";

      if (keys["control"]) {
        nextState = "sit";
      } else {
        const leftPressed = keys["a"] || keys["arrowleft"];
        const rightPressed = keys["d"] || keys["arrowright"];

        if (leftPressed || rightPressed) {
          pdir = leftPressed ? "left" : "right";

          // Calculate speed dynamically based on selected rank index (Iron = 0, Radiant = 8)
          const rankIndex = RANKS.indexOf(selectedRank);
          const rankIdx = rankIndex >= 0 ? rankIndex : 0;
          
          const baseWalkSpeed = 1.5;
          const baseRunSpeed = 3.5;
          const walkSpeed = baseWalkSpeed + rankIdx * 0.35;
          const runSpeed = baseRunSpeed + rankIdx * 0.65;

          if (keys["shift"]) {
            horizontalSpeed = walkSpeed;
            nextState = "walk";
          } else {
            horizontalSpeed = runSpeed;
            nextState = "run";
          }

          if (leftPressed) {
            px -= horizontalSpeed;
          } else {
            px += horizontalSpeed;
          }
        }
      }

      // Bound checking
      if (px < 30) px = 30;
      if (px > canvas.width - 30) px = canvas.width - 30;

      pstate = nextState;

      // Gravity and falling logic
      if (py < groundY) {
        pvy += gravity;
        py += pvy;

        // Spawn/Falling animation state
        if (py >= groundY) {
          py = groundY;
          pvy = 0;
        }
      } else {
        py = groundY;
        pvy = 0;
      }

      // 2. Network synchronization
      if (
        px !== lastSentState.x ||
        py !== lastSentState.y ||
        pdir !== lastSentState.direction ||
        pstate !== lastSentState.state
      ) {
        socket.emit("player_move", {
          x: Math.round(px),
          y: Math.round(py),
          direction: pdir,
          state: pstate,
        });

        lastSentState = { x: px, y: py, direction: pdir, state: pstate };
      }

      // 3. Render Background & Scene
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (bgImage.complete) {
        ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = "#080c10";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // 4. Draw Other Players
      const currentOthers = playersListRef.current;
      currentOthers.forEach((p) => {
        drawPlayerSprite(ctx, p, sprites, spriteSize);
      });

      // 5. Draw Local Player
      const selfPlayer: Player = {
        id: socket.id || "me",
        username: username,
        rank: selectedRank,
        agent: selectedAgent,
        x: px,
        y: py,
        direction: pdir,
        state: pstate,
      };
      drawPlayerSprite(ctx, selfPlayer, sprites, spriteSize, true);

      animationId = requestAnimationFrame(updateGame);
    };

    animationId = requestAnimationFrame(updateGame);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      cancelAnimationFrame(animationId);
    };
  }, [isLoggedIn, localPlayer, socket]);

  // Helper method to draw sprites
  const drawPlayerSprite = (
    ctx: CanvasRenderingContext2D,
    player: Player,
    sprites: Record<string, Record<string, HTMLImageElement>>,
    size: number,
    isLocal: boolean = false,
  ) => {
    const sprite = sprites[player.agent]?.[player.state];
    if (!sprite || !sprite.complete) return;

    ctx.save();

    // Horizontal offset adjustment so flip happens around center
    const x = player.x;
    const y = player.y;

    if (player.direction === "left") {
      ctx.translate(x, y);
      ctx.scale(-1, 1);
      ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
    } else {
      ctx.translate(x, y);
      ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
    }

    ctx.restore();

    // Render username tag
    ctx.save();
    ctx.textAlign = "center";

    // Draw username immediately above head
    ctx.font = 'bold 13px "Outfit", sans-serif';
    ctx.fillStyle = isLocal ? "#00f0ff" : "#ffffff";
    ctx.fillText(player.username, x, y - size / 2 - 8);

    ctx.restore();
  };

  return (
    <div className="app-container">
      {!isLoggedIn ? (
        <>
          <div className="title-container">
            <h1 className="main-title">
              VALORANT <span>8-BIT</span>
            </h1>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <div
                  className={`rank-option ${selectedAgent === 'jett' ? 'active' : ''}`}
                  onClick={() => setSelectedAgent('jett')}
                  style={{ flexDirection: 'row', gap: '12px', padding: '12px', justifyContent: 'flex-start' }}
                >
                  <img
                    src="/assets/jett/jett-stand.png"
                    alt="Jett"
                    style={{ width: '40px', height: '40px', objectFit: 'contain', imageRendering: 'pixelated', borderRadius: '4px' }}
                  />
                  <div style={{ textAlign: 'left' }}>
                    <div className="agent-name" style={{ fontSize: '1rem', fontWeight: 800 }}>JETT</div>
                    <div style={{ fontSize: '0.75rem', color: '#8c8b88' }}>DUELIST</div>
                  </div>
                </div>

                <div
                  className={`rank-option ${selectedAgent === 'phoenix' ? 'active' : ''}`}
                  onClick={() => setSelectedAgent('phoenix')}
                  style={{ flexDirection: 'row', gap: '12px', padding: '12px', justifyContent: 'flex-start' }}
                >
                  <img
                    src="/assets/phoenix/phoenix-stand.png"
                    alt="Phoenix"
                    style={{ width: '40px', height: '40px', objectFit: 'contain', imageRendering: 'pixelated', borderRadius: '4px' }}
                  />
                  <div style={{ textAlign: 'left' }}>
                    <div className="agent-name" style={{ fontSize: '1rem', fontWeight: 800 }}>PHOENIX</div>
                    <div style={{ fontSize: '0.75rem', color: '#8c8b88' }}>DUELIST</div>
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
        <div className="lobby-view">
          <div className="canvas-wrapper">
            <canvas ref={canvasRef} className="game-canvas"></canvas>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
