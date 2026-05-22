import {
  Activity,
  Ban,
  Building2,
  Camera,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Home,
  History,
  KeyRound,
  Loader2,
  Lock,
  LogIn,
  Menu,
  Plus,
  RotateCcw,
  Save,
  Send,
  Settings,
  ShieldCheck,
  Trash2,
  TrendingUp,
  UserPlus,
  UserRound,
  Users,
  Video,
  X,
} from "lucide-react";
import Hls from "hls.js";
import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_API_BASE =
  typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1"
    ? "https://sertao-replay.onrender.com/api"
    : "/api";
const IS_LOCAL_FRONTEND =
  typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
const API_BASE = (IS_LOCAL_FRONTEND ? "/api" : import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, "");
const DEFAULT_WEBRTC_BASE =
  typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? "http://localhost:8889"
    : "";
const WEBRTC_BASE = (import.meta.env.VITE_WEBRTC_BASE_URL || DEFAULT_WEBRTC_BASE).replace(/\/$/, "");
const WEBRTC_URL_STORAGE_PREFIX = "sertao_webrtc_url_";
const DEFAULT_HLS_CAMERA_MAP = {
  "campo-01": `${API_BASE}/cameras/campo-01/hls/index.m3u8`,
};
const OPERATOR_TOKEN_KEY = "sertao_operator_token";
const SUPER_ADMIN_SESSION_KEY = "sertao_super_admin_session";
const SUPER_ADMIN_CLIENT_CREDENTIALS_KEY = "sertao_super_admin_client_credentials";
const ADMIN_SESSION_KEY = "sertao_admin_session";
const REPLAY_HOTKEY_SECONDS = {
  F13: 10,
  F14: 15,
  F15: 30,
  F16: 15,
};
const NEXT_CAMERA_HOTKEY = "F17";

function replaySecondsFromHotkey(event) {
  if (event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey) {
    if (event.key === "1") return 10;
    if (event.key === "2") return 15;
    if (event.key === "3") return 30;
    if (event.key.toLowerCase() === "r") return 15;
  }

  return REPLAY_HOTKEY_SECONDS[event.key] || 0;
}

function isNextCameraHotkey(event) {
  return event.key === NEXT_CAMERA_HOTKEY || (event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey && event.key.toLowerCase() === "n");
}

function generateClientPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let password = "SR-";
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const values = new Uint32Array(12);
    crypto.getRandomValues(values);
    values.forEach((value) => {
      password += chars[value % chars.length];
    });
    return password;
  }

  for (let index = 0; index < 12; index += 1) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }
  return password;
}

