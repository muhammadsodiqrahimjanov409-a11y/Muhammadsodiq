import React, { useRef, useState } from 'react';
import { Crosshair } from 'lucide-react';

interface VirtualJoystickProps {
  onVectorChange: (angle: number | null, magnitude: number) => void;
  onFireChange: (firing: boolean) => void;
}

export const VirtualJoystick: React.FC<VirtualJoystickProps> = ({
  onVectorChange,
  onFireChange,
}) => {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const [knobOffset, setKnobOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [firing, setFiring] = useState(false);

  const maxRadius = 46;

  const updateStick = (clientX: number, clientY: number) => {
    const el = baseRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(maxRadius, dist);
    const angle = Math.atan2(dy, dx);

    const nx = Math.cos(angle) * clampedDist;
    const ny = Math.sin(angle) * clampedDist;
    setKnobOffset({ x: nx, y: ny });

    const magnitude = clampedDist / maxRadius;
    if (magnitude < 0.14) {
      onVectorChange(null, 0);
    } else {
      onVectorChange(angle, magnitude);
    }
  };

  const resetStick = () => {
    pointerIdRef.current = null;
    setKnobOffset({ x: 0, y: 0 });
    onVectorChange(null, 0);
  };

  return (
    <div className="flex items-center justify-between gap-4 w-full px-3 py-2 select-none touch-none">
      {/* Left: 360° Analog Tank Joystick */}
      <div className="flex items-center gap-3">
        <div
          ref={baseRef}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            pointerIdRef.current = e.pointerId;
            updateStick(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (pointerIdRef.current !== e.pointerId) return;
            updateStick(e.clientX, e.clientY);
          }}
          onPointerUp={(e) => {
            if (pointerIdRef.current !== e.pointerId) return;
            resetStick();
          }}
          onPointerCancel={(e) => {
            if (pointerIdRef.current !== e.pointerId) return;
            resetStick();
          }}
          className="relative w-32 h-32 rounded-full bg-slate-900/90 border-2 border-red-500/60 shadow-inner flex items-center justify-center touch-none"
        >
          <div className="w-14 h-14 rounded-full border border-slate-700/70 pointer-events-none" />
          <div
            style={{
              transform: `translate3d(${knobOffset.x}px, ${knobOffset.y}px, 0)`,
            }}
            className="absolute w-14 h-14 rounded-full bg-red-600 border-2 border-red-300 shadow-lg pointer-events-none transition-transform duration-75"
          />
        </div>
        <div className="hidden sm:block text-xs text-slate-400">
          <div className="font-semibold text-red-400">RED TANK JOYSTICK</div>
          <div>Drag to steer &amp; drive</div>
        </div>
      </div>

      {/* Right: Large Dedicated FIRE Button */}
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          setFiring(true);
          onFireChange(true);
        }}
        onPointerUp={() => {
          setFiring(false);
          onFireChange(false);
        }}
        onPointerCancel={() => {
          setFiring(false);
          onFireChange(false);
        }}
        onLostPointerCapture={() => {
          setFiring(false);
          onFireChange(false);
        }}
        className={`w-28 h-28 rounded-full font-display tracking-wider text-lg font-bold flex flex-col items-center justify-center gap-1 border-2 transition-transform touch-none select-none ${
          firing
            ? 'scale-95 bg-red-500 border-yellow-300 text-white shadow-inner'
            : 'bg-red-600 hover:bg-red-500 border-red-400 text-white shadow-xl'
        }`}
      >
        <Crosshair className="w-7 h-7" />
        <span>FIRE</span>
      </button>
    </div>
  );
};
