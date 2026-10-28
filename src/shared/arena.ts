import { Obstacle } from './types.ts';

export const ARENA_WIDTH = 1200;
export const ARENA_HEIGHT = 760;
export const WALL_THICKNESS = 28;

export const TANK_RADIUS = 24;
export const TANK_BODY_LENGTH = 50;
export const TANK_BODY_WIDTH = 40;
export const TANK_SPEED = 225; // pixels per second
export const TANK_REVERSE_SPEED = 155;
export const TANK_TURN_SPEED = 3.2; // radians per second

export const BULLET_SPEED = 620; // pixels per second
export const BULLET_RADIUS = 5;
export const BULLET_DAMAGE = 20;
export const TANK_MAX_HP = 100;
export const FIRE_COOLDOWN_MS = 400;

export const DEFAULT_HOST_ACCESS_CODE = '1234';
export const DEFAULT_GUEST_ACCESS_CODE = '5678';
export const DEFAULT_ROOM_ID = 'STEEL-01';

export const SPAWN_POINTS = {
  player1: {
    x: 130,
    y: ARENA_HEIGHT / 2,
    angle: 0, // facing right
  },
  player2: {
    x: ARENA_WIDTH - 130,
    y: ARENA_HEIGHT / 2,
    angle: Math.PI, // facing left
  },
} as const;

/**
 * Symmetrical industrial steel arena with perimeter hazard walls,
 * central dark steel corridor, tactical bunkers, metal crates, and machinery units.
 */
export const ARENA_OBSTACLES: Obstacle[] = [
  // Outer hazard-striped steel perimeter walls
  { id: 'wall-top', x: 0, y: 0, width: ARENA_WIDTH, height: WALL_THICKNESS, kind: 'wall' },
  { id: 'wall-bottom', x: 0, y: ARENA_HEIGHT - WALL_THICKNESS, width: ARENA_WIDTH, height: WALL_THICKNESS, kind: 'wall' },
  { id: 'wall-left', x: 0, y: WALL_THICKNESS, width: WALL_THICKNESS, height: ARENA_HEIGHT - WALL_THICKNESS * 2, kind: 'wall' },
  { id: 'wall-right', x: ARENA_WIDTH - WALL_THICKNESS, y: WALL_THICKNESS, width: WALL_THICKNESS, height: ARENA_HEIGHT - WALL_THICKNESS * 2, kind: 'wall' },

  // Spawn protective L-bunkers (Left & Right symmetrical)
  { id: 'bunker-left-v', x: 245, y: 290, width: 32, height: 180, kind: 'bunker' },
  { id: 'bunker-right-v', x: ARENA_WIDTH - 245 - 32, y: 290, width: 32, height: 180, kind: 'bunker' },

  // Upper & lower industrial machinery generators
  { id: 'machinery-tl', x: 350, y: 120, width: 110, height: 76, kind: 'machinery' },
  { id: 'machinery-bl', x: 350, y: ARENA_HEIGHT - 120 - 76, width: 110, height: 76, kind: 'machinery' },
  { id: 'machinery-tr', x: ARENA_WIDTH - 350 - 110, y: 120, width: 110, height: 76, kind: 'machinery' },
  { id: 'machinery-br', x: ARENA_WIDTH - 350 - 110, y: ARENA_HEIGHT - 120 - 76, width: 110, height: 76, kind: 'machinery' },

  // Central dark steel corridor flanking barriers & cover crates
  { id: 'center-bunker-top', x: 568, y: 165, width: 64, height: 125, kind: 'bunker' },
  { id: 'center-bunker-bottom', x: 568, y: ARENA_HEIGHT - 165 - 125, width: 64, height: 125, kind: 'bunker' },

  // Strategic reinforced steel crates
  { id: 'crate-mid-l1', x: 455, y: 348, width: 64, height: 64, kind: 'crate' },
  { id: 'crate-mid-r1', x: ARENA_WIDTH - 455 - 64, y: 348, width: 64, height: 64, kind: 'crate' },
  { id: 'crate-top-l', x: 185, y: 115, width: 58, height: 58, kind: 'crate' },
  { id: 'crate-bot-l', x: 185, y: ARENA_HEIGHT - 115 - 58, width: 58, height: 58, kind: 'crate' },
  { id: 'crate-top-r', x: ARENA_WIDTH - 185 - 58, y: 115, width: 58, height: 58, kind: 'crate' },
  { id: 'crate-bot-r', x: ARENA_WIDTH - 185 - 58, y: ARENA_HEIGHT - 115 - 58, width: 58, height: 58, kind: 'crate' },
];

/**
 * Resolves circle vs axis-aligned rectangle collision and returns push-out vector if overlapping.
 */
export function resolveCircleRectCollision(
  cx: number,
  cy: number,
  radius: number,
  rect: { x: number; y: number; width: number; height: number }
): { x: number; y: number; collided: boolean } {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.width));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.height));

  const dx = cx - closestX;
  const dy = cy - closestY;
  const distSq = dx * dx + dy * dy;

  if (distSq >= radius * radius) {
    return { x: cx, y: cy, collided: false };
  }

  const dist = Math.sqrt(distSq);
  if (dist === 0) {
    // Center is inside rectangle; push out along minimum penetration axis
    const leftPen = cx - rect.x;
    const rightPen = rect.x + rect.width - cx;
    const topPen = cy - rect.y;
    const bottomPen = rect.y + rect.height - cy;
    const minPen = Math.min(leftPen, rightPen, topPen, bottomPen);

    if (minPen === leftPen) return { x: rect.x - radius, y: cy, collided: true };
    if (minPen === rightPen) return { x: rect.x + rect.width + radius, y: cy, collided: true };
    if (minPen === topPen) return { x: cx, y: rect.y - radius, collided: true };
    return { x: cx, y: rect.y + rect.height + radius, collided: true };
  }

  const overlap = radius - dist;
  return {
    x: cx + (dx / dist) * overlap,
    y: cy + (dy / dist) * overlap,
    collided: true,
  };
}

export function circleIntersectsRect(
  cx: number,
  cy: number,
  radius: number,
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.width));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.height));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

export function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