async function copyTextToClipboard(value) {
  const text = String(value || "");
  if (!text || typeof document === "undefined") {
    return false;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Some browsers block the async clipboard API even on user clicks.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function formatDate(value) {
  if (!value) {
    return "Data indisponivel";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function mediaUrl(value) {
  if (!value) {
    return "";
  }

  if (value.startsWith("http")) {
    return value;
  }

  if (value.startsWith("/api")) {
    return `${API_BASE}${value.slice(4)}`;
  }

  if (value.startsWith("/")) {
    return value;
  }

  return `${API_BASE}/${value.replace(/^\//, "")}`;
}

async function apiRequest(path, { token, bearerToken, ...options } = {}) {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { "X-Operator-Token": token } : {}),
    ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : data?.detail?.message;
    throw new Error(detail || "Nao foi possivel concluir a requisicao.");
  }

  return data;
}

function replayTitle(replay) {
  return replay.title || `Replay ${replay.duration || 15}s`;
}

function fieldBackendId(fieldId) {
  return `campo-${String(fieldId).padStart(2, "0")}`;
}

function cameraBackendId(fieldId, cameraId) {
  return `${fieldBackendId(fieldId)}-camera-${String(cameraId).padStart(2, "0")}`;
}

function clientPath(clientSlug, path = "") {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return clientSlug ? `/${encodeURIComponent(clientSlug)}${cleanPath}` : cleanPath;
}

function clientApiPath(clientSlug, resourcePath) {
  if (!clientSlug) {
    return resourcePath;
  }

  return `/public/clients/${encodeURIComponent(clientSlug)}${resourcePath}`;
}

function cameraRoute(fieldId, cameraId, clientSlug = "") {
  return clientPath(clientSlug, `/campo${fieldId}/camera${cameraId}`);
}

function tenantCameraRoute(tenantSlug, camera) {
  return `/a/${tenantSlug}/campo/${camera.slug || camera.id}`;
}

function loadAdminSession() {
  try {
    return JSON.parse(localStorage.getItem(ADMIN_SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function saveAdminSession(session) {
  if (session) {
    localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(ADMIN_SESSION_KEY);
  }
}

function cameraPathFromBackendId(cameraId, clientSlug = "") {
  const match = String(cameraId).match(/^campo-?(\d+)(?:-(?:camera|cam)-?(\d+))?$/i);
  if (match) {
    return cameraRoute(Number(match[1]), Number(match[2] || 1), clientSlug);
  }

  return clientPath(clientSlug, "/operador");
}

function fieldNumber(value) {
  return String(value).padStart(2, "0");
}

const cameras = [
  {
    id: "1",
    name: "CÃ¢mera 1",
    position: "Lateral esquerda",
    image: "https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&q=80&w=640",
  },
  {
    id: "2",
    name: "CÃ¢mera 2",
    position: "Meio-campo",
    image: "https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?auto=format&fit=crop&q=80&w=640",
  },
  {
    id: "3",
    name: "CÃ¢mera 3",
    position: "Gol norte",
    image: "https://images.unsplash.com/photo-1570498839593-e565b39455fc?auto=format&fit=crop&q=80&w=640",
  },
  {
    id: "4",
    name: "CÃ¢mera 4",
    position: "VisÃ£o geral",
    image: "https://images.unsplash.com/photo-1489944440615-453fc2b6a9a9?auto=format&fit=crop&q=80&w=640",
  },
];

function parseCameraIdentity(camera, index = 0) {
  const id = String(camera?.id || "");
  const slug = String(camera?.slug || "");
  const source = `${id} ${slug} ${camera?.name || ""}`;
  const idMatch = id.match(/^campo-?(\d+)(?:-(?:camera|cam)-?(\d+))?$/i);
  if (idMatch) {
    return {
      fieldId: String(Number(idMatch[1])),
      cameraId: String(Number(idMatch[2] || 1)),
    };
  }

  const fieldNameMatch = source.match(/campo\s*-?\s*0?(\d+)/i);
  if (!fieldNameMatch) {
    return null;
  }

  const cameraNameMatch = source.match(/c[aÃ¢]mera\s*-?\s*0?(\d+)|camera\s*-?\s*0?(\d+)|cam\s*-?\s*0?(\d+)/i);
  return {
    fieldId: String(Number(fieldNameMatch[1])),
    cameraId: String(Number(cameraNameMatch?.[1] || cameraNameMatch?.[2] || cameraNameMatch?.[3] || index + 1)),
  };
}

function cameraTemplate(cameraId) {
  return cameras[(Number(cameraId) - 1) % cameras.length] || cameras[0];
}

function buildRegisteredFields(apiCameras = [], clientSlug = "") {
  const grouped = new Map();

  apiCameras
    .filter((camera) => camera?.enabled !== false)
    .forEach((camera, index) => {
      const identity = parseCameraIdentity(camera, index);
      if (!identity) {
        return;
      }

      const template = cameraTemplate(identity.cameraId);
      const registeredCamera = {
        ...camera,
        backendId: camera.id,
        id: identity.cameraId,
        fieldId: identity.fieldId,
        href: cameraRoute(identity.fieldId, identity.cameraId, clientSlug),
        image: template.image,
        name: camera.name || `CÃ¢mera ${identity.cameraId}`,
        position: camera.notes || template.position,
        status: camera.status || "unknown",
      };

      if (!grouped.has(identity.fieldId)) {
        grouped.set(identity.fieldId, {
          id: identity.fieldId,
          number: fieldNumber(identity.fieldId),
          href: clientPath(clientSlug, `/campo${identity.fieldId}`),
          featured: false,
          cameras: [],
        });
      }

      grouped.get(identity.fieldId).cameras.push(registeredCamera);
    });

  return [...grouped.values()]
    .map((field) => ({
      ...field,
      featured: field.id === "3",
      cameras: field.cameras.sort((left, right) => Number(left.id) - Number(right.id)),
    }))
    .sort((left, right) => Number(left.id) - Number(right.id));
}

const sponsors = [
  {
    number: "01",
    icon: (
      <path d="M12 2L1 12l11 10 11-10L12 2zm0 4l7 8-7 6-7-8 7-8z" />
    ),
  },
  {
    number: "02",
    icon: <circle cx="12" cy="12" r="10" />,
  },
  {
    number: "03",
    icon: <path d="M12 2L2 22h20L12 2z" />,
  },
  {
    number: "04",
    icon: <path d="M12 2l-10 5v10l10 5 10-5V7l-10-5zm0 4l6 3v6l-6 3-6-3V9l6-3z" />,
  },
];

const navItems = [
  { label: "STREAMING", href: "/streaming" },
  { label: "HIGHLIGHTS", href: "#highlights" },
  { label: "TOURNAMENTS", href: "#tournaments" },
];

function FieldIcon({ className = "h-8 w-8" }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
      <rect height="16" rx="2" width="20" x="2" y="4" />
      <path d="M12 4V20M2 12H5M19 12H22M12 12C12 13.1046 11.1046 14 10 14C8.89543 14 8 13.1046 8 12C8 10.8954 8.89543 10 10 10C11.1046 10 12 10.8954 12 12Z" />
    </svg>
  );
}

function ChevronIcon({ className = "h-5 w-5" }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg className="h-5 w-5 text-neon-green" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.382-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function BriefcaseIcon() {
  return (
    <svg className="h-5 w-5 text-neon-green" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function PlayCircleIcon({ className = "h-5 w-5" }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-12.01L14.59 11l-3.59 3.01V7.99z" />
      <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm0-2a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM11 7v10l7-5-7-5z" />
    </svg>
  );
}

function AppLogoIcon({ className = "h-12 w-12", imageClassName = "h-[72%] w-[72%]" }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black ${className}`} aria-hidden="true">
      <img alt="" className={`${imageClassName} object-contain`} src="/icon-192.png" />
    </span>
  );
}

function LogoMark() {
  return (
    <AppLogoIcon className="h-12 w-12 rounded-xl ring-1 ring-neon-green/30 lg:h-16 lg:w-16" />
  );
}

function FieldCard({ field }) {
  const large = field.featured;
  return (
    <a
      href={field.href}
      className={`glass-card group flex min-w-0 cursor-pointer items-center justify-between gap-3 rounded-2xl ${
        large ? "col-span-2 p-4 max-[420px]:col-span-1 sm:p-5 lg:col-span-1 lg:p-6" : "p-4 lg:p-6"
      }`}
      aria-label={`Abrir Campo ${field.number}`}
    >
      <div className={`flex min-w-0 items-center ${large ? "gap-4" : "gap-3"}`}>
        <div className="text-gray-400 transition group-hover:text-neon-green">
          <FieldIcon className={large ? "h-10 w-10 lg:h-12 lg:w-12" : "h-8 w-8 lg:h-12 lg:w-12"} />
        </div>
        <div className="min-w-0">
          <p className={`${large ? "text-xs" : "text-[10px]"} mb-0 font-bold uppercase leading-tight text-gray-400 lg:text-xs`}>
            Campo
          </p>
          <p className={`${large ? "text-3xl" : "text-2xl"} mb-0 font-black leading-tight text-neon-green lg:text-4xl`}>
            {field.number}
          </p>
        </div>
      </div>
      <ChevronIcon className={`${large ? "h-6 w-6" : "h-5 w-5"} shrink-0 text-neon-green lg:h-7 lg:w-7`} />
    </a>
  );
}

function SponsorCard({ sponsor }) {
  return (
    <div className="glass-card flex min-w-0 items-center gap-3 rounded-2xl p-4 lg:min-h-[104px] lg:p-5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 lg:h-12 lg:w-12">
        <svg className="h-6 w-6 text-white/50 lg:h-7 lg:w-7" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          {sponsor.icon}
        </svg>
      </div>
      <div className="min-w-0">
        <p className="mb-0 break-words text-[8px] font-bold uppercase leading-tight text-gray-400 lg:text-[10px]">Patrocinador</p>
        <p className="mb-0 text-sm font-black text-neon-green lg:text-xl">{sponsor.number}</p>
      </div>
    </div>
  );
}

function HomeNav({ clientSlug = "" }) {
  const navItems = [
    { label: "STREAMING", href: clientPath(clientSlug, "/streaming") },
    { label: "HIGHLIGHTS", href: clientPath(clientSlug, "/highlights") },
    { label: "TOURNAMENTS", href: clientPath(clientSlug, "/torneio") },
  ];

  return (
    <nav className="relative z-10 w-full" aria-label="NavegaÃ§Ã£o principal">
      <div className="grid gap-4 border-t border-[#5d2bff] bg-black/90 px-4 py-5 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-md sm:px-6 md:grid-cols-[220px_minmax(0,1fr)] md:items-center lg:min-h-[82px] lg:grid-cols-[260px_1fr_260px] lg:gap-0 lg:px-0 lg:py-0">
        <a
          className="flex w-fit min-w-0 items-center transition hover:opacity-90 lg:h-full lg:border-r lg:border-neon-green/10 lg:px-6"
          href={clientPath(clientSlug, "/")}
          aria-label="SertÃ£o Replay - inÃ­cio"
        >
          <img
            alt="SertÃ£o Replay"
            className="h-10 w-auto object-contain sm:h-11 lg:h-12"
            src="/assets/logo-sertao-replay-nav.png"
          />
        </a>

        <div className="flex min-w-0 items-center justify-start overflow-x-auto md:justify-center">
          <div className="flex items-center gap-5 whitespace-nowrap text-[10px] font-black uppercase tracking-[0.16em] text-[#9fb4c9] sm:gap-8 sm:text-[11px] sm:tracking-[0.2em] lg:gap-10 lg:tracking-[0.24em]">
            {navItems.map((item) => (
              <a
                className="transition hover:text-neon-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neon-green"
                href={item.href}
                key={item.label}
              >
                {item.label}
              </a>
            ))}
          </div>
        </div>
        <div className="hidden lg:block" aria-hidden="true" />
      </div>
    </nav>
  );
}

function HomePage({ clientSlug = "", section = "" }) {
  const [registeredFields, setRegisteredFields] = useState([]);
  const [fieldsStatus, setFieldsStatus] = useState("loading");
  const [fieldsError, setFieldsError] = useState("");

  useEffect(() => {
    async function loadRegisteredCameras() {
      setFieldsStatus("loading");
      try {
        const data = await apiRequest(clientApiPath(clientSlug, "/cameras"));
        setRegisteredFields(buildRegisteredFields(Array.isArray(data) ? data : [], clientSlug));
        setFieldsStatus("ready");
        setFieldsError("");
      } catch (error) {
        setRegisteredFields([]);
        setFieldsStatus("error");
        setFieldsError(error.message);
      }
    }

    loadRegisteredCameras();
  }, [clientSlug]);

  useEffect(() => {
    if (!section) {
      return;
    }

    const targetId = section === "torneio" ? "tournaments" : section;
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: "start" });
    });
  }, [section]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col overflow-hidden bg-dark-bg text-white shadow-[0_0_80px_rgba(0,0,0,0.45)] sm:max-w-2xl md:max-w-4xl lg:max-w-6xl lg:overflow-visible lg:bg-transparent lg:px-6 xl:px-0">
      <header className="relative z-10" data-purpose="page-header">
        <HomeNav clientSlug={clientSlug} />
      </header>

      <section id="streaming" className="mb-8 space-y-4 px-4 pt-6 sm:px-6 lg:mb-10 lg:px-0 lg:pt-10" data-purpose="field-selection" aria-label="SeleÃ§Ã£o de campo">
        {fieldsStatus === "loading" ? (
          <div className="glass-card rounded-2xl p-5 text-sm font-bold text-gray-300">Carregando campos cadastrados...</div>
        ) : null}

        {fieldsStatus === "error" ? (
          <div className="glass-card rounded-2xl p-5 text-sm text-gray-300">
            <strong className="block text-white">Nao foi possivel carregar os campos.</strong>
            <span>{fieldsError}</span>
          </div>
        ) : null}

        {fieldsStatus === "ready" && !registeredFields.length ? (
          <div className="glass-card rounded-2xl p-5 text-sm text-gray-300">
            <strong className="block text-white">Nenhum campo cadastrado.</strong>
            <span>Cadastre uma camera no Admin para liberar o campo na Home.</span>
          </div>
        ) : null}

        {registeredFields.length ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 lg:gap-5">
            {registeredFields.map((field) => (
              <FieldCard field={field} key={field.id} />
            ))}
          </div>
        ) : null}
      </section>

      <section className={`mb-8 px-4 sm:px-6 lg:mb-10 lg:px-0 ${section === "highlights" ? "scroll-mt-6" : ""}`} id="highlights" data-purpose="highlights">
        <div className="mb-4 flex items-center gap-2 lg:mb-5">
          <StarIcon />
          <h2 className="m-0 text-lg font-black uppercase tracking-wide lg:text-2xl">Algum Destaque</h2>
        </div>

        <article className="glass-card relative flex min-h-[220px] items-end overflow-hidden rounded-3xl sm:min-h-[280px] lg:min-h-[360px]">
          <div className="absolute inset-0 z-0">
            <img
              alt="Lance em campo de futebol"
              className="h-full w-full object-cover opacity-40"
              src="https://images.unsplash.com/photo-1517466787929-bc90951d0974?auto=format&fit=crop&q=80&w=1000"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
          </div>

          <div className="relative z-10 w-full p-5 sm:p-6 lg:p-8">
            <span className="mb-3 inline-block rounded-full border border-neon-green/30 bg-neon-green/10 px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-neon-green lg:mb-4 lg:text-[10px]">
              Destaque da semana
            </span>
            <h3 className="mb-2 max-w-[24rem] text-xl font-black uppercase leading-tight sm:text-3xl lg:text-4xl">
              Melhores Momentos
              <br />
              Final do Campeonato
            </h3>
            <p className="mb-4 max-w-[16rem] text-[11px] text-gray-300 sm:max-w-xs sm:text-sm lg:max-w-sm">
              Confira os melhores lances e todos os detalhes da grande decisÃ£o.
            </p>
            <button
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-neon-green px-4 py-2 text-xs font-black uppercase text-black transition hover:opacity-90 active:scale-95 lg:px-5 lg:py-3"
              type="button"
            >
              <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
              Assistir Agora
            </button>
          </div>

          <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-20 sm:right-4 sm:opacity-30 lg:right-10" aria-hidden="true">
            <svg className="h-28 w-28 text-neon-green sm:h-40 sm:w-40 lg:h-56 lg:w-56" fill="none" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20ZM10 8V16L16 12L10 8Z" fill="currentColor" />
            </svg>
          </div>

          <div className="absolute bottom-4 right-6 flex gap-1.5" aria-hidden="true">
            <div className="h-2 w-2 rounded-full bg-neon-green" />
            <div className="h-2 w-2 rounded-full bg-white/20" />
            <div className="h-2 w-2 rounded-full bg-white/20" />
            <div className="h-2 w-2 rounded-full bg-white/20" />
            <div className="h-2 w-2 rounded-full bg-white/20" />
          </div>
        </article>
      </section>

      <section id="tournaments" className={`mb-12 px-4 sm:px-6 lg:mb-16 lg:px-0 ${section === "torneio" ? "scroll-mt-6" : ""}`} data-purpose="sponsors">
        <div className="mb-4 flex items-center gap-2 lg:mb-5">
          <BriefcaseIcon />
          <h2 className="m-0 text-lg font-black uppercase tracking-wide lg:text-2xl">Patrocinadores</h2>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-5">
          {sponsors.map((sponsor) => (
            <SponsorCard sponsor={sponsor} key={sponsor.number} />
          ))}
        </div>
      </section>

      <footer className="mt-auto flex flex-wrap items-center justify-center gap-4 border-t border-white/5 px-4 py-8 sm:px-6 lg:justify-between lg:rounded-t-3xl lg:bg-white/[0.02] lg:px-10" data-purpose="page-footer">
        <div className="h-px flex-1 bg-white/10" />
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-3 px-0 sm:gap-4 lg:px-6">
          <span className="whitespace-nowrap text-[9px] font-black uppercase tracking-widest text-gray-400">SertÃ£o Replay</span>
          <div className="text-neon-green">
            <PlayCircleIcon className="h-5 w-5" />
          </div>
          <span className="whitespace-nowrap text-[9px] font-black uppercase tracking-widest text-gray-400">Replay Ã© emoÃ§Ã£o</span>
        </div>
        <div className="h-px flex-1 bg-white/10" />
      </footer>
    </main>
  );
}

function PublicTenantPage({ slug }) {
  const [client, setClient] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [replays, setReplays] = useState([]);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadTenant() {
      setStatus("loading");
      try {
        const [clientData, cameraData, replayData] = await Promise.all([
          apiRequest(`/public/clients/${encodeURIComponent(slug)}`),
          apiRequest(`/public/clients/${encodeURIComponent(slug)}/cameras`),
          apiRequest(`/public/clients/${encodeURIComponent(slug)}/replays`),
        ]);
        setClient(clientData);
        setCameras(Array.isArray(cameraData) ? cameraData : []);
        setReplays(Array.isArray(replayData) ? replayData : []);
        setStatus("ready");
        setMessage("");
      } catch (error) {
        setStatus("error");
        setMessage(error.message);
      }
    }

    loadTenant();
  }, [slug]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col overflow-hidden bg-dark-bg text-white shadow-[0_0_80px_rgba(0,0,0,0.45)] sm:max-w-2xl md:max-w-4xl lg:max-w-6xl lg:overflow-visible lg:bg-transparent lg:px-6 xl:px-0">
      <header className="border-t border-[#5d2bff] bg-black/90 px-4 py-5 sm:px-6 lg:rounded-b-3xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <a href="/" className="flex items-center">
            <img alt="Sertao Replay" className="h-11 w-auto object-contain" src={client?.logo_url || "/assets/logo-sertao-replay-nav.png"} />
          </a>
          <span className="rounded-full border border-neon-green/40 px-4 py-2 text-xs font-black uppercase text-neon-green">
            {client?.name || "Arena"}
          </span>
        </div>
      </header>

      <section className="px-4 py-8 sm:px-6 lg:px-0">
        <p className="eyebrow">Replays publicos</p>
        <h1 className="mb-3 text-3xl font-black uppercase leading-tight sm:text-5xl">{client?.name || "Arena Sertao Replay"}</h1>
        <p className="max-w-2xl text-sm text-gray-300 sm:text-base">
          Acesse os ultimos lances da arena pelo QR Code. Nao precisa de login.
        </p>
      </section>

      {status === "error" ? (
        <section className="px-4 sm:px-6 lg:px-0">
          <div className="glass-card rounded-2xl p-5 text-sm text-gray-300">{message}</div>
        </section>
      ) : null}

      <section className="mb-8 px-4 sm:px-6 lg:px-0">
        <div className="mb-4 flex items-center gap-2">
          <Camera className="h-5 w-5 text-neon-green" />
          <h2 className="m-0 text-xl font-black uppercase">Cameras</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cameras.map((camera) => (
            <a key={camera.id} href={tenantCameraRoute(slug, camera)} className="glass-card flex min-w-0 items-center justify-between gap-4 rounded-2xl p-5 text-white no-underline">
              <div className="min-w-0">
                <p className="m-0 text-xs font-black uppercase text-gray-400">Campo / camera</p>
                <h3 className="m-0 truncate text-2xl font-black text-neon-green">{camera.name}</h3>
              </div>
              <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${camera.status === "recording" ? "bg-neon-green text-black" : "bg-red-500 text-white"}`}>
                {camera.status === "recording" ? "Ao vivo" : "Offline"}
              </span>
            </a>
          ))}
        </div>
      </section>

      <section className="mb-12 px-4 sm:px-6 lg:px-0">
        <div className="mb-4 flex items-center gap-2">
          <Video className="h-5 w-5 text-neon-green" />
          <h2 className="m-0 text-xl font-black uppercase">Ultimos replays</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {replays.map((replay) => (
            <a key={replay.id} href={`/a/${slug}/replay/${replay.id}`} className="group text-white no-underline">
              <div className="relative mb-2 aspect-video overflow-hidden rounded-xl bg-[#0b0f0e]">
                <video className="h-full w-full object-cover opacity-70 transition group-hover:opacity-100" src={mediaUrl(replay.video_url)} preload="metadata" muted />
                <span className="absolute bottom-2 right-2 rounded bg-black/80 px-2 py-1 text-xs text-white">{replayDurationLabel(replay.duration)}</span>
              </div>
              <h3 className="mb-1 line-clamp-2 font-bold group-hover:text-neon-green">{replayTitle(replay)}</h3>
              <p className="m-0 text-sm text-gray-400">{formatDate(replay.created_at)}</p>
            </a>
          ))}
          {status === "ready" && !replays.length ? (
            <div className="glass-card rounded-2xl p-5 text-sm text-gray-300">Nenhum replay publico ainda.</div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function PublicCameraPage({ slug, cameraSlug }) {
  const [camera, setCamera] = useState(null);
  const [replays, setReplays] = useState([]);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadCamera() {
      setStatus("loading");
      try {
        const [cameraData, replayData] = await Promise.all([
          apiRequest(`/public/clients/${encodeURIComponent(slug)}/cameras/${encodeURIComponent(cameraSlug)}`),
          apiRequest(`/public/clients/${encodeURIComponent(slug)}/replays?camera_slug=${encodeURIComponent(cameraSlug)}`),
        ]);
        setCamera(cameraData);
        setReplays(Array.isArray(replayData) ? replayData : []);
        setStatus("ready");
        setMessage("");
      } catch (error) {
        setStatus("error");
        setMessage(error.message);
      }
    }

    loadCamera();
  }, [slug, cameraSlug]);

  return (
    <main className="min-h-screen bg-[#0a0f0d] px-4 py-6 text-white sm:px-6 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <a href={`/a/${slug}`}><img alt="Sertao Replay" className="h-11 w-auto object-contain" src="/assets/logo-sertao-replay-nav.png" /></a>
          <a className="rounded-full border border-[#8ddc00]/40 px-4 py-2 text-sm font-bold text-[#a1fb00] no-underline" href={`/a/${slug}`}>Voltar</a>
        </header>
        <section className="mb-8">
          <p className="eyebrow">Camera publica</p>
          <h1 className="text-3xl font-black sm:text-5xl">{camera?.name || "Camera"}</h1>
          {status === "error" ? <p className="text-red-300">{message}</p> : <p className="text-gray-400">Replays publicos desta camera.</p>}
        </section>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {replays.map((replay) => (
            <a key={replay.id} href={`/a/${slug}/replay/${replay.id}`} className="group text-white no-underline">
              <div className="relative mb-2 aspect-video overflow-hidden rounded-xl bg-black">
                <video className="h-full w-full object-cover opacity-70 group-hover:opacity-100" src={mediaUrl(replay.video_url)} preload="metadata" muted />
                <PlayCircleIcon className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 text-white" />
              </div>
              <h2 className="m-0 text-lg font-black group-hover:text-[#a1fb00]">{replayTitle(replay)}</h2>
              <p className="m-0 text-sm text-gray-400">{formatDate(replay.created_at)}</p>
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}

function PublicReplayPage({ slug, replayId }) {
  const [replay, setReplay] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadReplay() {
      try {
        const data = await apiRequest(`/public/clients/${encodeURIComponent(slug)}/replays/${encodeURIComponent(replayId)}`);
        setReplay(data);
        setMessage("");
      } catch (error) {
        setMessage(error.message);
      }
    }

    loadReplay();
  }, [slug, replayId]);

  return (
    <main className="min-h-screen bg-[#0a0f0d] px-4 py-6 text-white sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <a href={`/a/${slug}`}><img alt="Sertao Replay" className="h-11 w-auto object-contain" src="/assets/logo-sertao-replay-nav.png" /></a>
          <a className="rounded-full border border-[#8ddc00]/40 px-4 py-2 text-sm font-bold text-[#a1fb00] no-underline" href={`/a/${slug}`}>Voltar</a>
        </header>
        {message ? <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-red-200">{message}</div> : null}
        {replay ? (
          <>
            <h1 className="mb-4 text-3xl font-black sm:text-5xl">{replayTitle(replay)}</h1>
            <video className="aspect-video w-full rounded-2xl bg-black object-contain" src={mediaUrl(replay.video_url)} controls playsInline preload="metadata" />
            <a className="mt-4 inline-flex rounded-xl bg-[#a1fb00] px-5 py-3 font-black text-black no-underline" href={mediaUrl(replay.download_url || replay.video_url)} download>Baixar replay</a>
          </>
        ) : null}
      </div>
    </main>
  );
}

function CameraGlyph({ className = "h-5 w-5" }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 256 256" aria-hidden="true">
      <path d="M244.24,80.27l-32,18.18V80a16,16,0,0,0-16-16H32A16,16,0,0,0,16,80V176a16,16,0,0,0,16,16H196.24a16,16,0,0,0,16-16V157.55l32,18.18A8,8,0,0,0,256,168.91V87.09A8,8,0,0,0,244.24,80.27ZM196.24,176H32V80H196.24v96Zm43.76-7.09L212,152.91V103.09l28-15.91Z" />
    </svg>
  );
}

function StatusDot({ className = "" }) {
  return <span className={`inline-block h-2 w-2 rounded-full bg-[#a4ff00] shadow-[0_0_12px_rgba(164,255,0,0.8)] ${className}`} />;
}

function FieldMonitorIcon() {
  return (
    <div className="rounded-[8px] bg-[#181c1b] p-4">
      <svg className="h-8 w-8 text-[#a4ff00]" fill="currentColor" viewBox="0 0 256 256" aria-hidden="true">
        <path d="M208,32H48A16,16,0,0,0,32,48V176a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32Zm0,144H48V48H208V176Zm48-64a8,8,0,0,1-8,8H216a8,8,0,0,1,0-16h32A8,8,0,0,1,256,112Zm0,32a8,8,0,0,1-8,8H216a8,8,0,0,1,0-16h32A8,8,0,0,1,256,144Z" />
        <circle cx="128" cy="112" r="32" />
      </svg>
    </div>
  );
}

function CameraCard({ camera, fieldId, clientSlug = "" }) {
  return (
    <a
      className="group relative grid min-h-[150px] min-w-0 grid-cols-1 gap-4 rounded-[8px] border border-white/5 bg-[#181c1b]/60 p-3 text-left text-white no-underline transition hover:border-[#a4ff00]/60 hover:bg-[#181c1b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a4ff00] sm:grid-cols-[minmax(8rem,10rem)_minmax(0,1fr)]"
      href={cameraRoute(fieldId, camera.id, clientSlug)}
      aria-label={`Abrir ${camera.name} do Campo ${fieldId}`}
    >
      <img
        alt={`Preview ${camera.name}`}
        className="aspect-video h-auto min-h-[126px] w-full rounded-md object-cover opacity-70 transition group-hover:opacity-100 sm:h-full"
        src={camera.image}
      />

      <div className="flex min-w-0 flex-col justify-center gap-2">
        <div className="flex items-center gap-2">
          <div className="rounded border border-gray-700 p-1 text-gray-400">
            <CameraGlyph className="h-4 w-4" />
          </div>
          <span className="min-w-0 break-words font-bold">{camera.name}</span>
        </div>
        <span className="break-words text-sm text-gray-400">{camera.position}</span>
        <div className="mt-1 flex items-center gap-2">
          <StatusDot />
          <span className="text-[10px] font-semibold uppercase text-[#a4ff00]">Online</span>
        </div>
      </div>
    </a>
  );
}

function CampoPage({ fieldId, clientSlug = "" }) {
  const [registeredFields, setRegisteredFields] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadFieldCameras() {
      setStatus("loading");
      try {
        const data = await apiRequest(clientApiPath(clientSlug, "/cameras"));
        setRegisteredFields(buildRegisteredFields(Array.isArray(data) ? data : [], clientSlug));
        setStatus("ready");
        setError("");
      } catch (requestError) {
        setRegisteredFields([]);
        setStatus("error");
        setError(requestError.message);
      }
    }

    loadFieldCameras();
  }, []);

  const field = registeredFields.find((item) => item.id === String(fieldId));

  return (
    <main className="min-h-screen bg-[#0b0f0e] px-4 py-5 font-anybody text-white sm:px-6 lg:px-10 lg:py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex flex-wrap items-center justify-between gap-4" data-purpose="main-header">
          <a className="flex items-center" href={clientPath(clientSlug, "/")} aria-label="Voltar para a Home">
            <img alt="Sertao Replay" className="h-11 w-auto object-contain lg:h-14" src="/assets/logo-sertao-replay-nav.png" />
          </a>
          <a className="inline-flex min-h-10 items-center rounded-full border border-gray-600 px-5 py-2 text-sm font-bold text-gray-300 transition hover:border-[#a4ff00] hover:text-[#a4ff00]" href={clientPath(clientSlug, "/")}>
            Voltar
          </a>
        </header>

        <section className="flex min-w-0 items-start gap-4" data-purpose="page-title">
          <FieldMonitorIcon />
          <div className="min-w-0">
            <h1 className="mb-1 flex flex-wrap items-center gap-3 break-words text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              Campo {field?.number || fieldNumber(fieldId)} <StatusDot className="h-2.5 w-2.5" />
            </h1>
            <p className="mb-0 text-gray-400">Escolha uma c&acirc;mera</p>
          </div>
        </section>

        <section data-purpose="camera-selection">
          {status === "loading" ? (
            <div className="rounded-[8px] border border-white/5 bg-[#181c1b]/60 p-5 text-sm font-bold text-gray-300">Carregando cameras cadastradas...</div>
          ) : null}

          {status === "error" ? (
            <div className="rounded-[8px] border border-white/5 bg-[#181c1b]/60 p-5 text-sm text-gray-300">
              <strong className="block text-white">Nao foi possivel carregar as cameras.</strong>
              <span>{error}</span>
            </div>
          ) : null}

          {status === "ready" && !field ? (
            <div className="rounded-[8px] border border-white/5 bg-[#181c1b]/60 p-5 text-sm text-gray-300">
              <strong className="block text-white">Campo nao cadastrado.</strong>
              <span>Cadastre uma camera deste campo no Admin para liberar esta tela.</span>
            </div>
          ) : null}

          {field ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {field.cameras.map((camera) => (
                <CameraCard camera={camera} fieldId={field.id} clientSlug={clientSlug} key={camera.backendId} />
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

const replayFilters = ["15s", "30s", "60s", "Gol", "Defesa", "Lance bonito"];

function replayDurationLabel(duration) {
  const seconds = Number(duration) || 15;
  return `00:${String(seconds).padStart(2, "0")}`;
}

function storedWebrtcUrl(cameraId) {
  if (!cameraId || typeof window === "undefined") {
    return "";
  }

  try {
    const storedUrl =
      window.localStorage.getItem(`${WEBRTC_URL_STORAGE_PREFIX}${cameraId}`) ||
      window.localStorage.getItem("sertao_webrtc_url") ||
      "";
    const oldLocalDefault = new RegExp(`/(${cameraId})/whep$`, "i");
    if (storedUrl && WEBRTC_BASE && oldLocalDefault.test(storedUrl)) {
      return "";
    }

    return storedUrl;
  } catch {
    return "";
  }
}

function saveStoredWebrtcUrl(cameraId, value) {
  if (!cameraId || typeof window === "undefined") {
    return;
  }

  try {
    const storageKey = `${WEBRTC_URL_STORAGE_PREFIX}${cameraId}`;
    if (value.trim()) {
      window.localStorage.setItem(storageKey, value.trim());
    } else {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // localStorage can be unavailable in private browser contexts.
  }
}

function webrtcUrlForCamera(camera) {
  if (!camera?.id) {
    return "";
  }

  const storedUrl = storedWebrtcUrl(camera.id);
  if (storedUrl) {
    return storedUrl;
  }

  if (camera.webrtc_url || camera.webrtcUrl) {
    return camera.webrtc_url || camera.webrtcUrl;
  }

  if (WEBRTC_BASE) {
    return `${WEBRTC_BASE}/${encodeURIComponent(`${camera.id}-live`)}/whep`;
  }

  return `${API_BASE}/cameras/${encodeURIComponent(camera.id)}/webrtc/offer`;
}

function hlsUrlForCamera(camera) {
  if (!camera?.id) {
    return "";
  }

  if (camera.hls_url || camera.hlsUrl) {
    return camera.hls_url || camera.hlsUrl;
  }

  return DEFAULT_HLS_CAMERA_MAP[camera.id] || `${API_BASE}/cameras/${encodeURIComponent(camera.id)}/hls/index.m3u8`;
}

function waitForIceGatheringComplete(peerConnection) {
  if (peerConnection.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let timeout;
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeout);
      peerConnection.removeEventListener("icegatheringstatechange", handleChange);
      resolve();
    };

    const handleChange = () => {
      if (peerConnection.iceGatheringState === "complete") {
        finish();
      }
    };

    peerConnection.addEventListener("icegatheringstatechange", handleChange);
    timeout = window.setTimeout(finish, 2500);
  });
}

function clearVideoStream(video) {
  if (!video) {
    return;
  }

  if (video.srcObject) {
    video.srcObject.getTracks?.().forEach((track) => track.stop());
    video.srcObject = null;
  }

  video.removeAttribute("src");
  video.load?.();
}

function IconButton({ children, className = "", ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg bg-black/40 p-2 text-white backdrop-blur-sm transition hover:bg-black/60 ${className}`}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

function resolveOperatorCameraId(apiCameras) {
  const params = new URLSearchParams(window.location.search);
  const routeMatch = window.location.pathname.match(/^\/operador\/campo(\d+)(?:\/camera(\d+))?\/?$/);
  const fieldId = routeMatch?.[1] || params.get("campo");
  const cameraId = routeMatch?.[2] || params.get("camera");

  if (!fieldId) {
    return apiCameras[0]?.id || "";
  }

  const candidates = cameraId
    ? [cameraBackendId(fieldId, cameraId), `${fieldBackendId(fieldId)}-cam-${String(cameraId).padStart(2, "0")}`, fieldBackendId(fieldId)]
    : [fieldBackendId(fieldId)];

  return candidates.find((candidate) => apiCameras.some((camera) => camera.id === candidate)) || apiCameras[0]?.id || "";
}

function CameraPage({ fieldId: routeFieldId, cameraId: routeCameraId, clientSlug = "" }) {
  const params = new URLSearchParams(window.location.search);
  const fieldId = routeFieldId || params.get("campo") || "";
  const cameraId = routeCameraId || params.get("camera") || "";
  const [registeredFields, setRegisteredFields] = useState([]);
  const [replays, setReplays] = useState([]);
  const [selectedReplayId, setSelectedReplayId] = useState("");
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const field = registeredFields.find((item) => item.id === String(fieldId));
  const camera = field?.cameras.find((item) => item.id === String(cameraId));
  const previewImage = camera?.image || cameraTemplate(cameraId || 1).image;
  const cameraReplays = camera
    ? replays.filter((replay) => replay.status === "ready" && replay.camera_id === camera.backendId && replay.video_url)
    : [];
  const selectedReplay = cameraReplays.find((replay) => String(replay.id) === selectedReplayId) || cameraReplays[0] || null;
  const selectedVideoUrl = selectedReplay ? mediaUrl(selectedReplay.video_url) : "";
  const selectedDownloadUrl = selectedReplay ? mediaUrl(selectedReplay.download_url || selectedReplay.video_url) : "";

  useEffect(() => {
    async function loadCameraData() {
      setStatus("loading");
      try {
        const [cameraData, replayData] = await Promise.all([
          apiRequest(clientApiPath(clientSlug, "/cameras")),
          apiRequest(clientApiPath(clientSlug, "/replays")),
        ]);
        setRegisteredFields(buildRegisteredFields(Array.isArray(cameraData) ? cameraData : [], clientSlug));
        setReplays(Array.isArray(replayData) ? replayData : []);
        setStatus("ready");
        setError("");
      } catch (requestError) {
        setRegisteredFields([]);
        setReplays([]);
        setStatus("error");
        setError(requestError.message);
      }
    }

    loadCameraData();
  }, [clientSlug]);

  useEffect(() => {
    if (!cameraReplays.length) {
      setSelectedReplayId("");
      return;
    }

    if (!cameraReplays.some((replay) => String(replay.id) === selectedReplayId)) {
      setSelectedReplayId(String(cameraReplays[0].id));
    }
  }, [cameraReplays, selectedReplayId]);

  return (
    <main className="min-h-screen bg-[#0a0f0d] pb-28 text-white lg:pb-10">
      <header className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 bg-[#0a0f0d]/95 px-4 py-4 backdrop-blur-md lg:px-8" data-purpose="main-header">
        <a className="flex items-center" href={clientPath(clientSlug, "/")} aria-label="Voltar para a Home">
          <img alt="Sertao Replay" className="h-10 w-auto object-contain lg:h-12" src="/assets/logo-sertao-replay-nav.png" />
        </a>
      </header>

      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24.375rem)] lg:px-8">
        <section className="min-w-0">
          <section className="mb-4" data-purpose="camera-title-section">
            <div className="flex min-w-0 items-center gap-3">
              <div className="shrink-0 rounded-lg border border-[#79e043]/30 bg-[#1c221e] p-2 text-[#79e043]">
                <CameraGlyph className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="mb-0 flex flex-wrap items-center gap-2 break-words text-xl font-bold sm:text-2xl lg:text-4xl">
                  {field ? `Campo ${field.number}` : "Campo"} <span className="text-3xl leading-none text-[#79e043]">â€¢</span>{" "}
                  <span className="text-[#79e043]">{camera?.name || "Camera"}</span>
                </h1>
                <p className="mb-0 text-sm text-[#a0a0a0]">{camera?.position || "Posicao indisponivel"}</p>
              </div>
            </div>
          </section>

          {status === "error" ? (
            <div className="mb-4 rounded-2xl border border-white/5 bg-[#1c221e]/60 p-4 text-sm text-[#a0a0a0]">
              <strong className="block text-white">Nao foi possivel carregar os dados desta camera.</strong>
              <span>{error}</span>
            </div>
          ) : null}

          {status === "ready" && !camera ? (
            <div className="mb-4 rounded-2xl border border-white/5 bg-[#1c221e]/60 p-4 text-sm text-[#a0a0a0]">
              <strong className="block text-white">Camera nao cadastrada.</strong>
              <span>Esta rota so fica ativa quando a camera existe no banco de dados.</span>
            </div>
          ) : null}

          <section className="relative mb-6 overflow-hidden rounded-2xl shadow-[0_0_20px_rgba(121,224,67,0.1)]" data-purpose="live-video-player">
            <div className="relative aspect-video bg-black">
              {selectedReplay ? (
                <video
                  className="h-full w-full bg-black object-contain"
                  controls
                  key={selectedReplay.id}
                  playsInline
                  poster={previewImage}
                  preload="metadata"
                  src={selectedVideoUrl}
                />
              ) : (
                <img alt="Campo de futebol" className="h-full w-full object-cover" src={previewImage} />
              )}

              <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/40 px-3 py-1 backdrop-blur-sm sm:left-4 sm:top-4">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#79e043]" />
                <span className="text-xs font-medium">{selectedReplay ? "Replay selecionado" : "Online"}</span>
              </div>

              {selectedReplay ? (
                <div className="absolute inset-x-3 bottom-3 max-h-[55%] overflow-hidden rounded-xl bg-black/55 p-2 text-left backdrop-blur-sm sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-14 sm:max-w-[min(360px,calc(100%-2rem))] sm:p-3 sm:text-right">
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#79e043]">Assistindo agora</p>
                    <h2 className="m-0 line-clamp-2 text-sm font-black text-white sm:text-base lg:text-xl">{replayTitle(selectedReplay)}</h2>
                    <p className="m-0 text-xs text-[#a0a0a0]">{formatDate(selectedReplay.created_at)}</p>
                  </div>
                  <a className="mt-2 hidden rounded-lg bg-[#79e043] px-3 py-2 text-xs font-black uppercase text-black no-underline sm:inline-flex sm:px-4" href={selectedDownloadUrl} download>
                    Baixar replay
                  </a>
                </div>
              ) : (
                <>
                  <IconButton className="absolute right-4 top-4" aria-label="Tela cheia">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M21 16v3a2 2 0 0 1-2 2h-3" />
                    </svg>
                  </IconButton>

                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 sm:p-4">
                    <div className="flex items-center gap-3 sm:gap-4">
                      <button type="button" aria-label="Reproduzir">
                        <svg className="h-5 w-5 fill-current text-white" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </button>
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="shrink-0 text-[10px] tabular-nums text-white">00:00 / 00:30</span>
                        <div className="relative h-1 flex-1 rounded-full bg-white/20">
                          <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-[#79e043]" />
                          <div className="absolute left-1/3 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-[#79e043] shadow-[0_0_10px_#79e043]" />
                        </div>
                      </div>
                      <button type="button" aria-label="Configura&ccedil;&otilde;es">
                        <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
                          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.36.62.99 1 1.6 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="mb-6 overflow-hidden" data-purpose="replay-duration-filters">
            <div className="no-scrollbar flex gap-2 overflow-x-auto pb-2">
              {replayFilters.map((filter, index) => (
                <button
                  className={`min-h-10 whitespace-nowrap rounded-xl border px-4 py-2 text-sm font-medium sm:px-6 ${
                    index === 0 ? "border-[#79e043] bg-transparent text-[#79e043]" : "border-white/10 bg-[#1c221e] text-white"
                  }`}
                  key={filter}
                  type="button"
                >
                  {filter}
                </button>
              ))}
              <button className="min-h-10 shrink-0 rounded-xl border border-white/10 bg-[#1c221e] px-5 py-2 text-white" type="button" aria-label="Mais filtros">
                <ChevronIcon className="h-4 w-4" />
              </button>
            </div>
          </section>
        </section>

        <aside className="min-w-0" data-purpose="replays-list">
          <div className="mb-4 flex items-center gap-2">
            <svg className="h-5 w-5 text-[#79e043]" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11Zm3.5-.5L10 9h3L10.5 6h-3Zm6 0L16 9h1.5a.5.5 0 0 0 .5-.5V6h-4.5ZM6 10.5v7a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-7H6Z" />
            </svg>
            <h2 className="m-0 text-lg font-bold">Replays recentes</h2>
          </div>

          {status === "loading" ? (
            <div className="rounded-2xl border border-white/5 bg-[#1c221e]/40 p-4 text-sm font-bold text-[#a0a0a0]">Carregando replays desta camera...</div>
          ) : null}

          {status === "ready" && camera && !cameraReplays.length ? (
            <div className="rounded-2xl border border-white/5 bg-[#1c221e]/40 p-4 text-sm text-[#a0a0a0]">
              <strong className="block text-white">Nenhum replay desta camera ainda.</strong>
              <span>Quando esta camera gravar um lance, ele aparece aqui automaticamente.</span>
            </div>
          ) : null}

          {cameraReplays.length ? (
            <div className="grid gap-4">
            {cameraReplays.map((replay) => {
              const videoUrl = mediaUrl(replay.video_url);
              const downloadUrl = mediaUrl(replay.download_url || replay.video_url);
              const isSelected = selectedReplay && String(selectedReplay.id) === String(replay.id);

              return (
                <article
                  className={`flex cursor-pointer flex-col gap-3 rounded-2xl border p-3 transition ${
                    isSelected ? "border-[#79e043] bg-[#79e043]/10 shadow-[0_0_18px_rgba(121,224,67,0.12)]" : "border-white/5 bg-[#1c221e]/40 hover:border-[#79e043]/50"
                  }`}
                  key={replay.id}
                  onClick={() => setSelectedReplayId(String(replay.id))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedReplayId(String(replay.id));
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                <div className="flex min-w-0 gap-3">
                  <button
                    className="relative h-20 w-24 flex-shrink-0 overflow-hidden rounded-xl text-left min-[390px]:w-28 sm:w-32"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedReplayId(String(replay.id));
                    }}
                    type="button"
                    aria-label={`Ver ${replayTitle(replay)} no player principal`}
                  >
                    <img alt="Thumbnail do replay" className="h-full w-full object-cover opacity-60" src={previewImage} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <PlayCircleIcon className="h-8 w-8 text-white" />
                    </div>
                    <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px]">{replayDurationLabel(replay.duration)}</span>
                    {isSelected ? <span className="absolute left-1 top-1 rounded bg-[#79e043] px-2 py-0.5 text-[9px] font-black uppercase text-black">No player</span> : null}
                  </button>

                  <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="mb-1 text-[10px] text-[#79e043]">{formatDate(replay.created_at)}</p>
                        <h3 className="mb-0 line-clamp-2 text-sm font-bold">{replayTitle(replay)}</h3>
                        <p className="mb-0 mt-1 truncate text-[11px] text-[#a0a0a0]">{replay.camera_name || camera.name}</p>
                      </div>
                      <button className="text-[#a0a0a0]" type="button" aria-label="Mais opcoes">
                        <span className="text-xl leading-none">...</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 min-[390px]:grid-cols-2">
                  <button
                    className="flex min-w-0 items-center justify-center gap-2 rounded-lg bg-[#79e043] px-2 py-2 text-sm font-bold text-black"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedReplayId(String(replay.id));
                    }}
                    type="button"
                  >
                    <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    <span className="truncate">Ver no player</span>
                  </button>
                  <a className="flex min-w-0 items-center justify-center gap-2 rounded-lg border border-white/10 bg-[#1c221e] px-2 py-2 text-sm text-white no-underline" href={downloadUrl} download onClick={(event) => event.stopPropagation()}>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
                    </svg>
                    <span className="truncate">Baixar</span>
                  </a>
                </div>
                </article>
              );
            })}
            </div>
          ) : null}
        </aside>
      </div>

      <footer className="mx-auto mt-6 w-full max-w-md px-4 pb-6 lg:hidden" data-purpose="navigation-footer">
        <div className="mx-auto max-w-md space-y-3">
          <a className="flex w-full items-center justify-center gap-3 rounded-2xl bg-[#79e043] py-4 font-extrabold text-black no-underline shadow-[0_0_20px_rgba(121,224,67,0.3)] transition active:scale-95" href={field ? field.href : clientPath(clientSlug, "/")}>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 12H5m0 0 7 7m-7-7 7-7" />
            </svg>
            Voltar para c&acirc;meras
          </a>
        </div>
      </footer>
    </main>
  );
}

const STREAM_CHAT_STORAGE_KEY = "sertao_stream_chat_messages";
const STREAM_CHAT_USER_KEY = "sertao_stream_chat_user";
const STREAM_CHAT_USER = "Atleta";

function streamChatUserKey(clientSlug = "") {
  const slugKey = String(clientSlug || "global").trim().toLowerCase() || "global";
  return `${STREAM_CHAT_USER_KEY}_${slugKey}`;
}

function chatInitials(name) {
  const parts = String(name || "Torcedor")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  return (parts.map((part) => part[0]).join("") || "TR").toUpperCase();
}

function loadStoredChatMessages() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const data = JSON.parse(window.localStorage.getItem(STREAM_CHAT_STORAGE_KEY) || "[]");
    return Array.isArray(data) ? data.slice(-80) : [];
  } catch {
    return [];
  }
}

function loadStoredChatUser(clientSlug = "") {
  if (typeof window === "undefined") {
    return "";
  }

  const tenantKey = streamChatUserKey(clientSlug);
  const storedUser = (window.localStorage.getItem(tenantKey) || "").trim();
  if (!storedUser || storedUser.toLowerCase() === "admin") {
    window.localStorage.removeItem(tenantKey);
    window.localStorage.removeItem(STREAM_CHAT_USER_KEY);
    return "";
  }

  return storedUser;
}

function normalizeChatMessage(item) {
  const storedUser = String(item.user || "").trim();
  const safeUser = storedUser.toLowerCase() === "admin" ? STREAM_CHAT_USER : storedUser || STREAM_CHAT_USER;
  return {
    id: item.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    user: safeUser,
    initials: chatInitials(safeUser),
    text: item.text || "",
    createdAt: item.createdAt || item.created_at || new Date().toISOString(),
  };
}

function StreamingChatPanel({ chatDraft, chatListRef, chatMessages, handleSendChat, setChatDraft, userName, onChangeUser, className = "" }) {
  return (
    <section className={`flex min-h-[360px] min-w-0 flex-col sm:min-h-[420px] ${className}`} data-purpose="streaming-chat">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#8ddc00]/20 bg-[#101413]/75 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-[#8ddc00]/20 bg-[#272b29] p-4">
          <h2 className="m-0 flex items-center gap-2 font-bold text-[#a1fb00]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#a1fb00]" />
            Chat ao Vivo
          </h2>
          <span className="text-xs font-bold text-[#c0caad]">{chatMessages.length}</span>
        </div>
        <div className="border-b border-[#8ddc00]/10 bg-[#181c1b] px-4 py-3">
          <button className="text-left text-xs font-bold uppercase tracking-[0.12em] text-[#a1fb00]" onClick={onChangeUser} type="button">
            {userName || STREAM_CHAT_USER}
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4" ref={chatListRef}>
          {!chatMessages.length ? (
            <div className="rounded-xl border border-[#414a34] bg-[#181c1b] p-4 text-sm text-[#c0caad]">
              Seja o primeiro a comentar nessa live.
            </div>
          ) : null}

          {chatMessages.map((item, index) => (
            <div className="flex min-w-0 gap-3" key={item.id || `${item.user}-${index}`}>
              <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full border border-[#8ddc00]/10 bg-[#363a38] text-xs">{item.initials}</div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-xs font-bold text-[#a1fb00]">{item.user}</span>
                  {item.createdAt ? <span className="text-[10px] text-[#8a947a]">{formatDate(item.createdAt)}</span> : null}
                </div>
                <p className="m-0 break-words text-sm text-white">{item.text}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-[#8ddc00]/20 bg-[#1c201f] p-4">
          <form className="space-y-2" onSubmit={handleSendChat}>
            <button className="text-left text-xs font-bold uppercase tracking-[0.14em] text-[#8a947a]" onClick={onChangeUser} type="button">
              {userName || STREAM_CHAT_USER}
            </button>
            <div className="flex items-center gap-2">
              <input
                className="min-w-0 flex-1 rounded-t-md border-0 border-b border-[#8ddc00]/30 bg-[#101413] px-3 py-2 text-sm text-white outline-none focus:border-[#a1fb00] focus:ring-0"
                maxLength={240}
                onChange={(event) => setChatDraft(event.target.value)}
                placeholder="Diga algo..."
                type="text"
                value={chatDraft}
              />
              <button className="rounded-full p-2 text-[#a1fb00] transition hover:bg-[#a1fb00]/10 disabled:opacity-40" disabled={!chatDraft.trim()} type="submit" aria-label="Enviar mensagem">
                <Send size={18} />
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}

function StreamingPage({ clientSlug = "" }) {
  const videoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const hlsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const chatListRef = useRef(null);
  const [cameras, setCameras] = useState([]);
  const [replays, setReplays] = useState([]);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("Buscando cameras ao vivo...");
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [webrtcStatus, setWebrtcStatus] = useState("idle");
  const [webrtcError, setWebrtcError] = useState("");
  const [webrtcConfigVersion, setWebrtcConfigVersion] = useState(0);
  const [chatMessages, setChatMessages] = useState(() => loadStoredChatMessages());
  const [chatDraft, setChatDraft] = useState("");
  const [chatUserName, setChatUserName] = useState(() => loadStoredChatUser(clientSlug));
  const [chatNameDraft, setChatNameDraft] = useState(() => loadStoredChatUser(clientSlug));
  const [showChatNameModal, setShowChatNameModal] = useState(() => !loadStoredChatUser(clientSlug));
  const [previewReplayId, setPreviewReplayId] = useState("");

  function saveChatUserName(name) {
    const safeName = name.trim() || STREAM_CHAT_USER;
    setChatUserName(safeName);
    setChatNameDraft(safeName);
    setShowChatNameModal(false);
    window.localStorage.setItem(streamChatUserKey(clientSlug), safeName);
  }

  useEffect(() => {
    const storedUser = loadStoredChatUser(clientSlug);
    setChatUserName(storedUser);
    setChatNameDraft(storedUser);
    setShowChatNameModal(!storedUser);
  }, [clientSlug]);

  useEffect(() => {
    async function loadStreamingData() {
      try {
        const [cameraData, replayData] = await Promise.all([
          apiRequest(clientApiPath(clientSlug, "/cameras")),
          apiRequest(clientApiPath(clientSlug, "/replays")),
        ]);
        const enabledCameras = Array.isArray(cameraData) ? cameraData.filter((camera) => camera.enabled !== false) : [];
        setCameras(enabledCameras);
        setReplays(Array.isArray(replayData) ? replayData : []);
        setSelectedCameraId((current) => current || enabledCameras.find((camera) => camera.status === "recording")?.id || enabledCameras[0]?.id || "");
        setStatus("ready");
        setMessage("Live conectada pelo servidor publico.");
      } catch (error) {
        setStatus("error");
        setMessage(error.message);
      }
    }

    loadStreamingData();
    const refreshTimer = window.setInterval(loadStreamingData, 10000);
    return () => window.clearInterval(refreshTimer);
  }, [clientSlug]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STREAM_CHAT_STORAGE_KEY, JSON.stringify(chatMessages.slice(-80)));
    } catch {
      // localStorage can be unavailable in private browser contexts.
    }
  }, [chatMessages]);

  useEffect(() => {
    const chatList = chatListRef.current;
    if (chatList) {
      chatList.scrollTop = chatList.scrollHeight;
    }
  }, [chatMessages.length]);

  useEffect(() => {
    function syncChat(event) {
      if (event.key === STREAM_CHAT_STORAGE_KEY) {
        setChatMessages(loadStoredChatMessages());
      }
    }

    window.addEventListener("storage", syncChat);
    return () => window.removeEventListener("storage", syncChat);
  }, []);

  const selectedCamera = cameras.find((camera) => camera.id === selectedCameraId) || cameras[0];
  const selectedCameraIdentity = selectedCamera ? parseCameraIdentity(selectedCamera) : null;
  const posterImage = cameraTemplate(selectedCameraIdentity?.cameraId || 1).image;
  const effectiveWebrtcUrl = selectedCamera ? webrtcUrlForCamera(selectedCamera) : "";
  const effectiveHlsUrl = selectedCamera ? hlsUrlForCamera(selectedCamera) : "";
  const cameraReplays = selectedCamera
    ? replays.filter((replay) => replay.status === "ready" && replay.camera_id === selectedCamera.id && replay.video_url).slice(0, 6)
    : [];
  const previewReplay = cameraReplays.find((replay) => String(replay.id) === previewReplayId) || null;

  useEffect(() => {
    if (!selectedCameraId) {
      setChatMessages(loadStoredChatMessages());
      return undefined;
    }

    let cancelled = false;
    async function loadChatMessages() {
      try {
        const clientQuery = clientSlug ? `&client_slug=${encodeURIComponent(clientSlug)}` : "";
        const data = await apiRequest(`/chat/messages?camera_id=${encodeURIComponent(selectedCameraId)}&limit=80${clientQuery}`);
        if (!cancelled && Array.isArray(data)) {
          setChatMessages(data.map(normalizeChatMessage));
        }
      } catch {
        if (!cancelled) {
          setChatMessages(loadStoredChatMessages());
        }
      }
    }

    loadChatMessages();
    const timer = window.setInterval(loadChatMessages, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [clientSlug, selectedCameraId]);

  const isLive = webrtcStatus === "connected" || webrtcStatus === "receiving";
  const streamStatusLabel = isLive ? "Ao vivo" : "Offline";

  const scheduleWebrtcReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
    }

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      setWebrtcConfigVersion((current) => current + 1);
    }, 3000);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (!selectedCamera?.id) {
      setWebrtcStatus("idle");
      setWebrtcError("");
      clearVideoStream(video);
      return undefined;
    }

    let cancelled = false;

    function connectHls(reason = "") {
      if (!effectiveHlsUrl || !video) {
        setWebrtcStatus(reason ? "error" : "missing-url");
        setWebrtcError(reason || "");
        clearVideoStream(video);
        return undefined;
      }

      setWebrtcStatus("connecting");
      setWebrtcError("");
      clearVideoStream(video);

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = effectiveHlsUrl;
        video.play().catch(() => {});
        setWebrtcStatus("receiving");
        return undefined;
      }

      if (!Hls.isSupported()) {
        setWebrtcStatus("error");
        setWebrtcError(reason || "Este navegador nao tem suporte a live HLS.");
        return undefined;
      }

      const hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 30,
      });
      hlsRef.current = hls;
      hls.loadSource(effectiveHlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!cancelled) {
          video.play().catch(() => {});
          setWebrtcStatus("receiving");
        }
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!cancelled && data?.fatal) {
          setWebrtcStatus("error");
          setWebrtcError("A live HLS ainda nao esta recebendo video do servidor publico.");
          scheduleWebrtcReconnect();
        }
      });

      return hls;
    }

    if (effectiveHlsUrl && !WEBRTC_BASE) {
      const hls = connectHls();
      return () => {
        cancelled = true;
        hls?.destroy?.();
        if (hlsRef.current === hls) {
          hlsRef.current = null;
        }
        clearVideoStream(video);
      };
    }

    if (!effectiveWebrtcUrl || typeof window === "undefined" || !window.RTCPeerConnection) {
      const hls = connectHls(!effectiveWebrtcUrl ? "" : "Este navegador nao tem suporte a WebRTC.");
      return () => {
        cancelled = true;
        hls?.destroy?.();
        if (hlsRef.current === hls) {
          hlsRef.current = null;
        }
        clearVideoStream(video);
      };
    }

    const peerConnection = new window.RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    peerConnectionRef.current = peerConnection;
    setWebrtcStatus("connecting");
    setWebrtcError("");

    peerConnection.addTransceiver("video", { direction: "recvonly" });
    peerConnection.addTransceiver("audio", { direction: "recvonly" });

    peerConnection.ontrack = (event) => {
      if (cancelled || !video) {
        return;
      }

      const stream = event.streams?.[0];
      if (stream && video.srcObject !== stream) {
        video.srcObject = stream;
        video.play().catch(() => {});
      }

      setWebrtcStatus("receiving");
    };

    peerConnection.onconnectionstatechange = () => {
      if (cancelled) {
        return;
      }

      if (peerConnection.connectionState === "connected") {
        setWebrtcStatus("connected");
      }

      if (peerConnection.connectionState === "failed" || peerConnection.connectionState === "disconnected") {
        setWebrtcStatus("error");
        setWebrtcError("A conexao WebRTC caiu. Verifique o gateway da camera.");
        scheduleWebrtcReconnect();
      }
    };

    async function connectWebrtc() {
      try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await waitForIceGatheringComplete(peerConnection);

        if (cancelled) {
          return;
        }

        const response = await fetch(effectiveWebrtcUrl, {
          method: "POST",
          headers: {
            Accept: "application/sdp",
            "Content-Type": "application/sdp",
          },
          body: peerConnection.localDescription?.sdp || offer.sdp,
        });

        if (!response.ok) {
          throw new Error(`Gateway WebRTC respondeu ${response.status}.`);
        }

        const answer = await response.text();
        if (!answer.trim()) {
          throw new Error("Gateway WebRTC nao retornou SDP.");
        }

        await peerConnection.setRemoteDescription({ type: "answer", sdp: answer });
      } catch (error) {
        if (!cancelled) {
          peerConnection.close();
          peerConnectionRef.current = null;
          connectHls(error.message || "Nao foi possivel abrir a live por WebRTC.");
        }
      }
    }

    connectWebrtc();

    return () => {
      cancelled = true;
      if (peerConnectionRef.current === peerConnection) {
        peerConnectionRef.current = null;
      }
      hlsRef.current?.destroy();
      hlsRef.current = null;
      peerConnection.close();
      clearVideoStream(video);
    };
  }, [effectiveHlsUrl, effectiveWebrtcUrl, scheduleWebrtcReconnect, selectedCamera?.id, webrtcConfigVersion]);

  async function handleSendChat(event) {
    event.preventDefault();
    const text = chatDraft.trim();
    const user = (chatUserName || STREAM_CHAT_USER).trim();
    if (!text) {
      return;
    }

    const fallbackMessage = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      user,
      initials: chatInitials(user),
      text,
      createdAt: new Date().toISOString(),
    };

    setChatDraft("");
    try {
      const saved = await apiRequest("/chat/messages", {
        method: "POST",
        body: JSON.stringify({
          client_slug: clientSlug || null,
          camera_id: selectedCamera?.id || null,
          user,
          text,
        }),
      });
      setChatMessages((current) => [...current.slice(-79), normalizeChatMessage(saved)]);
    } catch {
      setChatMessages((current) => [...current.slice(-79), fallbackMessage]);
    }
  }

  return (
    <main className="min-h-screen bg-[#101413] px-3 pb-10 pt-20 text-[#e0e3e0] sm:px-4 md:px-8 xl:px-12">
      {showChatNameModal ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/80 px-4 backdrop-blur-sm">
          <form
            className="w-full max-w-sm rounded-xl border border-[#8ddc00]/30 bg-[#101413] p-5 shadow-[0_0_30px_rgba(141,220,0,0.14)]"
            onSubmit={(event) => {
              event.preventDefault();
              saveChatUserName(chatNameDraft);
            }}
          >
            <AppLogoIcon className="mb-4 h-12 w-12 rounded-xl ring-1 ring-neon-green/30" />
            <h2 className="mb-2 text-xl font-black text-white">Seu nome no chat</h2>
            <p className="mb-4 text-sm text-[#c0caad]">Digite o nome que vai aparecer quando voce comentar na live.</p>
            <input
              autoFocus
              className="mb-4 w-full rounded-lg border border-[#8ddc00]/30 bg-black px-3 py-3 text-white outline-none focus:border-[#a1fb00]"
              maxLength={80}
              onChange={(event) => setChatNameDraft(event.target.value)}
              placeholder="Ex: Joao Silva"
              value={chatNameDraft}
            />
            <button className="w-full rounded-lg bg-[#a1fb00] px-4 py-3 text-sm font-black uppercase text-black" type="submit">
              Entrar no streaming
            </button>
          </form>
        </div>
      ) : null}
      <nav className="fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between gap-3 border-b border-[#8ddc00]/30 bg-[#101413]/80 px-3 shadow-[0_0_15px_rgba(141,220,0,0.1)] backdrop-blur-xl sm:px-4 md:px-8 xl:px-12">
        <a className="flex min-w-0 items-center no-underline transition hover:opacity-90" href={clientPath(clientSlug, "/")} aria-label="Sertao Replay - inicio">
          <img alt="Sertao Replay" className="h-10 w-auto max-w-[min(13rem,55vw)] object-contain sm:h-11" src="/assets/logo-sertao-replay-nav.png" />
        </a>


        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] sm:px-3 sm:text-[11px] sm:tracking-[0.14em] ${isLive ? "bg-[#a1fb00] text-[#102000]" : "bg-[#ff4d4d] text-white"}`}>
            {streamStatusLabel}
          </span>
          <a className="inline-flex min-h-9 items-center rounded-full border border-[#8ddc00]/40 px-3 py-2 text-xs font-bold text-[#a1fb00] no-underline sm:px-4" href={selectedCamera ? cameraPathFromBackendId(selectedCamera.id, clientSlug) : clientPath(clientSlug, "/")}>
            Camera
          </a>
        </div>
      </nav>

      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="min-w-0 lg:col-span-8 xl:col-span-9">
          <div className="relative aspect-video overflow-hidden rounded-xl border border-[#8ddc00]/20 bg-black shadow-[0_0_15px_rgba(141,220,0,0.3)]">
            <video
              ref={videoRef}
              autoPlay
              className="h-full w-full object-contain"
              controls
              muted
              playsInline
              poster={posterImage}
            />

            {!isLive ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0b0f0e]/80 p-4 text-center backdrop-blur-sm sm:p-8">
                <Video size={48} className="mb-3 text-[#a1fb00] sm:mb-4" />
                <h1 className="mb-2 text-xl font-black text-white sm:text-2xl">
                  {webrtcStatus === "connecting" ? "Conectando live" : "Live indisponivel"}
                </h1>
                <p className="max-w-md text-sm text-[#c0caad]">
                  {webrtcError || "A transmissao da camera conecta automaticamente em alguns instantes."}
                </p>
              </div>
            ) : null}

          </div>
        </section>

        <StreamingChatPanel
            chatDraft={chatDraft}
            chatListRef={chatListRef}
            chatMessages={chatMessages}
            handleSendChat={handleSendChat}
            setChatDraft={setChatDraft}
            userName={chatUserName}
            onChangeUser={() => setShowChatNameModal(true)}
          className="lg:sticky lg:top-24 lg:col-span-4 lg:row-span-3 lg:h-[calc(100vh-120px)] xl:col-span-3"
        />

        <section className="min-w-0 space-y-6 lg:col-span-8 xl:col-span-9">
          <section className="space-y-4">
            <h1 className="break-words text-2xl font-black tracking-tight text-white sm:text-3xl md:text-4xl">{selectedCamera?.name || "Streaming Sertao Replay"}</h1>
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-[#8ddc00] bg-[#1c201f] font-black italic text-[#a1fb00]">SR</div>
                <div className="min-w-0">
                  <p className="m-0 font-bold text-white">Sertao Replay</p>
                  <p className="m-0 break-words text-sm text-[#c0caad]">{message}</p>
                </div>
              </div>

              <div className="flex min-w-0 flex-wrap gap-2">
                {cameras.map((camera) => (
                  <button
                    className={`min-h-10 rounded-full border px-3 py-2 text-xs font-black uppercase transition sm:px-4 ${
                      camera.id === selectedCamera?.id ? "border-[#a1fb00] bg-[#a1fb00] text-[#102000]" : "border-[#414a34] bg-[#1c201f] text-[#c0caad] hover:border-[#a1fb00]"
                    }`}
                    key={camera.id}
                    onClick={() => {
                      setSelectedCameraId(camera.id);
                      setWebrtcError("");
                    }}
                    type="button"
                  >
                    {camera.name}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-black text-white">Highlights recentes</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {cameraReplays.map((replay) => (
                <button
                  className="group min-h-0 rounded-xl border-0 bg-transparent p-0 text-left text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a1fb00]"
                  key={replay.id}
                  onClick={() => setPreviewReplayId(String(replay.id))}
                  type="button"
                >
                  <div className="relative mb-2 aspect-video overflow-hidden rounded-xl bg-[#0b0f0e]">
                    <img alt={replayTitle(replay)} className="h-full w-full object-cover opacity-70 transition duration-500 group-hover:scale-105" src={posterImage} />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/10 opacity-0 transition group-hover:opacity-100">
                      <PlayCircleIcon className="h-12 w-12 text-white drop-shadow-[0_0_16px_rgba(0,0,0,0.8)]" />
                    </div>
                    <span className="absolute bottom-2 right-2 rounded bg-black/80 px-2 py-1 text-xs text-white">{replayDurationLabel(replay.duration)}</span>
                  </div>
                  <h3 className="mb-1 line-clamp-2 font-bold transition group-hover:text-[#a1fb00]">{replayTitle(replay)}</h3>
                  <p className="m-0 text-sm text-[#c0caad]">{formatDate(replay.created_at)}</p>
                </button>
              ))}

              {!cameraReplays.length ? (
                <div className="rounded-xl border border-[#414a34] bg-[#181c1b] p-5 text-sm text-[#c0caad]">Nenhum highlight desta camera ainda.</div>
              ) : null}
            </div>
          </section>
        </section>

      </div>

      {previewReplay ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onClick={() => setPreviewReplayId("")}>
          <section
            className="w-full max-w-4xl overflow-hidden rounded-2xl border border-[#8ddc00]/30 bg-[#101413] shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Preview de ${replayTitle(previewReplay)}`}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[#8ddc00]/20 p-4">
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-black uppercase tracking-[0.16em] text-[#a1fb00]">Preview</p>
                <h2 className="m-0 line-clamp-2 text-lg font-black text-white sm:text-2xl">{replayTitle(previewReplay)}</h2>
                <p className="m-0 text-sm text-[#c0caad]">{formatDate(previewReplay.created_at)}</p>
              </div>
              <button
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#414a34] text-[#c0caad] transition hover:border-[#a1fb00] hover:text-[#a1fb00]"
                onClick={() => setPreviewReplayId("")}
                type="button"
                aria-label="Fechar preview"
              >
                <X size={20} />
              </button>
            </div>
            <div className="aspect-video bg-black">
              <video
                className="h-full w-full object-contain"
                controls
                playsInline
                poster={posterImage}
                preload="metadata"
                src={mediaUrl(previewReplay.video_url)}
              />
            </div>
          </section>
        </div>
      ) : null}

    </main>
  );
}

function OperatorPage() {
  const [cameras, setCameras] = useState([]);
  const [cameraId, setCameraId] = useState("");
  const [label, setLabel] = useState("");
  const [replays, setReplays] = useState([]);
  const [apiStatus, setApiStatus] = useState("checking");
  const [message, setMessage] = useState("Conectando ao backend...");
  const [busy, setBusy] = useState(false);

  async function loadCameras() {
    const data = await apiRequest("/cameras");
    setCameras(Array.isArray(data) ? data : []);
    setCameraId((current) => current || resolveOperatorCameraId(Array.isArray(data) ? data : []));
  }

  function selectNextCamera() {
    setCameraId((current) => {
      if (!cameras.length) {
        return current;
      }

      const currentIndex = cameras.findIndex((camera) => camera.id === current);
      const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % cameras.length : 0;
      const nextCamera = cameras[nextIndex];
      setMessage(`Camera selecionada: ${nextCamera.name}`);
      return nextCamera.id;
    });
  }

  async function loadReplays() {
    const data = await apiRequest("/replays");
    setReplays(Array.isArray(data) ? data : []);
  }

  async function refresh({ silent = false } = {}) {
    try {
      await apiRequest("/health");
      await Promise.all([loadCameras(), loadReplays()]);
      setApiStatus("online");
      if (!silent) {
        setMessage("Backend online. Capture-server deve estar rodando na arena.");
      }
    } catch (error) {
      setApiStatus("offline");
      setMessage(error.message);
    }
  }

  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => refresh({ silent: true }), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const requestReplay = useCallback(async (seconds = 15) => {
    if (busy) {
      return;
    }

    if (!cameraId) {
      setMessage("Cadastre ou conecte uma camera antes de pedir replay.");
      return;
    }

    setBusy(true);
    setMessage(`Solicitacao de ${seconds}s enviada. Aguardando capture-server cortar e subir o MP4...`);

    try {
      const data = await apiRequest("/replay-requests", {
        method: "POST",
        body: JSON.stringify({
          camera_id: cameraId,
          seconds,
          label: label.trim() || null,
        }),
      });
      setMessage(data?.message || "Replay solicitado ao capture-server.");
      setLabel("");
      await loadReplays();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }, [busy, cameraId, label]);

  useEffect(() => {
    function handleReplayHotkey(event) {
      if (isNextCameraHotkey(event) && !event.repeat) {
        event.preventDefault();
        selectNextCamera();
        return;
      }

      const seconds = replaySecondsFromHotkey(event);
      if (!seconds || event.repeat) {
        return;
      }

      event.preventDefault();
      requestReplay(seconds);
    }

    window.addEventListener("keydown", handleReplayHotkey);
    return () => window.removeEventListener("keydown", handleReplayHotkey);
  }, [cameras, requestReplay]);

  const selectedCamera = cameras.find((camera) => camera.id === cameraId);
  const readyReplays = replays.filter((replay) => replay.status === "ready" && replay.video_url).slice(0, 5);

  return (
    <main className="operator-shell">
      <header className="operator-topbar">
        <nav className="operator-nav" aria-label="Navegacao do operador">
          <a className="operator-brand" href="/">
            <Home size={18} />
            Home
          </a>
          <a className="operator-brand" href="/admin">
            <Settings size={18} />
            Admin
          </a>
        </nav>
        <span className={`status-pill status-${apiStatus}`}>
          {apiStatus === "online" ? "API online" : apiStatus === "offline" ? "API offline" : "Verificando API"}
        </span>
      </header>

      <section className="operator-hero">
        <div>
          <p className="eyebrow">Painel do operador</p>
          <h1>Replay 15s</h1>
          <p className="header-copy">
            Esta tela cria a solicitacao no backend. O capture-server local acessa o RTSP,
            gera o MP4 e publica o video na Home.
          </p>
        </div>
      </section>

      <section className="operator-grid">
        <article className="operator-panel">
          <div className="panel-heading">
            <Activity size={22} />
            <div>
              <h2>Camera</h2>
              <p>Status enviado pelo capture-server local.</p>
            </div>
          </div>

          <label htmlFor="cameraSelect">Camera cadastrada</label>
          <select id="cameraSelect" value={cameraId} onChange={(event) => setCameraId(event.target.value)}>
            {cameras.length ? (
              cameras.map((camera) => (
                <option key={camera.id} value={camera.id}>
                  {camera.name} ({camera.status || "unknown"})
                </option>
              ))
            ) : (
              <option value="">Nenhuma camera cadastrada</option>
            )}
          </select>

          <div className="status-box">
            <strong>{selectedCamera?.name || "Sem camera"}</strong>
            <span>{selectedCamera?.status || "Aguardando capture-server"}</span>
          </div>

          {selectedCamera ? (
            <a className="secondary-action" href={cameraPathFromBackendId(selectedCamera.id)}>
              <Video size={18} />
              Abrir caminho da camera
            </a>
          ) : null}

          <button type="button" className="secondary-action" onClick={() => refresh()}>
            <RotateCcw size={18} />
            Atualizar
          </button>
        </article>

        <article className="operator-panel accent-panel">
          <div className="panel-heading">
            <Send size={22} />
            <div>
              <h2>Gerar replay</h2>
              <p>Cria uma solicitacao para os ultimos 15 segundos.</p>
            </div>
          </div>

          <label htmlFor="replayLabel">Titulo opcional</label>
          <input
            id="replayLabel"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Gol, defesa, lance decisivo..."
          />

          <button type="button" className="primary-action" onClick={() => requestReplay(15)} disabled={busy || !cameraId}>
            {busy ? <Loader2 className="spin" size={19} /> : <Video size={19} />}
            Replay 15s
          </button>

          <div className="result">
            <strong>Status</strong>
            <span>{message}</span>
          </div>
        </article>

        <article className="operator-panel">
          <div className="panel-heading">
            <CheckCircle2 size={22} />
            <div>
              <h2>Controle fisico</h2>
              <p>Arduino Leonardo conectado para gerar replay sem token.</p>
            </div>
          </div>

          <div className="status-box">
            <strong>Replay 15s</strong>
            <span>Botao fisico pronto para uso.</span>
          </div>
        </article>
      </section>

      <section className="operator-panel recent-panel">
        <div className="panel-heading">
          <Video size={22} />
          <div>
            <h2>Ultimos replays</h2>
            <p>A lista atualiza junto com a Home.</p>
          </div>
        </div>

        {readyReplays.length ? (
          <div className="recent-list">
            {readyReplays.map((replay) => (
              <a key={replay.id} className="recent-item" href={mediaUrl(replay.video_url)} target="_blank" rel="noreferrer">
                <strong>{replayTitle(replay)}</strong>
                <span>
                  {replay.camera_name} - {formatDate(replay.created_at)}
                </span>
              </a>
            ))}
          </div>
        ) : (
          <p className="muted">Nenhum replay pronto ainda.</p>
        )}
      </section>
    </main>
  );
}

function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("Entrando...");
    try {
      const data = await apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      saveAdminSession(data);
      window.location.href = `/admin/${encodeURIComponent(data.client.slug)}/dashboard`;
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-login-page">
      <div className="admin-login-lights" aria-hidden="true" />
      <div className="admin-login-texture" aria-hidden="true" />

      <section className="admin-login-shell" aria-label="Login administrativo">
        <div className="admin-login-brand">
          <img
            alt="Sertao Replay"
            className="admin-login-logo"
            src="/assets/logo-sertao-replay-nav.png"
          />
          <div className="admin-login-title">
            <h1>Painel Admin</h1>
            <p>Acesso Restrito ao Painel</p>
          </div>
        </div>

        <article className="admin-login-card">
          <div className="admin-login-accent" aria-hidden="true" />
          <form className="admin-login-form" onSubmit={submit}>
            <div className="admin-login-field">
              <label htmlFor="adminLoginEmail">E-mail Administrativo</label>
              <div className="admin-login-input-row">
                <UserRound size={20} />
                <input
                  id="adminLoginEmail"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="usuario@sertaoreplay.com.br"
                  type="email"
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div className="admin-login-field">
              <div className="admin-login-label-row">
                <label htmlFor="adminLoginPassword">Chave de Acesso</label>
                <a href="/admin/login">Esqueceu a senha?</a>
              </div>
              <div className="admin-login-input-row">
                <Lock size={20} />
                <input
                  id="adminLoginPassword"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••••••"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                />
                <button
                  className="admin-login-visibility"
                  onClick={() => setShowPassword((current) => !current)}
                  type="button"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <button className="admin-login-submit" type="submit" disabled={busy}>
              {busy ? <Loader2 className="spin" size={24} /> : <LogIn size={24} />}
              {busy ? "Entrando..." : "Entrar no Painel"}
            </button>

            <div className="admin-login-security">
              <ShieldCheck size={16} />
              <span>Conexão Criptografada SSL</span>
            </div>
          </form>

          {message ? (
            <div className={`admin-login-message ${message === "Entrando..." ? "is-loading" : ""}`}>
              {message}
            </div>
          ) : null}
        </article>

        <footer className="admin-login-status">
          <div>
            <span className="admin-login-dot" />
            <span>Servidor Online</span>
          </div>
          <span>v2.4.0 (Stadium Build)</span>
        </footer>
      </section>
    </main>
  );
}

function AdminTenantPage({ view = "dashboard", routeClientSlug = "" }) {
  const [session, setSession] = useState(() => loadAdminSession());
  const [dashboard, setDashboard] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [replays, setReplays] = useState([]);
  const [settingsData, setSettingsData] = useState(null);
  const [message, setMessage] = useState("Carregando admin...");
  const [busy, setBusy] = useState(false);
  const [cameraForm, setCameraForm] = useState({
    id: "",
    name: "",
    camera_ip: "",
  });

  const token = session?.access_token;
  const client = settingsData || session?.client;
  const clientSlug = client?.slug || routeClientSlug || "";
  const adminBase = clientSlug ? `/admin/${clientSlug}` : "/admin";
  const publicUrl = clientSlug ? `${window.location.origin}/${clientSlug}` : "";
  const onlineCameras = cameras.filter((camera) => camera.status === "recording").length;
  const offlineCameras = Math.max(cameras.length - onlineCameras, 0);
  const publicReplays = replays.filter((replay) => replay.is_public).length;
  const recentReplays = replays.slice(0, 8);
  const chartValues = [40, 30, 55, 80, 95, 70, 45, 35, 60, 50, 85, 75];

  useEffect(() => {
    if (!token) {
      window.location.href = "/admin/login";
      return;
    }

    if (routeClientSlug && session?.client?.slug && routeClientSlug !== session.client.slug) {
      window.location.href = `/admin/${encodeURIComponent(session.client.slug)}/dashboard`;
      return;
    }

    async function loadAdminData() {
      try {
        const [dashboardData, cameraData, replayData, settingsResult] = await Promise.all([
          apiRequest("/admin/dashboard", { bearerToken: token }),
          apiRequest("/admin/cameras", { bearerToken: token }),
          apiRequest("/admin/replays", { bearerToken: token }),
          apiRequest("/admin/settings", { bearerToken: token }),
        ]);
        setDashboard(dashboardData);
        setCameras(Array.isArray(cameraData) ? cameraData : []);
        setReplays(Array.isArray(replayData) ? replayData : []);
        setSettingsData(settingsResult);
        setMessage("Dados carregados.");
      } catch (error) {
        setMessage(error.message);
        if (String(error.message).toLowerCase().includes("login") || String(error.message).toLowerCase().includes("sessao")) {
          saveAdminSession(null);
          setSession(null);
        }
      }
    }

    loadAdminData();
  }, [routeClientSlug, session?.client?.slug, token]);

  function logout() {
    saveAdminSession(null);
    window.location.href = "/admin/login";
  }

  function updateCameraForm(field, value) {
    setCameraForm((current) => ({ ...current, [field]: value }));
  }

  function resetCameraForm() {
    setCameraForm({ id: "", name: "", camera_ip: "" });
  }

  function editTenantCamera(camera) {
    setCameraForm({
      id: camera.id || "",
      name: camera.name || "",
      camera_ip: camera.rtsp_url?.match(/rtsp:\/\/(?:[^@]+@)?([^/:]+)/i)?.[1] || "",
    });
  }

  async function reloadAdminData() {
    if (!token) {
      return;
    }

    const [dashboardData, cameraData, replayData, settingsResult] = await Promise.all([
      apiRequest("/admin/dashboard", { bearerToken: token }),
      apiRequest("/admin/cameras", { bearerToken: token }),
      apiRequest("/admin/replays", { bearerToken: token }),
      apiRequest("/admin/settings", { bearerToken: token }),
    ]);
    setDashboard(dashboardData);
    setCameras(Array.isArray(cameraData) ? cameraData : []);
    setReplays(Array.isArray(replayData) ? replayData : []);
    setSettingsData(settingsResult);
  }

  async function saveTenantCamera(event) {
    event.preventDefault();
    if (!token) {
      setMessage("Login admin obrigatorio.");
      return;
    }

    const payload = {
      id: cameraForm.id.trim(),
      name: cameraForm.name.trim(),
      camera_ip: cameraForm.camera_ip.trim(),
    };

    setBusy(true);
    setMessage("Salvando camera...");
    try {
      const saved = await apiRequest("/admin/cameras", {
        method: "POST",
        bearerToken: token,
        body: JSON.stringify(payload),
      });
      setMessage(`Camera ${saved.name} salva no cliente ${client?.name || session?.client?.name || ""}.`);
      resetCameraForm();
      await reloadAdminData();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  const navItems = [
    { href: `${adminBase}/dashboard`, label: "Inicio", icon: Home, key: "dashboard" },
  ];

  if (!token) {
    return <AdminLoginPage />;
  }

  return (
    <main className="tenant-admin-page">
      <header className="tenant-admin-topbar">
        <div className="tenant-admin-topbar-inner">
          <div className="tenant-admin-brand">
            <button className="tenant-admin-icon-button" type="button" aria-label="Menu">
              <Menu size={22} />
            </button>
            <a href={`${adminBase}/dashboard`} className="tenant-admin-logo-link" aria-label="Sertao Replay admin">
              <img alt="Sertao Replay" src="/assets/logo-sertao-replay-nav.png" />
            </a>
          </div>

          <nav className="tenant-admin-desktop-nav" aria-label="Admin do cliente">
            {navItems.map((item) => (
              <a className={view === item.key ? "is-active" : ""} href={item.href} key={item.key}>{item.label}</a>
            ))}
          </nav>

          <button className="tenant-admin-avatar" onClick={logout} type="button" title="Sair">
            {(session?.user?.name || "Admin").slice(0, 2).toUpperCase()}
          </button>
        </div>
      </header>

      <section className="tenant-admin-shell">
        <div className="tenant-admin-heading">
          <div>
            <span>Visao geral do sistema</span>
            <h1>Painel Admin</h1>
            <p>{client?.name || "Cliente"} · {clientSlug || "tenant"}</p>
          </div>
          <div className="tenant-admin-heading-actions">
            <a className="tenant-admin-secondary" href={publicUrl || "/"} target="_blank" rel="noreferrer">Pagina publica</a>
          </div>
        </div>

        {message ? <div className="tenant-admin-message">{message}</div> : null}

        <section className="tenant-admin-metrics">
          <article className="tenant-admin-card tenant-admin-camera-card">
            <div className="tenant-admin-card-top">
              <div className="tenant-admin-card-icon"><Video size={24} /></div>
              <span>Total de cameras</span>
            </div>
            <div>
              <div className="tenant-admin-big-number">
                <strong>{dashboard?.cameras_total ?? cameras.length}</strong>
                <span>Unidades conectadas</span>
              </div>
              <div className="tenant-admin-split-status">
                <span><i className="is-online" />{onlineCameras} online</span>
                <span><i className="is-offline" />{offlineCameras} offline</span>
              </div>
            </div>
          </article>

          <article className="tenant-admin-card">
            <div className="tenant-admin-card-top">
              <div className="tenant-admin-card-icon"><History size={24} /></div>
              <span>Replays</span>
            </div>
            <div>
              <strong className="tenant-admin-stat">{dashboard?.replays_total ?? replays.length}</strong>
              <p><TrendingUp size={15} /> {publicReplays} publicos</p>
            </div>
          </article>

          <article className="tenant-admin-card">
            <div className="tenant-admin-card-top">
              <div className="tenant-admin-card-icon"><Users size={24} /></div>
              <span>Cliente</span>
            </div>
            <div>
              <strong className="tenant-admin-stat">{client?.plan || "starter"}</strong>
              <p><Activity size={15} /> Ao vivo</p>
            </div>
          </article>
        </section>

        <section className="tenant-admin-main-grid tenant-admin-main-grid-single">
          <article className="tenant-admin-card tenant-admin-chart-card">
            <div className="tenant-admin-section-head">
              <div>
                <h2>Atividade de geracao de replays</h2>
                <p>Ultimas 24 horas</p>
              </div>
              <select aria-label="Periodo do grafico">
                <option>Ultimas 24h</option>
                <option>Ultimos 7 dias</option>
              </select>
            </div>
            <div className="tenant-admin-chart" aria-label="Grafico de atividade">
              {chartValues.map((height, index) => (
                <span className={index === 4 ? "is-hot" : ""} style={{ height: `${height}%` }} key={`${height}-${index}`} />
              ))}
            </div>
            <div className="tenant-admin-chart-labels">
              <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:59</span>
            </div>
          </article>

        </section>

        {(view === "dashboard" || view === "replays") ? (
          <section className="tenant-admin-card tenant-admin-table-card">
            <div className="tenant-admin-section-head">
              <h2>Replays recentes</h2>
              <button onClick={reloadAdminData} type="button"><RotateCcw size={18} />Atualizar</button>
            </div>
            <div className="tenant-admin-table-wrap">
              <table className="tenant-admin-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>ID da camera</th>
                    <th>Evento</th>
                    <th>Horario</th>
                    <th>Duracao</th>
                    <th>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {recentReplays.map((replay) => (
                    <tr key={replay.id}>
                      <td><span className={`tenant-admin-badge ${replay.status === "ready" ? "is-success" : "is-error"}`}>{replay.status || "ready"}</span></td>
                      <td>{replay.camera_id}</td>
                      <td>{replayTitle(replay)}</td>
                      <td>{formatDate(replay.created_at)}</td>
                      <td>{replay.duration || replay.seconds || 15}s</td>
                      <td>
                        {replay.video_url ? <a href={mediaUrl(replay.video_url)} target="_blank" rel="noreferrer" aria-label="Ver replay"><Eye size={18} /></a> : null}
                        {replay.video_url ? <a href={mediaUrl(replay.download_url || replay.video_url)} download aria-label="Baixar replay"><Download size={18} /></a> : null}
                      </td>
                    </tr>
                  ))}
                  {!recentReplays.length ? (
                    <tr><td colSpan="6">Nenhum replay do cliente ainda.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {view === "dashboard" ? (
          <section className="tenant-admin-camera-admin">
            <article className="tenant-admin-card tenant-admin-form-card">
              <div className="tenant-admin-section-head">
                <div>
                  <h2>Adicionar camera</h2>
                  <p>Informe ID, nome e IP. A API descobre e valida o caminho RTSP.</p>
                </div>
              </div>
              <form className="tenant-admin-form" onSubmit={saveTenantCamera}>
                <label htmlFor="tenantCameraId">ID da camera</label>
                <input
                  id="tenantCameraId"
                  value={cameraForm.id}
                  onChange={(event) => updateCameraForm("id", event.target.value)}
                  placeholder="campo-01"
                  required
                />

                <label htmlFor="tenantCameraName">Nome da camera</label>
                <input
                  id="tenantCameraName"
                  value={cameraForm.name}
                  onChange={(event) => updateCameraForm("name", event.target.value)}
                  placeholder="Campo 01"
                  required
                />

                <label htmlFor="tenantCameraIp">IP da camera</label>
                <input
                  id="tenantCameraIp"
                  value={cameraForm.camera_ip}
                  onChange={(event) => updateCameraForm("camera_ip", event.target.value)}
                  placeholder="192.168.0.6"
                  inputMode="decimal"
                  required
                />

                <div className="tenant-admin-form-actions">
                  <button className="tenant-admin-primary" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={18} /> : <Save size={18} />} Salvar camera</button>
                </div>
              </form>
            </article>

            <article className="tenant-admin-card tenant-admin-camera-list-card">
              <div className="tenant-admin-section-head">
                <h2>Cameras cadastradas</h2>
                <button onClick={reloadAdminData} type="button"><RotateCcw size={18} />Atualizar</button>
              </div>
              <div className="tenant-admin-camera-list">
                {cameras.map((camera) => (
                  <button className="tenant-admin-camera-row" onClick={() => editTenantCamera(camera)} type="button" key={camera.id}>
                    <span><strong>{camera.name}</strong><small>{camera.id} · /{clientSlug}/campo/{camera.slug || camera.id}</small></span>
                    <em className={camera.status === "recording" ? "is-online" : "is-offline"}>{camera.status || "unknown"}</em>
                  </button>
                ))}
                {!cameras.length ? <p>Nenhuma camera cadastrada para este cliente.</p> : null}
              </div>
            </article>
          </section>
        ) : null}

      </section>

      <nav className="tenant-admin-bottom-nav" aria-label="Admin mobile">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <a className={view === item.key ? "is-active" : ""} href={item.href} key={item.key}>
              <Icon size={21} />
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>
    </main>
  );
}

function SuperAdminPage() {
  const [token, setToken] = useState(() => localStorage.getItem(OPERATOR_TOKEN_KEY) || "");
  const [superSession, setSuperSession] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(SUPER_ADMIN_SESSION_KEY) || "null");
    } catch {
      return null;
    }
  });
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [showSuperPassword, setShowSuperPassword] = useState(false);
  const [clients, setClients] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientCredentials, setClientCredentials] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(SUPER_ADMIN_CLIENT_CREDENTIALS_KEY) || "{}");
    } catch {
      return {};
    }
  });
  const [cep, setCep] = useState("");
  const [cepStatus, setCepStatus] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const [message, setMessage] = useState("Entre para carregar os clientes.");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    slug: "",
    plan: "pro",
    company_email: "",
    company_phone: "",
    document: "",
    address: "",
    admin_name: "",
    admin_email: "",
    admin_password: "",
    is_active: true,
  });

  const activeClients = clients.filter((client) => client.is_active).length;
  const inactiveClients = clients.length - activeClients;
  const totalCameras = clients.reduce((total, client) => total + Number(client.cameras_total || 0), 0);
  const totalReplays = clients.reduce((total, client) => total + Number(client.replays_total || 0), 0);
  const totalAdmins = clients.reduce((total, client) => total + Number(client.users?.length || 0), 0);
  const selectedAdmin = selectedClient?.users?.[0] || null;
  const selectedPassword = selectedClient ? selectedAdmin?.plain_password || clientCredentials[selectedClient.id] || "" : "";
  const isSuperAuthenticated = Boolean(superSession && tokenValue());

  function tokenValue() {
    return token.trim();
  }

  function superAdminOptions(options = {}) {
    return tokenValue() ? { ...options, token: tokenValue() } : options;
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateLoginForm(field, value) {
    setLoginForm((current) => ({ ...current, [field]: value }));
  }

  async function copyInstallKey(value) {
    if (!value) {
      setMessage("Chave de instalacao indisponivel.");
      setCopyNotice("");
      return;
    }

    const copied = await copyTextToClipboard(value);
    if (copied) {
      setMessage("Chave de instalacao copiada.");
      setCopyNotice("Chave do instalador copiada.");
    } else {
      setMessage(`Chave de instalacao: ${value}`);
      setCopyNotice(`Copie manualmente a chave: ${value}`);
    }
  }

  function saveClientCredentials(updater) {
    setClientCredentials((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      localStorage.setItem(SUPER_ADMIN_CLIENT_CREDENTIALS_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function copyClientPassword(value) {
    if (!value) {
      setMessage("Senha indisponivel. Defina uma nova senha para exibir e copiar.");
      setCopyNotice("");
      return;
    }

    const copied = await copyTextToClipboard(value);
    if (copied) {
      setMessage("Senha do cliente copiada.");
      setCopyNotice("Senha do cliente copiada.");
    } else {
      setMessage(`Senha do cliente: ${value}`);
      setCopyNotice(`Copie manualmente a senha: ${value}`);
    }
  }

  async function lookupCep(value = cep) {
    const cleanCep = String(value || "").replace(/\D/g, "");
    setCep(cleanCep);
    if (cleanCep.length !== 8) {
      setCepStatus("Informe um CEP com 8 numeros.");
      return;
    }

    setCepStatus("Buscando endereco pelo CEP...");
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
      const data = await response.json();
      if (!response.ok || data?.erro) {
        throw new Error("CEP nao encontrado.");
      }

      const parts = [
        data.logradouro,
        data.bairro,
        data.localidade && data.uf ? `${data.localidade}/${data.uf}` : data.localidade || data.uf,
      ].filter(Boolean);
      updateForm("address", parts.join(", "));
      setCepStatus("Endereco preenchido pelo ViaCEP.");
    } catch (error) {
      setCepStatus(error.message || "Nao foi possivel buscar o CEP.");
    }
  }

  function saveSuperSession(session, nextToken) {
    if (session && nextToken) {
      localStorage.setItem(SUPER_ADMIN_SESSION_KEY, JSON.stringify(session));
      localStorage.setItem(OPERATOR_TOKEN_KEY, nextToken);
      setSuperSession(session);
      setToken(nextToken);
    } else {
      localStorage.removeItem(SUPER_ADMIN_SESSION_KEY);
      localStorage.removeItem(OPERATOR_TOKEN_KEY);
      setSuperSession(null);
      setToken("");
    }
  }

  function resetForm() {
    setForm({
      name: "",
      slug: "",
      plan: "pro",
      company_email: "",
      company_phone: "",
      document: "",
      address: "",
      admin_name: "",
      admin_email: "",
      admin_password: "",
      is_active: true,
    });
    setCep("");
    setCepStatus("");
  }

  async function loadClients(nextSelectedId = selectedId) {
    if (!tokenValue()) {
      setMessage("Login do super admin obrigatorio.");
      saveSuperSession(null);
      return;
    }

    setBusy(true);
    try {
      const data = await apiRequest("/super-admin/clients", superAdminOptions());
      const records = Array.isArray(data) ? data : [];
      setClients(records);
      const next = records.find((client) => client.id === nextSelectedId) || records[0] || null;
      setSelectedId(next?.id || "");
      setSelectedClient(next);
      localStorage.setItem(OPERATOR_TOKEN_KEY, tokenValue());
      setMessage("Clientes carregados.");
    } catch (error) {
      setMessage(error.message);
      if (String(error.message).toLowerCase().includes("operador") || String(error.message).toLowerCase().includes("nao autorizado")) {
        saveSuperSession(null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitSuperLogin(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("Validando acesso...");
    try {
      const data = await apiRequest("/super-admin/login", {
        method: "POST",
        body: JSON.stringify({
          email: loginForm.email.trim(),
          password: loginForm.password,
        }),
      });
      const nextToken = data.operator_token || loginForm.password;
      saveSuperSession({ user: data.user || { email: loginForm.email.trim(), role: "super_admin" } }, nextToken);
      setLoginForm({ email: "", password: "" });
      setMessage("Login realizado.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  function logoutSuperAdmin() {
    saveSuperSession(null);
    setClients([]);
    setSelectedClient(null);
    setSelectedId("");
    setMessage("Sessao encerrada.");
  }

  useEffect(() => {
    if (isSuperAuthenticated && !clients.length) {
      loadClients("");
    }
  }, [isSuperAuthenticated]);

  async function openClient(clientId) {
    setSelectedId(clientId);
    setBusy(true);
    try {
      const data = await apiRequest(`/super-admin/clients/${encodeURIComponent(clientId)}`, superAdminOptions());
      setSelectedClient(data);
      setCopyNotice("");
      setMessage(`Cliente ${data.name} selecionado.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitClient(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        slug: form.slug.trim().toLowerCase(),
        logo_url: "/assets/logo-sertao-replay-nav.png",
      };
      const saved = await apiRequest("/super-admin/clients", superAdminOptions({
        method: "POST",
        body: JSON.stringify(payload),
      }));
      saveClientCredentials((current) => ({ ...current, [saved.id]: payload.admin_password }));
      resetForm();
      setMessage(`Cliente ${saved.name} criado. Usuario: ${payload.admin_email} | Senha: ${payload.admin_password}`);
      await loadClients(saved.id);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleClient(client) {
    setBusy(true);
    try {
      const saved = await apiRequest(`/super-admin/clients/${encodeURIComponent(client.id)}`, superAdminOptions({
        method: "PATCH",
        body: JSON.stringify({ is_active: !client.is_active }),
      }));
      setMessage(saved.is_active ? "Cliente ativado." : "Cliente desativado.");
      await loadClients(saved.id);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function resetClientPassword(client) {
    const generatedPassword = generateClientPassword();
    const nextPassword = window.prompt(
      `Nova senha para ${client.name}. Confirme ou altere a senha abaixo:`,
      generatedPassword,
    );
    if (!nextPassword) {
      return;
    }
    if (nextPassword.length < 6) {
      setMessage("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    setBusy(true);
    try {
      const admin = client.users?.[0] || {};
      const saved = await apiRequest(`/super-admin/clients/${encodeURIComponent(client.id)}`, superAdminOptions({
        method: "PATCH",
        body: JSON.stringify({
          admin_name: admin.name || client.name,
          admin_email: admin.email,
          admin_password: nextPassword,
        }),
      }));
      saveClientCredentials((current) => ({ ...current, [saved.id]: nextPassword }));
      setMessage(`Senha atualizada. Usuario: ${admin.email || "admin"} | Senha: ${nextPassword}`);
      await loadClients(saved.id);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteClient(client) {
    if (!window.confirm(`Excluir o cliente ${client.name}? Esta acao remove usuarios, cameras, replays e logs dele.`)) {
      return;
    }

    setBusy(true);
    try {
      await apiRequest(`/super-admin/clients/${encodeURIComponent(client.id)}?force=true`, superAdminOptions({ method: "DELETE" }));
      saveClientCredentials((current) => {
        const next = { ...current };
        delete next[client.id];
        return next;
      });
      setMessage(`Cliente ${client.name} excluido.`);
      await loadClients("");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  if (!isSuperAuthenticated) {
    return (
      <main className="super-admin-login-page">
        <div className="super-admin-login-lights" aria-hidden="true" />
        <section className="super-admin-login-shell">
          <div className="super-admin-login-brand">
            <span className="super-admin-logo-mark" aria-label="Sertao Replay">
              <img alt="" src="/assets/logo-sertao-replay-nav.png" />
            </span>
            <div>
              <h1>Super Admin</h1>
              <p>Acesso restrito ao controle de clientes</p>
            </div>
          </div>

          <article className="super-admin-login-card">
            <form className="super-admin-login-form" onSubmit={submitSuperLogin}>
              <label htmlFor="superAdminEmail">Usuario</label>
              <div className="super-admin-login-input">
                <UserRound size={20} />
                <input
                  id="superAdminEmail"
                  value={loginForm.email}
                  onChange={(event) => updateLoginForm("email", event.target.value)}
                  placeholder="seu@email.com"
                  type="email"
                  autoComplete="email"
                  required
                />
              </div>

              <label htmlFor="superAdminPassword">Senha</label>
              <div className="super-admin-login-input">
                <Lock size={20} />
                <input
                  id="superAdminPassword"
                  value={loginForm.password}
                  onChange={(event) => updateLoginForm("password", event.target.value)}
                  placeholder="Senha do super admin"
                  type={showSuperPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                />
                <button
                  className="super-admin-login-visibility"
                  onClick={() => setShowSuperPassword((current) => !current)}
                  type="button"
                  aria-label={showSuperPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showSuperPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>

              <button className="super-admin-login-submit" disabled={busy} type="submit">
                {busy ? <Loader2 className="spin" size={22} /> : <LogIn size={22} />}
                {busy ? "Entrando..." : "Entrar no Super Admin"}
              </button>
            </form>
            {message ? <div className="super-admin-login-message">{message}</div> : null}
          </article>
        </section>
      </main>
    );
  }

  return (
    <main className="super-admin-page">
      <header className="super-admin-topbar">
        <div className="super-admin-brand">
          <Menu size={22} />
          <span className="super-admin-logo-mark" aria-label="Sertao Replay">
            <img alt="" src="/assets/logo-sertao-replay-nav.png" />
          </span>
          <span className="super-admin-title">Super Admin</span>
        </div>
        <nav className="super-admin-nav" aria-label="Super admin">
          <a href="#dashboard">Dashboard</a>
          <a href="#clientes">Clientes</a>
          <a href="#novo-cliente">Novo cliente</a>
          <a href="#seguranca">Seguranca</a>
        </nav>
        <button className="super-admin-avatar" onClick={logoutSuperAdmin} type="button" title="Sair">
          {(superSession?.user?.email || "SA").slice(0, 2).toUpperCase()}
        </button>
      </header>

      <section className="super-admin-shell" id="dashboard">
        <div className="super-admin-heading">
          <div>
            <h1>Super Admin Dashboard</h1>
            <p>Status do sistema: <strong>otimizado</strong></p>
          </div>
          <div className="super-admin-session-actions">
            <span>{superSession?.user?.email || "super admin"}</span>
            <button onClick={() => loadClients()} disabled={busy} type="button">
              {busy ? <Loader2 className="spin" size={18} /> : <RotateCcw size={18} />} Atualizar
            </button>
          </div>
        </div>

        {message ? <div className="super-admin-message">{message}</div> : null}

        <section className="super-admin-stats">
          <article className="super-admin-card">
            <div><Building2 size={22} /><span>{inactiveClients} inativos</span></div>
            <h2>Clientes</h2>
            <strong>{clients.length}</strong>
            <p>{activeClients} ativos na plataforma</p>
          </article>
          <article className="super-admin-card is-featured">
            <div><Video size={22} /><span>{totalCameras} cameras</span></div>
            <h2>Replays</h2>
            <strong>{totalReplays}</strong>
            <p>Conteudo registrado nos clientes</p>
          </article>
          <article className="super-admin-card">
            <div><Users size={22} /><span>logins</span></div>
            <h2>Administradores</h2>
            <strong>{totalAdmins}</strong>
            <p>Acessos administrativos criados</p>
          </article>
        </section>

        <section className="super-admin-grid">
          <section className="super-admin-main">
            <div className="super-admin-section-title" id="novo-cliente">
              <h2><UserPlus size={22} /> Criar Cliente</h2>
            </div>

            <form className="super-admin-form super-admin-card" onSubmit={submitClient}>
              <div className="super-admin-form-section">
                <strong>Dados do cliente</strong>
                <span>Informacoes usadas nas paginas publica e administrativa.</span>
              </div>
              <div className="super-admin-form-grid">
                <label>Nome da empresa<input value={form.name} onChange={(event) => updateForm("name", event.target.value)} required /></label>
                <label>Slug publico<input value={form.slug} onChange={(event) => updateForm("slug", event.target.value)} placeholder="arena-exemplo" required /></label>
                <label>Plano<select value={form.plan} onChange={(event) => updateForm("plan", event.target.value)}><option value="starter">Starter</option><option value="pro">Pro</option><option value="enterprise">Enterprise</option></select></label>
                <label>Email da empresa<input value={form.company_email} onChange={(event) => updateForm("company_email", event.target.value)} type="email" /></label>
                <label>Telefone<input value={form.company_phone} onChange={(event) => updateForm("company_phone", event.target.value)} /></label>
                <label>CNPJ / documento<input value={form.document} onChange={(event) => updateForm("document", event.target.value)} /></label>
                <label>
                  CEP
                  <input
                    inputMode="numeric"
                    maxLength={9}
                    onBlur={() => lookupCep()}
                    onChange={(event) => {
                      const value = event.target.value.replace(/\D/g, "").slice(0, 8);
                      setCep(value);
                      if (value.length === 8) {
                        lookupCep(value);
                      }
                    }}
                    placeholder="00000000"
                    value={cep}
                  />
                </label>
                <label className="is-wide">Endereco<input value={form.address} onChange={(event) => updateForm("address", event.target.value)} /></label>
              </div>
              {cepStatus ? <div className="super-admin-form-section"><span>{cepStatus}</span></div> : null}
              <div className="super-admin-form-section">
                <strong>Login administrativo</strong>
                <span>Usuario e senha que o cliente usara para acessar o admin.</span>
              </div>
              <div className="super-admin-form-grid">
                <label>Nome do admin<input value={form.admin_name} onChange={(event) => updateForm("admin_name", event.target.value)} required /></label>
                <label>Usuario do cliente<input value={form.admin_email} onChange={(event) => updateForm("admin_email", event.target.value)} placeholder="email de login" type="email" required /></label>
                <label>Senha do cliente<input value={form.admin_password} onChange={(event) => updateForm("admin_password", event.target.value)} placeholder="senha inicial" type="text" required /></label>
              </div>
              <div className="super-admin-form-footer">
                <label className="super-admin-check"><input checked={form.is_active} onChange={(event) => updateForm("is_active", event.target.checked)} type="checkbox" /> Cliente ativo</label>
                <button className="super-admin-primary" disabled={busy} type="submit">{busy ? <Loader2 className="spin" size={18} /> : <Save size={18} />} Criar cliente</button>
              </div>
            </form>

            <div className="super-admin-section-title" id="clientes">
              <h2><Building2 size={24} /> Clientes</h2>
              <button onClick={() => loadClients()} type="button">Atualizar</button>
            </div>
            <div className="super-admin-client-list">
              {clients.map((client) => (
                <button className={`super-admin-client-row ${selectedId === client.id ? "is-active" : ""}`} onClick={() => openClient(client.id)} type="button" key={client.id}>
                  <span><strong>{client.name}</strong><small>Usuario: {client.users?.[0]?.email || "sem login"} · /{client.slug}</small></span>
                  <span className="super-admin-client-metrics"><small>{client.cameras_total || 0} cameras</small><small>{client.replays_total || 0} replays</small></span>
                  <em className={client.is_active ? "is-active" : "is-inactive"}>{client.is_active ? "ativo" : "inativo"}</em>
                </button>
              ))}
              {!clients.length ? <div className="super-admin-empty">Nenhum cliente carregado.</div> : null}
            </div>
          </section>

          <aside className="super-admin-sidebar">
            <article className="super-admin-card">
              <h2><ShieldCheck size={22} /> Cliente Selecionado</h2>
              {selectedClient ? (
                <div className="super-admin-detail">
                  <div className="super-admin-detail-head">
                    <strong>{selectedClient.name}</strong>
                    <em className={selectedClient.is_active ? "is-active" : "is-inactive"}>{selectedClient.is_active ? "ativo" : "inativo"}</em>
                  </div>
                  <div className="super-admin-credential-card">
                    <span>Login do cliente</span>
                    <p><b>Usuario</b><strong>{selectedAdmin?.email || "Usuario nao cadastrado"}</strong></p>
                    <p><b>Senha</b><strong>{selectedPassword || "Senha nao exibida"}</strong></p>
                    <button type="button" onClick={() => copyClientPassword(selectedPassword)}>
                      <KeyRound size={17} /> {copyNotice.includes("Senha") ? "Senha copiada" : "Copiar senha"}
                    </button>
                    <button type="button" onClick={() => resetClientPassword(selectedClient)}>
                      <RotateCcw size={17} /> Definir nova senha
                    </button>
                    {copyNotice.includes("Senha") ? <div className="super-admin-copy-notice">{copyNotice}</div> : null}
                    {!selectedPassword ? <small>Senhas antigas nao podem ser recuperadas porque o login guarda hash. Defina uma nova senha para ela aparecer aqui.</small> : null}
                  </div>
                  <div className="super-admin-install-card">
                    <span>Chave do instalador</span>
                    <strong>{selectedClient.install_key || "Gerando chave..."}</strong>
                    <small>Use esta chave no instalador da maquina do cliente para vincular o servidor local a esta empresa.</small>
                    <button type="button" onClick={() => copyInstallKey(selectedClient.install_key)}>
                      <KeyRound size={17} /> {copyNotice.includes("Chave") ? "Chave copiada" : "Copiar chave"}
                    </button>
                    {copyNotice.includes("Chave") ? <div className="super-admin-copy-notice">{copyNotice}</div> : null}
                  </div>
                  <div className="super-admin-info-list">
                    <p><span>Empresa</span><b>{selectedClient.company_email || "Email nao informado"}</b></p>
                    <p><span>Telefone</span><b>{selectedClient.company_phone || "Nao informado"}</b></p>
                    <p><span>Documento</span><b>{selectedClient.document || "Nao informado"}</b></p>
                    <p><span>Endereco</span><b>{selectedClient.address || "Nao informado"}</b></p>
                    <p><span>Plano</span><b>{selectedClient.plan || "Nao informado"}</b></p>
                  </div>
                  <div className="super-admin-detail-grid">
                    <div><b>{selectedClient.cameras_total || 0}</b><small>Cameras</small></div>
                    <div><b>{selectedClient.replays_total || 0}</b><small>Replays</small></div>
                  </div>
                  <div className="super-admin-link-list">
                    <a href={selectedClient.admin_path} target="_blank" rel="noreferrer"><ExternalLink size={17} /> Admin: {selectedClient.admin_path}</a>
                    <a href={selectedClient.public_path} target="_blank" rel="noreferrer"><ExternalLink size={17} /> Publico: {selectedClient.public_path}</a>
                  </div>
                  <div className="super-admin-form-section">
                    <strong>Usuarios</strong>
                    <span>{selectedAdmin ? `Admin principal: ${selectedAdmin.name}` : "Nenhum admin cadastrado"}</span>
                  </div>
                  <div className="super-admin-user-list">
                    {(selectedClient.users || []).map((user) => (
                      <p key={user.id}><strong>{user.name}</strong><span>{user.email}</span></p>
                    ))}
                  </div>
                  <div className="super-admin-detail-actions">
                    <button className="super-admin-secondary" onClick={() => toggleClient(selectedClient)} type="button">
                      <Ban size={18} /> {selectedClient.is_active ? "Desativar cliente" : "Ativar cliente"}
                    </button>
                    <button className="super-admin-danger" onClick={() => deleteClient(selectedClient)} type="button">
                      <Trash2 size={18} /> Excluir cliente
                    </button>
                  </div>
                </div>
              ) : <p>Selecione um cliente para ver todos os detalhes.</p>}
            </article>

            <article className="super-admin-card" id="seguranca">
              <h2><Settings size={24} /> Seguranca</h2>
              <div className="super-admin-security-row"><span>2FA obrigatorio</span><input type="checkbox" checked readOnly /></div>
              <div className="super-admin-security-row"><span>Monitoramento da API</span><input type="checkbox" checked readOnly /></div>
              <div className="super-admin-security-row"><span>Restricao por pais</span><input type="checkbox" readOnly /></div>
            </article>
          </aside>
        </section>
      </section>
    </main>
  );
}

function AdminPage() {
  const [token, setToken] = useState(() => localStorage.getItem(OPERATOR_TOKEN_KEY) || "");
  const [cameras, setCameras] = useState([]);
  const [logs, setLogs] = useState([]);
  const [apiStatus, setApiStatus] = useState("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Carregando painel admin...");
  const [form, setForm] = useState({
    id: "",
    name: "",
    rtsp_url: "",
    enabled: true,
    notes: "",
  });

  function tokenValue() {
    return token.trim();
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm({ id: "", name: "", rtsp_url: "", enabled: true, notes: "" });
  }

  async function loadCameras() {
    const path = tokenValue() ? "/cameras/admin" : "/cameras";
    const data = await apiRequest(path, tokenValue() ? { token: tokenValue() } : {});
    setCameras(Array.isArray(data) ? data : []);
  }

  async function loadLogs() {
    if (!tokenValue()) {
      setLogs([]);
      return;
    }

    const data = await apiRequest("/logs", { token: tokenValue() });
    setLogs(Array.isArray(data) ? data : []);
  }

  async function refreshStatus({ silent = false } = {}) {
    setBusy(true);
    try {
      await apiRequest("/health");
      await Promise.all([loadCameras(), loadLogs()]);
      setApiStatus("online");
      if (!silent) {
        setMessage("Status atualizado.");
      }
    } catch (error) {
      setApiStatus("error");
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refreshStatus();
    const timer = window.setInterval(() => refreshStatus({ silent: true }), 10000);
    return () => window.clearInterval(timer);
  }, []);

  function saveToken(event) {
    event.preventDefault();
    if (tokenValue()) {
      localStorage.setItem(OPERATOR_TOKEN_KEY, tokenValue());
    } else {
      localStorage.removeItem(OPERATOR_TOKEN_KEY);
    }
    setMessage("Token salvo neste navegador.");
    refreshStatus();
  }

  function editCamera(camera) {
    setForm({
      id: camera.id,
      name: camera.name,
      rtsp_url: camera.rtsp_url || "",
      enabled: Boolean(camera.enabled),
      notes: camera.notes || "",
    });
  }

  async function saveCamera(event) {
    event.preventDefault();
    if (!tokenValue()) {
      setMessage("Informe o token de operador antes de salvar.");
      return;
    }

    const payload = {
      id: form.id.trim(),
      name: form.name.trim(),
      rtsp_url: form.rtsp_url.trim(),
      enabled: form.enabled,
      notes: form.notes.trim() || null,
    };

    setBusy(true);
    try {
      const saved = await apiRequest("/cameras", {
        method: "POST",
        token: tokenValue(),
        body: JSON.stringify(payload),
      });
      setMessage(`Camera ${saved.id} salva.`);
      resetForm();
      await Promise.all([loadCameras(), loadLogs()]);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="operator-shell admin-shell">
      <header className="operator-topbar">
        <nav className="operator-nav" aria-label="Navegacao admin">
          <a className="operator-brand" href="/">
            <Home size={18} />
            Home
          </a>
          <a className="operator-brand" href="/operador">
            <Video size={18} />
            Operador
          </a>
        </nav>
        <span className={`status-pill status-${apiStatus}`}>
          {apiStatus === "online" ? "API online" : apiStatus === "error" ? "API erro" : "Verificando API"}
        </span>
      </header>

      <section className="operator-hero">
        <div>
          <p className="eyebrow">Painel admin</p>
          <h1>Cameras e logs</h1>
          <p className="header-copy">
            Cadastre cameras, acompanhe status do capture-server e consulte os logs operacionais.
          </p>
        </div>
      </section>

      <section className="admin-grid">
        <article className="operator-panel accent-panel">
          <div className="panel-heading">
            <Camera size={22} />
            <div>
              <h2>Camera</h2>
              <p>Cadastro usado pelo backend e pela tela de replay.</p>
            </div>
          </div>

          <form onSubmit={saveCamera} className="admin-form">
            <label htmlFor="adminCameraId">ID</label>
            <input
              id="adminCameraId"
              value={form.id}
              onChange={(event) => updateForm("id", event.target.value)}
              placeholder="campo-01"
              required
            />

            <label htmlFor="adminCameraName">Nome</label>
            <input
              id="adminCameraName"
              value={form.name}
              onChange={(event) => updateForm("name", event.target.value)}
              placeholder="Campo 01"
              required
            />

            <label htmlFor="adminCameraRtsp">URL RTSP</label>
            <input
              id="adminCameraRtsp"
              value={form.rtsp_url}
              onChange={(event) => updateForm("rtsp_url", event.target.value)}
              placeholder="rtsp://usuario:senha@192.168.0.6:554/onvif1"
              required
            />

            <label htmlFor="adminCameraNotes">Notas</label>
            <textarea
              id="adminCameraNotes"
              value={form.notes}
              onChange={(event) => updateForm("notes", event.target.value)}
              placeholder="Servidor local, posicao, observacoes"
            />

            <label className="toggle-row">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => updateForm("enabled", event.target.checked)}
              />
              <span>Camera ativa</span>
            </label>

            <div className="button-row">
              <button type="submit" className="primary-action" disabled={busy}>
                {busy ? <Loader2 className="spin" size={18} /> : <Save size={18} />}
                Salvar
              </button>
              <button type="button" className="secondary-action" onClick={resetForm}>
                <Plus size={18} />
                Nova
              </button>
            </div>
          </form>
        </article>

        <article className="operator-panel">
          <div className="panel-heading">
            <KeyRound size={22} />
            <div>
              <h2>Acesso</h2>
              <p>Token exigido para salvar cameras e abrir logs.</p>
            </div>
          </div>

          <form onSubmit={saveToken} className="token-form">
            <label htmlFor="adminOperatorToken">Token de operador</label>
            <input
              id="adminOperatorToken"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="token configurado no Render"
            />
            <button type="submit" className="secondary-action">
              <CheckCircle2 size={18} />
              Salvar token
            </button>
          </form>

          <button type="button" className="primary-action" onClick={() => refreshStatus()} disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} /> : <Activity size={18} />}
            Status
          </button>

          <div className="result">
            <strong>Resultado</strong>
            <span>{message}</span>
          </div>
        </article>
      </section>

      <section className="admin-grid lower-admin-grid">
        <article className="operator-panel">
          <div className="panel-heading">
            <Camera size={22} />
            <div>
              <h2>Cameras cadastradas</h2>
              <p>Status atualizado pelo capture-server.</p>
            </div>
          </div>

          <div className="camera-list">
            {cameras.length ? (
              cameras.map((camera) => (
                <button key={camera.id} type="button" className="camera-row" onClick={() => editCamera(camera)}>
                  <span>
                    <strong>{camera.name}</strong>
                    <small>{camera.id}</small>
                    {camera.rtsp_url ? <small className="rtsp-preview">{camera.rtsp_url}</small> : null}
                  </span>
                  <span className={`status-pill status-${camera.status || "unknown"}`}>
                    {camera.status || "unknown"}
                  </span>
                </button>
              ))
            ) : (
              <p className="muted">Nenhuma camera cadastrada.</p>
            )}
          </div>
        </article>

        <article className="operator-panel">
          <div className="panel-heading">
            <FileText size={22} />
            <div>
              <h2>Logs</h2>
              <p>Ultimos eventos do backend e capture-server.</p>
            </div>
          </div>

          <div className="log-list">
            {logs.length ? (
              logs.slice(0, 30).map((log) => (
                <div key={log.id} className="log-row">
                  <span className={`log-level level-${log.level}`}>{log.level}</span>
                  <div>
                    <strong>{log.source}{log.camera_id ? ` - ${log.camera_id}` : ""}</strong>
                    <p>{log.message}</p>
                    <small>{formatDate(log.created_at)}</small>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">Informe o token e clique em Status para carregar logs.</p>
            )}
          </div>
        </article>
      </section>
    </main>
  );
}

function RouteUnavailablePage({ slug, message = "Cliente nao encontrado ou desativado." }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center bg-dark-bg px-5 text-white sm:max-w-2xl lg:max-w-5xl">
      <div className="glass-card rounded-2xl p-6 sm:p-8">
        <AppLogoIcon className="mb-5 h-14 w-14 rounded-xl ring-1 ring-neon-green/30" />
        <p className="eyebrow">Rota indisponivel</p>
        <h1 className="mb-3 text-2xl font-black uppercase leading-tight sm:text-4xl">Cliente sem rota ativa</h1>
        <p className="mb-5 text-sm text-gray-300 sm:text-base">
          {message} {slug ? `Slug: /${slug}` : ""}
        </p>
        <a className="inline-flex min-h-11 items-center rounded-lg bg-neon-green px-4 py-2 text-sm font-black uppercase text-black no-underline" href="/">
          Voltar para o inicio
        </a>
      </div>
    </main>
  );
}

function ClientRouteGate({ slug, children }) {
  const [status, setStatus] = useState("checking");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    setStatus("checking");
    setMessage("");

    apiRequest(`/public/clients/${encodeURIComponent(slug)}`)
      .then(() => {
        if (active) {
          setStatus("active");
        }
      })
      .catch((error) => {
        if (active) {
          setStatus("unavailable");
          setMessage(error.message);
        }
      });

    return () => {
      active = false;
    };
  }, [slug]);

  if (status === "checking") {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center bg-dark-bg px-5 text-white sm:max-w-2xl lg:max-w-5xl">
        <div className="glass-card flex items-center gap-3 rounded-2xl p-5 text-sm font-bold text-gray-200">
          <Loader2 className="spin text-neon-green" size={20} />
          Validando cliente...
        </div>
      </main>
    );
  }

  if (status !== "active") {
    return <RouteUnavailablePage slug={slug} message={message} />;
  }

  return children;
}

export default function App() {
  const path = window.location.pathname;
  const tenantAdminMatch = path.match(/^\/admin\/([^/]+)(?:\/(dashboard))?\/?$/);

  if (path.startsWith("/super-admin")) {
    return <SuperAdminPage />;
  }

  const tenantAliasMatch = path.match(/^\/a\/([^/]+)(?:\/(.*))?$/);
  const reservedRootMatch = path.match(/^\/([^/]+)(?:\/(.*))?$/);
  const reservedRoots = new Set(["admin", "api", "assets", "camera", "super-admin", "streaming", "operador", "highlights", "highlight", "higliyhet", "torneio", "tournaments", "tournament", "favicon.ico"]);
  const directClientMatch =
    reservedRootMatch && !reservedRoots.has(reservedRootMatch[1].toLowerCase()) && !/^campo\d+$/i.test(reservedRootMatch[1])
      ? reservedRootMatch
      : null;
  const clientRouteMatch = tenantAliasMatch || directClientMatch;

  if (clientRouteMatch) {
    const clientSlug = clientRouteMatch[1];
    const route = (clientRouteMatch[2] || "").replace(/^\/+|\/+$/g, "");
    const lowerRoute = route.toLowerCase();
    const clientCameraRouteMatch = route.match(/^campo(\d+)\/camera(\d+)$/i);
    const clientFieldMatch = route.match(/^campo(\d+)$/i);

    if (!route) {
      return <ClientRouteGate slug={clientSlug}><HomePage clientSlug={clientSlug} /></ClientRouteGate>;
    }

    if (lowerRoute === "dashboard") {
      return <ClientRouteGate slug={clientSlug}><HomePage clientSlug={clientSlug} /></ClientRouteGate>;
    }

    if (lowerRoute === "streaming") {
      return <ClientRouteGate slug={clientSlug}><StreamingPage clientSlug={clientSlug} /></ClientRouteGate>;
    }

    if (["highlights", "highlight", "higliyhet"].includes(lowerRoute)) {
      return <ClientRouteGate slug={clientSlug}><HomePage clientSlug={clientSlug} section="highlights" /></ClientRouteGate>;
    }

    if (["torneio", "tournaments", "tournament"].includes(lowerRoute)) {
      return <ClientRouteGate slug={clientSlug}><HomePage clientSlug={clientSlug} section="torneio" /></ClientRouteGate>;
    }

    if (clientCameraRouteMatch) {
      return (
        <ClientRouteGate slug={clientSlug}>
          <CameraPage fieldId={clientCameraRouteMatch[1]} cameraId={clientCameraRouteMatch[2]} clientSlug={clientSlug} />
        </ClientRouteGate>
      );
    }

    if (clientFieldMatch) {
      return <ClientRouteGate slug={clientSlug}><CampoPage fieldId={clientFieldMatch[1]} clientSlug={clientSlug} /></ClientRouteGate>;
    }
  }

  const tenantReplayMatch = window.location.pathname.match(/^\/a\/([^/]+)\/replay\/([^/]+)\/?$/);
  const tenantCameraMatch = window.location.pathname.match(/^\/a\/([^/]+)\/campo\/([^/]+)\/?$/);
  const tenantMatch = window.location.pathname.match(/^\/a\/([^/]+)\/?$/);
  const cameraRouteMatch = window.location.pathname.match(/^\/campo(\d+)\/camera(\d+)\/?$/);
  const fieldMatch = window.location.pathname.match(/^\/campo(\d+)\/?$/);

  if (
    tenantAdminMatch
    && !["login", "dashboard"].includes(tenantAdminMatch[1])
  ) {
    return <AdminTenantPage routeClientSlug={tenantAdminMatch[1]} view={tenantAdminMatch[2] || "dashboard"} />;
  }

  const removedTenantAdminRoute = path.match(/^\/admin\/([^/]+)\/(?:cameras|replays|settings)\/?$/);
  if (removedTenantAdminRoute) {
    return <AdminTenantPage routeClientSlug={removedTenantAdminRoute[1]} view="dashboard" />;
  }

  if (tenantReplayMatch) {
    return <PublicReplayPage slug={tenantReplayMatch[1]} replayId={tenantReplayMatch[2]} />;
  }

  if (tenantCameraMatch) {
    return <PublicCameraPage slug={tenantCameraMatch[1]} cameraSlug={tenantCameraMatch[2]} />;
  }

  if (tenantMatch) {
    return <PublicTenantPage slug={tenantMatch[1]} />;
  }

  if (cameraRouteMatch) {
    return <CameraPage fieldId={cameraRouteMatch[1]} cameraId={cameraRouteMatch[2]} />;
  }

  if (window.location.pathname.startsWith("/camera")) {
    return <CameraPage />;
  }

  if (fieldMatch) {
    return <CampoPage fieldId={fieldMatch[1]} />;
  }

  if (window.location.pathname.startsWith("/admin/login")) {
    return <AdminLoginPage />;
  }

  if (window.location.pathname.startsWith("/admin/dashboard")) {
    return <AdminTenantPage view="dashboard" />;
  }

  if (window.location.pathname.startsWith("/admin")) {
    return <AdminPage />;
  }

  if (window.location.pathname.startsWith("/streaming")) {
    return <StreamingPage />;
  }

  if (["/highlights", "/highlight", "/higliyhet"].some((route) => window.location.pathname.startsWith(route))) {
    return <HomePage section="highlights" />;
  }

  if (["/torneio", "/tournaments", "/tournament"].some((route) => window.location.pathname.startsWith(route))) {
    return <HomePage section="torneio" />;
  }

  if (window.location.pathname.startsWith("/operador")) {
    return <OperatorPage />;
  }

  return <HomePage />;
}
