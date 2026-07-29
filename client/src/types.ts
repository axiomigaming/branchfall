/** The shapes the server actually sends. Kept narrow, and kept honest. */

export interface RationalView {
  readonly exact: string;
  readonly decimal: string;
}

export interface OutcomeRow {
  readonly survivors: number;
  readonly probability: RationalView;
  readonly claimFactor: RationalView;
  readonly direction: 'grows' | 'holds' | 'falls' | 'wipe';
}

export interface SideBetOffer {
  readonly id: string;
  readonly label: string;
  readonly claim: string;
  readonly probability: RationalView;
  readonly probabilityPct: string;
  readonly multiplier: RationalView;
}

export interface Figures {
  readonly route: string;
  readonly contractId: string;
  readonly running: number;
  readonly laneSplit: number | null;
  readonly lanes: readonly number[];
  readonly multiplier: RationalView;
  readonly outcomes: readonly OutcomeRow[];
  readonly wipe: RationalView;
  readonly allClear: RationalView;
  readonly sole: RationalView;
  readonly expectedSurvivors: RationalView;
  readonly breakEven: number;
  readonly claimFactorAtBreakEven: RationalView;
  readonly grows: RationalView;
  readonly holds: RationalView;
  readonly fallsNonZero: RationalView;
  readonly sideBets: readonly SideBetOffer[];
  readonly display: {
    readonly multiplier: string;
    readonly wipePct: string;
    readonly allClearPct: string;
    readonly solePct: string;
    readonly growsPct: string;
    readonly holdsPct: string;
    readonly fallsNonZeroPct: string;
    readonly expectedSurvivors: string;
  };
}

export interface MenuEntry {
  readonly route: 'WIDE' | 'SPLIT' | 'NARROW' | 'SHELTER';
  readonly title: string;
  readonly laneSplits: readonly (number | null)[];
  readonly shelterSizes: readonly number[];
  readonly figures: readonly {
    readonly laneSplit?: number | null;
    readonly shelterSize?: number;
    readonly banksMicro?: string;
    readonly figures: Figures;
  }[];
}

export interface SquadMember {
  readonly slot: number;
  readonly name: string;
  readonly status: 'running' | 'home' | 'lost';
  readonly valueMicro: string;
  readonly valueDisplay: string;
}

export interface ArenaRecord {
  readonly index: number;
  readonly name: string;
  readonly route: string;
  readonly laneSplit: number | null;
  readonly shelter: readonly { readonly slot: number; readonly name: string }[];
  readonly shelterCreditedMicro: string;
  readonly lanes: readonly {
    readonly entities: readonly { readonly slot: number; readonly name: string }[];
    readonly collapsed: boolean;
  }[];
  readonly survivors: readonly { readonly slot: number; readonly name: string }[];
  readonly fallen: readonly { readonly slot: number; readonly name: string }[];
  readonly running: number;
  readonly claimBeforeMicro: string;
  readonly claimRunningMicro: string;
  readonly claimAfterMicro: string;
  readonly claimFactor: RationalView;
  readonly arithmetic: string;
  readonly sideBets: readonly {
    readonly bet: string;
    readonly stakeMicro: string;
    readonly multiplierExact: string;
    readonly won: boolean;
    readonly creditedMicro: string;
  }[];
}

export interface Settlement {
  readonly kind: string;
  readonly creditedMicro: string;
  readonly totalCreditedMicro: string;
  readonly routeStakeMicro: string;
  readonly sideBetStakeMicro: string;
  readonly returnMultiple: string;
  readonly revealedServerSeed: string | null;
}

export interface Frame {
  readonly roundId: string;
  readonly phase: string;
  readonly arena: { readonly index: number; readonly of: number; readonly name: string; readonly subtitle: string };
  readonly frameRevision: number;
  readonly stakeMicro: string;
  readonly claim: {
    readonly micro: string;
    readonly exact: string;
    readonly display: string;
    readonly perRunnerMicro: string;
    readonly perRunnerDisplay: string;
  };
  readonly squad: readonly SquadMember[];
  readonly live: readonly number[];
  readonly menu: readonly MenuEntry[];
  readonly bankable: boolean;
  readonly bankAmountMicro: string;
  readonly sideBets: {
    readonly offered: boolean;
    readonly perBetMicro: string;
    readonly remainingMicro: string;
    readonly minMicro: string;
    readonly stakedMicro: string;
  };
  readonly speed: {
    readonly minGameCycleMs: number;
    readonly earliestNextActionAtMs: number;
    readonly serverNowMs: number;
    readonly standard: string;
    readonly standardEdition: string;
    readonly provision: string;
    readonly provisionVerifiedAgainstCertifiedCopy: boolean;
    readonly cycleUnit: string;
  };
  readonly fairness: {
    readonly preCommitment: string;
    readonly publishedAtMs: number;
    readonly clientSeed: string | null;
    readonly clientEntropy: string | null;
    readonly clientEntropyIsSeed: boolean;
    readonly tapeDigest: string | null;
    readonly definitionId: string;
    readonly definitionVersion: string;
    readonly fingerprint: string;
    readonly moduleId: string;
    readonly moduleVersion: string;
    readonly revealedServerSeed: string | null;
  };
  readonly history: readonly ArenaRecord[];
  readonly settlement: Settlement | null;
  readonly receipts: readonly Record<string, unknown>[];
  readonly lastLossAtMs: number;
}

