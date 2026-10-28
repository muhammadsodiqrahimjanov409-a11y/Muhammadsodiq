export type PlayerRole = 'player1' | 'player2';

export type RoomStatus = 'WAITING' | 'PLAYING' | 'PAUSED' | 'GAME_OVER';

export type ObstacleKind = 'wall' | 'crate' | 'machinery' | 'bunker';

export interface Obstacle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: ObstacleKind;
}

export interface PlayerInput {
  forward: boolean;
  backward: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  fire: boolean;
  /** Optional target angle in radians from mobile virtual joystick */
  joystickAngle?: number | null;
  /** Optional magnitude [0..1] from mobile virtual joystick */
  joystickMagnitude?: number;
}

export interface TankState {
  role: PlayerRole;
  name: string;
  color: 'red' | 'blue';
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  connected: boolean;
  lastShotAt: number;
  moving: boolean;
  recoil: number;
  hitFlash: number;
}

export interface BulletState {
  id: string;
  owner: PlayerRole;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  createdAt: number;
}

export type GameEventType = 'shot' | 'wall_hit' | 'tank_hit' | 'explosion';

export interface GameVisualEvent {
  id: string;
  type: GameEventType;
  x: number;
  y: number;
  angle?: number;
  color?: 'red' | 'blue' | 'spark';
}

export interface RoomStateSnapshot {
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
  players: {
    player1: TankState | null;
    player2: TankState | null;
  };
  bullets: BulletState[];
  events: GameVisualEvent[];
  serverTime: number;
}

export interface CreateRoomPayload {
  roomId: string;
  hostAccessCode: string;
  playerName: string;
  sessionToken: string;
}

export interface JoinRoomPayload {
  roomId: string;
  guestAccessCode: string;
  playerName: string;
  sessionToken: string;
}

export interface ReconnectRoomPayload {
  roomId: string;
  role: PlayerRole;
  sessionToken: string;
}

export interface RoomAuthResponse {
  ok: boolean;
  error?: string;
  code?: 'ROOM_EXISTS' | 'ROOM_NOT_FOUND' | 'ROOM_FULL' | 'INVALID_CODE' | 'INVALID_INPUT';
  role?: PlayerRole;
  roomId?: string;
  sessionToken?: string;
  state?: RoomStateSnapshot;
}
