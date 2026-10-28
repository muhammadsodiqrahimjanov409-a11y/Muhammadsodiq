import React, { useEffect, useRef } from 'react';
import {
  ARENA_HEIGHT,
  ARENA_OBSTACLES,
  ARENA_WIDTH,
  BULLET_RADIUS,
  TANK_BODY_LENGTH,
  TANK_BODY_WIDTH,
  WALL_THICKNESS,
  normalizeAngle,
} from '../shared/arena.ts';
import { Obstacle, RoomStateSnapshot, TankState } from '../shared/types.ts';
import { soundEngine } from '../audio/soundEngine.ts';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  kind: 'spark' | 'smoke' | 'flash';
}

interface SkidMark {
  x: number;
  y: number;
  angle: number;
  alpha: number;
}

interface ArenaCanvasProps {
  roomState: RoomStateSnapshot;
}

export const ArenaCanvas: React.FC<ArenaCanvasProps> = ({ roomState }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestStateRef = useRef<RoomStateSnapshot>(roomState);
  const processedEventsRef = useRef<Set<string>>(new Set());
  const particlesRef = useRef<Particle[]>([]);
  const skidsRef = useRef<SkidMark[]>([]);

  // Smooth client-side visual interpolation buffers
  const renderTanksRef = useRef<{
    player1: { x: number; y: number; angle: number } | null;
    player2: { x: number; y: number; angle: number } | null;
  }>({ player1: null, player2: null });

  const shakeRef = useRef<number>(0);

  useEffect(() => {
    latestStateRef.current = roomState;

    // Trigger visual particles & audio for newly arrived server events
    for (const ev of roomState.events) {
      if (processedEventsRef.current.has(ev.id)) continue;
      processedEventsRef.current.add(ev.id);
      if (processedEventsRef.current.size > 400) {
        const first = processedEventsRef.current.values().next().value;
        if (first) processedEventsRef.current.delete(first);
      }

      if (ev.type === 'shot') {
        soundEngine.playCannonShot();
        spawnShotParticles(particlesRef.current, ev.x, ev.y, ev.angle ?? 0);
        shakeRef.current = Math.max(shakeRef.current, 2.5);
      } else if (ev.type === 'wall_hit') {
        soundEngine.playMetalImpact();
        spawnMetalSparks(particlesRef.current, ev.x, ev.y, ev.angle ?? 0);
      } else if (ev.type === 'tank_hit') {
        soundEngine.playArmorHit();
        spawnArmorImpact(particlesRef.current, ev.x, ev.y, ev.color === 'red' ? '#ef4444' : '#3b82f6');
        shakeRef.current = Math.max(shakeRef.current, 6);
      } else if (ev.type === 'explosion') {
        soundEngine.playExplosion();
        spawnExplosion(particlesRef.current, ev.x, ev.y);
        shakeRef.current = 13;
      }
    }
  }, [roomState]);

  useEffect(() => {
    // Pre-render static industrial steel arena floor, dark central corridor, and obstacles once
    const offscreen = document.createElement('canvas');
    offscreen.width = ARENA_WIDTH;
    offscreen.height = ARENA_HEIGHT;
    const octx = offscreen.getContext('2d');
    if (octx) {
      renderStaticArena(octx);
    }
    bgCanvasRef.current = offscreen;

    let animId = 0;
    let lastFrame = performance.now();
    let skidTimer = 0;

    const renderLoop = (now: number) => {
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      skidTimer += dt;

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      const state = latestStateRef.current;

      if (canvas && ctx && state) {
        ctx.save();

        // Subtle camera trauma shake on hits/explosions
        if (shakeRef.current > 0.1) {
          const sx = (Math.random() - 0.5) * shakeRef.current * 2;
          const sy = (Math.random() - 0.5) * shakeRef.current * 2;
          ctx.translate(sx, sy);
          shakeRef.current = Math.max(0, shakeRef.current - dt * 28);
        }

        // 1. Blit pre-rendered industrial steel floor & obstacles
        if (bgCanvasRef.current) {
          ctx.drawImage(bgCanvasRef.current, 0, 0);
        }

        // 2. Update & draw tank tread marks
        const skids = skidsRef.current;
        for (let i = skids.length - 1; i >= 0; i--) {
          skids[i].alpha -= dt * 0.18;
          if (skids[i].alpha <= 0) {
            skids.splice(i, 1);
            continue;
          }
          ctx.save();
          ctx.translate(skids[i].x, skids[i].y);
          ctx.rotate(skids[i].angle);
          ctx.fillStyle = `rgba(10, 14, 20, ${skids[i].alpha * 0.38})`;
          ctx.fillRect(-5, -18, 10, 6);
          ctx.fillRect(-5, 12, 10, 6);
          ctx.restore();
        }

        // 3. Interpolate & draw tanks
        const roles: Array<'player1' | 'player2'> = ['player1', 'player2'];
        let anyMoving = false;

        for (const role of roles) {
          const tank = state.players[role];
          if (!tank) {
            renderTanksRef.current[role] = null;
            continue;
          }

          if (tank.moving && state.status === 'PLAYING') {
            anyMoving = true;
          }

          let interp = renderTanksRef.current[role];
          if (!interp || Math.hypot(tank.x - interp.x, tank.y - interp.y) > 90) {
            interp = { x: tank.x, y: tank.y, angle: tank.angle };
            renderTanksRef.current[role] = interp;
          } else {
            const blend = Math.min(1, dt * 20);
            interp.x += (tank.x - interp.x) * blend;
            interp.y += (tank.y - interp.y) * blend;
            const aDiff = normalizeAngle(tank.angle - interp.angle);
            interp.angle = normalizeAngle(interp.angle + aDiff * blend);
          }

          if (tank.moving && tank.hp > 0 && skidTimer >= 0.065) {
            skids.push({
              x: interp.x - Math.cos(interp.angle) * 14,
              y: interp.y - Math.sin(interp.angle) * 14,
              angle: interp.angle,
              alpha: 0.9,
            });
            if (skids.length > 140) skids.shift();
          }

          // Low HP engine smoke
          if (tank.hp > 0 && tank.hp <= 40 && Math.random() < dt * 10) {
            particlesRef.current.push({
              x: interp.x + (Math.random() - 0.5) * 16,
              y: interp.y + (Math.random() - 0.5) * 16,
              vx: (Math.random() - 0.5) * 22,
              vy: -15 - Math.random() * 20,
              life: 0.65,
              maxLife: 0.65,
              size: 7 + Math.random() * 6,
              color: '#475569',
              kind: 'smoke',
            });
          }

          drawTank(ctx, tank, interp.x, interp.y, interp.angle);
        }

        if (skidTimer >= 0.065) {
          skidTimer = 0;
        }

        soundEngine.setEngineMoving(state.status === 'PLAYING', anyMoving);

        // 4. Draw high-velocity shells & glowing tracers
        for (const bullet of state.bullets) {
          drawBullet(ctx, bullet.x, bullet.y, bullet.angle, bullet.owner === 'player1');
        }

        // 5. Update & draw sparks, muzzle flashes, and smoke particles
        updateAndDrawParticles(ctx, particlesRef.current, dt);

        ctx.restore();
      }

      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);
    return () => {
      cancelAnimationFrame(animId);
      soundEngine.setEngineMoving(false, false);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={ARENA_WIDTH}
      height={ARENA_HEIGHT}
      className="block w-full h-full object-contain rounded-lg shadow-2xl border border-slate-700/80 bg-[#141922]"
    />
  );
};

function renderStaticArena(ctx: CanvasRenderingContext2D): void {
  // Base brushed steel plating
  ctx.fillStyle = '#262d38';
  ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

  // Draw square riveted metallic floor tiles (60x60 grid)
  const tileSize = 60;
  for (let gx = 0; gx < ARENA_WIDTH; gx += tileSize) {
    for (let gy = 0; gy < ARENA_HEIGHT; gy += tileSize) {
      const shadeOffset = ((gx / tileSize + gy / tileSize) % 2 === 0) ? 0 : 5;
      ctx.fillStyle = `rgb(${39 + shadeOffset}, ${47 + shadeOffset}, ${59 + shadeOffset})`;
      ctx.fillRect(gx + 1, gy + 1, tileSize - 2, tileSize - 2);

      // Subtle bevel edge
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.lineWidth = 1;
      ctx.strokeRect(gx + 1.5, gy + 1.5, tileSize - 3, tileSize - 3);

      // Corner rivets
      ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
      ctx.fillRect(gx + 5, gy + 5, 2.5, 2.5);
      ctx.fillRect(gx + tileSize - 7.5, gy + 5, 2.5, 2.5);
      ctx.fillRect(gx + 5, gy + tileSize - 7.5, 2.5, 2.5);
      ctx.fillRect(gx + tileSize - 7.5, gy + tileSize - 7.5, 2.5, 2.5);
    }
  }

  // Dark metallic central corridor (vertical industrial walkway across center)
  const corridorWidth = 220;
  const corridorX = ARENA_WIDTH / 2 - corridorWidth / 2;
  ctx.fillStyle = '#151a22';
  ctx.fillRect(corridorX, WALL_THICKNESS, corridorWidth, ARENA_HEIGHT - WALL_THICKNESS * 2);

  // Grating pattern inside dark central corridor
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  for (let y = WALL_THICKNESS; y < ARENA_HEIGHT - WALL_THICKNESS; y += 20) {
    ctx.beginPath();
    ctx.moveTo(corridorX + 12, y);
    ctx.lineTo(corridorX + corridorWidth - 12, y);
    ctx.stroke();
  }

  // Yellow industrial caution trim lines bordering central corridor
  ctx.fillStyle = '#eab308';
  ctx.globalAlpha = 0.72;
  ctx.fillRect(corridorX, WALL_THICKNESS, 4, ARENA_HEIGHT - WALL_THICKNESS * 2);
  ctx.fillRect(corridorX + corridorWidth - 4, WALL_THICKNESS, 4, ARENA_HEIGHT - WALL_THICKNESS * 2);
  ctx.globalAlpha = 1;

  // Spawn zone floor decals (Left Red Zone, Right Blue Zone)
  drawSpawnPad(ctx, 130, ARENA_HEIGHT / 2, 'rgba(239, 68, 68, 0.16)', '#ef4444');
  drawSpawnPad(ctx, ARENA_WIDTH - 130, ARENA_HEIGHT / 2, 'rgba(59, 130, 246, 0.16)', '#3b82f6');

  // Create yellow-black diagonal hazard pattern for walls
  const hazardCanvas = document.createElement('canvas');
  hazardCanvas.width = 32;
  hazardCanvas.height = 32;
  const hctx = hazardCanvas.getContext('2d');
  if (hctx) {
    hctx.fillStyle = '#eab308';
    hctx.fillRect(0, 0, 32, 32);
    hctx.strokeStyle = '#111827';
    hctx.lineWidth = 11;
    hctx.beginPath();
    hctx.moveTo(-8, 8);
    hctx.lineTo(8, -8);
    hctx.moveTo(-8, 40);
    hctx.lineTo(40, -8);
    hctx.moveTo(24, 40);
    hctx.lineTo(40, 24);
    hctx.stroke();
  }
  const hazardPattern = ctx.createPattern(hazardCanvas, 'repeat');

  // Render all obstacles with drop shadows & metallic detailing
  for (const obs of ARENA_OBSTACLES) {
    drawObstacle(ctx, obs, hazardPattern);
  }
}

function drawSpawnPad(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  fill: string,
  stroke: string
): void {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.setLineDash([8, 6]);
  ctx.stroke();
  ctx.restore();
}

function drawObstacle(
  ctx: CanvasRenderingContext2D,
  obs: Obstacle,
  hazardPattern: CanvasPattern | null
): void {
  const { x, y, width, height, kind } = obs;

  if (kind === 'wall') {
    // Outer steel beam + yellow-black hazard stripe trim
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(x, y, width, height);

    if (hazardPattern) {
      ctx.save();
      ctx.fillStyle = hazardPattern;
      // Leave dark steel outer rim and paint inner hazard band
      ctx.fillRect(x + 4, y + 4, width - 8, height - 8);
      ctx.restore();
    }

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);
    return;
  }

  // Drop shadow for interior obstacles
  ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
  ctx.fillRect(x + 5, y + 6, width, height);

  if (kind === 'crate') {
    // Reinforced steel cargo crate with cross-bracing
    ctx.fillStyle = '#475569';
    ctx.fillRect(x, y, width, height);

    ctx.fillStyle = '#334155';
    ctx.fillRect(x + 6, y + 6, width - 12, height - 12);

    // Diagonal steel X-braces
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x + 7, y + 7);
    ctx.lineTo(x + width - 7, y + height - 7);
    ctx.moveTo(x + width - 7, y + 7);
    ctx.lineTo(x + 7, y + height - 7);
    ctx.stroke();

    // Caution accent tag
    ctx.fillStyle = '#eab308';
    ctx.fillRect(x + width / 2 - 10, y + 3, 20, 4);

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
  } else if (kind === 'machinery') {
    // Industrial turbine / technical power unit
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(x, y, width, height);

    if (hazardPattern) {
      ctx.fillStyle = hazardPattern;
      ctx.fillRect(x, y, width, 8);
      ctx.fillRect(x, y + height - 8, width, 8);
    }

    // Dual cooling fan vents
    const cy = y + height / 2;
    const fanCenters = [x + width * 0.28, x + width * 0.72];
    for (const fx of fanCenters) {
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(fx, cy, 18, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Fan blades
      for (let b = 0; b < 4; b++) {
        const ang = (b * Math.PI) / 2 + 0.4;
        ctx.beginPath();
        ctx.moveTo(fx, cy);
        ctx.lineTo(fx + Math.cos(ang) * 15, cy + Math.sin(ang) * 15);
        ctx.stroke();
      }

      ctx.fillStyle = '#64748b';
      ctx.beginPath();
      ctx.arc(fx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
  } else if (kind === 'bunker') {
    // Heavy armor tactical barricade with yellow-black ends
    ctx.fillStyle = '#334155';
    ctx.fillRect(x, y, width, height);

    if (hazardPattern) {
      ctx.fillStyle = hazardPattern;
      ctx.fillRect(x + 3, y + 3, width - 6, 10);
      ctx.fillRect(x + 3, y + height - 13, width - 6, 10);
    }

    // Armor plate seam lines
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 4, y + 16, width - 8, height - 32);

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x, y, width, height);
  }
}

function drawTank(
  ctx: CanvasRenderingContext2D,
  tank: TankState,
  x: number,
  y: number,
  angle: number
): void {
  const isRed = tank.color === 'red';
  const primary = isRed ? '#dc2626' : '#2563eb';
  const highlight = isRed ? '#f87171' : '#60a5fa';
  const darkShade = isRed ? '#7f1d1d' : '#1e3a8a';

  ctx.save();
  ctx.translate(x, y);

  if (tank.hp <= 0) {
    // Destroyed scorched hull
    ctx.rotate(angle);
    ctx.fillStyle = '#111827';
    ctx.fillRect(-TANK_BODY_LENGTH / 2, -TANK_BODY_WIDTH / 2, TANK_BODY_LENGTH, TANK_BODY_WIDTH);
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 2;
    ctx.strokeRect(-TANK_BODY_LENGTH / 2, -TANK_BODY_WIDTH / 2, TANK_BODY_LENGTH, TANK_BODY_WIDTH);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.rotate(angle);

  // Ground shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(-TANK_BODY_LENGTH / 2 + 3, -TANK_BODY_WIDTH / 2 + 4, TANK_BODY_LENGTH, TANK_BODY_WIDTH);

  // Left & Right armored caterpillar tracks
  const trackWidth = 9;
  const trackLength = TANK_BODY_LENGTH + 4;
  ctx.fillStyle = '#18181b';
  ctx.fillRect(-trackLength / 2, -TANK_BODY_WIDTH / 2 - 2, trackLength, trackWidth);
  ctx.fillRect(-trackLength / 2, TANK_BODY_WIDTH / 2 - trackWidth + 2, trackLength, trackWidth);

  // Track tread ribs
  ctx.fillStyle = '#3f3f46';
  for (let tx = -trackLength / 2 + 3; tx < trackLength / 2 - 2; tx += 6) {
    ctx.fillRect(tx, -TANK_BODY_WIDTH / 2 - 1, 3, trackWidth - 2);
    ctx.fillRect(tx, TANK_BODY_WIDTH / 2 - trackWidth + 3, 3, trackWidth - 2);
  }

  // Main armored chassis
  ctx.fillStyle = darkShade;
  ctx.fillRect(-TANK_BODY_LENGTH / 2, -TANK_BODY_WIDTH / 2 + 5, TANK_BODY_LENGTH, TANK_BODY_WIDTH - 10);

  ctx.fillStyle = tank.hitFlash > 0.2 ? '#ffffff' : primary;
  ctx.fillRect(
    -TANK_BODY_LENGTH / 2 + 3,
    -TANK_BODY_WIDTH / 2 + 7,
    TANK_BODY_LENGTH - 6,
    TANK_BODY_WIDTH - 14
  );

  // Front directional armor glacis chevron
  ctx.fillStyle = highlight;
  ctx.fillRect(TANK_BODY_LENGTH / 2 - 9, -TANK_BODY_WIDTH / 2 + 9, 5, TANK_BODY_WIDTH - 18);

  // Rear engine exhaust louvers
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(-TANK_BODY_LENGTH / 2 + 5, -9, 7, 18);

  // Cannon barrel with recoil kickback
  const recoilOffset = (tank.recoil || 0) * 6;
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(4 - recoilOffset, -4, 30, 8);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(4 - recoilOffset, -4, 30, 8);

  // Muzzle brake tip
  ctx.fillStyle = '#475569';
  ctx.fillRect(30 - recoilOffset, -5.5, 6, 11);

  // Central rotating turret dome
  ctx.fillStyle = tank.hitFlash > 0.2 ? '#ffffff' : darkShade;
  ctx.beginPath();
  ctx.arc(-2, 0, 13, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = tank.hitFlash > 0.2 ? '#ffffff' : highlight;
  ctx.beginPath();
  ctx.arc(-2, 0, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.restore();

  // Floating player tag & mini HP bar above tank (unrotated)
  const barW = 48;
  const barH = 5;
  const hpRatio = Math.max(0, Math.min(1, tank.hp / tank.maxHp));

  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.fillRect(-barW / 2 - 1, -39, barW + 2, barH + 2);

  ctx.fillStyle = isRed ? '#ef4444' : '#3b82f6';
  ctx.fillRect(-barW / 2, -38, barW * hpRatio, barH);

  ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e2e8f0';
  const label = tank.connected ? tank.name : `${tank.name} (OFFLINE)`;
  ctx.fillText(label, 0, -45);

  ctx.restore();
}

function drawBullet(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  isRed: boolean
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Glowing tracer wake
  const grad = ctx.createLinearGradient(-22, 0, 4, 0);
  grad.addColorStop(0, 'rgba(251, 191, 36, 0)');
  grad.addColorStop(1, isRed ? 'rgba(248, 113, 113, 0.9)' : 'rgba(96, 165, 250, 0.9)');
  ctx.fillStyle = grad;
  ctx.fillRect(-22, -2.5, 24, 5);

  // Bright armor-piercing shell core
  ctx.fillStyle = '#fef08a';
  ctx.beginPath();
  ctx.arc(0, 0, BULLET_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function spawnShotParticles(list: Particle[], x: number, y: number, angle: number): void {
  list.push({
    x,
    y,
    vx: 0,
    vy: 0,
    life: 0.09,
    maxLife: 0.09,
    size: 16,
    color: '#fef08a',
    kind: 'flash',
  });
  for (let i = 0; i < 7; i++) {
    const spread = angle + (Math.random() - 0.5) * 0.7;
    const speed = 70 + Math.random() * 110;
    list.push({
      x,
      y,
      vx: Math.cos(spread) * speed,
      vy: Math.sin(spread) * speed,
      life: 0.25 + Math.random() * 0.15,
      maxLife: 0.4,
      size: 4 + Math.random() * 4,
      color: i % 2 === 0 ? '#fbbf24' : '#94a3b8',
      kind: i % 2 === 0 ? 'spark' : 'smoke',
    });
  }
}

function spawnMetalSparks(list: Particle[], x: number, y: number, normalAngle: number): void {
  for (let i = 0; i < 12; i++) {
    const ang = normalAngle + (Math.random() - 0.5) * 1.5;
    const speed = 90 + Math.random() * 190;
    list.push({
      x,
      y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      life: 0.22 + Math.random() * 0.18,
      maxLife: 0.4,
      size: 2.5 + Math.random() * 2,
      color: i % 3 === 0 ? '#ffffff' : '#facc15',
      kind: 'spark',
    });
  }
}

function spawnArmorImpact(list: Particle[], x: number, y: number, accentColor: string): void {
  list.push({
    x,
    y,
    vx: 0,
    vy: 0,
    life: 0.12,
    maxLife: 0.12,
    size: 22,
    color: '#fb923c',
    kind: 'flash',
  });
  for (let i = 0; i < 16; i++) {
    const ang = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 200;
    list.push({
      x,
      y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      life: 0.3 + Math.random() * 0.25,
      maxLife: 0.55,
      size: 3 + Math.random() * 3,
      color: i % 3 === 0 ? accentColor : '#fbbf24',
      kind: 'spark',
    });
  }
}

function spawnExplosion(list: Particle[], x: number, y: number): void {
  list.push({
    x,
    y,
    vx: 0,
    vy: 0,
    life: 0.22,
    maxLife: 0.22,
    size: 46,
    color: '#fef08a',
    kind: 'flash',
  });
  for (let i = 0; i < 34; i++) {
    const ang = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 240;
    const isSmoke = i > 20;
    list.push({
      x,
      y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      life: isSmoke ? 0.85 : 0.48,
      maxLife: isSmoke ? 0.85 : 0.48,
      size: isSmoke ? 12 + Math.random() * 10 : 4 + Math.random() * 4,
      color: isSmoke ? '#334155' : i % 2 === 0 ? '#f97316' : '#facc15',
      kind: isSmoke ? 'smoke' : 'spark',
    });
  }
}

function updateAndDrawParticles(ctx: CanvasRenderingContext2D, list: Particle[], dt: number): void {
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.life -= dt;
    if (p.life <= 0) {
      list.splice(i, 1);
      continue;
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92;
    p.vy *= 0.92;

    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;

    if (p.kind === 'spark') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'flash') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1.3 - alpha * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
