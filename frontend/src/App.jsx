import {
  Activity,
  Camera,
  CheckCircle2,
  FileText,
  Home,
  KeyRound,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Send,
  Settings,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_API_BASE =
  typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1"
    ? "https://sertao-replay.onrender.com/api"
    : "/api";
const API_BASE = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, "");
const DEFAULT_WEBRTC_BASE =
  typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? "http://localhost:8889"
    : "";
const WEBRTC_BASE = (import.meta.env.VITE_WEBRTC_BASE_URL || DEFAULT_WEBRTC_BASE).replace(/\/$/, "");
const WEBRTC_URL_STORAGE_PREFIX = "sertao_webrtc_url_";
const OPERATOR_TOKEN_KEY = "sertao_operator_token";
const REPLAY_HOTKEY_SECONDS = {
  F13: 15,
  F14: 15,
  F15: 15,
  F16: 15,
};

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

async function apiRequest(path, { token, ...options } = {}) {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { "X-Operator-Token": token } : {}),
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

function cameraRoute(fieldId, cameraId) {
  return `/campo${fieldId}/camera${cameraId}`;
}

function cameraPathFromBackendId(cameraId) {
  const match = String(cameraId).match(/^campo-?(\d+)(?:-(?:camera|cam)-?(\d+))?$/i);
  if (match) {
    return cameraRoute(Number(match[1]), Number(match[2] || 1));
  }

  return "/teste";
}

function fieldNumber(value) {
  return String(value).padStart(2, "0");
}

const cameras = [
  {
    id: "1",
    name: "Câmera 1",
    position: "Lateral esquerda",
    image: "https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&q=80&w=640",
  },
  {
    id: "2",
    name: "Câmera 2",
    position: "Meio-campo",
    image: "https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?auto=format&fit=crop&q=80&w=640",
  },
  {
    id: "3",
    name: "Câmera 3",
    position: "Gol norte",
    image: "https://images.unsplash.com/photo-1570498839593-e565b39455fc?auto=format&fit=crop&q=80&w=640",
  },
  {
    id: "4",
    name: "Câmera 4",
    position: "Visão geral",
    image: "https://images.unsplash.com/photo-1489944440615-453fc2b6a9a9?auto=format&fit=crop&q=80&w=640",
  },
];

function parseCameraIdentity(camera, index = 0) {
  const id = String(camera?.id || "");
  const idMatch = id.match(/^campo-?(\d+)(?:-(?:camera|cam)-?(\d+))?$/i);
  if (idMatch) {
    return {
      fieldId: String(Number(idMatch[1])),
      cameraId: String(Number(idMatch[2] || 1)),
    };
  }

  const fieldNameMatch = String(camera?.name || "").match(/campo\s*0?(\d+)/i);
  if (!fieldNameMatch) {
    return null;
  }

  const cameraNameMatch = String(camera?.name || "").match(/c[aâ]mera\s*0?(\d+)/i);
  return {
    fieldId: String(Number(fieldNameMatch[1])),
    cameraId: String(Number(cameraNameMatch?.[1] || index + 1)),
  };
}

function cameraTemplate(cameraId) {
  return cameras[(Number(cameraId) - 1) % cameras.length] || cameras[0];
}

