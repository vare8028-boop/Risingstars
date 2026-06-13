import { useState, useEffect, useRef, useMemo, type ReactNode, type PointerEvent } from "react";
import "@fontsource/oswald/400.css";
import "@fontsource/oswald/500.css";
import {
  Vote,
  Pause,
  RotateCcw,
  Trophy,
  ShieldCheck,
  LogOut,
  Menu,
  X,
  Gavel,
} from "lucide-react";
import {
  motion,
  animate,
  AnimatePresence,
  useMotionValue,
  useTransform,
  useSpring,
  type PanInfo,
} from "framer-motion";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const AnimatedPercent = ({ value }: { value: number }) => {
  const [displayValue, setDisplayValue] = useState(0);
  useEffect(() => {
    setDisplayValue(0);
    const controls = animate(0, value, {
      duration: 1.6,
      delay: 1.8,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest: number) => setDisplayValue(Math.round(latest)),
    });
    return () => controls.stop();
  }, [value]);
  return <>{displayValue}%</>;
};

type AppRole =
  | "voter"
  | "audience-auth"
  | "host"
  | "guest"
  | "host-login"
  | "judge"
  | "judge-select"
  | "guest-judge"
  | "vote-wall";

type JudgeId = 1 | 2 | 3;
type JudgeVote = "yes" | "no" | null;
type AudienceVoteChoice = "yes" | "no";
type JudgeVoteMap = Record<number, Record<JudgeId, JudgeVote>>;
type AudienceVoteMap = Record<number, Record<string, AudienceVoteChoice>>;
type CheckedInVoterMap = Record<number, string[]>;
type GuestVoteMap = Record<number, Record<number, JudgeVote>>;
type VoteWallActor = "audience" | "judge" | "guest" | null;
type CompetitionStatus = "idle" | "performance" | "voting" | "waiting-results" | "results" | "ended";

interface Candidate {
  id: number;
  name: string;
  role: string;
  image: string;
}

interface Judge {
  id: JudgeId;
  name: string;
  title: string;
  image: string;
}

interface GuestJudge {
  id: number;
  name: string;
  title: string;
  image: string;
}

interface AudienceProfile {
  name: string;
  email: string;
  photo: string;
}

interface JudgeImageTool {
  sourceImage: string;
  cutoutImage: string | null;
  removeBackground: boolean;
  threshold: number;
  softness: number;
  backgroundColor: string;
  backgroundAlpha: number;
  objectScale: number;
  objectOffsetY: number;
  objectOpacity: number;
}

type JudgeImageToolMap = Record<number, JudgeImageTool>;

interface HostViewProps {
  session: SessionState;
  setRole: (role: AppRole) => void;
  updateSession: (updates: Partial<SessionState>) => void;
  resetAll: () => void;
  VoterViewComponent: () => ReactNode;
  getJudgeImageTool: (judge: Judge) => JudgeImageTool;
  getJudgeDisplayImage: (judge: Judge) => string;
  updateJudgeImageSource: (judgeIndex: number, sourceImage: string) => void;
  handleJudgePhotoUpload: (judgeIndex: number, file: File) => void;
  generateJudgeCutout: (judge: Judge) => Promise<void>;
  cutoutBusyJudgeId: number | null;
  judgeUploadInputRefs: React.MutableRefObject<Record<number, HTMLInputElement | null>>;
  updateJudgeTool: (judgeId: number, updates: Partial<JudgeImageTool>) => void;
  getFinalResult: (candidateId: number | null) => {
    percent: number;
    judgeYes: number;
    judgeTotal: number;
    audYes: number;
    audTotal: number;
    audPercent: number;
    guestBoostPercent: number;
    totalVotesReceived: number;
    audienceWeightContribution: number;
    judge1Contribution: number;
    judge2Contribution: number;
    judge3Contribution: number;
    guestWeightContribution: number;
  };
}

const normalizeJudgeImages = (judges: Judge[]) => judges;

const INITIAL_JUDGES: Judge[] = [
  {
    id: 1,
    name: "Marcus Devlin",
    title: "Grammy-winning Producer",
    image: "https://images.pexels.com/photos/2379005/pexels-photo-2379005.jpeg?auto=compress&cs=tinysrgb&w=400",
  },
  {
    id: 2,
    name: "Liana Park",
    title: "International Vocal Coach",
    image: "https://images.pexels.com/photos/1181686/pexels-photo-1181686.jpeg?auto=compress&cs=tinysrgb&w=400",
  },
  {
    id: 3,
    name: "Diego Reyes",
    title: "Music Director, Star Records",
    image: "https://images.pexels.com/photos/1043472/pexels-photo-1043472.jpeg?auto=compress&cs=tinysrgb&w=400",
  },
];

const CONTESTANT_IMAGE_MAP: Record<number, string> = {
  1: "https://images.pexels.com/photos/17615758/pexels-photo-17615758.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800",
  2: "https://images.pexels.com/photos/19629393/pexels-photo-19629393.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800",
  3: "https://images.pexels.com/photos/9566141/pexels-photo-9566141.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800",
  4: "https://images.pexels.com/photos/35228140/pexels-photo-35228140.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800",
};

const normalizeCandidateImages = (candidates: Candidate[]) =>
  candidates.map((candidate) => {
    const replacement = CONTESTANT_IMAGE_MAP[candidate.id];
    if (!replacement) return candidate;
    const isLegacyLocal =
      candidate.image.startsWith("/images/contestant") || candidate.image.includes("contestant");
    return isLegacyLocal ? { ...candidate, image: replacement } : candidate;
  });

const createJudgeImageTool = (sourceImage: string): JudgeImageTool => ({
  sourceImage,
  cutoutImage: null,
  removeBackground: false,
  threshold: 48,
  softness: 42,
  backgroundColor: "#000000",
  backgroundAlpha: 0.05,
  objectScale: 1,
  objectOffsetY: 0,
  objectOpacity: 1,
});

const buildJudgeImageToolMap = (judges: Judge[]): JudgeImageToolMap =>
  Object.fromEntries(judges.map((judge) => [judge.id, createJudgeImageTool(judge.image)]));

const mergeJudgeImageTools = (
  judges: Judge[],
  parsedTools?: Partial<Record<number, Partial<JudgeImageTool>>>,
): JudgeImageToolMap => {
  const merged = buildJudgeImageToolMap(judges);
  for (const judge of judges) {
    const parsed = parsedTools?.[judge.id];
    if (!parsed) continue;
    merged[judge.id] = {
      ...merged[judge.id],
      ...parsed,
      sourceImage: parsed.sourceImage || judge.image,
      cutoutImage: parsed.cutoutImage ?? null,
      backgroundAlpha: 0.05,
    };
  }
  return merged;
};

