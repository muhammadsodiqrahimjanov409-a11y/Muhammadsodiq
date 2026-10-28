import React from 'react';
import { Volume2, VolumeX, X } from 'lucide-react';

interface HowToPlayModalProps {
  onClose: () => void;
}

export const HowToPlayModal: React.FC<HowToPlayModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <h2 className="font-display text-2xl font-bold tracking-wide text-slate-100">
            HOW TO PLAY — STEEL TANKS
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-5 py-4 text-sm text-slate-300 leading-relaxed">
          <div>
            <h3 className="font-semibold text-amber-400 text-base mb-1">
              01. Online Room &amp; Access Codes
            </h3>
            <p>
              Ikki o‘yinchi turli qurilmalardan (telefon, planshet yoki kompyuter) bir xil{' '}
              <span className="font-mono text-white">ROOM ID</span> orqali bitta xonaga ulanadi:
            </p>
            <ul className="mt-2 space-y-1 text-slate-300 list-disc list-inside">
              <li>
                <strong className="text-red-400">1-O‘yinchi (Xona egasi — Qizil tank):</strong>{' '}
                “CREATE ROOM” bo‘limida kirish kodi sifatida{' '}
                <span className="font-mono font-bold text-amber-300">1234</span> ni kiritadi.
              </li>
              <li>
                <strong className="text-blue-400">2-O‘yinchi (Mehmon — Ko‘k tank):</strong>{' '}
                “JOIN ROOM” bo‘limida xuddi shu Room ID va kirish paroli sifatida{' '}
                <span className="font-mono font-bold text-amber-300">5678</span> ni kiritadi.
              </li>
              <li>
                Ikkala o‘yinchi ulangach, xona egasi <strong>START BATTLE</strong> tugmasini bosadi.
              </li>
            </ul>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-800">
            <div>
              <h3 className="font-semibold text-red-400 text-base mb-1">
                02. Player 1 — Red Tank Controls
              </h3>
              <p className="text-xs text-slate-400 mb-2">Kompyuter klaviaturasi yoki telefon joystigi:</p>
              <div className="font-mono text-xs space-y-1 text-slate-200">
                <div>W — Oldinga yurish</div>
                <div>S — Orqaga yurish</div>
                <div>A / D — Chapga / O‘ngga burilish</div>
                <div>TAB — O‘q uzish (400ms otish oralig‘i)</div>
                <div className="text-slate-400 pt-1">Telefonda: Joystik + katta FIRE tugmasi</div>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-blue-400 text-base mb-1">
                03. Player 2 — Blue Tank Controls
              </h3>
              <p className="text-xs text-slate-400 mb-2">O‘ng tomondagi boshqaruv paneli yoki sensor ekran:</p>
              <div className="font-mono text-xs space-y-1 text-slate-200">
                <div>↑ — Oldinga yurish</div>
                <div>↓ — Orqaga yurish</div>
                <div>← / → — Chapga / O‘ngga burilish</div>
                <div>FIRE — O‘q uzish (400ms otish oralig‘i)</div>
                <div className="text-slate-400 pt-1">Sichqoncha yoki barmoq bilan bosib turiladi</div>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800">
            <h3 className="font-semibold text-slate-100 text-base mb-1">
              04. Battle Rules
            </h3>
            <p>
              Har bir tank <strong>100 HP</strong> sog‘liq bilan boshlaydi. Har bir aniq tekkan o‘q{' '}
              <strong>20 HP</strong> kamaytiradi. Metall devorlar, qutilar va texnik qurilmalardan
              yashirinish uchun foydalaning. Raqib HP ko‘rsatkichi 0 ga tushganda g‘olib aniqlanadi va{' '}
              <strong>REMATCH</strong> orqali darhol yangi raund boshlash mumkin.
            </p>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};

interface SettingsModalProps {
  volume: number;
  muted: boolean;
  touchModeOverride: 'auto' | 'touch' | 'desktop';
  onVolumeChange: (val: number) => void;
  onMutedChange: (muted: boolean) => void;
  onTouchModeChange: (mode: 'auto' | 'touch' | 'desktop') => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  volume,
  muted,
  touchModeOverride,
  onVolumeChange,
  onMutedChange,
  onTouchModeChange,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <h2 className="font-display text-2xl font-bold tracking-wide text-slate-100">
            SETTINGS
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6 py-5">
          {/* Sound Mute Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-100">Game Audio &amp; Sound FX</div>
              <div className="text-xs text-slate-400">Engine rumble, cannon shots, metal sparks</div>
            </div>
            <button
              type="button"
              onClick={() => onMutedChange(!muted)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
                muted
                  ? 'bg-slate-800 text-slate-300 border border-slate-700'
                  : 'bg-emerald-600 text-white'
              }`}
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              <span>{muted ? 'Muted' : 'Sound On'}</span>
            </button>
          </div>

          {/* Volume Slider */}
          <div>
            <div className="flex items-center justify-between text-xs text-slate-300 mb-2">
              <span>Master Volume</span>
              <span className="font-mono tabular-nums">{Math.round(volume * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>

          {/* Control Layout Mode */}
          <div>
            <div className="text-sm font-semibold text-slate-100 mb-1">Control Interface Mode</div>
            <div className="text-xs text-slate-400 mb-2">
              Auto detects mobile touchscreen vs laptop/desktop controls
            </div>
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-950 rounded-lg border border-slate-800">
              {(['auto', 'desktop', 'touch'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onTouchModeChange(mode)}
                  className={`py-2 px-3 rounded-md text-xs font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                    touchModeOverride === mode
                      ? 'bg-slate-800 text-amber-400 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Save &amp; Close
          </button>
        </div>
      </div>
    </div>
  );
};
