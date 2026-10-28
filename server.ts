import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer, Socket } from 'socket.io';
import {
  ARENA_HEIGHT,
  ARENA_OBSTACLES,
  ARENA_WIDTH,
  BULLET_DAMAGE,
  BULLET_RADIUS,
  BULLET_SPEED,
  DEFAULT_GUEST_ACCESS_CODE,
  DEFAULT_HOST_ACCESS_CODE,
  FIRE_COOLDOWN_MS,
  SPAWN_POINTS,
  TANK_MAX_HP,
  TANK_RADIUS,
  TANK_REVERSE_SPEED,
  TANK_SPEED,
  TANK_TURN_SPEED,
  circleIntersectsRect,
  normalizeAngle,
  resolveCircleRectCollision,
} from './src/shared/arena.ts';
import {
  BulletState,
  CreateRoomPayload,
  GameVisualEvent,
  JoinRoomPayload,
  PlayerInput,
  PlayerRole,
  ReconnectRoomPayload,
  RoomAuthResponse,
  RoomStateSnapshot,
  RoomStatus,
  TankState,
} from './src/shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ServerPlayerSlot {
  role: PlayerRole;
  socketId: string | null;
  sessionToken: string;
  input: PlayerInput;
  tank: TankState;
  disconnectedAt: number | null;
}

interface GameRoom {
  roomId: string;
  hostCode: string;
  guestCode: string;
  status: RoomStatus;
  pausedBy: PlayerRole | null;
  winner: PlayerRole | null;
  scores: {
    player1: number;
    player2: number;
  };
  round: number;
  player1: ServerPlayerSlot | null;
  player2: ServerPlayerSlot | null;
  bullets: BulletState[];
  pendingEvents: GameVisualEvent[];
  createdAt: number;
  lastActivityAt: number;
}

const DEFAULT_INPUT: PlayerInput = {
  forward: false,
  backward: false,
  turnLeft: false,
  turnRight: false,
  fire: false,
  joystickAngle: null,
  joystickMagnitude: 0,
};

const rooms = new Map<string, GameRoom>();
const socketToRoom = new Map<string, { roomId: string; role: PlayerRole }>();

let bulletSeq = 1;
let eventSeq = 1;

function sanitizeRoomId(raw: string): string {
  return (raw || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);
}

function sanitizeName(raw: string, fallback: string): string {
  const cleaned = (raw || '').trim().slice(0, 18);
  return cleaned.length > 0 ? cleaned : fallback;
}

function createInitialTank(role: PlayerRole, name: string): TankState {
  const spawn = SPAWN_POINTS[role];
  return {
    role,
    name,
    color: role === 'player1' ? 'red' : 'blue',
    x: spawn.x,
    y: spawn.y,
    angle: spawn.angle,
    vx: 0,
    vy: 0,
    hp: TANK_MAX_HP,
    maxHp: TANK_MAX_HP,
    connected: true,
    lastShotAt: 0,
    moving: false,
    recoil: 0,
    hitFlash: 0,
  };
}

function resetRoundEntities(room: GameRoom): void {
  room.bullets = [];
  room.winner = null;
  room.pausedBy = null;
  if (room.player1) {
    room.player1.input = { ...DEFAULT_INPUT };
    const spawn1 = SPAWN_POINTS.player1;
    room.player1.tank.x = spawn1.x;
    room.player1.tank.y = spawn1.y;
    room.player1.tank.angle = spawn1.angle;
    room.player1.tank.vx = 0;
    room.player1.tank.vy = 0;
    room.player1.tank.hp = TANK_MAX_HP;
    room.player1.tank.moving = false;
    room.player1.tank.recoil = 0;
    room.player1.tank.hitFlash = 0;
    room.player1.tank.lastShotAt = 0;
  }
  if (room.player2) {
    room.player2.input = { ...DEFAULT_INPUT };
    const spawn2 = SPAWN_POINTS.player2;
    room.player2.tank.x = spawn2.x;
    room.player2.tank.y = spawn2.y;
    room.player2.tank.angle = spawn2.angle;
    room.player2.tank.vx = 0;
    room.player2.tank.vy = 0;
    room.player2.tank.hp = TANK_MAX_HP;
    room.player2.tank.moving = false;
    room.player2.tank.recoil = 0;
    room.player2.tank.hitFlash = 0;
    room.player2.tank.lastShotAt = 0;
  }
}