function buildRegisteredFields(apiCameras = []) {
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
        href: cameraRoute(identity.fieldId, identity.cameraId),
        image: template.image,
        name: camera.name || `Câmera ${identity.cameraId}`,
        position: camera.notes || template.position,
        status: camera.status || "unknown",
      };

      if (!grouped.has(identity.fieldId)) {
        grouped.set(identity.fieldId, {
          id: identity.fieldId,
          number: fieldNumber(identity.fieldId),
          href: `/campo${identity.fieldId}`,
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

function LogoMark() {
  return (
    <div className="relative flex h-12 w-12 items-center justify-center lg:h-16 lg:w-16" aria-hidden="true">
      <div className="absolute inset-0 rounded-full border border-neon-green/40 bg-neon-green/10 neon-border-glow" />
      <PlayCircleIcon className="relative h-8 w-8 text-neon-green neon-glow lg:h-11 lg:w-11" />
    </div>
  );
}

function FieldCard({ field }) {
  const large = field.featured;
  return (
    <a
      href={field.href}
      className={`glass-card group flex cursor-pointer items-center justify-between rounded-2xl ${
        large ? "col-span-2 p-5 max-[420px]:col-span-1 lg:col-span-1 lg:p-6" : "p-4 lg:p-6"
      }`}
      aria-label={`Abrir Campo ${field.number}`}
    >
      <div className={`flex items-center ${large ? "gap-4" : "gap-3"}`}>
        <div className="text-gray-400 transition group-hover:text-neon-green">
          <FieldIcon className={large ? "h-10 w-10 lg:h-12 lg:w-12" : "h-8 w-8 lg:h-12 lg:w-12"} />
        </div>
        <div>
          <p className={`${large ? "text-xs" : "text-[10px]"} mb-0 font-bold uppercase leading-tight text-gray-400 lg:text-xs`}>
            Campo
          </p>
          <p className={`${large ? "text-3xl" : "text-2xl"} mb-0 font-black leading-tight text-neon-green lg:text-4xl`}>
            {field.number}
          </p>
        </div>
      </div>
      <ChevronIcon className={`${large ? "h-6 w-6" : "h-5 w-5"} text-neon-green lg:h-7 lg:w-7`} />
    </a>
  );
}

function SponsorCard({ sponsor }) {
  return (
    <div className="glass-card flex items-center gap-3 rounded-2xl p-4 lg:min-h-[104px] lg:p-5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 lg:h-12 lg:w-12">
        <svg className="h-6 w-6 text-white/50 lg:h-7 lg:w-7" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          {sponsor.icon}
        </svg>
      </div>
      <div className="min-w-0">
        <p className="mb-0 text-[8px] font-bold uppercase leading-tight text-gray-400 lg:text-[10px]">Patrocinador</p>
        <p className="mb-0 text-sm font-black text-neon-green lg:text-xl">{sponsor.number}</p>
      </div>
    </div>
  );
}

function HomeNav() {
  return (
    <nav className="relative z-10 w-full" aria-label="Navegação principal">
      <div className="grid gap-5 border-t border-[#5d2bff] bg-black/90 px-5 py-5 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-md sm:px-7 lg:min-h-[82px] lg:grid-cols-[260px_1fr_260px] lg:items-center lg:gap-0 lg:px-0 lg:py-0">
        <a
          className="flex w-fit items-center transition hover:opacity-90 lg:h-full lg:border-r lg:border-neon-green/10 lg:px-6"
          href="/"
          aria-label="Sertão Replay - início"
        >
          <img
            alt="Sertão Replay"
            className="h-10 w-auto object-contain sm:h-11 lg:h-12"
            src="/assets/logo-sertao-replay-nav.png"
          />
        </a>

        <div className="flex items-center justify-center overflow-x-auto">
          <div className="flex items-center gap-7 whitespace-nowrap text-[11px] font-black uppercase tracking-[0.24em] text-[#9fb4c9] sm:gap-10">
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

function HomePage() {
  const [registeredFields, setRegisteredFields] = useState([]);
  const [fieldsStatus, setFieldsStatus] = useState("loading");
  const [fieldsError, setFieldsError] = useState("");

  useEffect(() => {
    async function loadRegisteredCameras() {
      setFieldsStatus("loading");
      try {
        const data = await apiRequest("/cameras");
        setRegisteredFields(buildRegisteredFields(Array.isArray(data) ? data : []));
        setFieldsStatus("ready");
        setFieldsError("");
      } catch (error) {
        setRegisteredFields([]);
        setFieldsStatus("error");
        setFieldsError(error.message);
      }
    }

    loadRegisteredCameras();
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col overflow-hidden bg-dark-bg text-white shadow-[0_0_80px_rgba(0,0,0,0.45)] lg:max-w-6xl lg:overflow-visible lg:bg-transparent lg:px-6 xl:px-0">
      <header className="relative z-10" data-purpose="page-header">
        <HomeNav />
      </header>

      <section id="streaming" className="mb-8 space-y-4 px-6 pt-6 lg:mb-10 lg:px-0 lg:pt-10" data-purpose="field-selection" aria-label="Seleção de campo">
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
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 lg:gap-5">
            {registeredFields.map((field) => (
              <FieldCard field={field} key={field.id} />
            ))}
          </div>
        ) : null}
      </section>

      <section className="mb-8 px-6 lg:mb-10 lg:px-0" id="highlights" data-purpose="highlights">
        <div className="mb-4 flex items-center gap-2 lg:mb-5">
          <StarIcon />
          <h2 className="m-0 text-lg font-black uppercase tracking-wide lg:text-2xl">Algum Destaque</h2>
        </div>

        <article className="glass-card relative flex min-h-[220px] items-end overflow-hidden rounded-3xl lg:min-h-[360px]">
          <div className="absolute inset-0 z-0">
            <img
              alt="Lance em campo de futebol"
              className="h-full w-full object-cover opacity-40"
              src="https://images.unsplash.com/photo-1517466787929-bc90951d0974?auto=format&fit=crop&q=80&w=1000"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
          </div>

          <div className="relative z-10 w-full p-5 lg:p-8">
            <span className="mb-3 inline-block rounded-full border border-neon-green/30 bg-neon-green/10 px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-neon-green lg:mb-4 lg:text-[10px]">
              Destaque da semana
            </span>
            <h3 className="mb-2 text-xl font-black uppercase leading-tight lg:text-4xl">
              Melhores Momentos
              <br />
              Final do Campeonato
            </h3>
            <p className="mb-4 max-w-[200px] text-[11px] text-gray-300 lg:max-w-sm lg:text-sm">
              Confira os melhores lances e todos os detalhes da grande decisão.
            </p>
            <button
              className="flex items-center gap-2 rounded-lg bg-neon-green px-4 py-2 text-xs font-black uppercase text-black transition hover:opacity-90 active:scale-95 lg:px-5 lg:py-3"
              type="button"
            >
              <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
              Assistir Agora
            </button>
          </div>

          <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-30 lg:right-10" aria-hidden="true">
            <svg className="h-32 w-32 text-neon-green lg:h-56 lg:w-56" fill="none" viewBox="0 0 24 24">
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

      <section id="tournaments" className="mb-12 px-6 lg:mb-16 lg:px-0" data-purpose="sponsors">
        <div className="mb-4 flex items-center gap-2 lg:mb-5">
          <BriefcaseIcon />
          <h2 className="m-0 text-lg font-black uppercase tracking-wide lg:text-2xl">Patrocinadores</h2>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-5">
          {sponsors.map((sponsor) => (
            <SponsorCard sponsor={sponsor} key={sponsor.number} />
          ))}
        </div>
      </section>

      <footer className="mt-auto flex items-center justify-between border-t border-white/5 px-6 py-8 lg:rounded-t-3xl lg:bg-white/[0.02] lg:px-10" data-purpose="page-footer">
        <div className="h-px flex-1 bg-white/10" />
        <div className="flex items-center gap-4 px-6">
          <span className="whitespace-nowrap text-[9px] font-black uppercase tracking-widest text-gray-400">Sertão Replay</span>
          <div className="text-neon-green">
            <PlayCircleIcon className="h-5 w-5" />
          </div>
          <span className="whitespace-nowrap text-[9px] font-black uppercase tracking-widest text-gray-400">Replay é emoção</span>
        </div>
        <div className="h-px flex-1 bg-white/10" />
      </footer>
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

function CameraCard({ camera, fieldId }) {
  return (
    <a
      className="group relative grid min-h-[150px] grid-cols-[160px_minmax(0,1fr)] gap-4 rounded-[8px] border border-white/5 bg-[#181c1b]/60 p-3 text-left text-white no-underline transition hover:border-[#a4ff00]/60 hover:bg-[#181c1b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a4ff00]"
      href={cameraRoute(fieldId, camera.id)}
      aria-label={`Abrir ${camera.name} do Campo ${fieldId}`}
    >
      <img
        alt={`Preview ${camera.name}`}
        className="h-full min-h-[126px] w-full rounded-md object-cover opacity-70 transition group-hover:opacity-100"
        src={camera.image}
      />

      <div className="flex min-w-0 flex-col justify-center gap-2">
        <div className="flex items-center gap-2">
          <div className="rounded border border-gray-700 p-1 text-gray-400">
            <CameraGlyph className="h-4 w-4" />
          </div>
          <span className="font-bold">{camera.name}</span>
        </div>
        <span className="text-sm text-gray-400">{camera.position}</span>
        <div className="mt-1 flex items-center gap-2">
          <StatusDot />
          <span className="text-[10px] font-semibold uppercase text-[#a4ff00]">Online</span>
        </div>
      </div>
    </a>
  );
}

function CampoPage({ fieldId }) {
  const [registeredFields, setRegisteredFields] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadFieldCameras() {
      setStatus("loading");
      try {
        const data = await apiRequest("/cameras");
        setRegisteredFields(buildRegisteredFields(Array.isArray(data) ? data : []));
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
    <main className="min-h-screen bg-[#0b0f0e] px-6 py-6 font-anybody text-white lg:px-10 lg:py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex items-center justify-between" data-purpose="main-header">
          <a className="flex items-center" href="/" aria-label="Voltar para a Home">
            <img alt="Sertao Replay" className="h-11 w-auto object-contain lg:h-14" src="/assets/logo-sertao-replay-nav.png" />
          </a>
          <a className="rounded-full border border-gray-600 px-5 py-2 text-sm font-bold text-gray-300 transition hover:border-[#a4ff00] hover:text-[#a4ff00]" href="/">
            Voltar
          </a>
        </header>

        <section className="flex items-start gap-4" data-purpose="page-title">
          <FieldMonitorIcon />
          <div>
            <h1 className="mb-1 flex items-center gap-3 text-4xl font-bold tracking-tight lg:text-5xl">
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
                <CameraCard camera={camera} fieldId={field.id} key={camera.backendId} />
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
    return (
      window.localStorage.getItem(`${WEBRTC_URL_STORAGE_PREFIX}${cameraId}`) ||
      window.localStorage.getItem("sertao_webrtc_url") ||
      ""
    );
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
    return `${WEBRTC_BASE}/${encodeURIComponent(camera.id)}/whep`;
  }

  return `${API_BASE}/cameras/${encodeURIComponent(camera.id)}/webrtc/offer`;
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
  if (!video?.srcObject) {
    return;
  }

  video.srcObject.getTracks?.().forEach((track) => track.stop());
  video.srcObject = null;
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
  const routeMatch = window.location.pathname.match(/^\/teste\/campo(\d+)(?:\/camera(\d+))?\/?$/);
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

function CameraPage({ fieldId: routeFieldId, cameraId: routeCameraId }) {
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
        const [cameraData, replayData] = await Promise.all([apiRequest("/cameras"), apiRequest("/replays")]);
        setRegisteredFields(buildRegisteredFields(Array.isArray(cameraData) ? cameraData : []));
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
  }, []);

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
    <main className="min-h-screen bg-[#0a0f0d] pb-36 text-white">
      <header className="sticky top-0 z-50 flex items-center justify-between bg-[#0a0f0d]/95 px-4 py-4 backdrop-blur-md lg:px-8" data-purpose="main-header">
        <a className="flex items-center" href="/" aria-label="Voltar para a Home">
          <img alt="Sertao Replay" className="h-10 w-auto object-contain lg:h-12" src="/assets/logo-sertao-replay-nav.png" />
        </a>
      </header>

      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 lg:grid-cols-[minmax(0,1fr)_390px] lg:px-8">
        <section className="min-w-0">
          <section className="mb-4" data-purpose="camera-title-section">
            <div className="flex items-center gap-3">
              <div className="rounded-lg border border-[#79e043]/30 bg-[#1c221e] p-2 text-[#79e043]">
                <CameraGlyph className="h-5 w-5" />
              </div>
              <div>
                <h1 className="mb-0 flex flex-wrap items-center gap-2 text-2xl font-bold lg:text-4xl">
                  {field ? `Campo ${field.number}` : "Campo"} <span className="text-3xl leading-none text-[#79e043]">•</span>{" "}
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

              <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/40 px-3 py-1 backdrop-blur-sm">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#79e043]" />
                <span className="text-xs font-medium">{selectedReplay ? "Replay selecionado" : "Online"}</span>
              </div>

              {selectedReplay ? (
                <div className="absolute right-4 top-14 max-w-[min(360px,calc(100%-2rem))] rounded-xl bg-black/55 p-3 text-right backdrop-blur-sm">
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#79e043]">Assistindo agora</p>
                    <h2 className="m-0 text-base font-black text-white lg:text-xl">{replayTitle(selectedReplay)}</h2>
                    <p className="m-0 text-xs text-[#a0a0a0]">{formatDate(selectedReplay.created_at)}</p>
                  </div>
                  <a className="mt-3 inline-flex rounded-lg bg-[#79e043] px-4 py-2 text-xs font-black uppercase text-black no-underline" href={selectedDownloadUrl} download>
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

                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                    <div className="flex items-center gap-4">
                      <button type="button" aria-label="Reproduzir">
                        <svg className="h-5 w-5 fill-current text-white" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </button>
                      <div className="flex flex-1 items-center gap-2">
                        <span className="text-[10px] tabular-nums text-white">00:00 / 00:30</span>
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
                  className={`whitespace-nowrap rounded-xl border px-6 py-2 font-medium ${
                    index === 0 ? "border-[#79e043] bg-transparent text-[#79e043]" : "border-white/10 bg-[#1c221e] text-white"
                  }`}
                  key={filter}
                  type="button"
                >
                  {filter}
                </button>
              ))}
              <button className="rounded-xl border border-white/10 bg-[#1c221e] px-5 py-2 text-white" type="button" aria-label="Mais filtros">
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
                <div className="flex gap-3">
                  <button
                    className="relative h-20 w-32 flex-shrink-0 overflow-hidden rounded-xl text-left"
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

                  <div className="flex flex-1 flex-col justify-between py-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="mb-1 text-[10px] text-[#79e043]">{formatDate(replay.created_at)}</p>
                        <h3 className="mb-0 text-sm font-bold">{replayTitle(replay)}</h3>
                        <p className="mb-0 mt-1 text-[11px] text-[#a0a0a0]">{replay.camera_name || camera.name}</p>
                      </div>
                      <button className="text-[#a0a0a0]" type="button" aria-label="Mais opcoes">
                        <span className="text-xl leading-none">...</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="flex items-center justify-center gap-2 rounded-lg bg-[#79e043] py-2 text-sm font-bold text-black"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedReplayId(String(replay.id));
                    }}
                    type="button"
                  >
                    <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    Ver no player
                  </button>
                  <a className="flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-[#1c221e] py-2 text-sm text-white no-underline" href={downloadUrl} download onClick={(event) => event.stopPropagation()}>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
                    </svg>
                    Baixar
                  </a>
                </div>
                </article>
              );
            })}
            </div>
          ) : null}
        </aside>
      </div>

      <footer className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-[#0a0f0d] via-[#0a0f0d] to-transparent p-4 pt-10" data-purpose="navigation-footer">
        <div className="mx-auto max-w-md space-y-3">
          <a className="flex w-full items-center justify-center gap-3 rounded-2xl bg-[#79e043] py-4 font-extrabold text-black no-underline shadow-[0_0_20px_rgba(121,224,67,0.3)] transition active:scale-95" href={field ? field.href : "/"}>
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

const chatSeed = [
  { user: "Joao Silva", initials: "JS", text: "Que jogada sensacional!" },
  { user: "Maria Oliveira", initials: "MO", text: "VAAAI MEU TIME!" },
  { user: "Ricardo Costa", initials: "RC", text: "O goleiro salvou demais agora." },
  { user: "Sertao Fan", initials: "SF", text: "Transmissao lisa por aqui." },
  { user: "Camila", initials: "CA", text: "Esse replay vai ficar bonito." },
];

function StreamingPage() {
  const videoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const [cameras, setCameras] = useState([]);
  const [replays, setReplays] = useState([]);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("Buscando cameras ao vivo...");
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [webrtcStatus, setWebrtcStatus] = useState("idle");
  const [webrtcError, setWebrtcError] = useState("");
  const [webrtcUrlInput, setWebrtcUrlInput] = useState("");
  const [webrtcConfigVersion, setWebrtcConfigVersion] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState(chatSeed);

  useEffect(() => {
    async function loadStreamingData() {
      try {
        const [cameraData, replayData] = await Promise.all([apiRequest("/cameras"), apiRequest("/replays")]);
        const enabledCameras = Array.isArray(cameraData) ? cameraData.filter((camera) => camera.enabled !== false) : [];
        setCameras(enabledCameras);
        setReplays(Array.isArray(replayData) ? replayData : []);
        setSelectedCameraId((current) => current || enabledCameras.find((camera) => camera.status === "recording")?.id || enabledCameras[0]?.id || "");
        setStatus("ready");
        setMessage("Live pronta para conectar via WebRTC.");
      } catch (error) {
        setStatus("error");
        setMessage(error.message);
      }
    }

    loadStreamingData();
    const refreshTimer = window.setInterval(loadStreamingData, 10000);
    return () => window.clearInterval(refreshTimer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setChatMessages((current) => {
        const next = chatSeed[Math.floor(Math.random() * chatSeed.length)];
        return [...current.slice(-24), next];
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const selectedCamera = cameras.find((camera) => camera.id === selectedCameraId) || cameras[0];
  const selectedCameraIdentity = selectedCamera ? parseCameraIdentity(selectedCamera) : null;
  const posterImage = cameraTemplate(selectedCameraIdentity?.cameraId || 1).image;
  const effectiveWebrtcUrl = selectedCamera ? webrtcUrlForCamera(selectedCamera) : "";
  const cameraReplays = selectedCamera
    ? replays.filter((replay) => replay.status === "ready" && replay.camera_id === selectedCamera.id && replay.video_url).slice(0, 6)
    : [];
  const isLive = webrtcStatus === "connected" || webrtcStatus === "receiving";
  const streamStatusLabel =
    webrtcStatus === "connected" || webrtcStatus === "receiving"
      ? "Ao vivo"
      : webrtcStatus === "connecting"
        ? "Conectando"
        : webrtcStatus === "missing-url"
          ? "Configurar WebRTC"
          : webrtcStatus === "error"
            ? "Sem sinal"
            : selectedCamera?.status || "Offline";

  useEffect(() => {
    setWebrtcUrlInput(effectiveWebrtcUrl);
  }, [effectiveWebrtcUrl, selectedCamera?.id]);

  useEffect(() => {
    const video = videoRef.current;

    if (!selectedCamera?.id) {
      setWebrtcStatus("idle");
      setWebrtcError("");
      clearVideoStream(video);
      return undefined;
    }

    if (!effectiveWebrtcUrl) {
      setWebrtcStatus("missing-url");
      setWebrtcError("");
      clearVideoStream(video);
      return undefined;
    }

    if (typeof window === "undefined" || !window.RTCPeerConnection) {
      setWebrtcStatus("error");
      setWebrtcError("Este navegador nao tem suporte a WebRTC.");
      clearVideoStream(video);
      return undefined;
    }

    let cancelled = false;
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
          setWebrtcStatus("error");
          setWebrtcError(error.message || "Nao foi possivel abrir a live por WebRTC.");
          clearVideoStream(video);
        }
      }
    }

    connectWebrtc();

    return () => {
      cancelled = true;
      if (peerConnectionRef.current === peerConnection) {
        peerConnectionRef.current = null;
      }
      peerConnection.close();
      clearVideoStream(video);
    };
  }, [effectiveWebrtcUrl, selectedCamera?.id, webrtcConfigVersion]);

  function handleSaveWebrtcUrl(event) {
    event.preventDefault();
    if (!selectedCamera?.id) {
      return;
    }

    saveStoredWebrtcUrl(selectedCamera.id, webrtcUrlInput);
    setMessage(webrtcUrlInput.trim() ? "URL WebRTC salva para esta camera." : "URL WebRTC removida desta camera.");
    setWebrtcConfigVersion((current) => current + 1);
  }

  return (
    <main className="min-h-screen bg-[#101413] px-4 pb-10 pt-20 text-[#e0e3e0] md:px-12">
      <nav className="fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between border-b border-[#8ddc00]/30 bg-[#101413]/80 px-4 shadow-[0_0_15px_rgba(141,220,0,0.1)] backdrop-blur-xl md:px-12">
        <div className="flex items-center gap-4">
          <button className="grid h-10 w-10 place-items-center rounded-full text-[#8ddc00] transition hover:bg-[#8ddc00]/10 active:scale-95" onClick={() => setDrawerOpen(true)} type="button" aria-label="Abrir menu">
            <span className="text-2xl leading-none">=</span>
          </button>
          <a className="text-xl font-black italic tracking-tight text-white no-underline" href="/">
            Sertao <span className="text-[#a1fb00]">Replay</span>
          </a>
        </div>

        <div className="hidden max-w-xl flex-1 px-8 md:block">
          <div className="relative">
            <input className="w-full rounded-t-lg border-0 border-b-2 border-[#8ddc00]/20 bg-[#181c1b] px-4 py-2 text-sm text-white outline-none transition focus:border-[#8ddc00] focus:ring-0" placeholder="Pesquisar partidas, atletas..." type="text" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a1fb00]">⌕</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] ${isLive ? "bg-[#a1fb00] text-[#102000]" : "bg-[#272b29] text-[#c0caad]"}`}>
            {streamStatusLabel}
          </span>
          <a className="rounded-full border border-[#8ddc00]/40 px-4 py-2 text-xs font-bold text-[#a1fb00] no-underline" href={selectedCamera ? cameraPathFromBackendId(selectedCamera.id) : "/"}>
            Camera
          </a>
        </div>
      </nav>

      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="space-y-6 lg:col-span-8 xl:col-span-9">
          <div className="relative aspect-video overflow-hidden rounded-xl border border-[#8ddc00]/20 bg-black shadow-[0_0_15px_rgba(141,220,0,0.3)]">
            <video
              ref={videoRef}
              autoPlay
              className={`h-full w-full object-contain ${isLive ? "opacity-100" : "opacity-45"}`}
              controls
              muted
              playsInline
              poster={posterImage}
            />

            {!isLive ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0b0f0e]/80 p-8 text-center backdrop-blur-sm">
                <Video size={48} className="mb-4 text-[#a1fb00]" />
                <h1 className="mb-2 text-2xl font-black text-white">
                  {webrtcStatus === "connecting" ? "Conectando live WebRTC" : "Live WebRTC indisponivel"}
                </h1>
                <p className="max-w-md text-sm text-[#c0caad]">
                  {webrtcError || "Informe uma URL WHEP/WebRTC para transmitir a camera em tempo real."}
                </p>
              </div>
            ) : null}

            <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 backdrop-blur">
              <span className={`h-2 w-2 rounded-full ${isLive ? "animate-pulse bg-[#a1fb00]" : "bg-[#ffb4ab]"}`} />
              <span className="text-xs font-bold text-white">{isLive ? "Transmitindo ao vivo por WebRTC" : streamStatusLabel}</span>
            </div>
          </div>

          <section className="space-y-4">
            <h1 className="text-3xl font-black tracking-tight text-white md:text-4xl">{selectedCamera?.name || "Streaming Sertao Replay"}</h1>
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div className="flex items-center gap-4">
                <div className="grid h-12 w-12 place-items-center rounded-full border-2 border-[#8ddc00] bg-[#1c201f] font-black italic text-[#a1fb00]">SR</div>
                <div>
                  <p className="m-0 font-bold text-white">Sertao Replay</p>
                  <p className="m-0 text-sm text-[#c0caad]">{message}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {cameras.map((camera) => (
                  <button
                    className={`rounded-full border px-4 py-2 text-xs font-black uppercase transition ${
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

          <section className="rounded-xl border border-[#414a34]/60 bg-[#181c1b] p-4">
            <div className="mb-2 flex flex-wrap gap-4 text-sm font-bold text-white">
              <span>{isLive ? "Online agora" : "Status: " + streamStatusLabel}</span>
              <span>{cameraReplays.length} highlights recentes</span>
            </div>
            <form className="grid gap-3 md:grid-cols-[1fr_auto]" onSubmit={handleSaveWebrtcUrl}>
              <input
                className="min-w-0 rounded-lg border border-[#414a34] bg-[#0b0f0e] px-4 py-3 text-sm text-white outline-none transition placeholder:text-[#8a947a] focus:border-[#a1fb00] focus:ring-0"
                onChange={(event) => setWebrtcUrlInput(event.target.value)}
                placeholder="https://seu-gateway-webrtc/campo-01/whep"
                type="text"
                value={webrtcUrlInput}
              />
              <button className="rounded-lg bg-[#a1fb00] px-5 py-3 text-sm font-black uppercase tracking-[0.08em] text-[#102000] transition hover:opacity-90 active:scale-95" type="submit">
                Salvar live
              </button>
            </form>
            <p className="mt-3 mb-0 text-xs leading-relaxed text-[#c0caad]">
              Live fica no WebRTC. Replays gravados aparecem abaixo como highlights.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-black text-white">Highlights recentes</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {cameraReplays.map((replay) => (
                <a className="group text-white no-underline" href={mediaUrl(replay.video_url)} key={replay.id} target="_blank" rel="noreferrer">
                  <div className="relative mb-2 aspect-video overflow-hidden rounded-xl bg-[#0b0f0e]">
                    <img alt={replayTitle(replay)} className="h-full w-full object-cover opacity-70 transition duration-500 group-hover:scale-105" src={posterImage} />
                    <span className="absolute bottom-2 right-2 rounded bg-black/80 px-2 py-1 text-xs text-white">{replayDurationLabel(replay.duration)}</span>
                  </div>
                  <h3 className="mb-1 line-clamp-2 font-bold transition group-hover:text-[#a1fb00]">{replayTitle(replay)}</h3>
                  <p className="m-0 text-sm text-[#c0caad]">{formatDate(replay.created_at)}</p>
                </a>
              ))}

              {!cameraReplays.length ? (
                <div className="rounded-xl border border-[#414a34] bg-[#181c1b] p-5 text-sm text-[#c0caad]">Nenhum highlight desta camera ainda.</div>
              ) : null}
            </div>
          </section>
        </section>

        <aside className="flex h-[calc(100vh-120px)] flex-col lg:sticky lg:top-24 lg:col-span-4 xl:col-span-3">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#8ddc00]/20 bg-[#101413]/75 backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-[#8ddc00]/20 bg-[#272b29] p-4">
              <h2 className="m-0 flex items-center gap-2 font-bold text-[#a1fb00]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#a1fb00]" />
                Chat ao Vivo
              </h2>
              <span className="text-[#c0caad]">...</span>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {chatMessages.map((item, index) => (
                <div className="flex gap-3" key={`${item.user}-${index}`}>
                  <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full border border-[#8ddc00]/10 bg-[#363a38] text-xs">{item.initials}</div>
                  <div>
                    <span className="text-xs font-bold text-[#a1fb00]">{item.user}</span>
                    <p className="m-0 text-sm text-white">{item.text}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-[#8ddc00]/20 bg-[#1c201f] p-4">
              <div className="flex items-center gap-2">
                <input className="min-w-0 flex-1 rounded-t-md border-0 border-b border-[#8ddc00]/30 bg-[#101413] px-3 py-2 text-sm text-white focus:border-[#a1fb00] focus:ring-0" placeholder="Diga algo..." type="text" />
                <button className="rounded-full p-2 text-[#a1fb00] transition hover:bg-[#a1fb00]/10" type="button" aria-label="Enviar mensagem">
                  <Send size={18} />
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {drawerOpen ? (
        <div className="fixed inset-0 z-[60] bg-black/60" onClick={() => setDrawerOpen(false)}>
          <aside className="h-full w-80 border-r border-[#414a34] bg-[#272b29] px-6 py-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-8 flex items-center gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-full border border-[#8ddc00]/50 bg-[#101413] font-black text-[#a1fb00]">SR</div>
              <div>
                <h3 className="m-0 font-bold text-white">Sertao Fan</h3>
                <p className="m-0 text-xs text-[#c0caad]">Streaming ao vivo</p>
              </div>
            </div>
            <nav className="space-y-1">
              <a className="flex items-center gap-4 border-l-4 border-[#a1fb00] bg-[#a1fb00]/10 px-4 py-3 text-[#a1fb00] no-underline" href="/streaming">All Sports</a>
              <a className="flex items-center gap-4 px-4 py-3 text-[#c0caad] no-underline hover:bg-[#a1fb00]/5" href="/">Home</a>
              <a className="flex items-center gap-4 px-4 py-3 text-[#c0caad] no-underline hover:bg-[#a1fb00]/5" href="/teste">Operador</a>
              <a className="flex items-center gap-4 px-4 py-3 text-[#c0caad] no-underline hover:bg-[#a1fb00]/5" href="/admin">Admin</a>
            </nav>
          </aside>
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
      const seconds = REPLAY_HOTKEY_SECONDS[event.key];
      if (!seconds || event.repeat) {
        return;
      }

      event.preventDefault();
      requestReplay(seconds);
    }

    window.addEventListener("keydown", handleReplayHotkey);
    return () => window.removeEventListener("keydown", handleReplayHotkey);
  }, [requestReplay]);

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
          <a className="operator-brand" href="/teste">
            <Video size={18} />
            Teste
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

export default function App() {
  const cameraRouteMatch = window.location.pathname.match(/^\/campo(\d+)\/camera(\d+)\/?$/);
  const fieldMatch = window.location.pathname.match(/^\/campo(\d+)\/?$/);

  if (cameraRouteMatch) {
    return <CameraPage fieldId={cameraRouteMatch[1]} cameraId={cameraRouteMatch[2]} />;
  }

  if (window.location.pathname.startsWith("/camera")) {
    return <CameraPage />;
  }

  if (fieldMatch) {
    return <CampoPage fieldId={fieldMatch[1]} />;
  }

  if (window.location.pathname.startsWith("/admin")) {
    return <AdminPage />;
  }

  if (window.location.pathname.startsWith("/streaming")) {
    return <StreamingPage />;
  }

  if (window.location.pathname.startsWith("/teste")) {
    return <OperatorPage />;
  }

  return <HomePage />;
}
