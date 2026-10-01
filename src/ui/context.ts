import { createContext, useContext } from 'react';
import type { Controller } from '../state/controller';

export const Ctl = createContext<Controller | null>(null);
export const useCtl = (): Controller | null => useContext(Ctl);
