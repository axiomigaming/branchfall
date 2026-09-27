import { useEffect, useRef, useState } from 'react';
import { formatCredits, formatMult } from '../engine/money';
import { useStore } from '../state/store';
import { useCtl } from './context';
import { IconMenu, IconShield, IconSliders, IconSound, Mark } from './icons';

export const tierOf = (m: number) => (m >= 1000 ? 'high' : m >= 200 ? 'mid' : '');

export function TopBar() {
  const balance = useStore((s) => s.balance);
  const history = useStore((s) => s.history);
  const phase = useStore((s) => s.phase);
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
  const live = phase === 'running' || phase === 'lead' || phase === 'cashing' || phase === 'placing';
  const open = (m: 'fair' | 'settings' | 'menu' | 'history') => {
    ctl?.audio.ui('open');
    set({ modal: m });
  };
  const newest = history[0]?.id;

  return (
    <header className="topbar">
      <button className="brand" onClick={() => !live && open('menu')} aria-label="Causeway menu">
        <Mark />
        <span className="brand-name">CAUSEWAY</span>
        <span className="tag">Demo</span>
      </button>
      <button className="history" onClick={() => open('history')} aria-label="Previous runs">
        {history.length === 0 ? (
          <span className="chip" style={{ opacity: 0.6 }}>
            No runs yet
          </span>
        ) : (
          history.slice(0, 14).map((h) => (
            <span key={h.id} className={`chip ${tierOf(h.crash)}${h.id === newest ? ' fresh' : ''}${h.outcome === 'cashout' ? ' mine' : ''}`} title={h.outcome === 'cashout' ? `You left at ${formatMult(h.cashoutMult!)}×` : undefined}>
              {formatMult(h.crash)}×
            </span>
          ))
        )}
      </button>
      <div className="top-right">
        <div className={`balance${bump ? ' bump' : ''}`} aria-live="polite">
          <div className="k">Balance</div>
          <div className="v num">
            {formatCredits(balance)}
            <small>CR</small>
          </div>
        </div>
        <button className="icon-btn" onClick={() => setSettings({ muted: !settings.muted })} aria-label={settings.muted ? 'Unmute' : 'Mute'} aria-pressed={settings.muted}>
          <IconSound off={settings.muted} />
        </button>
        <button className="icon-btn" onClick={() => open('fair')} aria-label="Provably fair">
          <IconShield />
        </button>
        <button className="icon-btn" onClick={() => open('settings')} aria-label="Settings">
          <IconSliders />
        </button>
        <button className="icon-btn" onClick={() => open('menu')} aria-label="Menu" disabled={live}>
          <IconMenu />
        </button>
      </div>
    </header>
  );
}
