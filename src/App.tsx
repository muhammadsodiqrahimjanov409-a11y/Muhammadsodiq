import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  BookOpen,
  Copy,
  Check,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  Settings,
  ShieldAlert,
  Smartphone,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  DEFAULT_GUEST_ACCESS_CODE,
  DEFAULT_HOST_ACCESS_CODE,
  DEFAULT_ROOM_ID,
} from './shared/arena.ts';
import {
  PlayerInput,
  PlayerRole,
  RoomAuthResponse,
  RoomStateSnapshot,
} from './shared/types.ts';
import { ArenaCanvas } from './components/ArenaCanvas.tsx';
import { VirtualJoystick } from './components/VirtualJoystick.tsx';
import { Player2ControlPanel } from './components/Player2ControlPanel.tsx';
import { HowToPlayModal, SettingsModal } from './components/Modals.tsx';
import { soundEngine } from './audio/soundEngine.ts';

type ScreenView = 'MENU' | 'LOBBY' | 'BATTLE';

const SESSION_STORAGE_KEY = 'steel_tanks_session_v1';

interface SavedSession {
  roomId: string;
  role: PlayerRole;
  sessionToken: string;
  playerName: string;
}

function getOrCreateToken(): string {
  const existing = sessionStorage.getItem('steel_tanks_token');
  if (existing) return existing;
  const created = `st-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  sessionStorage.setItem('steel_tanks_token', created);
  return created;
}

export default function App() {
  const socketRef = useRef<Socket | null>(null);

  // Connection & Room state
  const [socketConnected, setSocketConnected] = useState(false);
  const [screen, setScreen] = useState<ScreenView>('MENU');
  const [myRole, setMyRole] = useState<PlayerRole | null>(null);
  const [roomState, setRoomState] = useState<RoomStateSnapshot | null>(null);

  // Main Menu Form State
  const [menuTab, setMenuTab] = useState<'create' | 'join'>('create');
  const [playerName, setPlayerName] = useState('');
  const [roomIdInput, setRoomIdInput] = useState(DEFAULT_ROOM_ID);
  const [accessCodeInput, setAccessCodeInput] = useState(DEFAULT_HOST_ACCESS_CODE);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [copiedRoom, setCopiedRoom] = useState(false);

  // Modals & Audio Settings
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [volume, setVolume] = useState(0.65);
  const [muted, setMuted] = useState(false);
  const [touchModeOverride, setTouchModeOverride] = useState<'auto' | 'touch' | 'desktop'>('auto');
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [isPortraitMobile, setIsPortraitMobile] = useState(false);

  // Track local input state to send cleanly to server
  const inputRef = useRef<PlayerInput>({
    forward: false,
    backward: false,
    turnLeft: false,
    turnRight: false,
    fire: false,
    joystickAngle: null,
    joystickMagnitude: 0,
  });

  const prevWinnerRef = useRef<PlayerRole | null>(null);

  // Detect touch device & mobile orientation
  useEffect(() => {
    const checkViewport = () => {
      const coarse =
        window.matchMedia('(pointer: coarse)').matches ||
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0;
      setIsTouchDevice(coarse);
      setIsPortraitMobile(coarse && window.innerHeight > window.innerWidth && window.innerWidth < 768);
    };
    checkViewport();
    window.addEventListener('resize', checkViewport);
    return () => window.removeEventListener('resize', checkViewport);
  }, []);

  const effectiveTouchLayout = useMemo(() => {
    if (touchModeOverride === 'touch') return true;
    if (touchModeOverride === 'desktop') return false;
    return isTouchDevice;
  }, [touchModeOverride, isTouchDevice]);

  // Switch default access code helper when toggling CREATE ROOM vs JOIN ROOM
  const handleSelectMenuTab = (mode: 'create' | 'join') => {
    setMenuTab(mode);
    setErrorBanner(null);
    if (mode === 'create' && (accessCodeInput === '' || accessCodeInput === DEFAULT_GUEST_ACCESS_CODE)) {
      setAccessCodeInput(DEFAULT_HOST_ACCESS_CODE);
    } else if (mode === 'join' && (accessCodeInput === '' || accessCodeInput === DEFAULT_HOST_ACCESS_CODE)) {
      setAccessCodeInput(DEFAULT_GUEST_ACCESS_CODE);
    }
  };

  const emitCurrentInput = useCallback(() => {
    const sock = socketRef.current;
    if (!sock || !sock.connected) return;
    sock.emit('player:input', inputRef.current);
  }, []);

  // Establish real Socket.IO WebSocket connection + automatic reconnection sync
  useEffect(() => {
    const socketUrl = import.meta.env.VITE_SERVER_URL || undefined;
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 600,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);

      // Attempt automatic room recovery if user was already in a room
      const rawSaved = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (rawSaved) {
        try {
          const saved: SavedSession = JSON.parse(rawSaved);
          socket.emit(
            'room:reconnect',
            {
              roomId: saved.roomId,
              role: saved.role,
              sessionToken: saved.sessionToken,
            },
            (res: RoomAuthResponse) => {
              if (res.ok && res.state && res.role) {
                setMyRole(res.role);
                setRoomState(res.state);
                setScreen(res.state.status === 'WAITING' ? 'LOBBY' : 'BATTLE');
                setErrorBanner(null);
              } else {
                sessionStorage.removeItem(SESSION_STORAGE_KEY);
              }
            }
          );
        } catch {
          sessionStorage.removeItem(SESSION_STORAGE_KEY);
        }
      }
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socket.on('room:state', (snapshot: RoomStateSnapshot) => {
      setRoomState(snapshot);
      setScreen((prev) => {
        if (prev === 'MENU') return prev;
        return snapshot.status === 'WAITING' ? 'LOBBY' : 'BATTLE';
      });
    });

    socket.on('room:closed', (payload: { reason?: string }) => {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      setRoomState(null);
      setMyRole(null);
      setScreen('MENU');
      setErrorBanner(payload?.reason || 'Xona yopildi.');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Play Victory / Defeat fanfare when match finishes
  useEffect(() => {
    if (!roomState) {
      prevWinnerRef.current = null;
      return;
    }
    if (roomState.status === 'GAME_OVER' && roomState.winner && prevWinnerRef.current !== roomState.winner) {
      prevWinnerRef.current = roomState.winner;
      if (myRole === roomState.winner) {
        soundEngine.playVictory();
      } else {
        soundEngine.playDefeat();
      }
    } else if (roomState.status !== 'GAME_OVER') {
      prevWinnerRef.current = null;
    }
  }, [roomState, myRole]);

  // Strict Independent Keyboard Controls:
  // Player 1 (Red Tank): W, S, A, D + TAB (prevent browser focus jump!)
  // Player 2 (Blue Tank): ArrowUp, ArrowDown, ArrowLeft, ArrowRight + Space/Enter optional alongside right-side UI panel
  useEffect(() => {
    if (screen !== 'BATTLE' || !myRole) return;

    const resetAllInputs = () => {
      inputRef.current = {
        forward: false,
        backward: false,
        turnLeft: false,
        turnRight: false,
        fire: false,
        joystickAngle: null,
        joystickMagnitude: 0,
      };
      emitCurrentInput();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Always block TAB browser focus navigation during battle
      if (e.key === 'Tab' || e.code === 'Tab') {
        e.preventDefault();
      }

      if (myRole === 'player1') {
        // Player 1 strictly responds ONLY to W, A, S, D and TAB
        let changed = false;
        const code = e.code;
        if (code === 'KeyW') {
          if (!inputRef.current.forward) {
            inputRef.current.forward = true;
            changed = true;
          }
        } else if (code === 'KeyS') {
          if (!inputRef.current.backward) {
            inputRef.current.backward = true;
            changed = true;
          }
        } else if (code === 'KeyA') {
          if (!inputRef.current.turnLeft) {
            inputRef.current.turnLeft = true;
            changed = true;
          }
        } else if (code === 'KeyD') {
          if (!inputRef.current.turnRight) {
            inputRef.current.turnRight = true;
            changed = true;
          }
        } else if (code === 'Tab' || e.key === 'Tab') {
          if (!inputRef.current.fire) {
            inputRef.current.fire = true;
            changed = true;
          }
        }
        if (changed) emitCurrentInput();
      } else if (myRole === 'player2') {
        // Player 2 strictly independent from W/A/S/D/TAB; supports Arrow keys + right-side panel
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
          e.preventDefault();
        }
        let changed = false;
        if (e.key === 'ArrowUp') {
          if (!inputRef.current.forward) {
            inputRef.current.forward = true;
            changed = true;
          }
        } else if (e.key === 'ArrowDown') {
          if (!inputRef.current.backward) {
            inputRef.current.backward = true;
            changed = true;
          }
        } else if (e.key === 'ArrowLeft') {
          if (!inputRef.current.turnLeft) {
            inputRef.current.turnLeft = true;
            changed = true;
          }
        } else if (e.key === 'ArrowRight') {
          if (!inputRef.current.turnRight) {
            inputRef.current.turnRight = true;
            changed = true;
          }
        }
        if (changed) emitCurrentInput();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.code === 'Tab') {
        e.preventDefault();
      }

      if (myRole === 'player1') {
        let changed = false;
        const code = e.code;
        if (code === 'KeyW' && inputRef.current.forward) {
          inputRef.current.forward = false;
          changed = true;
        } else if (code === 'KeyS' && inputRef.current.backward) {
          inputRef.current.backward = false;
          changed = true;
        } else if (code === 'KeyA' && inputRef.current.turnLeft) {
          inputRef.current.turnLeft = false;
          changed = true;
        } else if (code === 'KeyD' && inputRef.current.turnRight) {
          inputRef.current.turnRight = false;
          changed = true;
        } else if ((code === 'Tab' || e.key === 'Tab') && inputRef.current.fire) {
          inputRef.current.fire = false;
          changed = true;
        }
        if (changed) emitCurrentInput();
      } else if (myRole === 'player2') {
        let changed = false;
        if (e.key === 'ArrowUp' && inputRef.current.forward) {
          inputRef.current.forward = false;
          changed = true;
        } else if (e.key === 'ArrowDown' && inputRef.current.backward) {
          inputRef.current.backward = false;
          changed = true;
        } else if (e.key === 'ArrowLeft' && inputRef.current.turnLeft) {
          inputRef.current.turnLeft = false;
          changed = true;
        } else if (e.key === 'ArrowRight' && inputRef.current.turnRight) {
          inputRef.current.turnRight = false;
          changed = true;
        }
        if (changed) emitCurrentInput();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { passive: false });
    window.addEventListener('keyup', handleKeyUp, { passive: false });
    window.addEventListener('blur', resetAllInputs);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', resetAllInputs);
      resetAllInputs();
    };
  }, [screen, myRole, emitCurrentInput]);

  // Actions: Create Room / Join Room / Start / Pause / Restart / Leave
  const handleCreateOrJoin = (e: React.FormEvent) => {
    e.preventDefault();
    soundEngine.unlock();
    setErrorBanner(null);

    const sock = socketRef.current;
    if (!sock || !sock.connected) {
      setErrorBanner('Server bilan aloqa o‘rnatilmoqda... Biroz kuting.');
      return;
    }

    const sessionToken = getOrCreateToken();
    const cleanedRoomId = roomIdInput.trim().toUpperCase();
    const cleanedCode = accessCodeInput.trim();
    const fallbackName = menuTab === 'create' ? 'RED COMMANDER' : 'BLUE COMMANDER';
    const finalName = playerName.trim() || fallbackName;

    setBusyAction(true);

    if (menuTab === 'create') {
      sock.emit(
        'room:create',
        {
          roomId: cleanedRoomId,
          hostAccessCode: cleanedCode,
          playerName: finalName,
          sessionToken,
        },
        (res: RoomAuthResponse) => {
          setBusyAction(false);
          if (!res.ok || !res.state || !res.role || !res.roomId) {
            setErrorBanner(res.error || 'Xona yaratishda xatolik yuz berdi.');
            return;
          }
          const saved: SavedSession = {
            roomId: res.roomId,
            role: res.role,
            sessionToken,
            playerName: finalName,
          };
          sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(saved));
          setMyRole(res.role);
          setRoomState(res.state);
          setScreen(res.state.status === 'WAITING' ? 'LOBBY' : 'BATTLE');
        }
      );
    } else {
      sock.emit(
        'room:join',
        {
          roomId: cleanedRoomId,
          guestAccessCode: cleanedCode,
          playerName: finalName,
          sessionToken,
        },
        (res: RoomAuthResponse) => {
          setBusyAction(false);
          if (!res.ok || !res.state || !res.role || !res.roomId) {
            setErrorBanner(res.error || 'Xonaga qo‘shilishda xatolik yuz berdi.');
            return;
          }
          const saved: SavedSession = {
            roomId: res.roomId,
            role: res.role,
            sessionToken,
            playerName: finalName,
          };
          sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(saved));
          setMyRole(res.role);
          setRoomState(res.state);
          setScreen(res.state.status === 'WAITING' ? 'LOBBY' : 'BATTLE');
        }
      );
    }
  };

  const handleStartBattle = () => {
    soundEngine.unlock();
    socketRef.current?.emit('game:start');
  };

  const handleTogglePause = () => {
    soundEngine.unlock();
    socketRef.current?.emit('game:pause_toggle');
  };

  const handleRestartOrRematch = () => {
    soundEngine.unlock();
    socketRef.current?.emit('game:restart');
  };

  const handleLeaveRoom = () => {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    socketRef.current?.emit('room:leave');
    soundEngine.setEngineMoving(false, false);
    setRoomState(null);
    setMyRole(null);
    setScreen('MENU');
    setErrorBanner(null);
  };

  const handleVolumeChange = (v: number) => {
    setVolume(v);
    soundEngine.setVolume(v);
  };

  const handleMuteToggle = (m: boolean) => {
    setMuted(m);
    soundEngine.setMuted(m);
  };

  const handleCopyRoomId = () => {
    if (!roomState) return;
    navigator.clipboard?.writeText(roomState.roomId).catch(() => {});
    setCopiedRoom(true);
    setTimeout(() => setCopiedRoom(false), 1800);
  };

  // Touch & Panel Callbacks
  const handleP1Joystick = useCallback(
    (angle: number | null, magnitude: number) => {
      if (myRole !== 'player1') return;
      inputRef.current.joystickAngle = angle;
      inputRef.current.joystickMagnitude = magnitude;
      emitCurrentInput();
    },
    [myRole, emitCurrentInput]
  );

  const handleP1FireTouch = useCallback(
    (firing: boolean) => {
      if (myRole !== 'player1') return;
      inputRef.current.fire = firing;
      emitCurrentInput();
    },
    [myRole, emitCurrentInput]
  );

  const handleP2PanelControl = useCallback(
    (
      key: keyof Pick<PlayerInput, 'forward' | 'backward' | 'turnLeft' | 'turnRight' | 'fire'>,
      pressed: boolean
    ) => {
      if (myRole !== 'player2') return;
      inputRef.current[key] = pressed;
      emitCurrentInput();
    },
    [myRole, emitCurrentInput]
  );

  const p1 = roomState?.players.player1 ?? null;
  const p2 = roomState?.players.player2 ?? null;
  const bothConnected = Boolean(p1?.connected && p2?.connected);

  return (
    <div className="min-h-screen w-full bg-[#0b0f17] text-slate-100 flex flex-col overflow-x-hidden">
      {/* Top Bar Contract when in Menu or Lobby */}
      {screen !== 'BATTLE' && (
        <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800/90 bg-slate-950/80">
          <div className="font-display text-xl font-bold tracking-wider text-amber-400 whitespace-nowrap shrink-0">
            STEEL TANKS
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
            <button
              type="button"
              onClick={() => handleSelectMenuTab('create')}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Create Room
            </button>
            <button
              type="button"
              onClick={() => handleSelectMenuTab('join')}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Join Room
            </button>
            <button
              type="button"
              onClick={() => setShowHowToPlay(true)}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              How to Play
            </button>
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Settings
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Audio &amp; Controls
            </button>
          </div>
        </header>
      )}

      {/* MAIN MENU VIEW */}
      {screen === 'MENU' && (
        <main className="flex-1 flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            {/* Left Column: Game Identity & Arena Preview Breakdown */}
            <section className="lg:col-span-7 flex flex-col justify-between bg-slate-900/75 border border-slate-800 rounded-2xl p-6 sm:p-8">
              <div>
                <div className="h-2 w-24 hazard-stripes rounded-xs mb-5" />
                <h1
                  style={{ textWrap: 'balance' }}
                  className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-white leading-none"
                >
                  STEEL TANKS — ONLINE 2 PLAYER BATTLE
                </h1>
                <p className="mt-4 text-slate-300 text-base leading-relaxed max-w-xl">
                  Real-time WebSocket top-down armored combat. Command the{' '}
                  <span className="text-red-400 font-semibold">Red Tank</span> or{' '}
                  <span className="text-blue-400 font-semibold">Blue Tank</span> across two separate
                  devices over the internet with server-synchronized physics, steel obstacles, and
                  ricochet sparks.
                </p>

                {/* Unboxed clean metadata row */}
                <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono">
                  <span className={socketConnected ? 'text-emerald-400' : 'text-amber-400'}>
                    {socketConnected ? 'Server Connected' : 'Connecting to Server...'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>100 HP Armor</span>
                  <span aria-hidden="true">·</span>
                  <span>20 DMG Shells</span>
                  <span aria-hidden="true">·</span>
                  <span>400ms Reload</span>
                </div>
              </div>

              {/* Dual Player Access Code Reference Table */}
              <div className="mt-8 pt-6 border-t border-slate-800/90 grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <div className="text-xs font-mono text-red-400">PLAYER 1 · HOST (RED TANK)</div>
                  <div className="mt-1 text-sm text-slate-200 font-semibold">
                    Host Access Code: <span className="font-mono text-amber-300">1234</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    PC: W, A, S, D + TAB to fire · Phone: Analog Joystick + FIRE
                  </p>
                </div>

                <div>
                  <div className="text-xs font-mono text-blue-400">PLAYER 2 · GUEST (BLUE TANK)</div>
                  <div className="mt-1 text-sm text-slate-200 font-semibold">
                    Guest Access Code: <span className="font-mono text-amber-300">5678</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    Right-side ↑ ↓ ← → &amp; FIRE panel · Mobile &amp; Laptop ready
                  </p>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-800/80 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => setShowHowToPlay(true)}
                  className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
                >
                  <BookOpen className="w-4 h-4" />
                  <span>HOW TO PLAY</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowSettings(true)}
                  className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
                >
                  <Settings className="w-4 h-4" />
                  <span>SETTINGS</span>
                </button>
              </div>
            </section>

            {/* Right Column: Create Room / Join Room Interactive Form */}
            <section className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 flex flex-col justify-between">
              <div>
                {/* Segmented Interactive Mode Selector */}
                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800 mb-6">
                  <button
                    type="button"
                    onClick={() => handleSelectMenuTab('create')}
                    className={`py-2.5 px-4 rounded-lg font-display tracking-wide text-sm font-bold transition-colors whitespace-nowrap shrink-0 ${
                      menuTab === 'create'
                        ? 'bg-red-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    CREATE ROOM
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectMenuTab('join')}
                    className={`py-2.5 px-4 rounded-lg font-display tracking-wide text-sm font-bold transition-colors whitespace-nowrap shrink-0 ${
                      menuTab === 'join'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    JOIN ROOM
                  </button>
                </div>

                <form onSubmit={handleCreateOrJoin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      PLAYER NAME
                    </label>
                    <input
                      type="text"
                      maxLength={18}
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      placeholder={menuTab === 'create' ? 'Red Commander' : 'Blue Commander'}
                      className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-slate-300">
                        SHARED ROOM ID
                      </label>
                      <span className="text-[11px] text-slate-400">
                        Same ID for both players
                      </span>
                    </div>
                    <input
                      type="text"
                      required
                      maxLength={16}
                      value={roomIdInput}
                      onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
                      placeholder="STEEL-01"
                      className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-amber-300 font-mono font-bold tracking-wider text-sm focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-slate-300">
                        {menuTab === 'create'
                          ? 'PLAYER 1 ACCESS CODE (1234)'
                          : 'PLAYER 2 ACCESS CODE (5678)'}
                      </label>
                      <span className="text-[11px] font-mono text-amber-400">
                        Required: {menuTab === 'create' ? '1234' : '5678'}
                      </span>
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      required
                      maxLength={8}
                      value={accessCodeInput}
                      onChange={(e) => setAccessCodeInput(e.target.value)}
                      placeholder={menuTab === 'create' ? '1234' : '5678'}
                      className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-base tracking-widest focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  {errorBanner && (
                    <div
                      role="alert"
                      className="p-3 rounded-lg bg-red-950/80 border border-red-700/80 text-red-200 text-xs flex items-start gap-2"
                    >
                      <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <span>{errorBanner}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busyAction || !socketConnected}
                    className={`w-full py-3.5 px-6 rounded-xl font-display tracking-wider text-base font-bold transition-colors whitespace-nowrap shrink-0 ${
                      menuTab === 'create'
                        ? 'bg-red-600 hover:bg-red-500 text-white'
                        : 'bg-blue-600 hover:bg-blue-500 text-white'
                    } disabled:opacity-50 disabled:cursor-not-allowed shadow-lg`}
                  >
                    {busyAction
                      ? 'CONNECTING...'
                      : menuTab === 'create'
                      ? 'CREATE ROOM (RED TANK)'
                      : 'JOIN ROOM (BLUE TANK)'}
                  </button>
                </form>
              </div>

              <p className="mt-5 text-xs text-slate-400 text-center">
                Works across phones &amp; laptops on different networks (Wi-Fi / 4G / 5G).
              </p>
            </section>
          </div>
        </main>
      )}

      {/* WAITING ROOM LOBBY VIEW */}
      {screen === 'LOBBY' && roomState && (
        <main className="flex-1 flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-800">
              <div>
                <div className="text-xs font-mono text-slate-400">WAITING ROOM LOBBY</div>
                <div className="flex items-center gap-3 mt-1">
                  <h2 className="font-display text-3xl font-bold tracking-wider text-amber-400 font-mono">
                    {roomState.roomId}
                  </h2>
                  <button
                    type="button"
                    onClick={handleCopyRoomId}
                    className="px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    {copiedRoom ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedRoom ? 'Copied' : 'Copy ID'}</span>
                  </button>
                </div>
              </div>

              <div className="text-right text-xs font-mono text-slate-400">
                <div>Host Code: <span className="text-slate-200">1234</span></div>
                <div>Guest Code: <span className="text-slate-200">5678</span></div>
              </div>
            </div>

            {/* Player Slots */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-6">
              {/* Player 1 Slot */}
              <div className="p-5 rounded-xl bg-slate-950/90 border border-slate-800">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-red-400 font-bold">PLAYER 1 · RED TANK</span>
                  <span className={p1?.connected ? 'text-emerald-400' : 'text-slate-500'}>
                    {p1?.connected ? 'CONNECTED' : 'OFFLINE'}
                  </span>
                </div>
                <div className="mt-3 text-lg font-bold text-white truncate">
                  {p1 ? p1.name : 'Waiting...'}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {myRole === 'player1' ? 'You (Room Host · Code 1234)' : 'Room Host'}
                </div>
              </div>

              {/* Player 2 Slot */}
              <div className="p-5 rounded-xl bg-slate-950/90 border border-slate-800">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-blue-400 font-bold">PLAYER 2 · BLUE TANK</span>
                  <span className={p2?.connected ? 'text-emerald-400' : 'text-amber-400'}>
                    {p2?.connected ? 'CONNECTED' : 'WAITING...'}
                  </span>
                </div>
                <div className="mt-3 text-lg font-bold text-white truncate">
                  {p2 ? p2.name : 'Waiting for Player 2...'}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {myRole === 'player2'
                    ? 'You (Guest · Code 5678)'
                    : `Join Room ID "${roomState.roomId}" with code 5678`}
                </div>
              </div>
            </div>

            {/* Connection & Start Status */}
            <div className="pt-5 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
              <button
                type="button"
                onClick={handleLeaveRoom}
                className="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
              >
                <LogOut className="w-4 h-4" />
                <span>LEAVE ROOM</span>
              </button>

              {myRole === 'player1' ? (
                <button
                  type="button"
                  disabled={!bothConnected}
                  onClick={handleStartBattle}
                  className="w-full sm:w-auto px-8 py-3 rounded-xl font-display tracking-wider text-base font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
                >
                  {bothConnected ? 'START BATTLE' : 'WAITING FOR PLAYER 2...'}
                </button>
              ) : (
                <div className="text-sm text-amber-300 font-medium text-center sm:text-right">
                  {bothConnected
                    ? 'Both tanks ready! Waiting for Host to press START BATTLE...'
                    : 'Reconnecting to Host...'}
                </div>
              )}
            </div>
          </div>
        </main>
      )}

      {/* ACTIVE BATTLE SCREEN */}
      {screen === 'BATTLE' && roomState && (
        <div className="flex-1 flex flex-col h-screen max-h-screen overflow-hidden select-none">
          {/* Compact Top Battle HUD */}
          <header className="px-3 sm:px-5 py-2 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
            {/* Left: Player 1 Red HP Bar */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="min-w-0 flex-1 max-w-xs">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-bold text-red-400 truncate">
                    {p1?.name || 'RED TANK'} {myRole === 'player1' ? '(YOU)' : ''}
                  </span>
                  <span className="font-mono tabular-nums text-slate-200 ml-2 shrink-0">
                    {p1?.hp ?? 0}/100 HP
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-800 rounded-xs overflow-hidden border border-slate-700">
                  <div
                    style={{
                      transform: `scaleX(${Math.max(0, (p1?.hp ?? 0) / 100)})`,
                      transformOrigin: 'left',
                    }}
                    className="h-full w-full bg-red-500 transition-transform duration-150"
                  />
                </div>
              </div>
            </div>

            {/* Center: Scoreboard & Connection Telemetry */}
            <div className="flex flex-col items-center shrink-0 px-2">
              <div className="font-display text-lg sm:text-2xl font-bold tracking-wider font-mono tabular-nums flex items-center gap-2">
                <span className="text-red-400">{roomState.scores.player1}</span>
                <span className="text-slate-500 text-sm">:</span>
                <span className="text-blue-400">{roomState.scores.player2}</span>
              </div>
              <div className="text-[10px] font-mono text-slate-400 flex items-center gap-1.5">
                <span className={socketConnected && bothConnected ? 'text-emerald-400' : 'text-amber-400'}>
                  {socketConnected
                    ? bothConnected
                      ? 'ONLINE'
                      : 'OPPONENT OFFLINE'
                    : 'RECONNECTING'}
                </span>
                <span>·</span>
                <span>{roomState.roomId}</span>
              </div>
            </div>

            {/* Right: Player 2 Blue HP Bar + Action Buttons */}
            <div className="flex items-center justify-end gap-2 sm:gap-3 min-w-0 flex-1">
              <div className="min-w-0 flex-1 max-w-xs">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-mono tabular-nums text-slate-200 mr-2 shrink-0">
                    {p2?.hp ?? 0}/100 HP
                  </span>
                  <span className="font-bold text-blue-400 truncate">
                    {p2?.name || 'BLUE TANK'} {myRole === 'player2' ? '(YOU)' : ''}
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-800 rounded-xs overflow-hidden border border-slate-700">
                  <div
                    style={{
                      transform: `scaleX(${Math.max(0, (p2?.hp ?? 0) / 100)})`,
                      transformOrigin: 'right',
                    }}
                    className="h-full w-full bg-blue-500 transition-transform duration-150"
                  />
                </div>
              </div>

              {/* Battle Utility Controls: Mute, Pause, Restart, Leave */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleMuteToggle(!muted)}
                  title={muted ? 'Unmute' : 'Mute'}
                  className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 transition-colors"
                >
                  {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={handleTogglePause}
                  title="Pause / Resume"
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
                >
                  {roomState.status === 'PAUSED' ? (
                    <Play className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Pause className="w-3.5 h-3.5" />
                  )}
                  <span className="hidden md:inline">
                    {roomState.status === 'PAUSED' ? 'RESUME' : 'PAUSE'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleRestartOrRematch}
                  title="Restart Round"
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">RESTART</span>
                </button>
                <button
                  type="button"
                  onClick={handleLeaveRoom}
                  title="Exit to Menu"
                  className="p-2 rounded-lg bg-slate-900 hover:bg-red-950 border border-slate-700 text-slate-300 hover:text-red-300 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </header>

          {/* Subtle Portrait Phone Hint */}
          {isPortraitMobile && (
            <div className="bg-amber-500/15 border-b border-amber-500/30 px-3 py-1 text-[11px] text-amber-300 flex items-center justify-center gap-2 shrink-0">
              <Smartphone className="w-3.5 h-3.5" />
              <span>Gorizontal (Landscape) holatda ushlasangiz arena yanada katta ko‘rinadi</span>
            </div>
          )}

          {/* Middle Workspace: Arena Canvas + Desktop Right-Side Panel for Player 2 */}
          <div className="flex-1 min-h-0 flex flex-row items-center justify-center gap-3 p-2 sm:p-3 overflow-hidden relative">
            {/* Responsive Aspect-Preserving Arena Container */}
            <div className="relative flex-1 h-full flex items-center justify-center min-w-0 min-h-0">
              <div className="relative w-full h-full max-w-[1200px] max-h-[760px] aspect-[1200/760] flex items-center justify-center">
                <ArenaCanvas roomState={roomState} />

                {/* PAUSED OVERLAY */}
                {roomState.status === 'PAUSED' && (
                  <div className="absolute inset-0 bg-black/70 backdrop-blur-xs rounded-lg flex flex-col items-center justify-center p-6 text-center">
                    <h3 className="font-display text-3xl sm:text-4xl font-bold tracking-wider text-amber-400">
                      {bothConnected ? 'BATTLE PAUSED' : 'OPPONENT DISCONNECTED'}
                    </h3>
                    <p className="mt-2 text-sm text-slate-300 max-w-md">
                      {bothConnected
                        ? 'O‘yin vaqtincha to‘xtatildi. Davom ettirish uchun RESUME tugmasini bosing.'
                        : 'Ikkinchi o‘yinchi internet aloqasi tiklanishi kutilmoqda... U qayta kirishi bilan o‘yin davom etadi.'}
                    </p>
                    <div className="mt-5 flex items-center gap-3">
                      {bothConnected && (
                        <button
                          type="button"
                          onClick={handleTogglePause}
                          className="px-6 py-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-sm transition-colors whitespace-nowrap shrink-0"
                        >
                          RESUME BATTLE
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleLeaveRoom}
                        className="px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm transition-colors whitespace-nowrap shrink-0"
                      >
                        EXIT ROOM
                      </button>
                    </div>
                  </div>
                )}

                {/* VICTORY / DEFEAT MODAL OVERLAY */}
                {roomState.status === 'GAME_OVER' && roomState.winner && (
                  <div className="absolute inset-0 bg-black/80 backdrop-blur-xs rounded-lg flex flex-col items-center justify-center p-6 text-center">
                    <div
                      className={`font-display text-5xl sm:text-6xl font-bold tracking-wider ${
                        roomState.winner === myRole ? 'text-emerald-400' : 'text-red-500'
                      }`}
                    >
                      {roomState.winner === myRole ? 'VICTORY' : 'DEFEAT'}
                    </div>
                    <p className="mt-2 text-base text-slate-200 font-medium">
                      {roomState.winner === 'player1'
                        ? `${p1?.name || 'Red Tank'} destroyed Blue Tank!`
                        : `${p2?.name || 'Blue Tank'} destroyed Red Tank!`}
                    </p>
                    <div className="mt-3 font-mono text-sm text-slate-400 tabular-nums">
                      Match Score: Red {roomState.scores.player1} — {roomState.scores.player2} Blue
                    </div>
                    <div className="mt-6 flex items-center gap-4">
                      <button
                        type="button"
                        onClick={handleRestartOrRematch}
                        className="px-8 py-3 rounded-xl font-display tracking-wider text-lg font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-xl transition-colors whitespace-nowrap shrink-0"
                      >
                        REMATCH
                      </button>
                      <button
                        type="button"
                        onClick={handleLeaveRoom}
                        className="px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
                      >
                        MAIN MENU
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right-Side Dedicated Control Panel on Desktop/Laptop */}
            {!effectiveTouchLayout && (
              <Player2ControlPanel
                disabled={myRole !== 'player2'}
                isTouchLayout={false}
                onControlChange={handleP2PanelControl}
              />
            )}
          </div>

          {/* Desktop Footer Control Hint Strip */}
          {!effectiveTouchLayout && (
            <footer className="px-4 py-1.5 bg-slate-950 border-t border-slate-900 text-xs text-slate-400 flex items-center justify-between shrink-0">
              <div>
                {myRole === 'player1' ? (
                  <span>
                    Active Role: <strong className="text-red-400">PLAYER 1 (RED TANK)</strong> · Move:{' '}
                    <span className="font-mono text-slate-200">W A S D</span> · Shoot:{' '}
                    <span className="font-mono text-amber-300">TAB</span>
                  </span>
                ) : (
                  <span>
                    Active Role: <strong className="text-blue-400">PLAYER 2 (BLUE TANK)</strong> · Use
                    right-side <span className="font-mono text-slate-200">↑ ↓ ← → + FIRE</span> panel
                    or Arrow keys
                  </span>
                )}
              </div>
              <div className="font-mono text-[11px] text-slate-500">Round #{roomState.round}</div>
            </footer>
          )}

          {/* Mobile Touch Controls Bar (Never overlaps Arena!) */}
          {effectiveTouchLayout && myRole === 'player1' && (
            <div className="shrink-0 bg-slate-950 border-t border-slate-800">
              <VirtualJoystick
                onVectorChange={handleP1Joystick}
                onFireChange={handleP1FireTouch}
              />
            </div>
          )}

          {effectiveTouchLayout && myRole === 'player2' && (
            <div className="shrink-0">
              <Player2ControlPanel
                disabled={false}
                isTouchLayout={true}
                onControlChange={handleP2PanelControl}
              />
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showHowToPlay && <HowToPlayModal onClose={() => setShowHowToPlay(false)} />}
      {showSettings && (
        <SettingsModal
          volume={volume}
          muted={muted}
          touchModeOverride={touchModeOverride}
          onVolumeChange={handleVolumeChange}
          onMutedChange={handleMuteToggle}
          onTouchModeChange={setTouchModeOverride}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