export interface Config {
  readonly game: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: string;
    readonly moduleId: string;
    readonly moduleVersion: string;
    readonly engineApi: string;
    readonly squadSize: number;
    readonly arenas: number;
    readonly arenaNames: readonly string[];
    readonly arenaSubtitles: readonly string[];
    readonly defaultRunnerNames: readonly string[];
    readonly routeTitles: Record<string, string>;
  };
  readonly money: {
    readonly rtpExact: string;
    readonly rtpPct: string;
    readonly rtpPct4: string;
    readonly houseEdgePct: string;
    readonly minStakeMicro: string;
    readonly maxStakeMicro: string;
    readonly minStakeCredits: string;
    readonly maxStakeCredits: string;
    readonly maxWinMultiple: string;
    readonly sideBetMinMicro: string;
    readonly sideBetRatio: string;
    readonly claimOpensAt: string;
  };
  readonly speed: Record<string, unknown> & { readonly minGameCycleMs: number };
  readonly sideBets: readonly { readonly id: string; readonly label: string; readonly claim: string }[];
  readonly rehearsal: {
    readonly arenas: number;
    readonly disclosure: readonly (readonly string[])[];
    readonly seedPair: { readonly serverSeed: string; readonly clientEntropy: string; readonly roundId: string };
  };
  readonly paytable: Record<string, Figures>;
}

export interface Session {
  readonly roundsSeen: number;
  readonly showEverything: boolean;
  readonly sideBetsOptedIn: boolean;
  readonly ghostLineEnabled: boolean;
  readonly rehearsalSeen: boolean;
  readonly reducedMotion: boolean;
  readonly elapsedMs: number;
  readonly stage: string;
  readonly runnerNames: readonly string[];
  /** The responsible-play state (`DESIGN.md` §10.2, §S9), all server-owned. */
  readonly realityCheckIntervalMs: number;
  readonly realityCheckDueMs: number;
  readonly sessionLimitMinutes: number | null;
  readonly sessionLossLimitMicro: string | null;
  readonly selfExcluded: boolean;
  readonly audioEnabled: boolean;
  readonly qualityTier: string;
  readonly stakingBlock: { readonly code: string; readonly message: string } | null;
}

export interface WalletView {
  readonly balanceMicro: string;
  readonly balanceDisplay: string;
  readonly netMicro: string;
  readonly netDisplay: string;
  readonly netSign: string;
  readonly stakedMicro: string;
  readonly creditedMicro: string;
}

export interface RehearsalArena {
  readonly index: number;
  readonly name: string;
  readonly subtitle: string;
  readonly route: string;
  readonly laneSplit: number | null;
  readonly shelter: readonly { readonly slot: number; readonly name: string }[];
  readonly lanes: readonly {
    readonly entities: readonly { readonly slot: number; readonly name: string }[];
    readonly collapsed: boolean;
  }[];
  readonly survivors: readonly { readonly slot: number; readonly name: string }[];
  readonly fallen: readonly { readonly slot: number; readonly name: string }[];
  readonly running: number;
  readonly claimBefore: string;
  readonly claimAfter: string;
  readonly bankedHere: string;
  readonly arithmetic: string;
}

export interface RehearsalResult {
  readonly seedPair: { readonly serverSeed: string; readonly clientEntropy: string; readonly roundId: string };
  readonly tapeDigest: string;
  readonly arenas: readonly RehearsalArena[];
  readonly claim: string;
  readonly banked: string;
  readonly total: string;
  readonly running: readonly { readonly slot: number; readonly name: string }[];
  readonly over: boolean;
  readonly wiped: boolean;
  readonly ghost: readonly GhostRow[];
  readonly payout: null;
}

export interface GhostRow {
  readonly arena: number;
  readonly route: string;
  readonly laneSplit: number | null;
  readonly taken: boolean;
  readonly lanes: readonly { readonly runners: readonly string[]; readonly collapsed: boolean }[];
  readonly survivors: readonly string[];
  readonly fallen: readonly string[];
}

export interface VerifyCheck {
  readonly code: string;
  readonly title: string;
  readonly ok: boolean;
  readonly detail: string;
}