function buildSnapshot(room: GameRoom, flushEvents = false): RoomStateSnapshot {
  const events = flushEvents ? [...room.pendingEvents] : [];
  if (flushEvents) {
    room.pendingEvents = [];
  }
  return {
    roomId: room.roomId,
    hostCode: room.hostCode,
    guestCode: room.guestCode,
    status: room.status,
    pausedBy: room.pausedBy,
    winner: room.winner,
    scores: { ...room.scores },
    round: room.round,
    players: {
      player1: room.player1 ? { ...room.player1.tank } : null,
      player2: room.player2 ? { ...room.player2.tank } : null,
    },
    bullets: room.bullets.map((b) => ({ ...b })),
    events,
    serverTime: Date.now(),
  };
}

function pushEvent(room: GameRoom, evt: Omit<GameVisualEvent, 'id'>): void {
  room.pendingEvents.push({
    id: `ev-${eventSeq++}`,
    ...evt,
  });
}

function updateTankPhysics(room: GameRoom, slot: ServerPlayerSlot, dt: number, now: number): void {
  const tank = slot.tank;
  const input = slot.input;

  if (tank.hp <= 0 || !tank.connected) {
    tank.vx = 0;
    tank.vy = 0;
    tank.moving = false;
    return;
  }

  // Decay visual timers
  tank.recoil = Math.max(0, tank.recoil - dt * 4.5);
  tank.hitFlash = Math.max(0, tank.hitFlash - dt * 4.0);

  let moveSpeed = 0;

  if (
    typeof input.joystickAngle === 'number' &&
    typeof input.joystickMagnitude === 'number' &&
    input.joystickMagnitude > 0.14
  ) {
    // Smooth turret/hull turn toward mobile joystick vector
    const diff = normalizeAngle(input.joystickAngle - tank.angle);
    const maxStep = TANK_TURN_SPEED * 1.35 * dt;
    if (Math.abs(diff) <= maxStep) {
      tank.angle = input.joystickAngle;
    } else {
      tank.angle = normalizeAngle(tank.angle + Math.sign(diff) * maxStep);
    }
    const alignment = Math.max(0.25, Math.cos(diff));
    moveSpeed = TANK_SPEED * Math.min(1, input.joystickMagnitude) * alignment;
  } else {
    if (input.turnLeft) {
      tank.angle = normalizeAngle(tank.angle - TANK_TURN_SPEED * dt);
    }
    if (input.turnRight) {
      tank.angle = normalizeAngle(tank.angle + TANK_TURN_SPEED * dt);
    }
    if (input.forward) {
      moveSpeed += TANK_SPEED;
    }
    if (input.backward) {
      moveSpeed -= TANK_REVERSE_SPEED;
    }
  }

  tank.vx = Math.cos(tank.angle) * moveSpeed;
  tank.vy = Math.sin(tank.angle) * moveSpeed;
  tank.moving = Math.abs(moveSpeed) > 5 || input.turnLeft || input.turnRight;

  tank.x += tank.vx * dt;
  tank.y += tank.vy * dt;

  // Arena bounds guard
  tank.x = Math.max(TANK_RADIUS, Math.min(ARENA_WIDTH - TANK_RADIUS, tank.x));
  tank.y = Math.max(TANK_RADIUS, Math.min(ARENA_HEIGHT - TANK_RADIUS, tank.y));

  // Obstacle collisions
  for (const obs of ARENA_OBSTACLES) {
    const res = resolveCircleRectCollision(tank.x, tank.y, TANK_RADIUS, obs);
    if (res.collided) {
      tank.x = res.x;
      tank.y = res.y;
    }
  }

  // Firing logic with 400ms cooldown
  if (input.fire && now - tank.lastShotAt >= FIRE_COOLDOWN_MS) {
    tank.lastShotAt = now;
    tank.recoil = 1;
    const muzzleOffset = TANK_RADIUS + 14;
    const bx = tank.x + Math.cos(tank.angle) * muzzleOffset;
    const by = tank.y + Math.sin(tank.angle) * muzzleOffset;

    room.bullets.push({
      id: `b-${bulletSeq++}`,
      owner: slot.role,
      x: bx,
      y: by,
      vx: Math.cos(tank.angle) * BULLET_SPEED,
      vy: Math.sin(tank.angle) * BULLET_SPEED,
      angle: tank.angle,
      createdAt: now,
    });

    pushEvent(room, {
      type: 'shot',
      x: bx,
      y: by,
      angle: tank.angle,
      color: tank.color,
    });
  }
}