const hexToRgba = (hex: string, alpha: number) => {
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  const normalized = hex.replace("#", "").trim();
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    return `rgba(0,0,0,${safeAlpha})`;
  }
  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${safeAlpha})`;
};

const INITIAL_CANDIDATES: Candidate[] = [
  {
    id: 1,
    name: "Alex Rivers",
    role: "Soul Vocalist",
    image: CONTESTANT_IMAGE_MAP[1],
  },
  {
    id: 2,
    name: "Sarah Chen",
    role: "Contemporary Dancer",
    image: CONTESTANT_IMAGE_MAP[2],
  },
  {
    id: 3,
    name: "Marcus Thorne",
    role: "Electric Guitarist",
    image: CONTESTANT_IMAGE_MAP[3],
  },
  {
    id: 4,
    name: "Elena Rodriguez",
    role: "Visual Artist",
    image: CONTESTANT_IMAGE_MAP[4],
  },
];

const STORAGE_KEY = "rising_star_session_v3";
const VOTER_ID_KEY = "rising_star_voter_id_v1";
const AUDIENCE_ACCOUNTS_KEY = "rising_star_audience_accounts_v1";
const AUDIENCE_CURRENT_KEY = "rising_star_audience_current_v1";
const VOTE_WALL_COLS = 30;
const VOTE_WALL_ROWS = 14;
const VOTE_WALL_TOTAL = VOTE_WALL_COLS * VOTE_WALL_ROWS;

const normalizeVoteWallSquares = (squares?: Array<string | null>) => {
  const base = Array.from({ length: VOTE_WALL_TOTAL }, () => null as string | null);
  if (!squares || squares.length === 0) return base;
  for (let i = 0; i < Math.min(base.length, squares.length); i += 1) {
    base[i] = squares[i] ?? null;
  }
  return base;
};

interface SessionState {
  currentCandidateId: number | null;
  status: CompetitionStatus;
  voterCount: number;
  results: Record<number, { yes: number; no: number; checkedInUsers?: number }>;
  checkedInVoters: CheckedInVoterMap;
  audienceVotes: AudienceVoteMap;
  guestJudgeCount: number;
  guestYesByCandidate: Record<number, number>;
  guestVotesByCandidate: GuestVoteMap;
  audienceProfiles: Record<string, AudienceProfile>;
  voteWallPhoto: string | null;
  voteWallPulse: number;
  voteWallActor: VoteWallActor;
  voteWallActorId: number | null;
  voteWallSquarePhotos: Array<string | null>;
  voteWallNextSquareIndex: number;
  voteWallLastPlacedIndex: number | null;
  guestJudges: GuestJudge[];
  candidates: Candidate[];
  judges: Judge[];
  judgeImageTools: JudgeImageToolMap;
  checkInWindowStartedAt: number | null;
  checkInDuration: number;
  judgeVotes: JudgeVoteMap;
  branding: {
    broadcastDate: string;
    broadcastTime: string;
    themeColor: string;
    accentColor: string;
    headerTitle: string;
    readyText: string;
    checkInText: string;
    swipeYesText: string;
    swipeNoText: string;
  };
  soundEffects: {
    yes: string | null;
    no: string | null;
  };
}

const DEFAULT_SESSION: SessionState = {
  currentCandidateId: null,
  status: "idle",
  voterCount: 0,
  results: {
    1: { yes: 0, no: 0 },
    2: { yes: 0, no: 0 },
    3: { yes: 0, no: 0 },
    4: { yes: 0, no: 0 },
  },
  checkedInVoters: {
    1: [],
    2: [],
    3: [],
    4: [],
  },
  audienceVotes: {
    1: {},
    2: {},
    3: {},
    4: {},
  },
  guestJudgeCount: 0,
  guestYesByCandidate: {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
  },
  guestVotesByCandidate: {
    1: {},
    2: {},
    3: {},
    4: {},
  },
  audienceProfiles: {},
  voteWallPhoto: null,
  voteWallPulse: 0,
  voteWallActor: null,
  voteWallActorId: null,
  voteWallSquarePhotos: Array.from({ length: VOTE_WALL_TOTAL }, () => null),
  voteWallNextSquareIndex: 0,
  voteWallLastPlacedIndex: null,
  guestJudges: [],
  candidates: INITIAL_CANDIDATES,
  judges: INITIAL_JUDGES,
  judgeImageTools: buildJudgeImageToolMap(INITIAL_JUDGES),
  checkInWindowStartedAt: null,
  checkInDuration: 20,
  judgeVotes: {
    1: { 1: null, 2: null, 3: null },
    2: { 1: null, 2: null, 3: null },
    3: { 1: null, 2: null, 3: null },
    4: { 1: null, 2: null, 3: null },
  },
  branding: {
    broadcastDate: "Series Premiere June 22",
    broadcastTime: "Sundays 9|8c",
    themeColor: "#d4af37",
    accentColor: "#22c55e",
    headerTitle: "RISING STAR",
    readyText: "Ready to vote?",
    checkInText: "Check-in to vote",
    swipeYesText: "YES",
    swipeNoText: "NO",
  },
  soundEffects: {
    yes: null,
    no: null,
  },
};

const HostCountdown = ({ startedAt, duration }: { startedAt: number; duration: number }) => {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, duration - Math.floor((Date.now() - startedAt) / 1000)),
  );
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const r = Math.max(0, duration - elapsed);
      setRemaining(r);
      if (r <= 0) {
        clearInterval(interval);
      }
    }, 200);
    return () => clearInterval(interval);
  }, [startedAt, duration]);
  const pct = duration > 0 ? (remaining / duration) * 100 : 0;
  return (
    <div className="relative flex h-12 w-12 items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(0,0,0,0.1)" strokeWidth="4" />
        <circle
          cx="24"
          cy="24"
          r="20"
          fill="none"
          stroke={remaining <= 5 ? "#ef4444" : "#dc2626"}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={String(2 * Math.PI * 20)}
          strokeDashoffset={String(2 * Math.PI * 20 * (1 - pct / 100))}
          style={{ transition: "stroke-dashoffset 0.2s linear" }}
        />
      </svg>
      <span className="relative z-10 tabular-nums text-base font-black">{remaining}</span>
    </div>
  );
};

const IosSpinner = ({
  size = "lg",
  color = "#ffffff",
  animated = true,
}: {
  size?: "lg" | "sm";
  color?: string;
  animated?: boolean;
}) => {
  const dim = size === "lg" ? 72 : 24;
  const spokeW = size === "lg" ? 4 : 2;
  const spokeH = size === "lg" ? 14 : 7;
  const spokeOffset = size === "lg" ? 24 : 8;
  const totalSpokes = 12;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: dim, height: dim }}>
      {animated ? (
        <motion.div
          className="absolute inset-0"
          animate={{ rotate: 360 }}
          transition={{ duration: 2.1, repeat: Infinity, ease: "linear" }}
        >
          {Array.from({ length: totalSpokes }).map((_, index) => (
            <motion.span
              key={index}
              className="absolute left-1/2 top-1/2 rounded-full"
              animate={{ opacity: [0.14, 1, 0.14] }}
              transition={{
                duration: 1.3,
                repeat: Infinity,
                ease: "easeInOut",
                delay: (index / totalSpokes) * 1.3,
              }}
              style={{
                width: spokeW,
                height: spokeH,
                backgroundColor: color,
                transform: `translate(-50%, -50%) rotate(${index * (360 / totalSpokes)}deg) translateY(-${spokeOffset}px)`,
                transformOrigin: "center",
              }}
            />
          ))}
        </motion.div>
      ) : (
        <div className="absolute inset-0">
          {Array.from({ length: totalSpokes }).map((_, index) => (
            <span
              key={index}
              className="absolute left-1/2 top-1/2 rounded-full"
              style={{
                width: spokeW,
                height: spokeH,
                backgroundColor: color,
                opacity: 0.2 + ((totalSpokes - index) / totalSpokes) * 0.75,
                transform: `translate(-50%, -50%) rotate(${index * (360 / totalSpokes)}deg) translateY(-${spokeOffset}px)`,
                transformOrigin: "center",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const CrystalStarLogo = ({ className }: { className?: string }) => {
  return (
    <svg viewBox="0 0 120 120" className={cn("drop-shadow-[0_0_30px_rgba(212,175,55,0.42)]", className)} aria-hidden="true">
      <defs>
        <radialGradient id="crystalCore" cx="42%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#fffdf6" stopOpacity="0.88" />
          <stop offset="35%" stopColor="#ffe8b3" stopOpacity="0.58" />
          <stop offset="70%" stopColor="#d9ae55" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#6d4b1b" stopOpacity="0.5" />
        </radialGradient>
        <linearGradient id="crystalFacetA" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.76" />
          <stop offset="55%" stopColor="#ffe2a1" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#b78635" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id="crystalFacetB" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fffdf4" stopOpacity="0.78" />
          <stop offset="55%" stopColor="#efca80" stopOpacity="0.36" />
          <stop offset="100%" stopColor="#6f4e1d" stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id="crystalEdge" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fff9e8" stopOpacity="0.9" />
          <stop offset="52%" stopColor="#e1b560" stopOpacity="0.58" />
          <stop offset="100%" stopColor="#6a4918" stopOpacity="0.72" />
        </linearGradient>
        <clipPath id="crystalStarClip">
          <path d="M60 6 L71.4 48.6 L114 60 L71.4 71.4 L60 114 L48.6 71.4 L6 60 L48.6 48.6 Z" />
        </clipPath>
      </defs>
      <path d="M60 4 L72 48 L116 60 L72 72 L60 116 L48 72 L4 60 L48 48 Z" fill="url(#crystalCore)" />
      <path d="M60 6 L66 49 L60 60 L54 49 Z M114 60 L71 66 L60 60 L71 54 Z M60 114 L54 71 L60 60 L66 71 Z M6 60 L49 54 L60 60 L49 66 Z" fill="url(#crystalEdge)" opacity="0.62" />
      <path
        d="M60 10 L68 50 L110 60 L68 70 L60 110 L52 70 L10 60 L52 50 Z"
        fill="url(#crystalFacetA)"
        opacity="0.88"
      />
      <path d="M60 14 L64 53 L102 60 L64 67 L60 106 L56 67 L18 60 L56 53 Z" fill="url(#crystalFacetB)" opacity="0.62" />
      <g clipPath="url(#crystalStarClip)">
        <polygon points="60,12 74,49 60,60 46,49" fill="#ffffff" opacity="0.18" />
        <polygon points="108,60 71,74 60,60 71,46" fill="#ffe7b8" opacity="0.14" />
        <polygon points="60,108 46,71 60,60 74,71" fill="#f0c675" opacity="0.15" />
        <polygon points="12,60 49,46 60,60 49,74" fill="#fff1cf" opacity="0.13" />
      </g>
      <path d="M60 8 L68 50 L112 60 L68 70 L60 112 L52 70 L8 60 L52 50 Z" fill="url(#crystalEdge)" opacity="0.16" />
    </svg>
  );
};

const PortraitFrame = ({ children }: { children: ReactNode }) => {
  return (
    <div className="flex min-h-screen items-center justify-center overflow-hidden bg-black font-sans">
      <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-black md:max-h-[850px] md:max-w-[450px] md:aspect-[9/16] animate-in fade-in duration-700">
        <div className="relative flex flex-grow flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  );
};

const VotingFrame = ({ children }: { children: ReactNode }) => {
  return (
    <div className="flex min-h-screen items-center justify-center overflow-hidden bg-black font-sans">
      <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-black md:max-h-[850px] md:max-w-[450px] md:aspect-[9/16] animate-in fade-in duration-700">
        <div className="relative flex flex-grow flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  );
};

const VoteWallFrame = ({ children }: { children: ReactNode }) => {
  return (
    <div className="flex min-h-screen items-center justify-center overflow-hidden bg-black font-sans">
      <div className="relative flex h-[100dvh] w-[100vw] flex-col overflow-hidden bg-black aspect-[16/9] animate-in fade-in duration-700">
        <div className="relative flex flex-grow flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  );
};

const GuestSignInForm = ({ onComplete }: { onComplete: (name: string, title: string, photo: string) => void }) => {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [photo, setPhoto] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="mt-4 w-full rounded-xl border border-dashed border-[#776a35] py-4 text-sm font-bold text-[#b8a97a] hover:bg-[#1a130b]"
      >
        + Sign In as New Guest Judge
      </button>
    );
  }

  const handlePhotoUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <div className="mt-6 space-y-4 rounded-2xl border-2 border-[#776a35] bg-[#0a0704] p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[#f1e7c1] uppercase">Guest Judge Registration</h3>
        <button onClick={() => setIsExpanded(false)} className="text-[#9f9470] hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Full Name"
        className="w-full rounded-xl border border-[#5f552d] bg-[#1e160d] px-4 py-2 text-sm text-[#f1e7c1]"
      />
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (e.g. Music Critic)"
        className="w-full rounded-xl border border-[#5f552d] bg-[#1e160d] px-4 py-2 text-sm text-[#f1e7c1]"
      />
      <div className="flex gap-2">
        <input
          type="text"
          value={photo}
          onChange={(e) => setPhoto(e.target.value)}
          placeholder="Photo URL"
          className="flex-1 rounded-xl border border-[#5f552d] bg-[#1e160d] px-4 py-2 text-xs text-[#f1e7c1]"
        />
        <button
          type="button"
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/*";
            input.onchange = (e: any) => {
              const file = e.target.files?.[0];
              if (file) handlePhotoUpload(file);
            };
            input.click();
          }}
          className="rounded-lg border border-[#9b8750] bg-[#2b2112] px-3 py-1 text-xs font-bold text-[#f1e7c1]"
        >
          Upload
        </button>
      </div>
      <button
        onClick={() => name && title && photo && onComplete(name, title, photo)}
        className="w-full rounded-xl bg-[#776a35] py-3 text-sm font-bold text-white hover:bg-[#d9c27a]"
      >
        Confirm & Enter Voting
      </button>
    </div>
  );
};

const GuestEditor = ({
  guest,
  guestIdx,
  session,
  updateSession,
}: {
  guest: GuestJudge;
  guestIdx: number;
  session: SessionState;
  updateSession: (updates: Partial<SessionState>) => void;
}) => {
  const [localGuest, setLocalGuest] = useState(guest);
  
  useEffect(() => {
    setLocalGuest(guest);
  }, [guest.id]);
  
  const updateGuest = () => {
    const nextGuestJudges = [...session.guestJudges];
    nextGuestJudges[guestIdx] = localGuest;
    updateSession({ guestJudges: nextGuestJudges });
  };
  
  return (
    <div className="space-y-3 rounded-xl border border-[#3d341d] bg-[#140f08] p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black tracking-widest text-[#d9c27a] uppercase">Guest {guestIdx + 1}</p>
        <button
          type="button"
          onClick={() => {
            const nextGuestJudges = session.guestJudges.filter((g) => g.id !== guest.id);
            const candidateId = session.currentCandidateId;
            const nextGuestYesByCandidate = { ...session.guestYesByCandidate };
            if (candidateId) {
              nextGuestYesByCandidate[candidateId] = Math.min(
                nextGuestJudges.length,
                nextGuestYesByCandidate[candidateId] || 0,
              );
            }
            updateSession({
              guestJudges: nextGuestJudges,
              guestJudgeCount: nextGuestJudges.length,
              guestYesByCandidate: nextGuestYesByCandidate,
            });
          }}
          className="text-xs font-bold text-red-400 hover:text-red-300"
        >
          Remove
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-gray-400 uppercase">Name</label>
          <input
            type="text"
            value={localGuest.name}
            onChange={(e) => setLocalGuest({ ...localGuest, name: e.target.value })}
            onBlur={updateGuest}
            className="w-full rounded-lg border border-[#5f552d] bg-[#1e160d] px-3 py-2 text-sm text-[#f1e7c1]"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-gray-400 uppercase">Title</label>
          <input
            type="text"
            value={localGuest.title}
            onChange={(e) => setLocalGuest({ ...localGuest, title: e.target.value })}
            onBlur={updateGuest}
            className="w-full rounded-lg border border-[#5f552d] bg-[#1e160d] px-3 py-2 text-sm text-[#f1e7c1]"
          />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-[10px] font-bold text-gray-400 uppercase">Photo URL</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={localGuest.image}
            onChange={(e) => setLocalGuest({ ...localGuest, image: e.target.value })}
            onBlur={updateGuest}
            className="flex-1 rounded-lg border border-[#5f552d] bg-[#1e160d] px-3 py-2 text-xs text-[#f1e7c1]"
          />
          <button
            type="button"
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/*";
              input.onchange = (e: any) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = () => {
                    const nextGuestJudges = [...session.guestJudges];
                    nextGuestJudges[guestIdx] = { ...nextGuestJudges[guestIdx], image: reader.result as string };
                    updateSession({ guestJudges: nextGuestJudges });
                  };
                  reader.readAsDataURL(file);
                }
              };
              input.click();
            }}
            className="rounded-lg border border-[#9b8750] bg-[#2b2112] px-3 py-1 text-xs font-bold text-[#f1e7c1]"
          >
            Upload
          </button>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [role, setRole] = useState<AppRole>("guest");
  const [session, setSession] = useState<SessionState>(DEFAULT_SESSION);
  const [checkedInCandidateId, setCheckedInCandidateId] = useState<number | null>(null);
  const [hasVotedThisRound, setHasVotedThisRound] = useState<{ id: number; type: "yes" | "no" } | null>(null);
  const [currentJudge, setCurrentJudge] = useState<JudgeId | null>(null);
  const [currentGuestJudgeId, setCurrentGuestJudgeId] = useState<number | null>(null);
  const [cutoutBusyJudgeId, setCutoutBusyJudgeId] = useState<number | null>(null);
  const judgeUploadInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const [audienceUser, setAudienceUser] = useState<AudienceProfile | null>(null);
  const previousRoundRef = useRef<{ status: CompetitionStatus; candidateId: number | null }>({
    status: DEFAULT_SESSION.status,
    candidateId: DEFAULT_SESSION.currentCandidateId,
  });

  const voterId = useMemo(() => {
    const existing = localStorage.getItem(VOTER_ID_KEY);
    if (existing) return existing;
    const created = `voter_${Math.random().toString(36).slice(2, 11)}_${Date.now().toString(36)}`;
    localStorage.setItem(VOTER_ID_KEY, created);
    return created;
  }, []);

  useEffect(() => {
    const savedCurrent = localStorage.getItem(AUDIENCE_CURRENT_KEY);
    if (savedCurrent) {
      try {
        setAudienceUser(JSON.parse(savedCurrent) as AudienceProfile);
      } catch {
        setAudienceUser(null);
      }
    }
  }, []);

  useEffect(() => {
    const hydrateFromStorage = (raw: string | null) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as Partial<SessionState>;
        const merged: SessionState = {
          ...DEFAULT_SESSION,
          ...parsed,
          results: { ...DEFAULT_SESSION.results, ...(parsed.results || {}) },
          checkedInVoters: { ...DEFAULT_SESSION.checkedInVoters, ...(parsed.checkedInVoters || {}) },
          audienceVotes: { ...DEFAULT_SESSION.audienceVotes, ...(parsed.audienceVotes || {}) },
          guestYesByCandidate: {
            ...DEFAULT_SESSION.guestYesByCandidate,
            ...(parsed.guestYesByCandidate || {}),
          },
          guestVotesByCandidate: {
            ...DEFAULT_SESSION.guestVotesByCandidate,
            ...(parsed.guestVotesByCandidate || {}),
          },
          audienceProfiles: { ...DEFAULT_SESSION.audienceProfiles, ...(parsed.audienceProfiles || {}) },
          voteWallPhoto: parsed.voteWallPhoto ?? DEFAULT_SESSION.voteWallPhoto,
          voteWallPulse: parsed.voteWallPulse ?? DEFAULT_SESSION.voteWallPulse,
          voteWallActor: parsed.voteWallActor ?? DEFAULT_SESSION.voteWallActor,
          voteWallActorId: parsed.voteWallActorId ?? DEFAULT_SESSION.voteWallActorId,
          voteWallSquarePhotos: normalizeVoteWallSquares(parsed.voteWallSquarePhotos),
          voteWallNextSquareIndex: Math.max(
            0,
            Math.min(VOTE_WALL_TOTAL, parsed.voteWallNextSquareIndex ?? DEFAULT_SESSION.voteWallNextSquareIndex),
          ),
          voteWallLastPlacedIndex: parsed.voteWallLastPlacedIndex ?? DEFAULT_SESSION.voteWallLastPlacedIndex,
          guestJudgeCount: parsed.guestJudgeCount ?? DEFAULT_SESSION.guestJudgeCount,
          guestJudges: parsed.guestJudges || DEFAULT_SESSION.guestJudges,
          branding: { ...DEFAULT_SESSION.branding, ...(parsed.branding || {}) },
          judgeVotes: { ...DEFAULT_SESSION.judgeVotes, ...(parsed.judgeVotes || {}) },
          candidates: normalizeCandidateImages(parsed.candidates || DEFAULT_SESSION.candidates),
          judges: normalizeJudgeImages(parsed.judges || DEFAULT_SESSION.judges),
          judgeImageTools: mergeJudgeImageTools(
            normalizeJudgeImages(parsed.judges || DEFAULT_SESSION.judges),
            parsed.judgeImageTools,
          ),
          soundEffects: parsed.soundEffects || DEFAULT_SESSION.soundEffects,
        };
        setSession(merged);
      } catch {
        setSession(DEFAULT_SESSION);
      }
    };

    hydrateFromStorage(localStorage.getItem(STORAGE_KEY));

    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      hydrateFromStorage(event.newValue);
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const updateSession = (updates: Partial<SessionState>) => {
    let newState = { ...session, ...updates };

    // Auto-vote NO logic: When status moves to "waiting-results", all checked-in participants 
    // who haven't voted yet are recorded as "no".
    if (updates.status === "waiting-results" && newState.currentCandidateId) {
      const cid = newState.currentCandidateId;
      const nextJudgeVotes = { ...(newState.judgeVotes[cid] || { 1: null, 2: null, 3: null }) };
      const nextGuestVotes = { ...(newState.guestVotesByCandidate[cid] || {}) };
      const nextAudienceVotes = { ...(newState.audienceVotes[cid] || {}) };

      // Auto-vote for Judges
      ([1, 2, 3] as JudgeId[]).forEach((id) => {
        if (nextJudgeVotes[id] === null) nextJudgeVotes[id] = "no";
      });

      // Auto-vote for Guest Judges
      newState.guestJudges.forEach((guest) => {
        if (nextGuestVotes[guest.id] === null || nextGuestVotes[guest.id] === undefined) {
          nextGuestVotes[guest.id] = "no";
        }
      });

      // Auto-vote for checked-in Audience
      const checkedIn = newState.checkedInVoters[cid] || [];
      checkedIn.forEach((vId) => {
        if (!nextAudienceVotes[vId]) {
          nextAudienceVotes[vId] = "no";
        }
      });

      newState = {
        ...newState,
        judgeVotes: { ...newState.judgeVotes, [cid]: nextJudgeVotes },
        guestVotesByCandidate: { ...newState.guestVotesByCandidate, [cid]: nextGuestVotes },
        audienceVotes: { ...newState.audienceVotes, [cid]: nextAudienceVotes },
      };
    }

    setSession(newState);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
    return newState;
  };

  useEffect(() => {
    const prev = previousRoundRef.current;
    const startedPerformanceForRound =
      session.status === "performance" &&
      (prev.status !== "performance" || prev.candidateId !== session.currentCandidateId);

    if (startedPerformanceForRound) {
      const clearedWallPhotos = Array.from({ length: VOTE_WALL_TOTAL }, () => null as string | null);
      const nextState: SessionState = {
        ...session,
        voteWallPhoto: null,
        voteWallActor: null,
        voteWallActorId: null,
        voteWallSquarePhotos: clearedWallPhotos,
        voteWallNextSquareIndex: 0,
        voteWallLastPlacedIndex: null,
      };
      setSession(nextState);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    }

    previousRoundRef.current = { status: session.status, candidateId: session.currentCandidateId };
  }, [session]);





  // Get a random empty square index from the vote wall
  const getRandomEmptySquareIndex = (squarePhotos: Array<string | null>): number => {
    const emptyIndices = squarePhotos
      .map((photo, index) => (photo === null ? index : -1))
      .filter((index) => index !== -1);
    
    if (emptyIndices.length === 0) return -1;
    
    const randomIndex = Math.floor(Math.random() * emptyIndices.length);
    return emptyIndices[randomIndex];
  };

  const resetAll = () => {
    // Preserve sound effects unless host manually changes them
    const preservedSoundEffects = { ...session.soundEffects };
    const resetSession = {
      ...DEFAULT_SESSION,
      soundEffects: preservedSoundEffects,
    };
    setSession(resetSession);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(resetSession));
    setCheckedInCandidateId(null);
    setHasVotedThisRound(null);
    setCurrentJudge(null);
    setCurrentGuestJudgeId(null);
  };

  const getJudgeImageTool = (judge: Judge): JudgeImageTool => {
    return session.judgeImageTools[judge.id] || createJudgeImageTool(judge.image);
  };

  const getJudgeDisplayImage = (judge: Judge): string => {
    const tool = getJudgeImageTool(judge);
    return tool.cutoutImage && tool.removeBackground ? tool.cutoutImage : tool.sourceImage;
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const updateJudgeImageSource = (_judgeIndex: number, _sourceImage: string) => {};

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleJudgePhotoUpload = (_judgeIndex: number, _file: File) => {};

  const generateJudgeCutout = async (judge: Judge) => {
    setCutoutBusyJudgeId(judge.id);
    try {
      const tool = getJudgeImageTool(judge);
      const cutout = await createJudgeCutoutPng(tool.sourceImage, tool.threshold, tool.softness);
      const newTools = { ...session.judgeImageTools };
      newTools[judge.id] = { ...newTools[judge.id], cutoutImage: cutout };
      updateSession({ judgeImageTools: newTools });
    } catch {
      console.error("Failed to generate cutout");
    } finally {
      setCutoutBusyJudgeId(null);
    }
  };

  const updateJudgeTool = (judgeId: number, updates: Partial<JudgeImageTool>) => {
    const newTools = { ...session.judgeImageTools };
    newTools[judgeId] = { ...newTools[judgeId], ...updates };
    updateSession({ judgeImageTools: newTools });
  };

  const getFinalResult = (candidateId: number | null) => {
    if (!candidateId) {
      return {
        percent: 0,
        judgeYes: 0,
        judgeTotal: 0,
        audYes: 0,
        audTotal: 0,
        audPercent: 0,
        guestBoostPercent: 0,
        totalVotesReceived: 0,
        audienceWeightContribution: 0,
        judge1Contribution: 0,
        judge2Contribution: 0,
        judge3Contribution: 0,
        guestWeightContribution: 0,
      };
    }

    const judgeVoteState = session.judgeVotes[candidateId] || { 1: null, 2: null, 3: null };
    const judge1Contribution = judgeVoteState[1] === "yes" ? 5 : 0;
    const judge2Contribution = judgeVoteState[2] === "yes" ? 5 : 0;
    const judge3Contribution = judgeVoteState[3] === "yes" ? 5 : 0;
    const judgeYes = [judgeVoteState[1], judgeVoteState[2], judgeVoteState[3]].filter(
      (vote) => vote === "yes",
    ).length;

    const guestVotesState = session.guestVotesByCandidate[candidateId] || {};
    const guestConfiguredCount = session.guestJudges.length;
    const guestWeightBudget = Math.min(85, guestConfiguredCount * 1);
    const audienceWeightBudget = Math.max(0, 85 - guestWeightBudget);
    const guestYesCount = session.guestJudges.filter(
      (guest) => guestVotesState[guest.id] === "yes",
    ).length;
    const guestWeightContribution = guestYesCount * 1;

    const audienceVoteState = session.audienceVotes[candidateId] || {};
    const audienceChoices = Object.values(audienceVoteState);
    const audTotal = audienceChoices.length;
    const audYes = audienceChoices.filter((vote) => vote === "yes").length;
    const audPercent = audTotal > 0 ? (audYes / audTotal) * 100 : 0;
    const audienceWeightContribution = (audPercent / 100) * audienceWeightBudget;

    const percent =
      judge1Contribution +
      judge2Contribution +
      judge3Contribution +
      guestWeightContribution +
      audienceWeightContribution;

    const judgeVotesCast = [judgeVoteState[1], judgeVoteState[2], judgeVoteState[3]].filter(
      (vote) => vote !== null,
    ).length;
    const guestVotesCast = session.guestJudges.filter(
      (guest) => guestVotesState[guest.id] !== null && guestVotesState[guest.id] !== undefined,
    ).length;

    return {
      percent: Number(percent.toFixed(4)),
      judgeYes,
      judgeTotal: 3,
      audYes,
      audTotal,
      audPercent: Number(audPercent.toFixed(4)),
      guestBoostPercent: Number(guestWeightContribution.toFixed(4)),
      totalVotesReceived: audTotal + judgeVotesCast + guestVotesCast,
      audienceWeightContribution: Number(audienceWeightContribution.toFixed(4)),
      judge1Contribution,
      judge2Contribution,
      judge3Contribution,
      guestWeightContribution: Number(guestWeightContribution.toFixed(4)),
    };
  };

  const handleJudgeVote = (candidateId: number, judgeId: JudgeId, isYes: boolean) => {
    playVoteSound(isYes);
    const newJudgeVotes = { ...session.judgeVotes[candidateId] };
    newJudgeVotes[judgeId] = isYes ? "yes" : "no";
    const newResults = { ...session.results[candidateId] };
    const previousVote = session.judgeVotes[candidateId][judgeId];
    if (previousVote === "yes" && !isYes) {
      newResults.yes -= 1;
      newResults.no += 1;
    } else if (previousVote === "no" && isYes) {
      newResults.yes += 1;
      newResults.no -= 1;
    } else if (!previousVote) {
      if (isYes) newResults.yes += 1;
      else newResults.no += 1;
    }
    const judgePhoto = getJudgeDisplayImage(session.judges.find((j: Judge) => j.id === judgeId) || session.judges[0]);
    const nextSquarePhotos = [...session.voteWallSquarePhotos];
    
    // Place photo in a random empty square
    const randomSquareIndex = getRandomEmptySquareIndex(nextSquarePhotos);
    const canPlaceJudgePhoto = isYes && randomSquareIndex !== -1;
    if (canPlaceJudgePhoto) {
      nextSquarePhotos[randomSquareIndex] = judgePhoto;
    }

    updateSession({
      judgeVotes: { ...session.judgeVotes, [candidateId]: newJudgeVotes },
      results: { ...session.results, [candidateId]: newResults },
      voteWallPhoto: isYes ? judgePhoto : session.voteWallPhoto,
      voteWallActor: isYes ? "judge" : session.voteWallActor,
      voteWallActorId: isYes ? judgeId : session.voteWallActorId,
      voteWallPulse: isYes ? session.voteWallPulse + 1 : session.voteWallPulse,
      voteWallSquarePhotos: canPlaceJudgePhoto ? nextSquarePhotos : session.voteWallSquarePhotos,
      voteWallLastPlacedIndex: canPlaceJudgePhoto ? randomSquareIndex : session.voteWallLastPlacedIndex,
    });
  };

  const handleGuestJudgeVote = (isYes: boolean) => {
    playVoteSound(isYes);
    const candidateId = session.currentCandidateId;
    const guestJudgeId = currentGuestJudgeId;
    if (!candidateId || !guestJudgeId) return;

    const newGuestVotes = { ...session.guestVotesByCandidate[candidateId] };
    const previousVote = newGuestVotes[guestJudgeId] ?? null;
    newGuestVotes[guestJudgeId] = isYes ? "yes" : "no";
    const newGuestYesByCandidate = { ...session.guestYesByCandidate };
    const previousYesCount = newGuestYesByCandidate[candidateId] || 0;
    let nextYesCount = previousYesCount;
    if (previousVote === "yes" && !isYes) {
      nextYesCount = Math.max(0, previousYesCount - 1);
    } else if (previousVote !== "yes" && isYes) {
      nextYesCount = previousYesCount + 1;
    }
    newGuestYesByCandidate[candidateId] = nextYesCount;
    const guestPhoto = session.guestJudges.find((g: GuestJudge) => g.id === guestJudgeId)?.image || null;
    const nextSquarePhotos = [...session.voteWallSquarePhotos];
    
    // Place photo in a random empty square
    const randomSquareIndex = getRandomEmptySquareIndex(nextSquarePhotos);
    const canPlaceGuestPhoto = !!guestPhoto && randomSquareIndex !== -1;
    if (canPlaceGuestPhoto) {
      nextSquarePhotos[randomSquareIndex] = guestPhoto;
    }
    updateSession({
      guestVotesByCandidate: { ...session.guestVotesByCandidate, [candidateId]: newGuestVotes },
      guestYesByCandidate: newGuestYesByCandidate,
      voteWallPhoto: guestPhoto,
      voteWallActor: "guest",
      voteWallActorId: guestJudgeId,
      voteWallPulse: session.voteWallPulse + 1,
      voteWallSquarePhotos: canPlaceGuestPhoto ? nextSquarePhotos : session.voteWallSquarePhotos,
      voteWallLastPlacedIndex: canPlaceGuestPhoto ? randomSquareIndex : session.voteWallLastPlacedIndex,
    });
  };



  const openAudienceVoting = () => {
    if (audienceUser) {
      setRole("voter");
    } else {
      setRole("audience-auth");
    }
  };

  const enterAudienceVoting = (profile: AudienceProfile) => {
    setAudienceUser(profile);
    localStorage.setItem(AUDIENCE_CURRENT_KEY, JSON.stringify(profile));
    const accountsRaw = localStorage.getItem(AUDIENCE_ACCOUNTS_KEY);
    let accounts: AudienceProfile[] = [];
    if (accountsRaw) {
      try {
        accounts = JSON.parse(accountsRaw) as AudienceProfile[];
      } catch {
        accounts = [];
      }
    }
    const filtered = accounts.filter((a) => a.email.toLowerCase() !== profile.email.toLowerCase());
    localStorage.setItem(AUDIENCE_ACCOUNTS_KEY, JSON.stringify([...filtered, profile]));
    setRole("voter");
  };

  const handleHostLogin = () => {
    setRole("host");
  };

  const playVoteSound = (isYes: boolean) => {
    const soundUrl = isYes ? session.soundEffects.yes : session.soundEffects.no;
    if (soundUrl) {
      const audio = new Audio(soundUrl);
      audio.play().catch((e) => console.error("Sound play failed", e));
    }
  };

  const createJudgeCutoutPng = async (source: string, threshold: number, softness: number) => {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load image for cutout."));
      img.src = source;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable.");
    ctx.drawImage(image, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    let sampleR = 0, sampleG = 0, sampleB = 0, sampleCount = 0;
    const step = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) / 120));
    for (let x = 0; x < canvas.width; x += step) {
      const topIndex = (x + 0 * canvas.width) * 4;
      const bottomIndex = (x + (canvas.height - 1) * canvas.width) * 4;
      sampleR += data[topIndex] + data[bottomIndex];
      sampleG += data[topIndex + 1] + data[bottomIndex + 1];
      sampleB += data[topIndex + 2] + data[bottomIndex + 2];
      sampleCount += 2;
    }
    for (let y = 0; y < canvas.height; y += step) {
      const leftIndex = (0 + y * canvas.width) * 4;
      const rightIndex = (canvas.width - 1 + y * canvas.width) * 4;
      sampleR += data[leftIndex] + data[rightIndex];
      sampleG += data[leftIndex + 1] + data[rightIndex + 1];
      sampleB += data[leftIndex + 2] + data[rightIndex + 2];
      sampleCount += 2;
    }
    const bgR = sampleCount ? sampleR / sampleCount : 0;
    const bgG = sampleCount ? sampleG / sampleCount : 0;
    const bgB = sampleCount ? sampleB / sampleCount : 0;
    const safeThreshold = Math.max(0, Math.min(255, threshold));
    const safeSoftness = Math.max(1, Math.min(255, softness));
    for (let i = 0; i < data.length; i += 4) {
      const dr = data[i] - bgR;
      const dg = data[i + 1] - bgG;
      const db = data[i + 2] - bgB;
      const distance = Math.sqrt(dr * dr + dg * dg + db * db);
      const alphaIndex = i + 3;
      if (distance <= safeThreshold) {
        data[alphaIndex] = 0;
      } else if (distance <= safeThreshold + safeSoftness) {
        const blend = (distance - safeThreshold) / safeSoftness;
        data[alphaIndex] = Math.round(data[alphaIndex] * blend);
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL("image/png");
  };

  const HostView = useMemo(
    () =>
      function HostViewComponent({
        session,
        setRole,
        updateSession,
        resetAll,
        VoterViewComponent,
        getJudgeImageTool,
        getJudgeDisplayImage,
        updateJudgeImageSource,
        handleJudgePhotoUpload,
        generateJudgeCutout,
        cutoutBusyJudgeId,
        judgeUploadInputRefs,
        updateJudgeTool,
        getFinalResult,
      }: HostViewProps) {
        const [activeTab, setActiveTab] = useState<"controls" | "editor">("controls");
        const handleBrandingChange = (key: keyof SessionState["branding"], value: string) => {
          updateSession({ branding: { ...session.branding, [key]: value } });
        };
        const activeCandidate =
          session.currentCandidateId !== null
            ? session.candidates.find((candidate: Candidate) => candidate.id === session.currentCandidateId) || null
            : null;
        const liveResult = getFinalResult(session.currentCandidateId);
        return (
          <div className="min-h-screen bg-[#0c0a09] font-sans text-white">
            <nav className="sticky top-0 z-30 flex items-center justify-between border-b border-[#5f552d] bg-[#140f08]/95 px-6 py-4 shadow-[0_6px_22px_rgba(0,0,0,0.45)] backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-6 w-6 text-[#d9c27a]" />
                <span className="text-lg font-bold">Host Dashboard</span>
              </div>
              <div className="flex items-center gap-6">
                <div className="flex rounded-xl border border-[#6f6336] bg-[#1b140c] p-1">
                  <button
                    onClick={() => setActiveTab("controls")}
                    className={cn(
                      "rounded-lg px-4 py-2 text-sm font-bold",
                      activeTab === "controls"
                        ? "bg-[#2a2011] text-[#f5e7ba] shadow-[inset_0_0_0_1px_rgba(217,194,122,0.25)]"
                        : "text-[#a79769]",
                    )}
                  >
                    Controls
                  </button>
                  <button
                    onClick={() => setActiveTab("editor")}
                    className={cn(
                      "rounded-lg px-4 py-2 text-sm font-bold",
                      activeTab === "editor"
                        ? "bg-[#2a2011] text-[#f5e7ba] shadow-[inset_0_0_0_1px_rgba(217,194,122,0.25)]"
                        : "text-[#a79769]",
                    )}
                  >
                    UI Editor
                  </button>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] font-black tracking-widest text-[#9f9470] uppercase">Active Voters</span>
                  <span className="text-sm font-bold text-[#e5cf89]">{session.voterCount} Online</span>
                </div>
                <button onClick={() => setRole("guest")} className="p-2 text-[#b8a97a] transition-colors hover:text-[#f5e7ba]">
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            </nav>
            <main className="mx-auto max-w-4xl space-y-8 p-6">
              {activeTab === "controls" ? (
                <div className="space-y-8">
                  <section className="rounded-3xl border border-[#6f6336] bg-[#140f08] p-8 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
                    <div className="mb-8 flex items-center justify-between">
                      <h2 className="text-2xl font-bold">Session Control</h2>
                      <button
                        onClick={resetAll}
                        className="flex items-center gap-1 rounded-lg border border-[#6f6336] bg-[#1e160d] px-3 py-1 text-xs font-bold text-[#b8a97a] transition-colors hover:bg-[#2a2011]"
                      >
                        <RotateCcw className="h-3 w-3" /> Reset Session
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
                      <button
                        onClick={() =>
                          updateSession({
                            status: "idle",
                            currentCandidateId: null,
                            checkInWindowStartedAt: null,
                          })
                        }
                        className={cn(
                          "flex flex-col items-center gap-3 rounded-2xl border-2 p-6 transition-all",
                          session.status === "idle"
                            ? "border-[#d9c27a] bg-[#2a2011] text-[#f1e7c1]"
                            : "border-[#3d341d] bg-[#140f08] text-[#b8a97a]",
                        )}
                      >
                        <Pause className="h-8 w-8" />
                        <span className="font-bold">Lobby</span>
                      </button>
                      <button
                        onClick={() =>
                          updateSession({
                            checkInWindowStartedAt: Date.now(),
                          })
                        }
                        disabled={!session.currentCandidateId}
                        className={cn(
                          "flex flex-col items-center gap-3 rounded-2xl border-2 p-6 transition-all",
                          session.checkInWindowStartedAt
                            ? "border-[#d9c27a] bg-[#2a2011] text-[#f1e7c1]"
                            : "border-[#3d341d] bg-[#140f08] text-[#b8a97a]",
                        )}
                      >
                        {session.checkInWindowStartedAt ? (
                          <HostCountdown startedAt={session.checkInWindowStartedAt} duration={session.checkInDuration || 20} />
                        ) : (
                          <RotateCcw className="h-8 w-8" />
                        )}
                        <span className="text-center font-bold">
                          {session.checkInWindowStartedAt ? "Check-In Live" : "Start " + String(session.checkInDuration || 20) + "s Check-In"}
                        </span>
                      </button>
                      <button
                        onClick={() => updateSession({ status: "voting" })}
                        disabled={!session.currentCandidateId}
                        className={cn(
                          "flex flex-col items-center gap-3 rounded-2xl border-2 p-6 transition-all",
                          session.status === "voting"
                            ? "border-[#d9c27a] bg-[#2a2011] text-[#f1e7c1]"
                            : "border-[#3d341d] bg-[#140f08] text-[#b8a97a]",
                        )}
                      >
                        <Vote className="h-8 w-8" />
                        <span className="font-bold">Open Voting</span>
                      </button>
                      <button
                        onClick={() => updateSession({ status: "waiting-results" })}
                        disabled={!session.currentCandidateId}
                        className={cn(
                          "flex flex-col items-center gap-3 rounded-2xl border-2 p-6 transition-all",
                          session.status === "waiting-results"
                            ? "border-[#d9c27a] bg-[#2a2011] text-[#f1e7c1]"
                            : "border-[#3d341d] bg-[#140f08] text-[#b8a97a]",
                        )}
                      >
                        <IosSpinner size="sm" color="#ffffff" animated={false} />
                        <span className="font-bold">Wait Results</span>
                      </button>
                      <button
                        onClick={() => updateSession({ status: "results" })}
                        disabled={!session.currentCandidateId}
                        className={cn(
                          "flex flex-col items-center gap-3 rounded-2xl border-2 p-6 transition-all",
                          session.status === "results"
                            ? "border-[#d9c27a] bg-[#2a2011] text-[#f1e7c1]"
                            : "border-[#3d341d] bg-[#140f08] text-[#b8a97a]",
                        )}
                      >
                        <Trophy className="h-8 w-8" />
                        <span className="font-bold">Show Results</span>
                      </button>
                    </div>
                  </section>
                  <section>
                    <h2 className="mb-6 text-xl font-bold">Select Performing Artist</h2>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {session.candidates.map((candidate) => (
                        <div
                          key={candidate.id}
                          className={cn(
                            "flex items-center gap-6 rounded-3xl border-2 bg-[#140f08] p-6 transition-all",
                            session.currentCandidateId === candidate.id
                              ? "border-[#d9c27a] shadow-[0_0_18px_rgba(154,140,92,0.35)]"
                              : "border-[#3d341d]",
                          )}
                        >
                          <img src={candidate.image} className="h-16 w-16 rounded-2xl object-cover" alt="" />
                          <div className="flex-grow">
                            <h4 className="font-bold text-[#f1e7c1]">{candidate.name}</h4>
                            <p className="text-sm text-[#b8a97a]">{candidate.role}</p>
                          </div>
                          <button
                            onClick={() =>
                              updateSession({
                                currentCandidateId: candidate.id,
                                status: "performance",
                                checkInWindowStartedAt: null,
                              })
                            }
                            className="rounded-xl border border-[#9b8750] bg-[#2b2112] px-4 py-2 text-sm font-bold text-[#f1e7c1]"
                          >
                            Go Live
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="rounded-3xl border border-[#6f6336] bg-[#140f08] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
                    <div className="mb-4 flex items-center justify-between">
                      <h2 className="text-xl font-bold">Live Results</h2>
                      <span className="text-[10px] font-black tracking-widest text-[#9f9470] uppercase">Auto Updates</span>
                    </div>
                    {activeCandidate ? (
                      <div className="space-y-3">
                        <p className="text-sm font-bold text-[#f1e7c1]">
                          {activeCandidate.name} - {activeCandidate.role}
                        </p>
                        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                          <div className="rounded-xl border border-[#3d341d] bg-[#1a130b] p-3">
                            <p className="text-[10px] font-black tracking-widest text-[#9f9470] uppercase">Final Score</p>
                            <p className="text-lg font-black text-[#f1e7c1]">{liveResult.percent.toFixed(4)}%</p>
                          </div>
                          <div className="rounded-xl border border-[#3d341d] bg-[#1a130b] p-3">
                            <p className="text-[10px] font-black tracking-widest text-[#9f9470] uppercase">Checked-In Users</p>
                            <p className="text-lg font-black text-[#f1e7c1]">{liveResult.audTotal}</p>
                          </div>
                          <div className="rounded-xl border border-[#3d341d] bg-[#1a130b] p-3">
                            <p className="text-[10px] font-black tracking-widest text-[#9f9470] uppercase">Total Votes</p>
                            <p className="text-lg font-black text-[#f1e7c1]">{liveResult.totalVotesReceived}</p>
                          </div>
                          <div className="rounded-xl border border-[#3d341d] bg-[#1a130b] p-3">
                            <p className="text-[10px] font-black tracking-widest text-[#9f9470] uppercase">Audience %</p>
                            <p className="text-lg font-black text-[#f1e7c1]">{liveResult.audPercent.toFixed(4)}%</p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-[#b8a97a]">Select an artist to see live results.</p>
                    )}
                  </section>

                  <section className="rounded-3xl border border-[#6f6336] bg-[#140f08] p-8 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
                    <div className="mb-6 flex items-center justify-between">
                      <h2 className="text-xl font-bold">Guest Management</h2>
                      <button
                        type="button"
                        onClick={() => {
                          const nextId =
                            session.guestJudges.length > 0
                              ? Math.max(...session.guestJudges.map((g) => g.id)) + 1
                              : 1;
                          const nextGuestJudges = [
                            ...session.guestJudges,
                            {
                              id: nextId,
                              name: "Guest Judge",
                              title: "Special Guest",
                              image: "https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&w=400",
                            },
                          ];
                          updateSession({
                            guestJudges: nextGuestJudges,
                            guestJudgeCount: nextGuestJudges.length,
                          });
                        }}
                        className="rounded-lg border border-[#9b8750] bg-[#2b2112] px-3 py-1 text-xs font-bold text-[#f1e7c1]"
                      >
                        + Add Guest
                      </button>
                    </div>
                    <div className="space-y-4">
                      {session.guestJudges.map((guest, guestIdx) => (
                        <GuestEditor
                          key={guest.id}
                          guest={guest}
                          guestIdx={guestIdx}
                          session={session}
                          updateSession={updateSession}
                        />
                      ))}
                    </div>
                  </section>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
                  <div className="flex min-h-[600px] items-center justify-center rounded-[2.5rem] bg-[#140f08] p-8 md:col-span-2">
                    <div className="origin-center scale-[0.8]">
                      <VotingFrame>
                        <VoterViewComponent />
                      </VotingFrame>
                    </div>
                  </div>
                  <div className="space-y-6">
                    <div className="rounded-3xl border border-[#6f6336] bg-[#140f08] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
                      <h3 className="mb-4 text-lg font-bold">Branding &amp; Timing</h3>
                      <div className="space-y-4">
                        <div>
                          <label className="mb-1 block text-[10px] font-black tracking-widest text-[#9f9470] uppercase">Header Title</label>
                          <input
                            type="text"
                            value={session.branding.headerTitle}
                            onChange={(e) => handleBrandingChange("headerTitle", e.target.value)}
                            className="w-full rounded-xl border border-[#5f552d] bg-[#1e160d] px-4 py-2 text-sm text-[#f1e7c1]"
                            placeholder="Title"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-black tracking-widest text-[#9f9470] uppercase">Check-In Duration (seconds)</label>
                          <div className="flex items-center gap-3">
                            <input
                              type="range"
                              min="5"
                              max="120"
                              step="5"
                              value={session.checkInDuration || 20}
                              onChange={(e) => updateSession({ checkInDuration: Number.parseInt(e.target.value, 10) })}
                              className="flex-grow cursor-pointer accent-[#d9c27a]"
                            />
                            <input
                              type="number"
                              min="5"
                              max="120"
                              value={session.checkInDuration || 20}
                              onChange={(e) =>
                                updateSession({
                                  checkInDuration: Math.max(5, Math.min(120, Number.parseInt(e.target.value, 10) || 20)),
                                })
                              }
                              className="w-16 rounded-xl border border-[#5f552d] bg-[#1e160d] px-2 py-2 text-center text-sm font-bold text-[#f1e7c1]"
                            />
                            <span className="text-xs font-bold text-[#b8a97a]">sec</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-3xl border border-[#6f6336] bg-[#140f08] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
                      <h3 className="mb-4 text-lg font-bold">Voting Sound Effects</h3>
                      <div className="space-y-4">
                        <div>
                          <label className="mb-1 block text-[10px] font-black tracking-widest text-[#9f9470] uppercase">"YES" Sound (Green)</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={session.soundEffects.yes || ""}
                              onChange={(e) => updateSession({ soundEffects: { ...session.soundEffects, yes: e.target.value } })}
                              className="flex-grow rounded-xl border border-[#5f552d] bg-[#1e160d] px-4 py-2 text-xs text-[#f1e7c1]"
                              placeholder="URL or base64"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const input = document.createElement("input");
                                input.type = "file";
                                input.accept = "audio/*";
                                input.onchange = (e: any) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    const reader = new FileReader();
                                    reader.onload = () => {
                                      updateSession({ soundEffects: { ...session.soundEffects, yes: reader.result as string } });
                                    };
                                    reader.readAsDataURL(file);
                                  }
                                };
                                input.click();
                              }}
                              className="rounded-lg border border-[#9b8750] bg-[#2b2112] px-3 py-1 text-xs font-bold text-[#f1e7c1]"
                            >
                              Upload
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-black tracking-widest text-[#9f9470] uppercase">"NO" Sound (Red)</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={session.soundEffects.no || ""}
                              onChange={(e) => updateSession({ soundEffects: { ...session.soundEffects, no: e.target.value } })}
                              className="flex-grow rounded-xl border border-[#5f552d] bg-[#1e160d] px-4 py-2 text-xs text-[#f1e7c1]"
                              placeholder="URL or base64"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const input = document.createElement("input");
                                input.type = "file";
                                input.accept = "audio/*";
                                input.onchange = (e: any) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    const reader = new FileReader();
                                    reader.onload = () => {
                                      updateSession({ soundEffects: { ...session.soundEffects, no: reader.result as string } });
                                    };
                                    reader.readAsDataURL(file);
                                  }
                                };
                                input.click();
                              }}
                              className="rounded-lg border border-[#9b8750] bg-[#2b2112] px-3 py-1 text-xs font-bold text-[#f1e7c1]"
                            >
                              Upload
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-[#6f6336] bg-[#140f08] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-lg font-bold">Judges</h3>
                      </div>
                      <div className="max-h-[400px] space-y-4 overflow-y-auto pr-2">
                        {session.judges.map((judge, idx) => {
                          const tool = getJudgeImageTool(judge);
                          const previewImage = getJudgeDisplayImage(judge);
                          return (
                            <div key={judge.id} className="space-y-3 rounded-2xl border border-[#3d341d] bg-[#1a130b] p-4">
                              <div className="flex items-center gap-3 border-b border-[#3d341d] pb-2">
                                <div
                                  className="flex aspect-square h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-white/80 p-0"
                                  style={{
                                    backgroundColor: hexToRgba(tool.backgroundColor, tool.backgroundAlpha),
                                  }}
                                >
                                  <img src={previewImage} alt="" className="h-full w-full object-cover object-center" />
                                </div>
                                <p className="text-xs font-bold tracking-widest text-[#d9c27a] uppercase">Station {judge.id}</p>
                              </div>
                              <div>
                                <label className="mb-1 block text-[10px] font-black tracking-widest text-[#9f9470] uppercase">Name</label>
                                <input
                                  type="text"
                                  value={judge.name}
                                  onChange={(e) => {
                                    const j = [...session.judges];
                                    j[idx] = { ...j[idx], name: e.target.value };
                                    updateSession({ judges: j });
                                  }}
                                  className="w-full rounded-xl border border-[#5f552d] bg-[#140f08] px-3 py-2 text-sm font-bold text-[#f1e7c1]"
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-[10px] font-black tracking-widest text-[#9f9470] uppercase">Title / Role</label>
                                <input
                                  type="text"
                                  value={judge.title}
                                  onChange={(e) => {
                                    const j = [...session.judges];
                                    j[idx] = { ...j[idx], title: e.target.value };
                                    updateSession({ judges: j });
                                  }}
                                  className="w-full rounded-xl border border-[#5f552d] bg-[#140f08] px-3 py-2 text-sm text-[#f1e7c1]"
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  ref={(el) => {
                                    judgeUploadInputRefs.current[judge.id] = el;
                                  }}
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleJudgePhotoUpload(idx, file);
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => judgeUploadInputRefs.current[judge.id]?.click()}
                                  className="rounded-lg border border-[#9b8750] bg-[#2b2112] px-3 py-1 text-xs font-bold text-[#f1e7c1]"
                                >
                                  Upload Photo
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void generateJudgeCutout(judge)}
                                  className="rounded-lg border border-[#9b8750] bg-[#2b2112] px-3 py-1 text-xs font-bold text-[#f1e7c1]"
                                >
                                  {cutoutBusyJudgeId === judge.id ? "Cutting..." : "Generate Cutout"}
                                </button>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <label className="text-[10px] font-black tracking-widest text-[#9f9470] uppercase">
                                  Use Cutout
                                  <input
                                    type="checkbox"
                                    checked={tool.removeBackground}
                                    onChange={(e) => updateJudgeTool(judge.id, { removeBackground: e.target.checked })}
                                    className="mt-1 block h-4 w-4 accent-[#d9c27a]"
                                  />
                                </label>
                                <label className="text-[10px] font-black tracking-widest text-[#9f9470] uppercase">
                                  BG Color
                                  <input
                                    type="color"
                                    value={tool.backgroundColor}
                                    onChange={(e) => updateJudgeTool(judge.id, { backgroundColor: e.target.value })}
                                    className="mt-1 block h-8 w-full"
                                  />
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </main>
          </div>
        );
      },
    [session],
  );

  const VoterView = () => {
    const buttonWidth = 176;
    const buttonHalfWidth = buttonWidth / 2;

    const voteDividerStyle = {
      background:
        "linear-gradient(180deg, rgba(255,255,255,0.34) 0%, rgba(255,255,255,0.14) 45%, rgba(255,255,255,0.32) 100%)",
      boxShadow: "inset 0 0 0.5px rgba(255,255,255,0.25)",
    };

    const [timeLeft, setTimeLeft] = useState<number | null>(null);
    const [activeStarIndex, setActiveStarIndex] = useState(0);
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const checkInTrackRef = useRef<HTMLDivElement | null>(null);
    const checkInThumbRef = useRef<HTMLDivElement | null>(null);

    const xCheckIn = useMotionValue(0);
    const xYes = useMotionValue(-buttonHalfWidth);
    const xNo = useMotionValue(buttonHalfWidth);

    const yesIconRotate = useTransform(xYes, [-buttonHalfWidth, 0], [0, -90]);
    const yesIconRotateSpring = useSpring(yesIconRotate, { stiffness: 85, damping: 13, mass: 1.05 });

    const noIconRotate = useTransform(xNo, [buttonHalfWidth, 0], [0, -90]);
    const noIconRotateSpring = useSpring(noIconRotate, { stiffness: 85, damping: 13, mass: 1.05 });

    const headerTextStyle = {
      fontFamily: '"Oswald", "Arial Narrow", "Segoe UI", sans-serif',
    };
    const footerTextStyle = headerTextStyle;

    const activeCandidate = session.candidates.find(
      (c: Candidate) => c.id === session.currentCandidateId,
    );

    const hasCheckedIn =
      session.currentCandidateId !== null &&
      checkedInCandidateId === session.currentCandidateId;
    const isVotingActive = session.status === "voting";
    const isWaitingForResults = session.status === "waiting-results";

    const isCheckInActive = !!session.checkInWindowStartedAt;
    const showCheckInScreen =
      session.currentCandidateId !== null &&
      (isWaitingForResults ||
        (session.status !== "results" && (!isVotingActive || !hasCheckedIn)));
    const needsCheckIn = showCheckInScreen && !hasCheckedIn && !isWaitingForResults;

    /* ----------------------- Countdown timer ----------------------- */
    useEffect(() => {
      if (session.checkInWindowStartedAt && needsCheckIn) {
        const interval = setInterval(() => {
          const elapsed = Math.floor(
            (Date.now() - session.checkInWindowStartedAt!) / 1000,
          );
          const remaining = Math.max(
            0,
            (session.checkInDuration || 20) - elapsed,
          );
          setTimeLeft(remaining);
          if (remaining <= 0) clearInterval(interval);
        }, 100);
        return () => clearInterval(interval);
      }
      setTimeLeft(null);
    }, [session.checkInWindowStartedAt, needsCheckIn, session.checkInDuration]);

    /* ----------------------- Star animation ------------------------ */
    useEffect(() => {
      if (!hasCheckedIn && !isWaitingForResults) return;
      const interval = setInterval(() => {
        setActiveStarIndex((prev) => (prev + 1) % 3);
      }, 700);
      return () => clearInterval(interval);
    }, [hasCheckedIn, isWaitingForResults]);

    const isCheckInClosed =
      isCheckInActive && timeLeft !== null && timeLeft <= 0;

    const handleCheckIn = () => {
      if (session.currentCandidateId && !checkedInCandidateId) {
        const newCheckedIn = [...(session.checkedInVoters[session.currentCandidateId] || [])];
        if (!newCheckedIn.includes(voterId)) newCheckedIn.push(voterId);

        const updatedResults = { ...session.results };
        if (session.currentCandidateId) {
          const res = updatedResults[session.currentCandidateId];
          updatedResults[session.currentCandidateId] = {
            ...res,
            checkedInUsers: (res.checkedInUsers || 0) + 1
          };
        }

        const nextCheckedInVoters = {
          ...session.checkedInVoters,
          [session.currentCandidateId]: newCheckedIn,
        };
        updateSession({
          checkedInVoters: nextCheckedInVoters,
          voterCount: Object.values(nextCheckedInVoters).reduce((acc, arr) => acc + arr.length, 0),
          results: updatedResults,
        });
        setCheckedInCandidateId(session.currentCandidateId);
      }
    };

    const handleVoteLocal = (isYes: boolean) => {
      const candidateId = session.currentCandidateId;
      if (!candidateId || checkedInCandidateId !== candidateId || hasVotedThisRound?.id === candidateId) return;

      const newAudienceVotes = { ...session.audienceVotes[candidateId] };
      newAudienceVotes[voterId] = isYes ? "yes" : "no";
      const newResults = { ...session.results[candidateId] };
      if (isYes) newResults.yes += 1;
      else newResults.no += 1;

      const photo = audienceUser?.photo || null;
      const nextSquarePhotos = [...session.voteWallSquarePhotos];
      
      // Place photo in a random empty square
      const randomSquareIndex = getRandomEmptySquareIndex(nextSquarePhotos);
      const canPlacePhoto = !!photo && randomSquareIndex !== -1;
      if (canPlacePhoto) {
        nextSquarePhotos[randomSquareIndex] = photo;
      }

      updateSession({
        audienceVotes: { ...session.audienceVotes, [candidateId]: newAudienceVotes },
        results: { ...session.results, [candidateId]: newResults },
        voteWallPhoto: photo,
        voteWallActor: "audience",
        voteWallActorId: null,
        voteWallPulse: session.voteWallPulse + 1,
        voteWallSquarePhotos: canPlacePhoto ? nextSquarePhotos : session.voteWallSquarePhotos,
        voteWallLastPlacedIndex: canPlacePhoto ? randomSquareIndex : session.voteWallLastPlacedIndex,
      });

      setHasVotedThisRound({ id: candidateId, type: isYes ? "yes" : "no" });
    };

    return (
      <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[#0c0a09] text-white">
        <div className="z-20 flex items-center justify-between border-b border-black bg-black px-4 py-3 shrink-0">
          <button
            onClick={() => {
              setIsMenuOpen(false);
              setRole("guest");
            }}
            aria-label="Exit"
            className="text-white transition-opacity hover:opacity-80"
          >
            <X className="h-6 w-6" />
          </button>
          <button
            aria-label="Open menu"
            onClick={() => setIsMenuOpen(true)}
            className="rounded p-1 text-white/90 transition-opacity hover:opacity-75"
          >
            <Menu className="h-6 w-6" />
          </button>
        </div>
        {showCheckInScreen ? (
          /* ============================================================
             CHECK-IN / COUNTDOWN / VOTING-STARTED / WAITING SCREEN
          ============================================================ */
          <div className="relative flex flex-1 flex-col overflow-hidden">
            <div className="z-10 border-b border-black bg-black py-2 text-center shrink-0">
              <p
                className="text-[24px] leading-none font-normal text-[#d6d3d1]"
                style={headerTextStyle}
              >
                {isWaitingForResults
                  ? "Please wait for the results"
                  : session.branding.readyText}
              </p>
            </div>

            <div className="relative flex flex-grow items-end justify-center overflow-hidden">
              <div
                className="absolute top-1/2 left-1/2 z-0 w-full -translate-x-1/2 -translate-y-1/2 aspect-square rounded-full opacity-20 blur-[100px]"
                style={{ backgroundColor: session.branding.themeColor }}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative z-10 flex h-full w-full flex-col items-center justify-end"
              >
                <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                  <img
                    src={activeCandidate?.image || "/silhouette.png"}
                    alt=""
                    className="h-full w-full object-cover opacity-90"
                    style={{ objectPosition: "center 28%" }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" />
                </div>

                {/* ---------------- SLIDER / STATUS PILL ---------------- */}
                <div className="absolute top-1/2 right-0 left-0 mx-auto flex w-[56%] max-w-[196px] -translate-y-1/2 justify-center">
                  {isWaitingForResults ? null : hasCheckedIn ? null : isCheckInClosed ||
                    isVotingActive ? (
                    /* -------- VOTING HAS STARTED PILL -------- */
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="relative flex h-13 w-full items-center overflow-hidden rounded-full border-2 bg-[#0a0704] px-[4px] shadow-2xl"
                      style={{
                        borderColor: "#9ca3af",
                        boxShadow:
                          "inset 0 0 0 1px rgba(229,231,235,0.18), 0 8px 22px rgba(0,0,0,0.45)",
                      }}
                    >
                      <div className="pointer-events-none absolute inset-y-0 left-[52px] right-6 flex items-center justify-center text-center">
                        <motion.span
                          initial={{ backgroundPosition: "220% 50%" }}
                          animate={{
                            opacity: 0.88,
                            backgroundPosition: ["220% 50%", "-220% 50%"],
                            textShadow:
                              "0 0 10px rgba(226,232,240,0.38), 0 0 18px rgba(148,163,184,0.28)",
                          }}
                          transition={{
                            duration: 2.4,
                            repeat: Infinity,
                            repeatType: "loop",
                            ease: "linear",
                          }}
                          className="text-[11px] font-normal"
                          style={{
                            fontFamily: "Helvetica, Arial, sans-serif",
                            whiteSpace: "nowrap",
                            color: "#9ca3af",
                            backgroundImage:
                              "linear-gradient(90deg, #8b95a3 0%, #b7bfcb 40%, #f1f5f9 52%, #b7bfcb 64%, #8b95a3 100%)",
                            backgroundSize: "220% 100%",
                            WebkitBackgroundClip: "text",
                            WebkitTextFillColor: "transparent",
                            letterSpacing: "0.01em",
                          }}
                        >
                          Voting has started
                        </motion.span>
                      </div>
                      <div className="z-10">
                        <div className="group relative flex h-[42px] w-[42px] items-center justify-center overflow-hidden rounded-full">
                          <div className="absolute inset-0 overflow-hidden rounded-full">
                            <div
                              className="absolute inset-0"
                              style={{
                                background:
                                  "radial-gradient(ellipse 95% 96% at 72% 42%, #9ca3af 0%, #7d8591 42%, #6b7280 100%)",
                              }}
                            />
                          </div>
                          <svg
                            width="25"
                            height="18"
                            viewBox="0 0 38 26"
                            className="relative z-10 drop-shadow-[0_2px_3px_rgba(0,0,0,0.45)]"
                          >
                            <path
                              fill="#e5e7eb"
                              d="M0,7 H24 V0 L38,13 L24,26 V19 H0 Z"
                            />
                          </svg>
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    /* -------- CHECK-IN SLIDER (with countdown glow) -------- */
                    <motion.div
                      ref={checkInTrackRef}
                      className="relative flex h-13 w-full items-center overflow-hidden rounded-full border-2 bg-[#0a0704] px-[4px] shadow-2xl"
                      style={{
                        borderColor: "#776a35",
                        boxShadow:
                          "inset 0 0 0 1px rgba(154, 141, 85, 0.24), 0 8px 22px rgba(0,0,0,0.45)",
                      }}
                    >
                      {isCheckInActive && (
                        <motion.div
                          initial={{ opacity: 0.25 }}
                          animate={{ opacity: [0.22, 0.85, 0.22] }}
                          transition={{
                            duration: 1.1,
                            repeat: Infinity,
                            ease: "easeInOut",
                          }}
                          className="pointer-events-none absolute inset-0 rounded-full"
                          style={{
                            background:
                              "linear-gradient(90deg, rgba(127,29,29,0.2) 0%, rgba(220,38,38,0.48) 50%, rgba(127,29,29,0.2) 100%)",
                            boxShadow:
                              "inset 0 0 20px rgba(127,29,29,0.7), inset 0 0 38px rgba(69,10,10,0.7)",
                          }}
                        />
                      )}

                      <div className="pointer-events-none absolute inset-y-0 left-[52px] right-6 flex items-center justify-center text-center">
                        <motion.span
                          initial={{ backgroundPosition: "120% 50%" }}
                          animate={
                            isCheckInActive
                              ? {
                                  opacity: 0.9,
                                  backgroundPosition: [
                                    "120% 50%",
                                    "-120% 50%",
                                  ],
                                }
                              : {
                                  opacity: 0.88,
                                  backgroundPosition: [
                                    "220% 50%",
                                    "-220% 50%",
                                  ],
                                }
                          }
                          transition={{
                            duration: isCheckInActive ? 1.8 : 2.4,
                            repeat: Infinity,
                            repeatType: "loop",
                            ease: "linear",
                          }}
                          style={{
                            fontFamily: "Helvetica, Arial, sans-serif",
                            whiteSpace: "nowrap",
                            color: "#6a655f",
                            backgroundImage:
                              "linear-gradient(90deg, #605b55 0%, #8c8781 40%, #d1d5db 52%, #8c8781 64%, #605b55 100%)",
                            backgroundSize: "220% 100%",
                            WebkitBackgroundClip: "text",
                            WebkitTextFillColor: "transparent",
                            letterSpacing: "0.01em",
                          }}
                          className="text-[11px] font-normal"
                        >
                          {session.branding.checkInText}
                        </motion.span>
                      </div>

                      {/* draggable thumb */}
                      <motion.div
                        ref={checkInThumbRef}
                        drag="x"
                        style={{ x: xCheckIn }}
                        dragConstraints={checkInTrackRef}
                        dragElastic={0.1}
                        onDragEnd={(_e, info: PanInfo) => {
                          const trackWidth =
                            checkInTrackRef.current?.clientWidth ?? 0;
                          const thumbWidth =
                            checkInThumbRef.current?.clientWidth ?? 0;
                          const maxTravel = Math.max(
                            0,
                            trackWidth - thumbWidth - 6,
                          );
                          const swipeThreshold =
                            maxTravel > 0 ? maxTravel * 0.7 : 100;
                          if (info.offset.x >= swipeThreshold) handleCheckIn();
                          animate(xCheckIn, 0, { duration: 0.12, ease: "easeOut" });
                        }}
                        className="z-10 cursor-grab active:cursor-grabbing"
                      >
                        <div className="group relative flex h-[42px] w-[42px] items-center justify-center overflow-hidden rounded-full">
                          <div className="absolute inset-0 overflow-hidden rounded-full">
                            <div
                              className="absolute inset-0"
                              style={{
                                background:
                                  "radial-gradient(ellipse 95% 96% at 72% 42%, #8d814b 0%, #766a39 42%, #5f552d 100%)",
                              }}
                            />
                          </div>
                          <svg
                            width="25"
                            height="18"
                            viewBox="0 0 38 26"
                            className="relative z-10 drop-shadow-[0_2px_3px_rgba(0,0,0,0.45)]"
                          >
                            <path
                              fill="#f2d34a"
                              d="M0,7 H24 V0 L38,13 L24,26 V19 H0 Z"
                            />
                          </svg>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </div>

                {/* ---------------- FOOTER + WAITING STARS ---------------- */}
                <div className="absolute bottom-0 left-0 w-full space-y-1.5 bg-black/60 px-5 pt-1 pb-2 text-center backdrop-blur-sm">
                  {(hasCheckedIn || isWaitingForResults) && (
                    <div className="flex w-full items-center justify-center gap-3 whitespace-nowrap text-center">
                      <p
                        className="text-[24px] leading-none font-normal text-white"
                        style={headerTextStyle}
                      >
                        {isWaitingForResults
                          ? "Stay tuned"
                          : "Please wait for voting to begin"}
                      </p>
                      <div className="ml-1 flex items-center gap-1.5">
                        {[0, 1, 2].map((index) => (
                          <motion.span
                            key={index}
                            className="block h-5 w-5"
                            initial={false}
                            animate={
                              activeStarIndex === index
                                ? {
                                    opacity: [0, 1, 0],
                                    scale: [0.85, 1.25, 0.85],
                                  }
                                : { opacity: 0, scale: 0.85 }
                            }
                            transition={{ duration: 0.65, ease: "easeInOut" }}
                          >
                            <svg viewBox="0 0 12 12" className="h-full w-full">
                              <path
                                d="M6 0 L6.85 5.15 L12 6 L6.85 6.85 L6 12 L5.15 6.85 L0 6 L5.15 5.15 Z"
                                fill="white"
                              />
                            </svg>
                          </motion.span>
                        ))}
                      </div>
                    </div>
                  )}
                  <p
                    className="text-[24px] leading-none font-normal tracking-tight text-white"
                    style={headerTextStyle}
                  >
                    {activeCandidate?.name || "Name"}
                  </p>
                  <p
                    className="text-[24px] leading-none font-normal text-white opacity-85"
                    style={headerTextStyle}
                  >
                    {activeCandidate?.role || "Song Title"}
                  </p>
                </div>
              </motion.div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex flex-1 flex-col overflow-hidden">
              <AnimatePresence mode="wait">
                {session.status === "idle" && (
                  <motion.div
                    key="idle"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="flex flex-grow flex-col items-center justify-center p-6 text-center"
                  >
                    <div className="mb-6">
                      <IosSpinner size="lg" color="#ffffff" />
                    </div>
                    <h2 className="mb-2 text-2xl font-bold">Waiting for Host</h2>
                  </motion.div>
                )}
                {session.status === "performance" && session.currentCandidateId && (
                  <motion.div
                    key="performance"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-grow flex-col items-center justify-center p-6 text-center"
                  >
                    <div className="relative mb-8 w-full max-w-sm aspect-[4/5] overflow-hidden rounded-3xl shadow-2xl">
                      <img
                        src={activeCandidate?.image}
                        className="h-full w-full object-cover"
                        style={{ objectPosition: "center 28%" }}
                        alt=""
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent" />
                      <div className="absolute right-6 bottom-6 left-6 text-left">
                        <span className="mb-2 inline-block rounded bg-indigo-500 px-2 py-0.5 text-[10px] font-black text-white uppercase">
                          Now Performing
                        </span>
                        <h3 className="text-3xl font-black">
                          {activeCandidate?.name}
                        </h3>
                        <p className="font-medium text-slate-300">
                          {activeCandidate?.role}
                        </p>
                      </div>
                    </div>
                    <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
                      <p className="text-sm font-bold tracking-widest text-slate-400 uppercase">
                        Performance in progress
                      </p>
                    </div>
                  </motion.div>
                )}
                {session.status === "voting" && session.currentCandidateId && (
                  <motion.div
                    key="voting"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="relative flex h-full flex-grow flex-col"
                  >
                    <div className="z-30 border-b border-black bg-black py-2 text-center">
                      <p
                        className="text-[24px] leading-none font-normal text-[#d6d3d1]"
                        style={headerTextStyle}
                      >
                        {hasVotedThisRound?.id === session.currentCandidateId
                          ? "Thanks for voting!"
                          : "Swipe GREEN for Yes and RED for No"}
                      </p>
                    </div>

                    <div className="relative flex flex-grow items-end justify-center overflow-hidden bg-[#0c0a09]">
                      <div className="relative z-10 flex h-full w-full flex-col items-center justify-end">
                        <img
                          src={activeCandidate?.image || "/silhouette.png"}
                          alt=""
                          className="h-full w-full object-cover opacity-80"
                          style={{ objectPosition: "center 28%" }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />



                        {hasVotedThisRound?.id === session.currentCandidateId ? (
                          /* ---- VOTE CONFIRMATION ---- */
                          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center p-6">
                            <div
                              className={cn(
                                "flex w-full px-2",
                                hasVotedThisRound.type === "yes"
                                  ? "justify-start -translate-x-2"
                                  : "justify-end translate-x-2",
                              )}
                            >
                              <div className="relative flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#d4af37] bg-black/55 shadow-2xl">
                                <svg
                                  width="40"
                                  height="40"
                                  viewBox="0 0 100 100"
                                  style={{
                                    transform:
                                      hasVotedThisRound.type === "yes"
                                        ? "rotate(-90deg)"
                                        : "rotate(90deg)",
                                  }}
                                  className="relative"
                                >
                                  <defs>
                                    <linearGradient id="confirmGreenSplit" x1="15.8%" y1="80.5%" x2="78.7%" y2="-2.9%">
                                      <stop offset="0%" stopColor="#0a7f38" />
                                      <stop offset="46%" stopColor="#0f9b45" />
                                      <stop offset="48.5%" stopColor="#0a7635" />
                                      <stop offset="49.2%" stopColor="#0a6a32" />
                                      <stop offset="49.8%" stopColor="#18b85f" />
                                      <stop offset="50.4%" stopColor="#24d96f" />
                                      <stop offset="100%" stopColor="#2eea7d" />
                                    </linearGradient>
                                    <linearGradient id="confirmRedSplit" x1="15.8%" y1="30.5%" x2="78.7%" y2="113.9%">
                                      <stop offset="0%" stopColor="#DE0000" />
                                      <stop offset="46%" stopColor="#f01818" />
                                      <stop offset="48.5%" stopColor="#c50000" />
                                      <stop offset="49.2%" stopColor="#ae0000" />
                                      <stop offset="49.8%" stopColor="#FFA3A3" />
                                      <stop offset="50.4%" stopColor="#FFA3A3" />
                                      <stop offset="100%" stopColor="#FFA3A3" />
                                    </linearGradient>
                                  </defs>
                                  <path
                                    fill={
                                      hasVotedThisRound.type === "yes"
                                        ? "url(#confirmGreenSplit)"
                                        : "url(#confirmRedSplit)"
                                    }
                                    d="M18,18 L94,50 L18,82 Q56,50 18,18 Z"
                                  />
                                </svg>
                              </div>
                            </div>
                          </div>
                        ) : (
                          /* ---- YES / NO SLIDERS ---- */
                          <div className="pointer-events-none absolute top-1/2 left-0 z-30 flex w-full -translate-y-1/2 items-center justify-between px-0">
                            <div className="pointer-events-auto relative">
                              <motion.div
                                drag="x"
                                style={{ x: xYes, borderColor: session.branding.themeColor }}
                                dragConstraints={{ left: -buttonHalfWidth, right: 0 }}
                                dragElastic={0}
                                dragMomentum={false}
                                onDragEnd={() => {
                                  if (xYes.get() >= -buttonHalfWidth * 0.05) {
                                    handleVoteLocal(true);
                                  } else {
                                    animate(xYes, -buttonHalfWidth, {
                                      duration: 0.2,
                                      ease: "easeOut",
                                    });
                                  }
                                }}
                                className="relative z-10 flex h-20 w-44 items-center justify-end overflow-hidden rounded-r-full border-2 border-l-0 bg-black/55 pr-4 cursor-grab active:cursor-grabbing"
                              >
                                <motion.div style={{ rotate: yesIconRotateSpring }}>
                                  <svg width="48" height="48" viewBox="0 0 100 100">
                                  <defs>
                                    <linearGradient id="voteGreenSplit" x1="15.8%" y1="80.5%" x2="78.7%" y2="-2.9%">
                                      <stop offset="0%" stopColor="#0a7f38" />
                                      <stop offset="46%" stopColor="#0f9b45" />
                                      <stop offset="48.5%" stopColor="#0a7635" />
                                      <stop offset="49.2%" stopColor="#0a6a32" />
                                      <stop offset="49.8%" stopColor="#18b85f" />
                                      <stop offset="50.4%" stopColor="#24d96f" />
                                      <stop offset="100%" stopColor="#2eea7d" />
                                    </linearGradient>
                                  </defs>
                                    <path fill="url(#voteGreenSplit)" d="M18,18 L94,50 L18,82 Q56,50 18,18 Z" />
                                  </svg>
                                </motion.div>
                                <div className="ml-2.5 flex -translate-x-1 gap-1">
                                  <div className="h-12 w-[1.5px] rounded-full" style={voteDividerStyle} />
                                  <div className="h-12 w-[1.5px] rounded-full" style={voteDividerStyle} />
                                </div>
                              </motion.div>
                            </div>
                            <div className="pointer-events-auto relative">
                              <motion.div
                                drag="x"
                                style={{ x: xNo, borderColor: session.branding.themeColor }}
                                dragConstraints={{ left: 0, right: buttonHalfWidth }}
                                dragElastic={0}
                                dragMomentum={false}
                                onDragEnd={() => {
                                  if (xNo.get() <= buttonHalfWidth * 0.05) {
                                    handleVoteLocal(false);
                                  } else {
                                    animate(xNo, buttonHalfWidth, {
                                      duration: 0.2,
                                      ease: "easeOut",
                                    });
                                  }
                                }}
                                className="relative z-10 flex h-20 w-44 items-center justify-start overflow-hidden rounded-l-full border-2 border-r-0 bg-black/55 pl-4 cursor-grab active:cursor-grabbing"
                              >
                                <div className="mr-2.5 flex translate-x-1 gap-1">
                                  <div className="h-12 w-px rounded-full" style={voteDividerStyle} />
                                  <div className="h-12 w-[2px] rounded-full" style={voteDividerStyle} />
                                </div>
                                <motion.div style={{ rotate: noIconRotateSpring }}>
                                  <svg width="48" height="48" viewBox="0 0 100 100" className="rotate-180">
                                  <defs>
                                    <linearGradient id="voteRedSplit" x1="15.8%" y1="30.5%" x2="78.7%" y2="113.9%">
                                      <stop offset="0%" stopColor="#DE0000" />
                                      <stop offset="46%" stopColor="#f01818" />
                                      <stop offset="48.5%" stopColor="#c50000" />
                                      <stop offset="49.2%" stopColor="#ae0000" />
                                      <stop offset="49.8%" stopColor="#FFA3A3" />
                                      <stop offset="50.4%" stopColor="#FFA3A3" />
                                      <stop offset="100%" stopColor="#FFA3A3" />
                                    </linearGradient>
                                  </defs>
                                    <path fill="url(#voteRedSplit)" d="M18,18 L94,50 L18,82 Q56,50 18,18 Z" />
                                  </svg>
                                </motion.div>
                              </motion.div>
                            </div>
                          </div>
                        )}
                        <div className="absolute right-0 bottom-0 left-0 w-full space-y-1 bg-black/60 px-4 pt-1 pb-3 text-center backdrop-blur-sm">
                          <div className="translate-y-0">
                            <p
                              className="text-[22px] leading-tight font-medium tracking-tight text-white break-words drop-shadow-[0_2px_3px_rgba(0,0,0,0.8)] sm:text-[24px]"
                              style={footerTextStyle}
                            >
                              {activeCandidate?.name}
                            </p>
                            <p
                              className="text-[21px] leading-tight font-normal text-white break-words drop-shadow-[0_2px_3px_rgba(0,0,0,0.8)] sm:text-[23px]"
                              style={footerTextStyle}
                            >
                              {activeCandidate?.role}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
                {session.status === "waiting-results" && (
                  <motion.div
                    key="waiting-results"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-1 flex-col items-center justify-center p-6"
                  >
                    <IosSpinner size="lg" color="#d4af37" />
                    <h2 className="mt-6 text-2xl font-bold text-white">Please wait for the results...</h2>
                  </motion.div>
                )}
                {session.status === "results" && (
                  <motion.div
                    key="results"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.45, ease: "easeInOut" }}
                    className="relative flex h-full flex-grow flex-col"
                  >
                    <div className="z-30 border-b border-black bg-black py-2 text-center">
                      <p className="text-[24px] leading-none font-normal text-[#d6d3d1]" style={headerTextStyle}>
                        The results are in...
                      </p>
                    </div>

                    <div className="relative flex flex-grow items-end justify-center overflow-hidden bg-[#0c0a09]">
                      <div className="absolute top-1/2 left-1/2 z-0 w-full -translate-x-1/2 -translate-y-1/2 aspect-square rounded-full bg-[#d4af37]/10 blur-[100px]" />

                      <div className="relative z-10 flex h-full w-full flex-col items-center justify-end">
                        <img
                          src={activeCandidate?.image || "/silhouette.png"}
                          alt=""
                          className="h-full w-full object-cover opacity-80"
                          style={{ objectPosition: "center 28%" }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />

                        <motion.div
                          initial={{ opacity: 0, scale: 0.85, x: -8 }}
                          animate={{ opacity: 1, scale: 1, x: 0 }}
                          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
                          className="absolute top-[53%] left-6 z-30 flex -translate-y-1/2 items-end gap-3"
                        >
                          {(() => {
                            const finalResult = getFinalResult(session.currentCandidateId);
                            const percent = finalResult.percent;
                            const cappedPercent = Math.min(percent, 100);
                            const fillStartOffset = 6.2; // Touches the curved top of the Red arrow
                            const fillTopLimit = 92.5;   // Pull back slightly to create a gap from the Green arrow
                            const fillTravelRange = fillTopLimit - fillStartOffset;
                            const fillHeightPercent = (cappedPercent / 100) * fillTravelRange;
                            const fillTopPercent = fillStartOffset + fillHeightPercent;

                            return (
                              <div className="relative h-80 w-24">
                                <div className="relative h-80 w-5 overflow-hidden rounded-full border border-white/10 bg-black/40">
                                  <motion.div
                                    initial={{ scaleX: 0.3, opacity: 0 }}
                                    animate={{ scaleX: 1, opacity: 1 }}
                                    transition={{ duration: 1.05, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
                                    className="pointer-events-none absolute inset-0 z-20 rounded-full border border-white/70"
                                    style={{ transformOrigin: "center" }}
                                  />
                                  <motion.div
                                    initial={{ height: "0%" }}
                                    animate={{ height: fillHeightPercent + "%" }}
                                    transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1], delay: 1.8 }}
                                    className="absolute bottom-0 left-1/2 z-10 w-3 -translate-x-1/2 rounded-full shadow-[inset_0_0_4px_rgba(255,255,255,0.12)]"
                                    style={{
                                      bottom: fillStartOffset + "%",
                                      background:
                                        "linear-gradient(to top, rgba(154,140,92,0.05) 0%, rgba(154,140,92,0.5) 45%, rgba(154,140,92,0.95) 100%)",
                                    }}
                                  />
                                  <motion.div
                                    initial={{ bottom: "50%", opacity: 0, scale: 0.9 }}
                                    animate={{ bottom: "92%", opacity: 1, scale: 1 }}
                                    transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
                                    className="absolute left-1/2 z-10 -translate-x-1/2"
                                  >
                                    <svg width="18" height="18" viewBox="0 0 100 100" style={{ transform: "rotate(-90deg)" }}>
                                      <defs>
                                        <linearGradient id="capGreenSplit" x1="15.8%" y1="80.5%" x2="78.7%" y2="-2.9%">
                                          <stop offset="0%" stopColor="#0a7f38" />
                                          <stop offset="46%" stopColor="#0f9b45" />
                                          <stop offset="48.5%" stopColor="#0a7635" />
                                          <stop offset="49.2%" stopColor="#0a6a32" />
                                          <stop offset="49.8%" stopColor="#18b85f" />
                                          <stop offset="50.4%" stopColor="#24d96f" />
                                          <stop offset="100%" stopColor="#2eea7d" />
                                        </linearGradient>
                                      </defs>
                                      <path fill="url(#capGreenSplit)" d="M18,18 L94,50 L18,82 Q56,50 18,18 Z" />
                                    </svg>
                                  </motion.div>
                                  <motion.div
                                    initial={{ bottom: "50%", opacity: 0, scale: 0.9 }}
                                    animate={{ bottom: "2%", opacity: 1, scale: 1 }}
                                    transition={{ duration: 1.2, delay: 0.28, ease: [0.22, 1, 0.36, 1] }}
                                    className="absolute left-1/2 z-10 -translate-x-1/2"
                                  >
                                    <svg width="18" height="18" viewBox="0 0 100 100" style={{ transform: "rotate(90deg)" }}>
                                      <defs>
                                        <linearGradient id="capRedSplit" x1="15.8%" y1="30.5%" x2="78.7%" y2="113.9%">
                                          <stop offset="0%" stopColor="#DE0000" />
                                          <stop offset="46%" stopColor="#f01818" />
                                          <stop offset="48.5%" stopColor="#c50000" />
                                          <stop offset="49.2%" stopColor="#ae0000" />
                                          <stop offset="49.8%" stopColor="#FFA3A3" />
                                          <stop offset="50.4%" stopColor="#FFA3A3" />
                                          <stop offset="100%" stopColor="#FFA3A3" />
                                        </linearGradient>
                                      </defs>
                                      <path fill="url(#capRedSplit)" d="M18,18 L94,50 L18,82 Q56,50 18,18 Z" />
                                    </svg>
                                  </motion.div>
                                </div>

                                <motion.div
                                  initial={{ bottom: fillStartOffset + "%", opacity: 0, scale: 0.9 }}
                                  animate={{ bottom: fillTopPercent + "%", opacity: 1, scale: 1 }}
                                  transition={{ duration: 1.6, delay: 1.8, ease: [0.16, 1, 0.3, 1] }}
                                  className="absolute left-7 z-30 translate-y-1/2 whitespace-nowrap text-white flex flex-col items-start"
                                  style={{ fontFamily: 'Calibri, "Segoe UI", sans-serif', textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}
                                >
                                  <span className="text-[36px] font-thin leading-none">
                                    <AnimatedPercent value={percent} />
                                  </span>
                                </motion.div>
                              </div>
                            );
                          })()}
                        </motion.div>

                        <div className="absolute right-0 bottom-0 left-0 w-full space-y-1 bg-black/60 px-4 pt-1 pb-3 text-center backdrop-blur-sm">
                          <p className="text-[22px] leading-tight font-medium text-white drop-shadow-[0_2px_3px_rgba(0,0,0,0.8)]" style={footerTextStyle}>
                            {activeCandidate?.name}
                          </p>
                          <p className="text-[21px] leading-tight font-normal text-white drop-shadow-[0_2px_3px_rgba(0,0,0,0.8)]" style={footerTextStyle}>
                            {activeCandidate?.role}
                          </p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
        <AnimatePresence>
          {isMenuOpen && (
            <>
              <motion.button
                aria-label="Close menu overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsMenuOpen(false)}
                className="absolute inset-0 z-40 bg-black/55"
              />
              <motion.aside
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="absolute top-0 right-0 z-50 flex h-full w-64 flex-col bg-black/95 px-5 pt-4"
              >
                <div className="mb-6 flex items-center justify-between">
                  <p className="text-sm font-bold tracking-wide text-white/90 uppercase">Menu</p>
                  <button
                    aria-label="Close menu"
                    onClick={() => setIsMenuOpen(false)}
                    className="rounded p-1 text-white/90"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <button onClick={() => { setIsMenuOpen(false); setRole("guest"); }} className="w-full border-b border-white/10 py-3 text-left text-sm font-semibold text-white">Home</button>
                <button onClick={() => { setIsMenuOpen(false); openAudienceVoting(); }} className="w-full border-b border-white/10 py-3 text-left text-sm font-semibold text-white">Audience Voting</button>
                <button onClick={() => { setIsMenuOpen(false); setRole("vote-wall"); }} className="w-full border-b border-white/10 py-3 text-left text-sm font-semibold text-white">Vote Wall</button>
                <button onClick={() => { setIsMenuOpen(false); setRole("judge-select"); }} className="w-full border-b border-white/10 py-3 text-left text-sm font-semibold text-[#d9c27a]">Judge Voting</button>
                <button onClick={() => { setIsMenuOpen(false); setRole("host-login"); }} className="w-full border-b border-white/10 py-3 text-left text-sm font-semibold text-white">Host Login</button>
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const GuestSignInForm = ({ onComplete }: { onComplete: (name: string, title: string, photo: string) => void }) => {
    const [name, setName] = useState("");
    const [title, setTitle] = useState("");
    const [photo, setPhoto] = useState("");
    const [isExpanded, setIsExpanded] = useState(false);

    if (!isExpanded) {
      return (
        <button
          onClick={() => setIsExpanded(true)}
          className="mt-4 w-full rounded-xl border border-dashed border-[#776a35] py-4 text-sm font-bold text-[#b8a97a] hover:bg-[#1a130b]"
        >
          + Sign In as New Guest Judge
        </button>
      );
    }

    const handlePhotoUpload = (file: File) => {
      const reader = new FileReader();
      reader.onload = () => setPhoto(reader.result as string);
      reader.readAsDataURL(file);
    };

    return (
      <div className="mt-6 space-y-4 rounded-2xl border-2 border-[#776a35] bg-[#0a0704] p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#f1e7c1] uppercase">Guest Judge Registration</h3>
          <button onClick={() => setIsExpanded(false)} className="text-[#9f9470] hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full Name"
          className="w-full rounded-xl border border-[#5f552d] bg-[#1e160d] px-4 py-2 text-sm text-[#f1e7c1]"
        />
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (e.g. Music Critic)"
          className="w-full rounded-xl border border-[#5f552d] bg-[#1e160d] px-4 py-2 text-sm text-[#f1e7c1]"
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={photo}
            onChange={(e) => setPhoto(e.target.value)}
            placeholder="Photo URL"
            className="flex-1 rounded-xl border border-[#5f552d] bg-[#1e160d] px-4 py-2 text-xs text-[#f1e7c1]"
          />
          <button
            type="button"
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/*";
              input.onchange = (e: any) => {
                const file = e.target.files?.[0];
                if (file) handlePhotoUpload(file);
              };
              input.click();
            }}
            className="rounded-lg border border-[#9b8750] bg-[#2b2112] px-3 py-1 text-xs font-bold text-[#f1e7c1]"
          >
            Upload
          </button>
        </div>
        <button
          onClick={() => name && title && photo && onComplete(name, title, photo)}
          className="w-full rounded-xl bg-[#776a35] py-3 text-sm font-bold text-white hover:bg-[#d9c27a]"
        >
          Confirm & Enter Voting
        </button>
      </div>
    );
  };

  const JudgeSelectView = () => (
    <div className="flex min-h-screen items-center justify-center bg-[#0c0a09] p-6 text-white">
      <div className="w-full max-w-md rounded-[2.5rem] border border-[#776a35] bg-[#140f08] p-8 shadow-[0_0_40px_rgba(154,140,92,0.2)] sm:p-10">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#776a35] bg-gradient-to-br from-[#1a130b] to-black shadow-[inset_0_0_12px_rgba(217,194,122,0.18)]">
            <Gavel className="h-7 w-7 text-[#d9c27a]" />
          </div>
          <h2 className="mb-2 text-3xl font-black tracking-wide text-[#f1e7c1] uppercase" style={{ fontFamily: '"Oswald", "Arial Narrow", "Segoe UI", sans-serif' }}>
            Judge Panel
          </h2>
          <p className="text-sm text-[#b8a97a]">Select your station to begin voting</p>
        </div>
        <div className="space-y-3">
          {session.judges.map((judge) => {
            const tool = getJudgeImageTool(judge);
            const previewImage = getJudgeDisplayImage(judge);
            const isVotedForCurrent = (() => {
              const cid = session.currentCandidateId;
              if (cid === null) return false;
              return session.judgeVotes[cid]?.[judge.id] != null;
            })();
            return (
              <button
                key={judge.id}
                onClick={() => {
                  setCurrentJudge(judge.id);
                  setRole("judge");
                }}
                className="group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border-2 border-[#776a35] bg-[#0a0704] px-4 py-3 text-left transition-all hover:border-[#d9c27a] hover:bg-[#1a130b] active:scale-[0.99] sm:px-5 sm:py-4"
              >
                <div
                  className="relative aspect-square h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-white/85 bg-transparent sm:h-24 sm:w-24"
                  style={{ backgroundColor: hexToRgba(tool.backgroundColor, tool.backgroundAlpha) }}
                >
                  <img src={previewImage} alt={judge.name} className="absolute inset-0 z-10 h-full w-full object-cover object-center" />
                </div>
                <div className="flex-grow">
                  <p className="text-base font-bold text-[#f1e7c1] sm:text-lg" style={{ fontFamily: '"Oswald", "Arial Narrow", "Segoe UI", sans-serif' }}>
                    {judge.name}
                  </p>
                  <p className="text-[10px] font-bold tracking-widest text-[#9f9470] uppercase">{judge.title}</p>
                  <p className="mt-1 text-[10px] font-bold tracking-widest text-[#d9c27a] uppercase">
                    {isVotedForCurrent ? "Voted on current artist" : "Ready to vote"}
                  </p>
                </div>
                {isVotedForCurrent && (
                  <span className="rounded-full border border-[#03b807] bg-[#03b807]/15 px-2 py-0.5 text-[9px] font-black tracking-widest text-[#03b807] uppercase">Done</span>
                )}
                <div className="text-2xl text-[#776a35] transition-colors group-hover:text-[#d9c27a]">→</div>
              </button>
            );
          })}

          {session.guestJudges.length > 0 && (
            <div className="pt-4 space-y-3 border-t border-[#3d341d]">
              <p className="text-center text-[10px] font-black tracking-widest text-[#9f9470] uppercase">
                Registered Guest Judges (1% each)
              </p>
              {session.guestJudges.map((guest) => {
                const isGuestVotedForCurrent = (() => {
                  const cid = session.currentCandidateId;
                  if (cid === null) return false;
                  return session.guestVotesByCandidate[cid]?.[guest.id] != null;
                })();
                return (
                  <button
                    key={guest.id}
                    onClick={() => {
                      setCurrentGuestJudgeId(guest.id);
                      setRole("guest-judge");
                    }}
                    className="group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border-2 border-[#776a35] bg-[#0a0704] px-4 py-3 text-left transition-all hover:border-[#d9c27a] hover:bg-[#1a130b]"
                  >
                    <div className="relative aspect-square h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-white/75 bg-black">
                      <img
                        src={guest.image}
                        alt={guest.name}
                        className="absolute inset-0 h-full w-full object-cover object-center"
                      />
                    </div>
                    <div className="flex-grow">
                      <p
                        className="text-sm font-bold text-[#f1e7c1]"
                        style={{ fontFamily: '"Oswald", "Arial Narrow", "Segoe UI", sans-serif' }}
                      >
                        {guest.name}
                      </p>
                      <p className="text-[10px] font-bold tracking-widest text-[#9f9470] uppercase">
                        {guest.title}
                      </p>
                      <p className="mt-1 text-[10px] font-bold tracking-widest text-[#d9c27a] uppercase">
                        {isGuestVotedForCurrent ? "Voted on current artist" : "Ready to vote"}
                      </p>
                    </div>
                    {isGuestVotedForCurrent && (
                      <span className="rounded-full border border-[#03b807] bg-[#03b807]/15 px-2 py-0.5 text-[9px] font-black tracking-widest text-[#03b807] uppercase">Done</span>
                    )}
                    <div className="text-xl text-[#776a35] transition-colors group-hover:text-[#d9c27a]">→</div>
                  </button>
                );
              })}
            </div>
          )}

          <GuestSignInForm
            onComplete={(name, title, photo) => {
              const nextId =
                session.guestJudges.length > 0
                  ? Math.max(...session.guestJudges.map((g) => g.id)) + 1
                  : 1;
              const nextGuestJudges = [
                ...session.guestJudges,
                { id: nextId, name, title, image: photo },
              ];
              updateSession({
                guestJudges: nextGuestJudges,
                guestJudgeCount: nextGuestJudges.length,
              });
              setCurrentGuestJudgeId(nextId);
              setRole("guest-judge");
            }}
          />
        </div>
        <button onClick={() => setRole("guest")} className="mt-8 w-full text-sm font-bold text-[#9f9470] transition-colors hover:text-[#d9c27a]">
          ← Back to Home
        </button>
      </div>
    </div>
  );

  const VotingPageUI = ({
    hasVoted,
    onVote,
    onBack,
  }: {
    hasVoted: JudgeVote;
    onVote: (isYes: boolean) => void;
    onBack: () => void;
  }) => {
    const [offset, setOffset] = useState(0);
    const [maxOffset, setMaxOffset] = useState(420);
    const [isDragging, setIsDragging] = useState(false);
    const dragState = useRef({ active: false, startX: 0, startOffset: 0 });

    useEffect(() => {
      const updateMaxOffset = () => setMaxOffset(Math.max(180, window.innerWidth / 2 - 96));
      updateMaxOffset();
      window.addEventListener("resize", updateMaxOffset);
      return () => window.removeEventListener("resize", updateMaxOffset);
    }, []);

    useEffect(() => {
      setOffset(0);
    }, [hasVoted]);

    const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
      if (hasVoted) return;
      setIsDragging(true);
      dragState.current = { active: true, startX: event.clientX, startOffset: offset };
      event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
      if (!dragState.current.active || hasVoted) return;
      const delta = event.clientX - dragState.current.startX;
      setOffset(Math.max(Math.min(dragState.current.startOffset + delta, maxOffset), -maxOffset));
    };

    const handlePointerUp = (_event: PointerEvent<HTMLElement>) => {
      if (hasVoted) return;
      dragState.current.active = false;
      setIsDragging(false);
      const releaseOffset = offset;
      if (releaseOffset > maxOffset * 0.5) {
        setOffset(maxOffset);
        onVote(true);
      } else if (releaseOffset < -maxOffset * 0.5) {
        setOffset(-maxOffset);
        onVote(false);
      } else {
        setOffset(0);
      }
    };

    const colorSwitchThreshold = 8;
    const showYes = offset > colorSwitchThreshold;
    const showNo = offset < -colorSwitchThreshold;

    if (hasVoted) {
      const votedYes = hasVoted === "yes";
      const laneColor = votedYes ? "#03b807" : "#d90912";
      return (
        <main className="relative min-h-screen w-full overflow-hidden bg-black">
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2">
            <div className="relative h-48 w-full" style={{ background: laneColor }}>
              <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 bg-zinc-100" />
            </div>
          </div>
          <div
            className="absolute top-1/2 z-10 -translate-y-1/2"
            style={{ left: votedYes ? "calc(100% - 12rem)" : "0rem" }}
          >
            <div className="h-48 w-48 rounded-full border-4 border-zinc-100 bg-black shadow-2xl" />
          </div>
          <button
            type="button"
            onClick={onBack}
            className="absolute top-4 left-4 z-20 h-10 w-10 rounded-full border border-white/20 bg-black/60 backdrop-blur-sm hover:bg-black/80"
          />
        </main>
      );
    }

    return (
      <main className="relative min-h-screen w-full overflow-hidden bg-black">
        {/* Background gradients */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden">
          <div className="relative h-48 w-full">
            <div
              className="absolute inset-0 transition-all duration-300 ease-out"
              style={{
                background: showYes
                  ? "#03b807"
                  : showNo
                    ? "#d90912"
                    : "linear-gradient(90deg, #d90912 0%, #8f0a0f 15%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 70%, #0d5b13 85%, #03b807 100%)",
              }}
            />
          </div>
        </div>

        {/* Center line */}
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 bg-zinc-100" />
        <div
          className={cn(
            "absolute top-1/2 left-1/2 z-30 -translate-y-1/2",
            isDragging ? "" : "transition-[left] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
          )}
          style={{ left: `calc(50% + ${offset}px)` }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div
            className={cn(
              "flex h-48 w-48 -translate-x-1/2 items-center justify-center rounded-full border-4 bg-black touch-none select-none shadow-2xl",
              isDragging ? "cursor-grabbing border-white" : "cursor-grab border-white",
            )}
          />
        </div>
      </main>
    );
  };

  const JudgeView = () => {
    const candidateId = session.currentCandidateId;
    const judge = currentJudge;
    const storedVote: JudgeVote =
      judge && candidateId ? session.judgeVotes[candidateId]?.[judge] ?? null : null;

    return (
      <VotingPageUI
        hasVoted={storedVote}
        onVote={(isYes) => {
          if (candidateId && judge) handleJudgeVote(candidateId, judge, isYes);
        }}
        onBack={() => {
          setRole("judge-select");
          setCurrentJudge(null);
        }}
      />
    );
  };

  const GuestJudgeView = () => {
    const candidateId = session.currentCandidateId;
    const guestJudgeId = currentGuestJudgeId;
    const storedVote: JudgeVote =
      candidateId && guestJudgeId
        ? session.guestVotesByCandidate[candidateId]?.[guestJudgeId] || null
        : null;

    return (
      <VotingPageUI
        hasVoted={storedVote}
        onVote={(isYes) => {
          if (candidateId && guestJudgeId) handleGuestJudgeVote(isYes);
        }}
        onBack={() => {
          setRole("judge-select");
          setCurrentGuestJudgeId(null);
        }}
      />
    );
  };

  const AudienceAuthView = () => {
    const [mode, setMode] = useState<"register" | "login">("register");
    const [name, setName] = useState(audienceUser?.name || "");
    const [email, setEmail] = useState(audienceUser?.email || "");
    const [photo, setPhoto] = useState(audienceUser?.photo || "");
    const [error, setError] = useState("");

    const handlePhotoUpload = (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        if (result) setPhoto(result);
      };
      reader.readAsDataURL(file);
    };

    const handleRegister = () => {
      setError("");
      if (!name.trim() || !email.trim() || !photo) {
        setError("Please enter name, email, and upload photo.");
        return;
      }
      const profile: AudienceProfile = { name: name.trim(), email: email.trim(), photo };
      enterAudienceVoting(profile);
    };

    const handleLogin = () => {
      setError("");
      if (!email.trim()) {
        setError("Please enter your email.");
        return;
      }
      const accountsRaw = localStorage.getItem(AUDIENCE_ACCOUNTS_KEY);
      if (!accountsRaw) {
        setError("No account found. Please register first.");
        return;
      }
      let accounts: AudienceProfile[] = [];
      try {
        accounts = JSON.parse(accountsRaw) as AudienceProfile[];
      } catch {
        setError("Account data is corrupted. Please register again.");
        return;
      }
      const found = accounts.find((a) => a.email.toLowerCase() === email.toLowerCase());
      if (!found) {
        setError("Account not found. Please register first.");
        return;
      }
      enterAudienceVoting(found);
    };

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0c0a09] px-6 text-white">
        <div className="w-full max-w-md space-y-5 rounded-[2rem] border border-[#6f6336] bg-[#140f08] p-7 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
          <h2 className="text-center text-3xl font-black text-[#f1e7c1]" style={{ fontFamily: '"Oswald", "Arial Narrow", "Segoe UI", sans-serif' }}>
            Audience Access
          </h2>
          <div className="flex rounded-xl border border-[#5f552d] bg-[#1a130b] p-1">
            <button onClick={() => setMode("register")} className={cn("flex-1 rounded-lg py-2 text-sm font-bold", mode === "register" ? "bg-[#2b2112] text-[#f1e7c1]" : "text-[#9f9470]")}>Register</button>
            <button onClick={() => setMode("login")} className={cn("flex-1 rounded-lg py-2 text-sm font-bold", mode === "login" ? "bg-[#2b2112] text-[#f1e7c1]" : "text-[#9f9470]")}>Login</button>
          </div>
          {mode === "register" && (
            <>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full rounded-xl border border-[#5f552d] bg-[#1e160d] px-4 py-3 text-sm text-[#f1e7c1]" />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-xl border border-[#5f552d] bg-[#1e160d] px-4 py-3 text-sm text-[#f1e7c1]" />
              <label className="block rounded-xl border border-[#5f552d] bg-[#1e160d] px-4 py-3 text-sm text-[#f1e7c1]">
                Upload Photo
                <input type="file" accept="image/*" className="mt-2 block w-full text-xs" onChange={(e) => { const file = e.target.files?.[0]; if (file) handlePhotoUpload(file); }} />
              </label>
              {photo && <img src={photo} alt="Audience preview" className="h-20 w-20 rounded-xl object-cover" />}
              <button onClick={handleRegister} className="w-full rounded-xl border border-[#9b8750] bg-[#2b2112] py-3 text-sm font-bold text-[#f1e7c1]">Register and Vote</button>
            </>
          )}
          {mode === "login" && (
            <>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-xl border border-[#5f552d] bg-[#1e160d] px-4 py-3 text-sm text-[#f1e7c1]" />
              <button onClick={handleLogin} className="w-full rounded-xl border border-[#9b8750] bg-[#2b2112] py-3 text-sm font-bold text-[#f1e7c1]">Login and Vote</button>
            </>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button onClick={() => setRole("guest")} className="w-full text-sm font-bold text-[#9f9470] transition-colors hover:text-[#d9c27a]">Back</button>
        </div>
      </div>
    );
  };

  const LandingView = () => {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    return (
      <div className="relative flex h-full min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-[#0c0a09] p-6 text-center text-white">
        <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-end border-b border-white/10 bg-black/60 px-4 py-3 backdrop-blur-sm">
          <button aria-label="Open menu" onClick={() => setIsMenuOpen(true)} className="rounded p-1 text-white/90">
            <Menu className="h-6 w-6" />
          </button>
        </div>
        <div className="absolute inset-0">
          <div className="absolute top-[-20%] left-[-20%] h-[80%] w-[80%] rounded-full bg-[#9A8C5C]/20 blur-[120px]" />
          <div className="absolute right-[-20%] bottom-[-20%] h-[80%] w-[80%] rounded-full bg-[#6f5424]/22 blur-[120px]" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/10 to-black/45" />
        </div>
        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="relative z-10 w-full max-w-sm">
          <CrystalStarLogo className="mx-auto mb-8 h-24 w-24 rotate-12" />
          <h1 className="mb-2 text-5xl font-black tracking-tighter uppercase">{session.branding.headerTitle}</h1>
          <p className="mb-12 text-[10px] font-bold tracking-[0.3em] text-[#9f9470] uppercase">Live Audience Experience</p>
          <button
            onClick={openAudienceVoting}
            className="relative mx-auto flex h-13 w-[52%] items-center overflow-hidden rounded-full border-2 bg-[#0a0704] px-[4px] shadow-2xl active:scale-[0.99]"
            style={{ borderColor: "#776a35", boxShadow: "inset 0 0 0 1px rgba(154, 141, 85, 0.24), 0 8px 22px rgba(0,0,0,0.45)" }}
          >
            <div className="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center justify-center text-center px-6">
              <span className="text-[16px] font-bold" style={{ fontFamily: "Helvetica, Arial, sans-serif", whiteSpace: "nowrap", color: "#cbd5e1", backgroundImage: "linear-gradient(90deg, #94a3b8 0%, #cbd5e1 38%, #f8fafc 52%, #cbd5e1 66%, #94a3b8 100%)", backgroundSize: "220% 100%", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "0.01em" }}>Enter</span>
            </div>
          </button>
        </motion.div>
        <AnimatePresence>
          {isMenuOpen && (
            <>
              <motion.button aria-label="Close menu overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsMenuOpen(false)} className="absolute inset-0 z-40 bg-black/55" />
              <motion.aside initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: 0.22, ease: "easeOut" }} className="absolute top-0 right-0 z-50 flex h-full w-64 flex-col bg-black/95 px-5 pt-4">
                <div className="mb-6 flex items-center justify-between">
                  <p className="text-sm font-bold tracking-wide text-white/90 uppercase">Menu</p>
                  <button aria-label="Close menu" onClick={() => setIsMenuOpen(false)} className="rounded p-1 text-white/90">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <button onClick={() => { setIsMenuOpen(false); setRole("guest"); }} className="w-full border-b border-white/10 py-3 text-left text-sm font-semibold text-white">Home</button>
                <button onClick={() => { setIsMenuOpen(false); openAudienceVoting(); }} className="w-full border-b border-white/10 py-3 text-left text-sm font-semibold text-white">Audience Voting</button>
                <button onClick={() => { setIsMenuOpen(false); setRole("vote-wall"); }} className="w-full border-b border-white/10 py-3 text-left text-sm font-semibold text-white">Vote Wall</button>
                <button onClick={() => { setIsMenuOpen(false); setRole("judge-select"); }} className="w-full border-b border-white/10 py-3 text-left text-sm font-semibold text-[#d9c27a]">Judge Voting</button>
                <button onClick={() => { setIsMenuOpen(false); setRole("host-login"); }} className="w-full border-b border-white/10 py-3 text-left text-sm font-semibold text-white">Host Login</button>
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const VoteWallOverlay = ({
    overlay,
    onDone,
  }: {
    overlay: {
      id: string;
      photo: string;
      actor: VoteWallActor;
      actorId: number | null;
      leftPct: number;
      topPct: number;
    };
    onDone: (id: string) => void;
  }) => {
    const [phase, setPhase] = useState<"flip" | "grow" | "fade">("flip");

    useEffect(() => {
      const growTimer = window.setTimeout(() => setPhase("grow"), 2000);
      const fadeTimer = window.setTimeout(() => setPhase("fade"), 3500);
      const clearTimer = window.setTimeout(() => onDone(overlay.id), 5000);
      return () => {
        window.clearTimeout(growTimer);
        window.clearTimeout(fadeTimer);
        window.clearTimeout(clearTimer);
      };
    }, [overlay.id, onDone]);

    return (
      <motion.div
        className="absolute h-56 w-56 overflow-hidden rounded-[1.75rem] border-2 border-white/85 bg-black transform-gpu"
        initial={{ opacity: 0, rotateY: -90, scale: 1, x: "-50%", y: "-50%" }}
        animate={
          phase === "flip"
            ? { opacity: 1, rotateY: 0, scale: 1, x: "-50%", y: "-50%" }
            : phase === "grow"
              ? { opacity: 1, rotateY: 0, scale: 1.06, x: "-50%", y: "-50%" }
              : { opacity: 0, rotateY: 0, scale: 1.06, x: "-50%", y: "-50%" }
          }
          transition={
            phase === "flip"
              ? { duration: 2, ease: "easeInOut" }
              : phase === "grow"
                ? { duration: 1.5, ease: "linear" }
                : { duration: 1.5, ease: "easeOut" }
          }
          style={{
            left: `${overlay.leftPct}%`,
            top: `${overlay.topPct}%`,
            transformStyle: "preserve-3d",
            backfaceVisibility: "hidden",
            transformOrigin: "center center",
          }}
        >
          <img src={overlay.photo} alt="Latest vote" className="h-full w-full object-cover" />
        </motion.div>
      );
    };

    const VoteWallView = () => {
    const VOTE_WALL_GAP_PX = 10;
    const VOTE_WALL_MARGIN_PX = 8;
    const VOTE_WALL_MARGIN_X_PX = VOTE_WALL_MARGIN_PX;
    const VOTE_WALL_MARGIN_Y_PX = VOTE_WALL_MARGIN_PX;
    const [countdown, setCountdown] = useState<number | null>(null);
    const previousStatusRef = useRef<CompetitionStatus>(session.status);
    const livePercent = getFinalResult(session.currentCandidateId).percent;
    const stars = useMemo(() => Array.from({ length: 54 }).map((_, index) => ({
      id: index,
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 100}%`,
      size: 1 + Math.random() * 2.6,
      drift: 4 + Math.random() * 9,
      duration: 3.8 + Math.random() * 5.2,
      delay: Math.random() * 2.5,
      color: index % 5 === 0 ? "rgba(212,175,55,0.9)" : "rgba(255,255,255,0.9)",
    })), []);
    const [activeWallOverlays, setActiveWallOverlays] = useState<
      Array<{
        id: string;
        photo: string;
        actor: VoteWallActor;
        actorId: number | null;
        leftPct: number;
        topPct: number;
      }>
    >([]);
    const activeOverlaysRef = useRef(activeWallOverlays);
    const [voteWallGridSize, setVoteWallGridSize] = useState({ width: 0, height: 0, cols: VOTE_WALL_COLS });

    useEffect(() => {
      activeOverlaysRef.current = activeWallOverlays;
    }, [activeWallOverlays]);

    useEffect(() => {
      const previousStatus = previousStatusRef.current;
      if (session.status === "voting" && previousStatus !== "voting") setCountdown(3);
      previousStatusRef.current = session.status;
    }, [session.status]);

    useEffect(() => {
      if (countdown === null) return;
      if (countdown <= 0) { setCountdown(null); return; }
      const timeout = window.setTimeout(() => setCountdown((value) => (value === null ? null : value - 1)), 850);
      return () => window.clearTimeout(timeout);
    }, [countdown]);

    useEffect(() => {
      if (!session.voteWallPhoto || !session.voteWallActor) {
        return;
      }
      const overlayId = `${session.voteWallPulse}-${Date.now()}`;
      const currentOverlays = activeOverlaysRef.current;
      const actor = session.voteWallActor;
      const actorId = session.voteWallActorId;

      if (actor === "audience") return; // No 5s animation for audience

      const currentGuestOverlays = currentOverlays.filter((item) => item.actor === "guest");
      const guestCountWithNew = currentGuestOverlays.length + (actor === "guest" ? 1 : 0);

      // Re-align based on new request: Guests on left middle most (10%) and right middle most (90%)
      const judgeSlots =
        guestCountWithNew <= 0
          ? { 1: 25, 2: 50, 3: 75 }
          : guestCountWithNew === 1
            ? { 1: 20, 2: 40, 3: 60 } // Shifted to make room for 1 guest on right
            : { 1: 30, 2: 50, 3: 70 }; // Shifted to center for 2 guests on sides

      let leftPct = 50;
      let topPct = 50;

      if (actor === "judge" && actorId !== null) {
        leftPct = judgeSlots[actorId as 1 | 2 | 3] ?? 50;
      } else if (actor === "guest") {
        const guestOrder = [...currentGuestOverlays, { actorId }]
          .map((item) => item.actorId ?? Number.MAX_SAFE_INTEGER)
          .sort((a, b) => a - b);
        const guestIndex = guestOrder.findIndex((id) => id === (actorId ?? Number.MAX_SAFE_INTEGER));

        if (guestCountWithNew === 1) {
          leftPct = 90; // Right middle most
        } else {
          // If 2+ guests, Guest 1 is Left middle most, Guest 2 is Right middle most
          leftPct = guestIndex === 0 ? 10 : 90;
        }
      }

      setActiveWallOverlays((current) => [
        ...current,
        {
          id: overlayId,
          photo: session.voteWallPhoto as string,
          actor,
          actorId,
          leftPct,
          topPct,
        },
      ]);
    }, [session.voteWallPulse, session.voteWallPhoto, session.voteWallActor, session.voteWallActorId]);

    useEffect(() => {
      const recomputeGrid = () => {
        const availableWidth = Math.max(0, window.innerWidth - VOTE_WALL_MARGIN_X_PX * 2);
        const availableHeight = Math.max(0, window.innerHeight - VOTE_WALL_MARGIN_Y_PX * 2);
        const cellByWidth = (availableWidth - VOTE_WALL_GAP_PX * (VOTE_WALL_COLS - 1)) / VOTE_WALL_COLS;
        const cellByHeight = (availableHeight - VOTE_WALL_GAP_PX * (VOTE_WALL_ROWS - 1)) / VOTE_WALL_ROWS;
        const cellSize = Math.max(0, Math.min(cellByWidth, cellByHeight));
        const fittedCols = Math.max(
          VOTE_WALL_COLS,
          Math.floor((availableWidth + VOTE_WALL_GAP_PX) / Math.max(1, cellSize + VOTE_WALL_GAP_PX)),
        );
        const width = cellSize * fittedCols + VOTE_WALL_GAP_PX * (fittedCols - 1);
        const height = cellSize * VOTE_WALL_ROWS + VOTE_WALL_GAP_PX * (VOTE_WALL_ROWS - 1);
        setVoteWallGridSize({ width, height, cols: fittedCols });
      };

      recomputeGrid();
      window.addEventListener("resize", recomputeGrid);
      return () => window.removeEventListener("resize", recomputeGrid);
    }, [VOTE_WALL_GAP_PX, VOTE_WALL_MARGIN_X_PX, VOTE_WALL_MARGIN_Y_PX]);

    useEffect(() => {
      if (session.status !== "performance") return;
      setActiveWallOverlays([]);
    }, [session.status, session.currentCandidateId]);

    return (
      <div className="relative h-full min-h-[100dvh] w-full overflow-hidden bg-black">
        <div className="absolute inset-0 z-[1]">
          <div className="absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-[#d4af37]/20 blur-3xl" />
          <div className="absolute bottom-[-18%] left-[-8%] h-72 w-72 rounded-full bg-[#b8892f]/14 blur-3xl" />
          <div className="absolute top-[28%] right-[-10%] h-80 w-80 rounded-full bg-[#e5c06b]/10 blur-3xl" />
        </div>
        {countdown !== null ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black">
            <motion.p key={countdown} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 1.1, opacity: 0 }} className="text-8xl font-black text-[#d9c27a]" style={{ fontFamily: '"Oswald", "Arial Narrow", "Segoe UI", sans-serif' }}>
              {countdown}
            </motion.p>
          </div>
        ) : (
          <>
            <div className="absolute inset-0 z-10">
              {stars.map((star) => (
                <motion.span key={star.id} className="absolute rounded-full" style={{ left: star.left, top: star.top, width: star.size, height: star.size, backgroundColor: star.color, boxShadow: `0 0 8px ${star.color}` }} animate={{ y: [0, -star.drift, 0], x: [0, star.drift * 0.35, 0], opacity: [0.3, 1, 0.35] }} transition={{ duration: star.duration, repeat: Infinity, ease: "easeInOut", delay: star.delay }} />
              ))}
            </div>
            <div
              className="pointer-events-none absolute inset-0 z-[11] flex items-center justify-center"
              style={{ padding: `${VOTE_WALL_MARGIN_Y_PX}px ${VOTE_WALL_MARGIN_X_PX}px` }}
            >
              <div
                className="grid"
                style={{
                  width: `${voteWallGridSize.width}px`,
                  height: `${voteWallGridSize.height}px`,
                  columnGap: `${VOTE_WALL_GAP_PX}px`,
                  rowGap: `${VOTE_WALL_GAP_PX}px`,
                  gridTemplateColumns: `repeat(${voteWallGridSize.cols}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${VOTE_WALL_ROWS}, minmax(0, 1fr))`,
                }}
              >
                {Array.from({ length: VOTE_WALL_TOTAL }).map((_, index) => {
                  const photo = session.voteWallSquarePhotos[index];

                  return photo ? (
                    <motion.span
                      key={`photo-${index}`}
                      className="block h-full w-full rounded-sm bg-cover bg-center"
                      style={{ backgroundImage: `url(${photo})` }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.55, ease: "easeOut" }}
                    />
                  ) : (
                    <span key={`empty-${index}`} className="block h-full w-full rounded-sm bg-white/[0.03]" />
                  );
                })}
              </div>
            </div>
            {activeWallOverlays.length > 0 && (
              <div className="pointer-events-none absolute inset-0 z-[15]">
                {activeWallOverlays.map((overlay) => (
                  <VoteWallOverlay
                    key={overlay.id}
                    overlay={overlay}
                    onDone={(id) => {
                      setActiveWallOverlays((current) => current.filter((item) => item.id !== id));
                    }}
                  />
                ))}
              </div>
            )}
            <div className="absolute top-10 left-1/2 z-20 flex h-16 w-28 -translate-x-1/2 items-center justify-center bg-black/80">
              <p className="text-white" style={{ fontFamily: "Calibri, Arial, sans-serif", fontWeight: 700, fontSize: 42, lineHeight: 1 }}>{Math.round(livePercent)}%</p>
            </div>
          </>
        )}
      </div>
    );
  };

  const HostLoginView = () => (
    <div className="flex min-h-screen items-center justify-center bg-[#0c0a09] p-6 text-white">
      <div className="w-full max-w-md rounded-[2.5rem] border border-[#776a35] bg-[#140f08] p-10 shadow-[0_0_40px_rgba(154,140,92,0.2)]">
        <ShieldCheck className="mx-auto mb-8 h-12 w-12 text-[#d9c27a]" />
        <h2 className="mb-2 text-center text-3xl font-black text-[#f1e7c1]">Host Access</h2>
        <p className="mb-8 text-center text-[#b8a97a]">Enter the production dashboard.</p>
        <div className="space-y-6">
          <button onClick={handleHostLogin} className="relative mx-auto flex h-13 w-[72%] items-center justify-center overflow-hidden rounded-full border-2 bg-[#0a0704] px-[4px] active:scale-[0.99]" style={{ borderColor: "#776a35", boxShadow: "inset 0 0 0 1px rgba(154, 141, 85, 0.24), 0 8px 22px rgba(0,0,0,0.45)" }}>
            <span className="text-[16px] font-bold text-white" style={{ fontFamily: "Helvetica, Arial, sans-serif", whiteSpace: "nowrap", letterSpacing: "0.01em" }}>Enter Dashboard</span>
          </button>
          <button onClick={() => setRole("guest")} className="w-full text-sm font-bold text-[#9f9470] transition-colors hover:text-[#d9c27a]">Cancel</button>
        </div>
      </div>
    </div>
  );

  return (
    <AnimatePresence mode="wait">
      {role === "host" && (
        <motion.div key="host" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full">
          <HostView session={session} setRole={setRole} updateSession={updateSession} resetAll={resetAll} VoterViewComponent={VoterView} getJudgeImageTool={getJudgeImageTool} getJudgeDisplayImage={getJudgeDisplayImage} updateJudgeImageSource={updateJudgeImageSource} handleJudgePhotoUpload={handleJudgePhotoUpload} generateJudgeCutout={generateJudgeCutout} cutoutBusyJudgeId={cutoutBusyJudgeId} judgeUploadInputRefs={judgeUploadInputRefs} updateJudgeTool={updateJudgeTool} getFinalResult={getFinalResult} />
        </motion.div>
      )}
      {role === "voter" && (
        <motion.div key="voter" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full">
          <VotingFrame><VoterView /></VotingFrame>
        </motion.div>
      )}
      {role === "audience-auth" && (
        <motion.div key="audience-auth" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full">
          <AudienceAuthView />
        </motion.div>
      )}
      {role === "vote-wall" && (
        <motion.div key="vote-wall" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full">
          <VoteWallFrame><VoteWallView /></VoteWallFrame>
        </motion.div>
      )}
      {role === "guest" && (
        <motion.div key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full">
          <PortraitFrame><LandingView /></PortraitFrame>
        </motion.div>
      )}
      {role === "host-login" && (
        <motion.div key="login" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full">
          <HostLoginView />
        </motion.div>
      )}
      {role === "judge-select" && (
        <motion.div key="judge-select" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full">
          <JudgeSelectView />
        </motion.div>
      )}
      {role === "judge" && (
        <motion.div key="judge" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full">
          <JudgeView />
        </motion.div>
      )}
      {role === "guest-judge" && (
        <motion.div key="guest-judge" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full">
          <GuestJudgeView />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
