import React, { useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Crosshair } from 'lucide-react';
import { PlayerInput } from '../shared/types.ts';

interface Player2ControlPanelProps {
  disabled?: boolean;
  isTouchLayout?: boolean;
  onControlChange: (key: keyof Pick<PlayerInput, 'forward' | 'backward' | 'turnLeft' | 'turnRight' | 'fire'>, pressed: boolean) => void;
}

export const Player2ControlPanel: React.FC<Player2ControlPanelProps> = ({
  disabled = false,
  isTouchLayout = false,
  onControlChange,
}) => {
  const [activeKeys, setActiveKeys] = useState<Record<string, boolean>>({});

  const setPressed = (
    key: keyof Pick<PlayerInput, 'forward' | 'backward' | 'turnLeft' | 'turnRight' | 'fire'>,
    pressed: boolean
  ) => {
    if (disabled && pressed) return;
    setActiveKeys((prev) => (prev[key] === pressed ? prev : { ...prev, [key]: pressed }));
    onControlChange(key, pressed);
  };

  const bindHoldEvents = (
    key: keyof Pick<PlayerInput, 'forward' | 'backward' | 'turnLeft' | 'turnRight' | 'fire'>
  ) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (disabled) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setPressed(key, true);
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setPressed(key, false);
    },
    onPointerCancel: () => setPressed(key, false),
    onLostPointerCapture: () => setPressed(key, false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const btnSize = isTouchLayout ? 'w-16 h-16 text-xl' : 'w-14 h-14 text-lg';

  const dpadBtnClass = (active: boolean) =>
    `${btnSize} rounded-xl border font-bold flex items-center justify-center select-none touch-none transition-transform duration-75 ${
      disabled
        ? 'bg-slate-900/50 border-slate-800 text-slate-600 cursor-not-allowed'
        : active
        ? 'scale-95 bg-blue-600 border-blue-300 text-white shadow-inner'
        : 'bg-slate-800/95 hover:bg-slate-700 border-slate-600 text-slate-100 shadow-md active:scale-95'
    }`;

  return (
    <aside
      aria-label="Player 2 Blue Tank Control Panel"
      className={`flex ${
        isTouchLayout
          ? 'flex-row items-center justify-between w-full px-3 py-2 bg-slate-900/90 border-t border-slate-800'
          : 'flex-col items-center justify-between w-52 shrink-0 p-4 bg-slate-900/95 border border-slate-800 rounded-xl'
      } select-none touch-none`}
    >
      {!isTouchLayout && (
        <div className="w-full text-center pb-3 border-b border-slate-800">
          <div className="font-display text-base tracking-wide text-blue-400 font-bold">
            BLUE TANK PANEL
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {disabled ? 'Locked to Player 2' : 'Hold buttons or Arrow keys'}
          </p>
        </div>
      )}

      {/* Directional Arrow Cluster: ↑ ↓ ← → */}
      <div className="grid grid-cols-3 gap-2 my-2">
        <div />
        <button
          type="button"
          aria-label="Oldinga yurish (↑)"
          disabled={disabled}
          {...bindHoldEvents('forward')}
          className={dpadBtnClass(Boolean(activeKeys.forward))}
        >
          <ArrowUp className="w-6 h-6" />
        </button>
        <div />

        <button
          type="button"
          aria-label="Chapga burilish (←)"
          disabled={disabled}
          {...bindHoldEvents('turnLeft')}
          className={dpadBtnClass(Boolean(activeKeys.turnLeft))}
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <button
          type="button"
          aria-label="Orqaga yurish (↓)"
          disabled={disabled}
          {...bindHoldEvents('backward')}
          className={dpadBtnClass(Boolean(activeKeys.backward))}
        >
          <ArrowDown className="w-6 h-6" />
        </button>
        <button
          type="button"
          aria-label="O'ngga burilish (→)"
          disabled={disabled}
          {...bindHoldEvents('turnRight')}
          className={dpadBtnClass(Boolean(activeKeys.turnRight))}
        >
          <ArrowRight className="w-6 h-6" />
        </button>
      </div>

      {/* Dedicated FIRE Button */}
      <button
        type="button"
        disabled={disabled}
        {...bindHoldEvents('fire')}
        className={`${
          isTouchLayout ? 'w-28 h-24 rounded-2xl' : 'w-full py-4 rounded-xl mt-2'
        } font-display tracking-wider text-lg font-bold border-2 flex items-center justify-center gap-2 select-none touch-none transition-transform duration-75 ${
          disabled
            ? 'bg-slate-900/50 border-slate-800 text-slate-600 cursor-not-allowed'
            : activeKeys.fire
            ? 'scale-95 bg-blue-500 border-yellow-300 text-white'
            : 'bg-blue-600 hover:bg-blue-500 border-blue-400 text-white shadow-lg'
        }`}
      >
        <Crosshair className="w-5 h-5" />
        <span>FIRE</span>
      </button>

      {!isTouchLayout && (
        <div className="w-full pt-3 border-t border-slate-800 text-[11px] text-slate-400 space-y-1 text-center">
          <div>↑ Oldinga · ↓ Orqaga</div>
          <div>← Chapga · → O‘ngga</div>
        </div>
      )}
    </aside>
  );
};