function resolveTankVsTankCollision(t1: TankState, t2: TankState): void {
  if (t1.hp <= 0 || t2.hp <= 0) return;
  const dx = t2.x - t1.x;
  const dy = t2.y - t1.y;
  const minDist = TANK_RADIUS * 2;
  const distSq = dx * dx + dy * dy;

  if (distSq > 0 && distSq < minDist * minDist) {
    const dist = Math.sqrt(distSq);
    const overlap = (minDist - dist) * 0.5;
    const nx = dx / dist;
    const ny = dy / dist;

    t1.x -= nx * overlap;
    t1.y -= ny * overlap;
    t2.x += nx * overlap;
    t2.y += ny * overlap;

    for (const obs of ARENA_OBSTACLES) {
      const r1 = resolveCircleRectCollision(t1.x, t1.y, TANK_RADIUS, obs);
      t1.x = r1.x;
      t1.y = r1.y;
      const r2 = resolveCircleRectCollision(t2.x, t2.y, TANK_RADIUS, obs);
      t2.x = r2.x;
      t2.y = r2.y;
    }
  }
}

function stepRoomSimulation(room: GameRoom, dt: number, now: number): void {
  if (room.status !== 'PLAYING') return;
  if (!room.player1 || !room.player2) return;

  updateTankPhysics(room, room.player1, dt, now);
  updateTankPhysics(room, room.player2, dt, now);

  resolveTankVsTankCollision(room.player1.tank, room.player2.tank);

  // Step bullets in 2 substeps for crisp high-speed collision accuracy
  const survivingBullets: BulletState[] = [];
  const subSteps = 2;
  const subDt = dt / subSteps;

  for (const bullet of room.bullets) {
    if (now - bullet.createdAt > 4000) continue;

    let destroyed = false;
    for (let s = 0; s < subSteps; s++) {
      bullet.x += bullet.vx * subDt;
      bullet.y += bullet.vy * subDt;

      // Check arena boundary
      if (
        bullet.x < 0 ||
        bullet.x > ARENA_WIDTH ||
        bullet.y < 0 ||
        bullet.y > ARENA_HEIGHT
      ) {
        pushEvent(room, {
          type: 'wall_hit',
          x: Math.max(0, Math.min(ARENA_WIDTH, bullet.x)),
          y: Math.max(0, Math.min(ARENA_HEIGHT, bullet.y)),
          angle: bullet.angle + Math.PI,
          color: 'spark',
        });
        destroyed = true;
        break;
      }

      // Check obstacles
      for (const obs of ARENA_OBSTACLES) {
        if (circleIntersectsRect(bullet.x, bullet.y, BULLET_RADIUS, obs)) {
          pushEvent(room, {
            type: 'wall_hit',
            x: bullet.x,
            y: bullet.y,
            angle: bullet.angle + Math.PI,
            color: 'spark',
          });
          destroyed = true;
          break;
        }
      }
      if (destroyed) break;

      // Check opposing tank hit
      const targetSlot = bullet.owner === 'player1' ? room.player2 : room.player1;
      if (targetSlot && targetSlot.tank.hp > 0) {
        const dx = bullet.x - targetSlot.tank.x;
        const dy = bullet.y - targetSlot.tank.y;
        const hitRadius = TANK_RADIUS + BULLET_RADIUS - 2;
        if (dx * dx + dy * dy <= hitRadius * hitRadius) {
          targetSlot.tank.hp = Math.max(0, targetSlot.tank.hp - BULLET_DAMAGE);
          targetSlot.tank.hitFlash = 1;

          // Subtle physical knockback on bullet hit
          targetSlot.tank.x += Math.cos(bullet.angle) * 4;
          targetSlot.tank.y += Math.sin(bullet.angle) * 4;
          for (const obs of ARENA_OBSTACLES) {
            const res = resolveCircleRectCollision(
              targetSlot.tank.x,
              targetSlot.tank.y,
              TANK_RADIUS,
              obs
            );
            targetSlot.tank.x = res.x;
            targetSlot.tank.y = res.y;
          }

          pushEvent(room, {
            type: 'tank_hit',
            x: bullet.x,
            y: bullet.y,
            angle: bullet.angle,
            color: targetSlot.tank.color,
          });

          if (targetSlot.tank.hp <= 0) {
            room.status = 'GAME_OVER';
            room.winner = bullet.owner;
            room.scores[bullet.owner] += 1;
            room.bullets = [];

            pushEvent(room, {
              type: 'explosion',
              x: targetSlot.tank.x,
              y: targetSlot.tank.y,
              color: targetSlot.tank.color,
            });
          }

          destroyed = true;
          break;
        }
      }
    }

    if (!destroyed && room.status === 'PLAYING') {
      survivingBullets.push(bullet);
    }
  }

  if (room.status === 'PLAYING') {
    room.bullets = survivingBullets;
  }
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    pingInterval: 10000,
    pingTimeout: 15000,
  });

  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      activeRooms: rooms.size,
      timestamp: Date.now(),
    });
  });

  app.get('/api/rooms/:roomId', (req, res) => {
    const roomId = sanitizeRoomId(req.params.roomId);
    const room = rooms.get(roomId);
    if (!room) {
      res.status(404).json({ exists: false });
      return;
    }
    const p1Active = Boolean(room.player1?.tank.connected);
    const p2Active = Boolean(room.player2?.tank.connected);
    res.json({
      exists: true,
      roomId: room.roomId,
      status: room.status,
      player1Connected: p1Active,
      player2Connected: p2Active,
      isFull: Boolean(room.player1 && room.player2 && p1Active && p2Active),
    });
  });

  io.on('connection', (socket: Socket) => {
    socket.on('room:create', (payload: CreateRoomPayload, ack?: (res: RoomAuthResponse) => void) => {
      const roomId = sanitizeRoomId(payload?.roomId);
      const hostAccessCode = (payload?.hostAccessCode || '').trim();
      const playerName = sanitizeName(payload?.playerName, 'RED COMMANDER');
      const sessionToken = (payload?.sessionToken || '').trim() || `tok-${socket.id}`;

      if (!roomId || roomId.length < 2) {
        ack?.({
          ok: false,
          code: 'INVALID_INPUT',
          error: 'Room ID kamida 2 ta belgidan iborat bo‘lishi kerak.',
        });
        return;
      }

      if (hostAccessCode !== DEFAULT_HOST_ACCESS_CODE) {
        ack?.({
          ok: false,
          code: 'INVALID_CODE',
          error: `Xona egasi kodi noto‘g‘ri! 1-o‘yinchi kirish kodi sifatida ${DEFAULT_HOST_ACCESS_CODE} ni kiriting.`,
        });
        return;
      }

      const existing = rooms.get(roomId);
      if (existing) {
        // Allow host with matching sessionToken to reclaim if disconnected, otherwise prevent collision
        if (existing.player1 && existing.player1.sessionToken === sessionToken) {
          existing.player1.socketId = socket.id;
          existing.player1.tank.connected = true;
          existing.player1.tank.name = playerName;
          existing.player1.disconnectedAt = null;
          existing.lastActivityAt = Date.now();
          socket.join(roomId);
          socketToRoom.set(socket.id, { roomId, role: 'player1' });
          const snapshot = buildSnapshot(existing, false);
          ack?.({
            ok: true,
            role: 'player1',
            roomId,
            sessionToken,
            state: snapshot,
          });
          io.to(roomId).emit('room:state', snapshot);
          return;
        }

        ack?.({
          ok: false,
          code: 'ROOM_EXISTS',
          error: `"${roomId}" IDli xona allaqachon mavjud. Boshqa Room ID tanlang yoki unga qo‘shiling.`,
        });
        return;
      }

      const now = Date.now();
      const newRoom: GameRoom = {
        roomId,
        hostCode: DEFAULT_HOST_ACCESS_CODE,
        guestCode: DEFAULT_GUEST_ACCESS_CODE,
        status: 'WAITING',
        pausedBy: null,
        winner: null,
        scores: { player1: 0, player2: 0 },
        round: 1,
        player1: {
          role: 'player1',
          socketId: socket.id,
          sessionToken,
          input: { ...DEFAULT_INPUT },
          tank: createInitialTank('player1', playerName),
          disconnectedAt: null,
        },
        player2: null,
        bullets: [],
        pendingEvents: [],
        createdAt: now,
        lastActivityAt: now,
      };

      rooms.set(roomId, newRoom);
      socket.join(roomId);
      socketToRoom.set(socket.id, { roomId, role: 'player1' });

      const snapshot = buildSnapshot(newRoom, false);
      ack?.({
        ok: true,
        role: 'player1',
        roomId,
        sessionToken,
        state: snapshot,
      });
      io.to(roomId).emit('room:state', snapshot);
    });

    socket.on('room:join', (payload: JoinRoomPayload, ack?: (res: RoomAuthResponse) => void) => {
      const roomId = sanitizeRoomId(payload?.roomId);
      const guestAccessCode = (payload?.guestAccessCode || '').trim();
      const playerName = sanitizeName(payload?.playerName, 'BLUE COMMANDER');
      const sessionToken = (payload?.sessionToken || '').trim() || `tok-${socket.id}`;

      if (!roomId) {
        ack?.({
          ok: false,
          code: 'INVALID_INPUT',
          error: 'Ulaniyotgan xonaning Room ID raqamini kiriting.',
        });
        return;
      }

      const room = rooms.get(roomId);
      if (!room) {
        ack?.({
          ok: false,
          code: 'ROOM_NOT_FOUND',
          error: `"${roomId}" xonasi topilmadi. 1-o‘yinchi avval CREATE ROOM qilganini tekshiring.`,
        });
        return;
      }

      if (guestAccessCode !== DEFAULT_GUEST_ACCESS_CODE) {
        ack?.({
          ok: false,
          code: 'INVALID_CODE',
          error:
            guestAccessCode === DEFAULT_HOST_ACCESS_CODE
              ? `1234 — bu xona egasi kodi. 2-o‘yinchi kirish kodi sifatida ${DEFAULT_GUEST_ACCESS_CODE} ni kiriting!`
              : `2-o‘yinchi kirish kodi noto‘g‘ri! Kirish paroli sifatida ${DEFAULT_GUEST_ACCESS_CODE} ni kiriting.`,
        });
        return;
      }

      // Check if room already has 2 active players and caller isn't reconnecting player2
      if (room.player2) {
        const isSamePlayer2 = room.player2.sessionToken === sessionToken;
        if (!isSamePlayer2 && room.player2.tank.connected) {
          ack?.({
            ok: false,
            code: 'ROOM_FULL',
            error: 'ROOM IS FULL — Bu xonada allaqachon 2 nafar faol o‘yinchi bor.',
          });
          return;
        }

        // Reclaiming disconnected player2 slot or same token
        room.player2.socketId = socket.id;
        room.player2.sessionToken = sessionToken;
        room.player2.tank.connected = true;
        room.player2.tank.name = playerName;
        room.player2.disconnectedAt = null;
      } else {
        room.player2 = {
          role: 'player2',
          socketId: socket.id,
          sessionToken,
          input: { ...DEFAULT_INPUT },
          tank: createInitialTank('player2', playerName),
          disconnectedAt: null,
        };
      }

      room.lastActivityAt = Date.now();
      socket.join(roomId);
      socketToRoom.set(socket.id, { roomId, role: 'player2' });

      const snapshot = buildSnapshot(room, false);
      ack?.({
        ok: true,
        role: 'player2',
        roomId,
        sessionToken,
        state: snapshot,
      });
      io.to(roomId).emit('room:state', snapshot);
    });

    socket.on('room:reconnect', (payload: ReconnectRoomPayload, ack?: (res: RoomAuthResponse) => void) => {
      const roomId = sanitizeRoomId(payload?.roomId);
      const role = payload?.role;
      const sessionToken = (payload?.sessionToken || '').trim();

      const room = rooms.get(roomId);
      if (!room || !sessionToken || (role !== 'player1' && role !== 'player2')) {
        ack?.({
          ok: false,
          code: 'ROOM_NOT_FOUND',
          error: 'Avvalgi xona topilmadi yoki muddati tugagan.',
        });
        return;
      }

      const slot = role === 'player1' ? room.player1 : room.player2;
      if (!slot || slot.sessionToken !== sessionToken) {
        ack?.({
          ok: false,
          code: 'INVALID_CODE',
          error: 'Sessiya tasdiqlanmadi.',
        });
        return;
      }

      slot.socketId = socket.id;
      slot.tank.connected = true;
      slot.disconnectedAt = null;
      room.lastActivityAt = Date.now();

      socket.join(roomId);
      socketToRoom.set(socket.id, { roomId, role });

      const snapshot = buildSnapshot(room, false);
      ack?.({
        ok: true,
        role,
        roomId,
        sessionToken,
        state: snapshot,
      });
      io.to(roomId).emit('room:state', snapshot);
    });

    socket.on('game:start', () => {
      const mapping = socketToRoom.get(socket.id);
      if (!mapping || mapping.role !== 'player1') return;

      const room = rooms.get(mapping.roomId);
      if (!room) return;
      if (!room.player1?.tank.connected || !room.player2?.tank.connected) return;
      if (room.status !== 'WAITING') return;

      resetRoundEntities(room);
      room.status = 'PLAYING';
      room.lastActivityAt = Date.now();
      io.to(room.roomId).emit('room:state', buildSnapshot(room, false));
    });

    socket.on('player:input', (rawInput: Partial<PlayerInput>) => {
      const mapping = socketToRoom.get(socket.id);
      if (!mapping) return;
      const room = rooms.get(mapping.roomId);
      if (!room) return;

      const slot = mapping.role === 'player1' ? room.player1 : room.player2;
      if (!slot) return;

      slot.input = {
        forward: Boolean(rawInput.forward),
        backward: Boolean(rawInput.backward),
        turnLeft: Boolean(rawInput.turnLeft),
        turnRight: Boolean(rawInput.turnRight),
        fire: Boolean(rawInput.fire),
        joystickAngle:
          typeof rawInput.joystickAngle === 'number' && Number.isFinite(rawInput.joystickAngle)
            ? rawInput.joystickAngle
            : null,
        joystickMagnitude:
          typeof rawInput.joystickMagnitude === 'number' && Number.isFinite(rawInput.joystickMagnitude)
            ? Math.max(0, Math.min(1, rawInput.joystickMagnitude))
            : 0,
      };
      room.lastActivityAt = Date.now();
    });

    socket.on('game:pause_toggle', () => {
      const mapping = socketToRoom.get(socket.id);
      if (!mapping) return;
      const room = rooms.get(mapping.roomId);
      if (!room) return;

      if (room.status === 'PLAYING') {
        room.status = 'PAUSED';
        room.pausedBy = mapping.role;
        if (room.player1) room.player1.input = { ...DEFAULT_INPUT };
        if (room.player2) room.player2.input = { ...DEFAULT_INPUT };
        io.to(room.roomId).emit('room:state', buildSnapshot(room, false));
      } else if (room.status === 'PAUSED') {
        room.status = 'PLAYING';
        room.pausedBy = null;
        io.to(room.roomId).emit('room:state', buildSnapshot(room, false));
      }
    });

    socket.on('game:restart', () => {
      const mapping = socketToRoom.get(socket.id);
      if (!mapping) return;
      const room = rooms.get(mapping.roomId);
      if (!room) return;
      if (!room.player1 || !room.player2) return;

      room.round += 1;
      resetRoundEntities(room);
      room.status = 'PLAYING';
      room.lastActivityAt = Date.now();
      io.to(room.roomId).emit('room:state', buildSnapshot(room, false));
    });

    socket.on('room:leave', () => {
      handleSocketLeave(socket, true);
    });

    socket.on('disconnect', () => {
      handleSocketLeave(socket, false);
    });

    function handleSocketLeave(sock: Socket, explicitLeave: boolean) {
      const mapping = socketToRoom.get(sock.id);
      if (!mapping) return;
      socketToRoom.delete(sock.id);
      sock.leave(mapping.roomId);

      const room = rooms.get(mapping.roomId);
      if (!room) return;

      const slot = mapping.role === 'player1' ? room.player1 : room.player2;
      if (slot && slot.socketId === sock.id) {
        slot.socketId = null;
        slot.tank.connected = false;
        slot.input = { ...DEFAULT_INPUT };
        slot.disconnectedAt = Date.now();

        if (explicitLeave) {
          if (mapping.role === 'player2') {
            room.player2 = null;
            if (room.status === 'PLAYING' || room.status === 'PAUSED') {
              room.status = 'WAITING';
              resetRoundEntities(room);
            }
          } else if (mapping.role === 'player1') {
            // Host explicitly left: close room and notify guest
            io.to(room.roomId).emit('room:closed', {
              reason: 'Xona egasi (1-o‘yinchi) xonani tark etdi.',
            });
            rooms.delete(room.roomId);
            return;
          }
        } else {
          // Temporary network drop: pause active match so player can reconnect seamlessly
          if (room.status === 'PLAYING') {
            room.status = 'PAUSED';
            room.pausedBy = mapping.role;
          }
        }
      }

      // Clean up completely empty room if both explicitly gone
      const p1Gone = !room.player1 || !room.player1.tank.connected;
      const p2Gone = !room.player2 || !room.player2.tank.connected;
      if (explicitLeave && p1Gone && p2Gone) {
        rooms.delete(room.roomId);
        return;
      }

      io.to(room.roomId).emit('room:state', buildSnapshot(room, false));
    }
  });

  // Authoritative 60Hz Physics Tick & 30Hz Network State Broadcast
  let lastTick = Date.now();
  let tickCount = 0;

  setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.05, (now - lastTick) / 1000);
    lastTick = now;
    tickCount++;

    for (const [roomId, room] of rooms.entries()) {
      // Garbage collect abandoned rooms after 15 minutes of both players offline
      const p1Online = Boolean(room.player1?.tank.connected);
      const p2Online = Boolean(room.player2?.tank.connected);
      if (!p1Online && !p2Online && now - room.lastActivityAt > 15 * 60 * 1000) {
        rooms.delete(roomId);
        continue;
      }

      if (room.status === 'PLAYING') {
        stepRoomSimulation(room, dt, now);
      }

      // Broadcast 30 times/sec while playing or immediately if visual events occurred
      if (
        (room.status === 'PLAYING' && tickCount % 2 === 0) ||
        room.pendingEvents.length > 0
      ) {
        io.to(roomId).emit('room:state', buildSnapshot(room, true));
      }
    }
  }, 1000 / 60);

  // Serve Vite dev middleware or built production SPA
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`STEEL TANKS Multiplayer Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start STEEL TANKS server:', err);
  process.exit(1);
});
