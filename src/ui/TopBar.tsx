import { useEffect, useRef, useState } from 'react';
import { formatCredits, formatMult } from '../engine/money';
import { useStore } from '../state/store';
import { useCtl } from './context';
import { IconMenu, IconShield, IconSliders, IconSound } from './icons';
import { Logo } from './Logo';

export const tierOf = (m: number) => (m >= 1000 ? 'high' : m >= 200 ? 'mid' : '');

export function TopBar() {
  const balance = useStore((s) => s.balance);
  const history = useStore((s) => s.history);
  const phase = useStore((s) => s.phase);
  const result = useStore((s) => s.result);
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.set);
  const setSettings = useStore((s) => s.setSettings);
  const ctl = useCtl();
  const [bump, setBump] = useState(false);
  const prev = useRef(balance);
  useEffect(() => {
    if (balance > prev.current) {
      setBump(true);
      const t = setTimeout(() => setBump(false), 650);
      prev.current = balance;
      return () => clearTimeout(t);
    }
    prev.current = balance;
  }, [balance]);
  const open = (m: 'fair' | 'settings' | 'menu' | 'history') => {
    ctl?.audio.ui('open');
    set({ modal: m });
  };
  const quiet = phase === 'result';
  // Responsible play: after a cash-out, the round just settled stays out of the strip until the
  // next run starts, so its fall point (always above the cash-out) never sits on the win screen.
  // It is still in the history panel and the verifier, which the player opens on purpose.
  const held = phase === 'result' && result?.won ? result.round.id : null;
  const shown = held ? history.filter((h) => h.id !== held) : history;

  return (
    <header className="topbar">
      <button className="brand" onClick={() => open('menu')} aria-label="Causeway menu">
        <Logo size="compact" />
        <Logo size="mark" />
        <span className="tag">Demo</span>
      </button>
      {/* Responsible play: the strip is a quiet, uniform record. No highlight of big falls, no
          "this was your round" mark, no entrance on the newest entry, and while a result is shown it
          steps back further, so a past fall point never reads as a near miss beside a win. */}
      <button className={`history${quiet ? ' quiet' : ''}`} onClick={() => open('history')} aria-label="History of previous rounds">
        {history.length === 0 ? (
          <span className="chip none">No runs yet</span>
        ) : shown.length === 0 ? null : (
          <>
            <span className="hist-k" aria-hidden>
              History
            </span>
            {shown.slice(0, 14).map((h) => (
              <span key={h.id} className="chip" title={`Round fell at ${formatMult(h.crash)}×`}>
                {formatMult(h.crash)}×
              </span>
            ))}
          </>
        )}
      </button>
      <div className={`balance${bump ? ' bump' : ''}`} aria-live="polite">
        <div className="k">Demo balance</div>
        <div className="v num">
          {formatCredits(balance)}
          <small>CR</small>
        </div>
      </div>
      <nav className="tools" aria-label="Game">
        <button className="icon-btn" onClick={() => setSettings({ muted: !settings.muted })} aria-label={settings.muted ? 'Unmute' : 'Mute'} aria-pressed={settings.muted}>
          <IconSound off={settings.muted} />
        </button>
        {/* On phones these two live in the menu. */}
        <button className="icon-btn wide-only" onClick={() => open('fair')} aria-label="Provably fair">
          <IconShield />
        </button>
        <button className="icon-btn wide-only" onClick={() => open('settings')} aria-label="Settings">
          <IconSliders />
        </button>
        <button className="icon-btn" onClick={() => open('menu')} aria-label="Menu">
          <IconMenu />
        </button>
      </nav>
    </header>
  );
}
