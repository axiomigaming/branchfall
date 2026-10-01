import { useEffect } from 'react';
import { useStore } from '../state/store';
import { useCtl } from './context';
import { Dock } from './Dock';
import { Hud, ResultPlate } from './Hud';
import { Panels, Toasts } from './Panels';
import { Title } from './Title';
import { TopBar } from './TopBar';

export function App() {
  const phase = useStore((s) => s.phase);
  const ctl = useCtl();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape') {
        if (st.modal) st.set({ modal: null, fairFocus: null });
        else if (st.phase === 'setup' || st.phase === 'result') st.set({ modal: 'menu' });
        return;
      }
      if (e.key === 'm' || e.key === 'M') {
        st.setSettings({ muted: !st.settings.muted });
        return;
      }
      if (st.modal || !ctl) return;
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (e.repeat) return;
        if (st.phase === 'running') void ctl.cashout();
        else if (st.phase === 'setup' || st.phase === 'result') void ctl.run();
        else if (st.phase === 'title') ctl.enter();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctl]);

  const inGame = phase !== 'title' && phase !== 'loading';
  return (
    <>
      {inGame && <div className="scrim-top" />}
      {inGame && <div className="scrim-bottom" />}
      {!inGame && <Title />}
      {inGame && <TopBar />}
      {inGame && <Hud />}
      {inGame && <ResultPlate />}
      {inGame && <Dock />}
      <Panels />
      <Toasts />
    </>
  );
}
