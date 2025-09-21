// src/pages/MainMap.jsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/* ====== 공통 설정 ====== */
const API_BASE = (process.env.REACT_APP_API_BASE || "").replace(/\/$/, "");

/* ✅ 백엔드 ETA 사용 스위치 (기본: 끔)
   .env에 REACT_APP_USE_BACKEND_ETA=true 넣으면 활성화됩니다. */
const USE_BACKEND_ETA = /^true$/i.test(process.env.REACT_APP_USE_BACKEND_ETA || "");

/* ✅ 도착지 선택 즉시 백엔드 분석 자동 시작 (권장: 운영 정책에 맞춰 사용)
   .env에 REACT_APP_AUTO_BACKEND_ETA=true 넣으면 활성화됩니다.  */
const AUTO_BACKEND_ETA = /^true$/i.test(process.env.REACT_APP_AUTO_BACKEND_ETA || "");

/* WebSocket Base URL (토큰은 연결 시점에 쿼리로 붙임) */
const WS_BASE_URL = (() => {
  const env = process.env.REACT_APP_WS_BASE || API_BASE;
  try {
    if (env) {
      const u = new URL(env.startsWith("http") ? env : `https://${env}`);
      const proto = u.protocol === "https:" ? "wss:" : "ws:";
      return `${proto}//${u.host}/ws-location`;
    }
  } catch {}
  const hereProto = window.location.protocol === "https:" ? "wss://" : "ws://";
  return `${hereProto}${window.location.host}/ws-location`;
})();

/** 토큰을 쿼리스트링으로 붙인 최종 WS URL 생성 */
function buildWsUrlWithToken(token) {
  try {
    const u = new URL(WS_BASE_URL);
    if (token) u.searchParams.set("access_token", token);
    return u.toString();
  } catch {
    return WS_BASE_URL;
  }
}

/** 일렬 배치(가로) 간격 설정 (반겹) */
const LINE_LAYOUT = { desiredPx: 18, clusterPx: 14 };

/** JWT */
const setJwt = (t) => { try { if (t) sessionStorage.setItem("jwt", t); } catch {} };
const getJwt = () => {
  try {
    return (
      sessionStorage.getItem("jwt") ||
      localStorage.getItem("accessToken") ||
      (JSON.parse(sessionStorage.getItem("auth") || "{}")?.token) ||
      process.env.REACT_APP_TEST_JWT ||
      ""
    );
  } catch {
    return localStorage.getItem("accessToken") || "";
  }
};

/* ====== Tmap SDK 준비 대기 ====== */
function waitForTmapV2({ timeoutMs = 15000, intervalMs = 50 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const T = window.Tmapv2;
      const ok = T && typeof T.Map === "function" && typeof T.LatLng === "function";
      if (ok) return resolve(T);
      if (Date.now() - start > timeoutMs) return reject(new Error("Tmap SDK not ready"));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

/* ====== STOMP 로더 ====== */
async function ensureStomp() {
  if (window.Stomp?.over) return window.Stomp;
  await new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "https://cdn.jsdelivr.net/npm/stompjs@2.3.3/lib/stomp.min.js";
    el.async = true;
    el.onload = resolve;
    el.onerror = () => reject(new Error("Failed to load STOMP library"));
    document.head.appendChild(el);
  });
  if (!window.Stomp?.over) throw new Error("STOMP not available after load");
  return window.Stomp;
}

/* ====== 아이콘 ====== */
const ICONS = {
  me: `${process.env.PUBLIC_URL}/images/pin_r.png`,
  dest: `${process.env.PUBLIC_URL}/images/pin_b.png`,
  car: `${process.env.PUBLIC_URL}/images/Car.png`,
  otherYellow: `${process.env.PUBLIC_URL}/images/pin_y.png`,
  otherOrange: `${process.env.PUBLIC_URL}/images/pin_o.png`,
};

/* ====== 거리/투영 ====== */
function haversineM(a, b) {
  const R = 6378137;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function metersPerPixelAtLat(lat, zoom) {
  const R = 6378137;
  return (
    (Math.cos((lat * Math.PI) / 180) * 2 * Math.PI * R) /
    (256 * Math.pow(2, zoom))
  );
}

/* ===== 유틸 ===== */
function makeMarkerMeta(marker, base, idKey) {
  return { marker, base: { ...base }, idKey };
}
function unwrapRTU(raw) {
  const hasWrapper = raw && typeof raw === "object" && "payload" in raw;
  if (hasWrapper) return { type: raw.type || "UNKNOWN", payload: raw.payload };
  return { type: "LEGACY", payload: raw };
}
function fromLocalDateTimeArray(arr) {
  if (!Array.isArray(arr) || arr.length < 6) return null;
  const [y, M, d, H, m, s] = arr;
  try {
    return new Date(y, M - 1, d, H, m, s);
  } catch {
    return null;
  }
}
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function senderKey(p, headers = {}) {
  const uid = p?.userId ?? p?.user?.id;
  if (uid != null) return `u:${uid}`;
  if (headers["x-user-id"]) return `h:${headers["x-user-id"]}`;
  const alt = p?.deviceId || p?.clientId || p?.phone || p?.name;
  if (alt) return `c:${String(alt)}`;
  return `msg:${headers["message-id"] || Math.random().toString(36).slice(2)}`;
}

/** fetch 옵션 생성기: Bearer 토큰 + 쿠키 인증 모두 지원 */
function buildAuthFetchOptions({ method = "GET", json, signal } = {}) {
  const jwt = getJwt();
  const headers = { accept: "application/json" };
  if (json) headers["content-type"] = "application/json";
  if (jwt) headers["Authorization"] = `Bearer ${jwt}`;
  return {
    method,
    headers,
    credentials: "include",
    ...(json ? { body: JSON.stringify(json) } : {}),
    ...(signal ? { signal } : {}),
  };
}
/** 401 대응: Bearer/쿠키를 바꿔가며 재시도 */
async function fetchWithAuthRetry(url, opts) {
  let res = await fetch(url, opts);
  if (res.status === 401 && opts?.headers?.Authorization) {
    const { Authorization, ...restHeaders } = opts.headers;
    const retryOpts = { ...opts, headers: restHeaders };
    res = await fetch(url, retryOpts);
  } else if (res.status === 401 && !opts?.headers?.Authorization) {
    const jwt = getJwt();
    if (jwt) {
      const retryOpts = {
        ...opts,
        headers: { ...(opts.headers || {}), Authorization: `Bearer ${jwt}` },
      };
      res = await fetch(url, retryOpts);
    }
  }
  return res;
}

/* ===== 엔드포인트 ===== */
const ETA_ENDPOINTS = (() => {
  const list = [];
  if (API_BASE) {
    list.push(`${API_BASE}/api/eta`);
    list.push(`${API_BASE}/eta`);
  }
  list.push("/api/eta");
  list.push("/eta");
  return list;
})();
const CAR_REQUEST_POST = [`${API_BASE}/api/car-request`, `/api/car-request`];
const carDecisionGetList = (id) => [
  `${API_BASE}/api/car-request/${id}/decision`,
  `/api/car-request/${id}/decision`,
];

/* ===== ETA payload 모드: nested | flat ===== */
function buildETAPayload(start, end, destinationName) {
  const mode = (process.env.REACT_APP_ETA_PAYLOAD_MODE || "nested").toLowerCase();
  if (mode === "flat") {
    return {
      startLat: start.lat,
      startLon: start.lon,
      endLat: end.lat,
      endLon: end.lon,
      destinationName: destinationName || null,
    };
  }
  return {
    start: { lat: start.lat, lon: start.lon },
    end: { lat: end.lat, lon: end.lon },
    destinationName: destinationName || null,
  };
}

/* ===== ETA 백엔드 (서킷 브레이커 적용) + Fallback ===== */
let ETA_CIRCUIT_OPEN_UNTIL = 0;
async function fetchETAFromBackend({ start, end, destinationName, signal }) {
  const cbDisabled = String(process.env.REACT_APP_ETA_CB_DISABLE).match(/^true$/i);
  if (!cbDisabled && Date.now() < ETA_CIRCUIT_OPEN_UNTIL) {
    const err = new Error("ETA circuit open");
    err.name = "EtaCircuitOpen";
    throw err;
  }
  const payload = buildETAPayload(start, end, destinationName);

  let lastErr = null;
  for (const url of ETA_ENDPOINTS) {
    try {
      const res = await fetchWithAuthRetry(
        url,
        buildAuthFetchOptions({ method: "POST", json: payload, signal })
      );
      if (!res.ok) {
        let text = "";
        try { text = await res.text(); } catch {}
        console.warn(`[ETA] ${url} -> ${res.status}`, text);
        if (res.status >= 500 && !cbDisabled) {
          ETA_CIRCUIT_OPEN_UNTIL = Date.now() + 60_000; // 60s
        }
        lastErr = new Error(`ETA ${url} -> ${res.status}`);
        continue;
      }
      const raw = await res.json();
      const data = raw?.data ?? raw;
      const carMinutes = Number.isFinite(+data?.carMinutes) ? +data.carMinutes : null;
      const transitMinutes = Number.isFinite(+data?.transitMinutes) ? +data.transitMinutes : null;
      const recommend =
        data?.recommend === "car" || data?.recommend === "transit"
          ? data.recommend
          : (carMinutes != null && transitMinutes != null
              ? (transitMinutes < carMinutes ? "transit" : "car")
              : "car");
      return {
        carMinutes,
        transitMinutes,
        recommend,
        recommendMessage: data?.recommendMessage ?? "",
        subMessage: data?.subMessage ?? "",
        buttonLabel: data?.buttonLabel ?? "차량 이용",
      };
    } catch (e) {
      if (e.name === "AbortError") throw e;
      lastErr = e;
      continue;
    }
  }
  throw lastErr || new Error("ETA endpoints unreachable");
}

/* ===== 대중교통 ETA(Tmap) ===== */
async function fetchTransitETAFromTmap(start, end, signal) {
  const appKey = process.env.REACT_APP_TMAP_APPKEY;
  if (!appKey) return { minutes: null, forbidden: false };

  const url = "https://apis.openapi.sk.com/transit/routes?version=1&format=json";
  const body = {
    startX: Number(start.lon),
    startY: Number(start.lat),
    endX: Number(end.lon),
    endY: Number(end.lat),
    reqCoordType: "WGS84GEO",
    resCoordType: "WGS84GEO",
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      appKey,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (res.status === 403) {
    console.warn("[TransitETA] 403 Forbidden: AppKey에 대중교통 권한이 없습니다.");
    return { minutes: null, forbidden: true };
  }
  if (!res.ok) {
    console.warn("[TransitETA] fail:", res.status, await res.text());
    return { minutes: null, forbidden: false };
  }

  const data = await res.json();
  let sec = Number(data?.metaData?.plan?.itineraries?.[0]?.totalTime);
  if (!Number.isFinite(sec)) {
    const features = data?.features || [];
    for (const f of features) {
      const t = Number(f?.properties?.totalTime);
      if (Number.isFinite(t)) sec = t;
    }
  }
  if (!Number.isFinite(sec)) return { minutes: null, forbidden: false };
  return { minutes: Math.max(0, Math.round(sec / 60)), forbidden: false };
}

/* ===== 주소 DTO 생성 ===== */
function buildDestinationDtoFromPlace(place) {
  const p = place?._raw || {};
  let city = p.upperAddrName || "";
  let gu = p.middleAddrName || "";
  let dong = p.lowerAddrName || "";
  let bunji = p.buildingNo || "";

  const addr = (place?.addr || "").trim();
  if (!(city && gu && dong) && addr) {
    const parts = addr.split(/\s+/);
    if (!city && parts.length) city = parts[0] || city;
    if (!gu && parts.length > 1) gu = parts[1] || gu;
    if (!dong && parts.length > 2) dong = parts[2] || dong;
    if (!bunji) {
      const last = parts[parts.length - 1] || "";
      if (/^\d+(-\d+)?$/.test(last)) bunji = last;
    }
  }
  return {
    destinationCityDo: city || "",
    destinationGuGun: gu || "",
    destinationDong: dong || "",
    destinationBunji: bunji || "",
  };
}

/* ======== (추가) 거리 기반 ETA 추정 유틸 ======== */
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function pathLengthMeters(latlngs) {
  if (!Array.isArray(latlngs) || latlngs.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < latlngs.length; i++) {
    const a = { lat: latlngs[i-1]._lat ?? latlngs[i-1].lat, lon: latlngs[i-1]._lng ?? latlngs[i-1].lon };
    const b = { lat: latlngs[i]._lat ?? latlngs[i].lat, lon: latlngs[i]._lng ?? latlngs[i].lon };
    if (Number.isFinite(a.lat) && Number.isFinite(a.lon) && Number.isFinite(b.lat) && Number.isFinite(b.lon)) {
      sum += haversineM(a, b);
    }
  }
  return sum;
}
function estimateCarMinByDistance(distanceM) {
  const km = distanceM / 1000;
  if (km < 0.1) return 0;
  const avgKmh = 25;
  let min = (km / avgKmh) * 60;
  min += clamp(km * 1.5, 2, 6);
  return Math.max(1, Math.round(min));
}
function estimateTransitMin(carMin, distanceM) {
  if (Number.isFinite(carMin) && carMin > 0) {
    const factor = 1.35;
    const transfer = clamp(Math.round(distanceM / 1000) + 6, 6, 10);
    return Math.max(1, Math.round(carMin * factor) + transfer);
  }
  const km = distanceM / 1000;
  let min = (km / 18) * 60;
  min += clamp(Math.round(km) + 6, 6, 12);
  return Math.max(1, Math.round(min));
}
function safePosMin(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/* ===== 차량 요청 생성 ===== */
async function createCarRequestByAddress(destDto) {
  let lastErr = null;
  for (const url of CAR_REQUEST_POST) {
    try {
      const res = await fetchWithAuthRetry(
        url,
        buildAuthFetchOptions({ method: "POST", json: destDto })
      );
      if (res.status === 401) {
        throw new Error("사용자 인증이 필요합니다.");
      }
      if (res.status !== 202) {
        const text = await res.text().catch(() => "");
        try {
          const j = JSON.parse(text || "{}");
          const msg = j?.message || j?.error || text;
          lastErr = new Error(msg || `POST ${url} -> ${res.status}`);
        } catch {
          lastErr = new Error(text || `POST ${url} -> ${res.status}`);
        }
        continue;
      }
      const body = await res.json().catch(() => ({}));
      const data = body?.data ?? body;
      const id = data?.carRequestId;
      if (!id) throw new Error("carRequestId missing in response");
      return String(id);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Car request creation failed");
}

/* ===== 결과 폴링(GET) ===== */
async function fetchCarDecisionOnce(carRequestId) {
  let lastErr = null;
  for (const url of carDecisionGetList(carRequestId)) {
    try {
      const res = await fetchWithAuthRetry(
        url,
        buildAuthFetchOptions({ method: "GET" })
      );
      if (res.status === 404) return null; // 아직
      if (res.status === 200) {
        const body = await res.json();
        const d = body?.data ?? body;
        const decision = String(d?.decision || "");
        return {
          raw: d,
          decision,
          reason: d?.reason || "",
          pickupTime: d?.pickupTime || null,
          destinationTime: d?.destinationTime || null,
          carTotalTime: Number.isFinite(+d?.carTotalTime) ? +d.carTotalTime : null,
          transitTotalTime: Number.isFinite(+d?.transitTotalTime) ? +d.transitTotalTime : null,
          carpoolMembers: Array.isArray(d?.carpoolMembers) ? d.carpoolMembers : null,
        };
      }
      lastErr = new Error(`GET ${url} -> ${res.status}`);
      continue;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Car decision polling failed");
}

export default function MainMap() {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const didInitRef = useRef(false);

  const hereMarkerRef = useRef(null);
  const hereBaseRef = useRef({ lat: null, lon: null });

  const destMarkerRef = useRef(null);

  // 차량 (실시간 수신)
  const carMarkerRef = useRef(null);
  const lastCarPosRef = useRef(null); // {lat, lon}

  const routeLineRef = useRef(null);
  const carRouteRef = useRef(null);

  const [herePos, setHerePos] = useState(null);
  const [status, setStatus] = useState("지도 로딩 중…");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState(null);

  const nav = useNavigate();
  const { state } = useLocation();

  // ====== WebSocket/STOMP ======
  const stompRef = useRef(null);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const watchIdRef = useRef(null);
  const connRef = useRef({ connecting: false, connected: false });

  // 가족 마커
  const otherMarkersRef = useRef(new Map());
  const myIdsRef = useRef({ userId: null, groupId: null, myName: null });

  const nameCacheRef = useRef(new Map());
  const getDisplayName = useCallback((idKey) => {
    const key = String(idKey ?? "");
    return nameCacheRef.current.get(key) || "가족";
  }, []);
  const setCachedName = useCallback((idKey, name) => {
    if (!idKey || !name) return;
    nameCacheRef.current.set(String(idKey), String(name));
    const meta = otherMarkersRef.current.get(String(idKey));
    if (meta?.marker) {
      try {
        if (typeof meta.marker.setTitle === "function")
          meta.marker.setTitle(String(name));
        else if (meta.marker.options) meta.marker.options.title = String(name);
      } catch {}
    }
  }, []);

  /* ===== 진행/결과 상태 ===== */
  const etaAbortRef = useRef(null);
  const pollTimerRef = useRef(null);
  const pollStartAtRef = useRef(0);
  const [etaOpen, setEtaOpen] = useState(false);
  const [etaLoading, setEtaLoading] = useState(false);
  const [eta, setEta] = useState({
    carMin: null, transitMin: null, recommend: "car",
    recommendMessage: "", subMessage: "", buttonLabel: "차량 이용",
  });
  const [carReqId, setCarReqId] = useState(null);
  const [carReqPhase, setCarReqPhase] = useState("idle"); // idle | requesting | polling | done | error
  const [carReqError, setCarReqError] = useState("");
  const [decision, setDecision] = useState(null);
  const [showReqUI, setShowReqUI] = useState(false); // 수동 버튼을 눌렀을 때만 진행/오류 노출

  /* ===== 로그인 복구 ===== */
  useEffect(() => {
    let me = null;
    if (state?.name && state?.phone) {
      if (state?.token) setJwt(state.token);
      me = state;
    } else {
      const saved = sessionStorage.getItem("auth");
      if (saved) {
        try {
          const p = JSON.parse(saved);
          if (p?.name && p?.phone) me = p;
        } catch {}
      }
    }
    if (!me) { nav("/", { replace: true }); return; }
    myIdsRef.current.userId = me.userId ?? null;
    myIdsRef.current.groupId = me.groupId ?? null;
    myIdsRef.current.myName = me.name ?? null;
  }, [state, nav]);

  /* ===== 지도 초기화 ===== */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tag = document.getElementById("tmap-js-sdk");
      if (!tag) { setStatus("index.html의 Tmap 스크립트를 확인하세요. (id='tmap-js-sdk')"); return; }

      try {
        await waitForTmapV2();
        if (cancelled || didInitRef.current) return;
        const { Tmapv2 } = window;
        if (!Tmapv2 || typeof Tmapv2.Map !== "function") { setStatus("지도 로드 실패: Tmap SDK 준비 안 됨"); return; }

        if (mapRef.current?.destroy) { try { mapRef.current.destroy(); } catch {} }
        const map = new window.Tmapv2.Map(mapDivRef.current, {
          center: new window.Tmapv2.LatLng(37.5666805, 126.9784147),
          width: "100%",
          height: "100%",
          zoom: 15,
        });
        mapRef.current = map;
        didInitRef.current = true;

        try { map.addListener("zoom_changed", () => recomputeLineLayout()); } catch {}

        // 현재 위치
        if ("geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(
            ({ coords }) => {
              const here = new window.Tmapv2.LatLng(coords.latitude, coords.longitude);
              map.setCenter(here);
              try {
                hereMarkerRef.current = new window.Tmapv2.Marker({
                  position: here, map, icon: ICONS.me, title: "현재 위치",
                });
              } catch {}
              hereBaseRef.current = { lat: coords.latitude, lon: coords.longitude };
              setHerePos({ lat: coords.latitude, lon: coords.longitude });
              recomputeLineLayout();
              setStatus("");
            },
            () => setStatus("현재 위치를 가져오지 못했습니다."),
            { enableHighAccuracy: true, timeout: 8000 }
          );
        } else setStatus("");
      } catch (e) {
        console.error("Tmap SDK 대기 실패:", e);
        setStatus("지도 로드 실패: SDK 준비 시간 초과");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ===== WebSocket/STOMP 연결 & 위치 송수신 ===== */
  useEffect(() => {
    let cancelled = false;

    const scheduleReconnect = (delay = 2500) => {
      if (cancelled) return;
      try { clearTimeout(reconnectTimerRef.current); } catch {}
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    const connect = async () => {
      const ws = wsRef.current;
      if (
        connRef.current.connecting ||
        connRef.current.connected ||
        (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))
      ) return;

      const token = getJwt();
      const { groupId } = myIdsRef.current || {};
      if (!token || !groupId || !mapRef.current) return;

      connRef.current.connecting = true;

      try {
        await ensureStomp();

        try { if (stompRef.current?.connected) stompRef.current?.disconnect(() => {}); } catch {}
        try { if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.close(); } catch {}

        // ① WS 핸드셰이크에 토큰을 쿼리로 실어서 연결
        const socket = new WebSocket(buildWsUrlWithToken(token));
        wsRef.current = socket;

        socket.onclose = () => {
          connRef.current.connected = false;
          connRef.current.connecting = false;
          if (!cancelled) scheduleReconnect(2500);
        };

        const stomp = window.Stomp.over(socket);
        stomp.debug = null;
        stompRef.current = stomp;

        // ② STOMP CONNECT 프레임에도 Authorization 헤더로 전송
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        stomp.connect(
          headers,
          () => {
            if (cancelled) return;
            console.log("✅ STOMP Connected");
            connRef.current.connected = true;
            connRef.current.connecting = false;

            // (A) 사용자 위치 스트림
            stomp.subscribe(
              `/topic/group/${groupId}`,
              (message) => {
                try {
                  const raw = JSON.parse(message.body);
                  const { type, payload } = unwrapRTU(raw);
                  const p = type === "LEGACY" ? raw : payload;
                  const lat = Number(p?.latitude);
                  const lon = Number(p?.longitude);
                  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

                  const fromId = p?.userId ?? p?.user?.id ?? null;
                  if (fromId != null &&
                      myIdsRef.current?.userId != null &&
                      Number(fromId) === Number(myIdsRef.current.userId)) return;

                  const key = senderKey(p, message.headers);
                  const display = p?.name || p?.userName || p?.nickname || p?.user?.name;
                  if (display) setCachedName(key, display);
                  placeOrMoveOtherMarker(key, lat, lon, display);
                } catch (e) {
                  console.warn("USER stream parse fail:", e, message?.body);
                }
              }
            );

            // (B) 차량 위치 스트림
            stomp.subscribe(
              `/topic/group/${groupId}/location`,
              (message) => {
                try {
                  const raw = JSON.parse(message.body);
                  const { type, payload } = unwrapRTU(raw);
                  if (type !== "VEHICLE_UPDATE") return;

                  const lat = Number(payload?.latitude);
                  const lon = Number(payload?.longitude);
                  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

                  const speed = payload?.speed;
                  const batt = payload?.batteryLevel;
                  const statusTxt = payload?.status;
                  const ts = fromLocalDateTimeArray(payload?.timestamp);

                  moveVehicleMarker(lat, lon, {
                    title:
                      `차량` +
                      (Number.isFinite(speed) ? ` • ${speed}km/h` : "") +
                      (Number.isFinite(batt) ? ` • ${batt}%` : "") +
                      (statusTxt ? ` • ${statusTxt}` : "") +
                      (ts ? ` • ${ts.toLocaleString()}` : ""),
                  });

                  lastCarPosRef.current = { lat, lon };
                  if (hereBaseRef.current.lat != null && hereBaseRef.current.lon != null) {
                    drawCarToHereRoute({ lat, lon }, hereBaseRef.current);
                  }
                } catch (e) {
                  console.warn("VEHICLE stream parse fail:", e, message?.body);
                }
              }
            );

            // (C) 내 위치 전송
            if ("geolocation" in navigator) {
              try { navigator.geolocation.clearWatch(watchIdRef.current); } catch {}
              watchIdRef.current = navigator.geolocation.watchPosition(
                (pos) => {
                  const lat = pos.coords.latitude;
                  const lon = pos.coords.longitude;
                  moveMyMarker(lat, lon);
                  try {
                    const body = JSON.stringify({ latitude: lat, longitude: lon });
                    stomp.send("/app/location/update", {}, body);
                  } catch (e) { console.warn("위치 전송 실패", e); }
                },
                (err) => console.warn("watchPosition 실패", err),
                { enableHighAccuracy: true, maximumAge: 1500, timeout: 12000 }
              );
            }
          },
          (error) => {
            console.error("❌ STOMP 연결 실패:", error);
            connRef.current.connecting = false;
            connRef.current.connected = false;
            if (!cancelled) scheduleReconnect(2500);
          }
        );
      } catch (e) {
        console.error("STOMP 초기화 실패:", e);
        connRef.current.connecting = false;
        connRef.current.connected = false;
        if (!cancelled) scheduleReconnect(3000);
      }
    };

    const readyCheck = setInterval(() => {
      const hasMap = !!mapRef.current;
      const { groupId } = myIdsRef.current || {};
      if (hasMap && groupId) {
        clearInterval(readyCheck);
        connect();
      }
    }, 300);

    return () => {
      clearInterval(readyCheck);
      try { navigator.geolocation.clearWatch(watchIdRef.current); } catch {}
      try { if (stompRef.current?.connected) stompRef.current?.disconnect(() => {}); } catch {}
      try { if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.close(); } catch {}
      for (const meta of otherMarkersRef.current.values()) {
        try { meta.marker.setMap(null); } catch {}
      }
      otherMarkersRef.current.clear();
      try { carMarkerRef.current?.setMap(null); } catch {}
    };
  }, [setCachedName, getDisplayName]);

  /* ===== 레이아웃(가로 반겹) ===== */
  function recomputeLineLayout() {
    if (!mapRef.current || !window.Tmapv2) return;
    const { lat: meLat, lon: meLon } = hereBaseRef.current || {};
    if (!Number.isFinite(meLat) || !Number.isFinite(meLon)) return;

    const zoom = mapRef.current.getZoom?.() ?? 15;
    const mpp = metersPerPixelAtLat(meLat, zoom);

    const stepM = (LINE_LAYOUT.desiredPx || 18) * mpp;
    const clusterM = (LINE_LAYOUT.clusterPx || 14) * mpp;

    const near = [];
    otherMarkersRef.current.forEach((meta) => {
      const d = haversineM({ lat: meLat, lon: meLon }, meta.base);
      if (d <= clusterM) near.push({ meta });
    });

    near.sort((a, b) => (a.meta.idKey || "").localeCompare(b.meta.idKey || ""));

    const R = 6378137, rad = Math.PI / 180;
    try { hereMarkerRef.current?.setPosition(new window.Tmapv2.LatLng(meLat, meLon)); } catch {}

    for (let i = 0; i < near.length; i++) {
      const sign = i % 2 === 0 ? 1 : -1;
      const k = Math.ceil((i + 1) / 2);
      const offsetM = stepM * k * sign;
      const dLon = (offsetM / (R * Math.cos(meLat * rad))) * (180 / Math.PI);
      const adj = { lat: meLat, lon: meLon + dLon };
      const { marker } = near[i].meta;
      try { marker.setPosition(new window.Tmapv2.LatLng(adj.lat, adj.lon)); } catch {}
    }

    otherMarkersRef.current.forEach((meta) => {
      const inNear = near.some((x) => x.meta === meta);
      if (!inNear) {
        try { meta.marker.setPosition(new window.Tmapv2.LatLng(meta.base.lat, meta.base.lon)); } catch {}
      }
    });
  }

  function moveMyMarker(lat, lon) {
    try {
      setHerePos({ lat, lon });
      hereBaseRef.current = { lat, lon };
      if (mapRef.current && window.Tmapv2) recomputeLineLayout();
      if (lastCarPosRef.current) drawCarToHereRoute(lastCarPosRef.current, { lat, lon });
    } catch {}
  }

  function placeOrMoveOtherMarker(idKey, lat, lon, displayName) {
    if (!mapRef.current || !window.Tmapv2) return;
    const key = String(idKey || "unknown");
    let meta = otherMarkersRef.current.get(key);
    const base = { lat, lon };
    const titleNow = displayName || getDisplayName(key);

    if (!meta) {
      const h = hashStr(key);
      const icon = h % 2 === 0 ? ICONS.otherYellow : ICONS.otherOrange;
      const marker = new window.Tmapv2.Marker({
        position: new window.Tmapv2.LatLng(base.lat, base.lon),
        map: mapRef.current,
        icon, title: titleNow,
      });
      meta = makeMarkerMeta(marker, base, key);
      otherMarkersRef.current.set(key, meta);
    } else {
      meta.base = base;
      try {
        if (typeof meta.marker.setTitle === "function") meta.marker.setTitle(titleNow);
        else meta.marker.options && (meta.marker.options.title = titleNow);
      } catch {}
      try { meta.marker.setPosition(new window.Tmapv2.LatLng(base.lat, base.lon)); } catch {}
    }
    recomputeLineLayout();
  }

  /** 🚗 차량 마커 생성/이동 */
  function moveVehicleMarker(lat, lon, { title } = {}) {
    if (!mapRef.current || !window.Tmapv2) return;
    if (!carMarkerRef.current) {
      try {
        carMarkerRef.current = new window.Tmapv2.Marker({
          position: new window.Tmapv2.LatLng(lat, lon),
          map: mapRef.current, icon: ICONS.car, title: title || "차량",
        });
      } catch {}
    } else {
      try { carMarkerRef.current.setPosition(new window.Tmapv2.LatLng(lat, lon)); } catch {}
      try {
        if (title) {
          if (typeof carMarkerRef.current.setTitle === "function") carMarkerRef.current.setTitle(title);
          else carMarkerRef.current.options && (carMarkerRef.current.options.title = title);
        }
      } catch {}
    }
  }

  /* ===== 검색/경로 ===== */
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  useEffect(() => {
    const keyword = query.trim();
    if (!keyword) {
      setResults([]); setOpen(false); abortRef.current?.abort();
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        setLoading(true);
        abortRef.current?.abort();
        abortRef.current = new AbortController();

        const appKey = process.env.REACT_APP_TMAP_APPKEY;
        const center = mapRef.current?.getCenter?.();
        const centerLat = center?._lat, centerLon = center?._lng;

        const url = new URL("https://apis.openapi.sk.com/tmap/pois");
        url.searchParams.set("version", "1");
        url.searchParams.set("searchKeyword", keyword);
        url.searchParams.set("resCoordType", "WGS84GEO");
        url.searchParams.set("reqCoordType", "WGS84GEO");
        url.searchParams.set("count", "15");
        if (centerLat && centerLon) {
          url.searchParams.set("centerLat", String(centerLat));
          url.searchParams.set("centerLon", String(centerLon));
        }

        const res = await fetch(url, {
          headers: { accept: "application/json", appKey },
          signal: abortRef.current.signal,
        });
        if (!res.ok) throw new Error(`POI 검색 실패: ${res.status}`);

        const data = await res.json();
        const pois = data?.searchPoiInfo?.pois?.poi ?? [];
        const list = Array.isArray(pois) ? pois : [pois];

        const toNum = (v) => (v == null ? NaN : Number(String(v).trim()));
        const items = list
          .map((p) => {
            const latStr = p.frontLat ?? p.noorLat ?? p.lat ?? p.centerLat ?? p.newLat;
            const lonStr = p.frontLon ?? p.noorLon ?? p.lon ?? p.centerLon ?? p.newLon;
            const lat = toNum(latStr), lon = toNum(lonStr);
            return {
              id: p.id,
              name: p.name,
              addr:
                p?.newAddressList?.newAddress?.[0]?.fullAddressRoad ??
                [p.upperAddrName, p.middleAddrName, p.lowerAddrName, p.roadName, p.buildingNo]
                  .filter(Boolean)
                  .join(" "),
              lat,
              lon,
              _raw: p,
            };
          })
          .filter((it) => Number.isFinite(it.lat) && Number.isFinite(it.lon));

        setResults(items);
        setOpen(true);
      } catch (e) {
        if (e.name !== "AbortError") { console.error(e); setResults([]); setOpen(false); }
      } finally { setLoading(false); }
    }, 250);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  /* ===== ETA/결과 리셋 ===== */
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
  }, []);
  useEffect(() => () => stopPolling(), [stopPolling]);

  const resetEtaAndDecision = useCallback(() => {
    etaAbortRef.current?.abort();
    stopPolling();
    setEtaOpen(false);
    setEtaLoading(false);
    setEta({
      carMin: null, transitMin: null, recommend: "car",
      recommendMessage: "", subMessage: "", buttonLabel: "차량 이용",
    });
    setCarReqId(null);
    setCarReqPhase("idle");
    setCarReqError("");
    setDecision(null);
    setShowReqUI(false);
  }, [stopPolling]);

  /* ===== 도착지 선택 시: 지도 이동 + 경로 + (임시 ETA) + (옵션) 자동 백엔드 분석 ===== */
  useEffect(() => {
    if (!selectedPlace) return;
    const map = mapRef.current;
    if (!map || !window.Tmapv2) return;

    resetEtaAndDecision();

    const pos = new window.Tmapv2.LatLng(selectedPlace.lat, selectedPlace.lon);
    map.setCenter(pos);
    map.setZoom(16);
    try {
      if (destMarkerRef.current) destMarkerRef.current.setMap(null);
      destMarkerRef.current = new window.Tmapv2.Marker({
        position: pos, map, icon: ICONS.dest, title: selectedPlace.name,
      });
    } catch {}
    if (herePos) {
      drawRoute(herePos, { lat: selectedPlace.lat, lon: selectedPlace.lon }, { destinationName: selectedPlace.name });
    }

    // 🔸 자동 백엔드 분석 스타트 (옵션)
    autoStartBackendETA();
  }, [selectedPlace, herePos, resetEtaAndDecision]);

  useEffect(() => {
    if (herePos && lastCarPosRef.current) {
      drawCarToHereRoute(lastCarPosRef.current, herePos);
    }
  }, [herePos]);

  const startPollingDecision = useCallback((id) => {
    stopPolling();
    setCarReqPhase("polling");
    setCarReqError("");
    setDecision(null);
    pollStartAtRef.current = Date.now();

    pollTimerRef.current = setInterval(async () => {
      if (Date.now() - pollStartAtRef.current > 30000) {
        stopPolling();
        setCarReqPhase("error");
        setCarReqError("분석 대기 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      try {
        const info = await fetchCarDecisionOnce(id);
        if (info === null) return; // 아직
        stopPolling();
        setDecision(info);
        setCarReqPhase("done");
        // 상단 ETA 덮어쓰기
        setEta((prev) => {
          const carFromDecision = safePosMin(info.carTotalTime);
          const transitFromDecision = safePosMin(info.transitTotalTime);
          return {
            ...prev,
            carMin: carFromDecision ?? prev.carMin,
            transitMin: transitFromDecision ?? prev.transitMin,
            recommendMessage: prev.recommendMessage || (info.reason ? String(info.reason) : ""),
          };
        });
      } catch (e) {
        console.error("poll error:", e);
        stopPolling();
        setCarReqPhase("error");
        setCarReqError("결과 조회 중 오류가 발생했습니다.");
      }
    }, 2500);
  }, [stopPolling]);

  /* ===== 자동 백엔드 분석 (도착지 선택 직후) ===== */
  const autoStartBackendETA = useCallback(async () => {
    if (!AUTO_BACKEND_ETA) return;
    if (!selectedPlace) return;
    if (!getJwt()) return;

    try {
      const destDto = buildDestinationDtoFromPlace(selectedPlace);
      const id = await createCarRequestByAddress(destDto);
      setCarReqId(id);
      startPollingDecision(id);

      // 모달이 이미 열려 있지 않다면 열고 "분석 중" 문구를 표시
      setEtaOpen(true);
      setEta((prev) => ({
        ...prev,
        recommendMessage: prev.recommendMessage || "정확한 소요시간을 분석 중입니다…",
      }));
    } catch (e) {
      console.warn("auto backend ETA failed:", e?.message || e);
    }
  }, [selectedPlace, startPollingDecision]);

  const requestETAFromBackend = useCallback(async ({ start, end, destinationName }) => {
    try {
      setEtaLoading(true);
      setEtaOpen(true);
      etaAbortRef.current?.abort();
      etaAbortRef.current = new AbortController();

      const data = await fetchETAFromBackend({
        start, end, destinationName,
        signal: etaAbortRef.current.signal,
      });

      setEta((prev) => ({
        ...prev,
        carMin: safePosMin(data.carMinutes) ?? prev.carMin,
        transitMin: safePosMin(data.transitMinutes) ?? prev.transitMin,
        recommend: data.recommend ?? "car",
        recommendMessage: data.recommendMessage || "",
        subMessage: data.subMessage || "",
        buttonLabel: data.buttonLabel || "차량 이용",
      }));
    } catch (e) {
      if (e.name === "AbortError") return;
      console.warn("ETA unavailable:", e?.message || e);
      setEta((prev) => ({
        ...prev,
        recommend: "car",
        recommendMessage: "현재 소요시간 정보를 불러오지 못했습니다.",
        subMessage: "경로는 정상 표시되며, 차량 추천은 ‘AI 추천 요청하기’로 확인하세요.",
        buttonLabel: "AI 추천 요청하기",
      }));
      setEtaOpen(true);
    } finally {
      setEtaLoading(false);
    }
  }, []);

  // 👉 Tmap 경로 API에서 요약 시간(초)을 추출하여 분으로 반환 (보정)
  function extractCarMinutesFromTmap(features) {
    let sec = null;
    for (const f of features || []) {
      const t = Number(f?.properties?.totalTime);
      if (Number.isFinite(t)) sec = t; // 마지막 summary 덮어쓰기
    }
    if (sec == null) return null;
    const min = Math.round(sec / 60);
    return Math.max(0, min); // 0분 허용
  }

  // 경로 그리기 + 임시 ETA (Tmap/거리) + (선택) 백엔드 프리뷰
  const drawRoute = async (start, end, { destinationName = "" } = {}) => {
    try {
      if (!mapRef.current) return;
      const appKey = process.env.REACT_APP_TMAP_APPKEY;
      if (!appKey) return alert("TMAP AppKey가 없습니다.");
      if (![start, end].every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))) return;

      if (routeLineRef.current) {
        routeLineRef.current.halo?.setMap(null);
        routeLineRef.current.main?.setMap(null);
        routeLineRef.current = null;
      }

      const url = "https://apis.openapi.sk.com/tmap/routes?version=1&format=json";
      const body = {
        startX: start.lon, startY: start.lat,
        endX: end.lon, endY: end.lat,
        reqCoordType: "WGS84GEO", resCoordType: "WGS84GEO",
        trafficInfo: "Y",
      };

      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", appKey },
        body: JSON.stringify(body),
      });
      if (!res.ok) { console.error("경로 API 실패:", res.status, await res.text()); return alert("경로 API 호출 실패"); }

      const data = await res.json();
      const features = data?.features ?? [];
      const pts = [];
      for (const f of features) {
        if (f?.geometry?.type === "LineString") {
          for (const c of f.geometry.coordinates) {
            const x = Number(c[0]), y = Number(c[1]);
            if (Number.isFinite(x) && Number.isFinite(y)) pts.push(new window.Tmapv2.LatLng(y, x));
          }
        }
      }
      if (!pts.length) return alert("경로 선 정보를 찾지 못했습니다.");

      // ====== 거리 계산 후, 빈 칸은 추정치로 보정 ======
      const distanceM = pathLengthMeters(pts);
      let carMinFromTmap = extractCarMinutesFromTmap(features);

      if (Number.isFinite(carMinFromTmap)) {
        if (carMinFromTmap === 0 && distanceM >= 100) carMinFromTmap = 1;
        setEtaOpen(true);
        setEta((prev) => ({ ...prev, carMin: carMinFromTmap }));
      } else {
        const guessedCar = estimateCarMinByDistance(distanceM);
        setEtaOpen(true);
        setEta((prev) => ({ ...prev, carMin: guessedCar }));
      }

      // 대중교통 ETA 시도 → 실패/권한없음 → 추정치
      try {
        const { minutes, forbidden } = await fetchTransitETAFromTmap(start, end);
        if (Number.isFinite(minutes)) {
          setEta((prev) => ({ ...prev, transitMin: minutes }));
        } else {
          const baseCar = Number.isFinite(carMinFromTmap) ? carMinFromTmap : estimateCarMinByDistance(distanceM);
          const guessedTransit = estimateTransitMin(baseCar, distanceM);
          setEta((prev) => ({ ...prev, transitMin: guessedTransit }));
          setEta((prev) => ({
            ...prev,
            subMessage:
              (prev.subMessage ? prev.subMessage + " " : "") +
              (forbidden
                ? "(Tmap 대중교통 권한/키 문제로 추정치를 사용했어요)"
                : "(대중교통 시간을 불러오지 못해 추정치를 사용했어요)"),
          }));
        }
      } catch {
        const baseCar = Number.isFinite(carMinFromTmap) ? carMinFromTmap : estimateCarMinByDistance(distanceM);
        const guessedTransit = estimateTransitMin(baseCar, distanceM);
        setEta((prev) => ({ ...prev, transitMin: guessedTransit }));
      }

      // 경로 그리기
      const halo = new window.Tmapv2.Polyline({
        map: mapRef.current, path: pts, strokeColor: "#FFFFFF",
        strokeWeight: 10, strokeOpacity: 1, zIndex: 9998,
      });
      const main = new window.Tmapv2.Polyline({
        map: mapRef.current, path: pts, strokeColor: "#0066FF",
        strokeWeight: 6, strokeOpacity: 1, zIndex: 9999,
      });
      routeLineRef.current = { halo, main };

      const bounds = new window.Tmapv2.LatLngBounds();
      pts.forEach((p) => bounds.extend(p));
      mapRef.current.fitBounds(bounds);

      // (옵션) 프리뷰 ETA
      if (USE_BACKEND_ETA) {
        requestETAFromBackend({ start, end, destinationName });
      }
    } catch (e) {
      console.error("경로 그리기 실패:", e);
      alert("경로를 불러오는 중 오류");
    }
  };

  const drawCarToHereRoute = async (start, end) => {
    try {
      if (!mapRef.current) return;
      const appKey = process.env.REACT_APP_TMAP_APPKEY;
      if (!appKey) return;
      if (![start, end].every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))) return;

      if (carRouteRef.current) {
        carRouteRef.current.halo?.setMap(null);
        carRouteRef.current.main?.setMap(null);
        carRouteRef.current = null;
      }

      const url = "https://apis.openapi.sk.com/tmap/routes?version=1&format=json";
      const body = {
        startX: Number(start.lon), startY: Number(start.lat),
        endX: Number(end.lon), endY: Number(end.lat),
        reqCoordType: "WGS84GEO", resCoordType: "WGS84GEO",
        trafficInfo: "N", searchOption: 0,
        startName: "차량", endName: "내 위치",
      };

      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", appKey },
        body: JSON.stringify(body),
      });
      if (!res.ok) { console.error("차→나 경로 실패:", res.status, await res.text()); return; }

      const data = await res.json();
      const features = data?.features ?? [];
      const pts = [];
      for (const f of features) {
        if (f?.geometry?.type === "LineString") {
          for (const [lon, lat] of f.geometry.coordinates) {
            if (Number.isFinite(lon) && Number.isFinite(lat)) pts.push(new window.Tmapv2.LatLng(lat, lon));
          }
        }
      }
      if (!pts.length) return;

      const halo = new window.Tmapv2.Polyline({
        map: mapRef.current, path: pts, strokeColor: "#FFFFFF",
        strokeWeight: 10, strokeOpacity: 1, zIndex: 9996,
      });
      const main = new window.Tmapv2.Polyline({
        map: mapRef.current, path: pts, strokeColor: "#FF2D55",
        strokeWeight: 6, strokeOpacity: 1, zIndex: 9997,
      });
      carRouteRef.current = { halo, main };
    } catch (e) { console.error("차→나 경로 그리기 실패:", e); }
  };

  const pickResult = (item) => {
    setQuery(item.name);
    setOpen(false);
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) {
      alert("선택한 장소의 좌표가 없습니다.");
      return;
    }
    setSelectedPlace(item);
  };

  const clearQuery = () => {
    setQuery(""); setResults([]); setOpen(false); setSelectedPlace(null); setStatus("");
    if (destMarkerRef.current) { destMarkerRef.current.setMap(null); destMarkerRef.current = null; }
    if (routeLineRef.current) { routeLineRef.current.halo?.setMap(null); routeLineRef.current.main?.setMap(null); routeLineRef.current = null; }
    resetEtaAndDecision();
  };

  /* ===== 차량 요청 트리거 (수동) ===== */
  const handleClickCarRequest = async () => {
    setShowReqUI(true);

    if (!selectedPlace) return alert("도착지를 먼저 선택해 주세요.");
    const jwtNow = getJwt();
    if (!jwtNow) {
      setCarReqPhase("error");
      setCarReqError("로그인이 필요합니다. 다시 로그인해 주세요.");
      return;
    }

    // 이미 자동 분석 중/완료라면 새 요청을 만들지 않고 열어주기만
    if (carReqId && (carReqPhase === "polling" || carReqPhase === "done")) {
      setEtaOpen(true);
      return;
    }

    try {
      const destDto = buildDestinationDtoFromPlace(selectedPlace);

      setCarReqPhase("requesting");
      setCarReqError("");
      setDecision(null);

      const id = await createCarRequestByAddress(destDto);
      setCarReqId(id);
      startPollingDecision(id);
    } catch (e) {
      console.error("car request error:", e);
      setCarReqPhase("error");
      setCarReqError(e?.message || "요청 처리 중 오류가 발생했습니다.");
    }
  };

  return (
    <div className="mainShell" onClick={() => setOpen(false)}>
      <div className="searchWrap" onClick={(e) => e.stopPropagation()}>
        <div className="searchBar">
          <span className="pin">📍</span>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => { setOpen(Boolean(query)); }}
            placeholder="도착지 검색(장소명)"
          />
          {query && (
            <button className="clearBtn" onClick={clearQuery} aria-label="지우기">×</button>
          )}
        </div>
        {open && (results.length > 0 || loading) && (
          <div className="resultBox">
            {loading && <div className="hint">검색 중…</div>}
            {!loading && results.map((r) => (
              <button key={`${r.id}-${r.name}`} className="resultItem" onClick={() => pickResult(r)}>
                <div className="rTitle">{r.name}</div>
                <div className="rAddr">{r.addr}</div>
              </button>
            ))}
            {!loading && results.length === 0 && <div className="hint">검색 결과가 없습니다</div>}
          </div>
        )}
      </div>

      <div className="mapCanvas" ref={mapDivRef} />
      {status && <div className="mapStatus">{status}</div>}

      {etaOpen && (
        <div className="etaBackdrop" onClick={resetEtaAndDecision /* 모달 밖 클릭 시 완전 리셋 */}>
          <div className="etaCard" onClick={(e) => e.stopPropagation()}>
            <button className="etaClose" aria-label="닫기" onClick={resetEtaAndDecision}>×</button>

            <div className="etaTitle">도착지까지 걸리는 시간</div>
            <hr className="etaHr" />

            <div className="etaRow">
              <span>차량 이용 시</span>
              <strong>{etaLoading ? "계산 중…" : (eta.carMin != null ? `${eta.carMin}분` : "-")}</strong>
            </div>
            <div className="etaRow">
              <span>대중교통 이용 시</span>
              <strong>{etaLoading ? "계산 중…" : (eta.transitMin != null ? `${eta.transitMin}분` : "-")}</strong>
            </div>

            <hr className="etaHr" />
            <p className="etaDesc">{etaLoading ? "소요시간을 계산하고 있습니다…" : (eta.recommendMessage || "")}</p>
            <p className="etaSub">{etaLoading ? "" : (eta.subMessage || "")}</p>

            <div className="reqArea">
              <button
                className="etaPrimary"
                onClick={handleClickCarRequest}
                disabled={!selectedPlace || etaLoading || carReqPhase === "requesting"}
              >
                {carReqPhase === "requesting" ? "요청 접수 중…" :
                 carReqPhase === "polling"   ? "AI 분석 중… 열어보기" :
                 carReqPhase === "done"      ? "AI 결과 열어보기" :
                                               "AI 추천 요청하기"}
              </button>

              {showReqUI && carReqPhase === "requesting" && (
                <div className="reqInfo">요청을 접수 중입니다…</div>
              )}
              {showReqUI && carReqPhase === "polling" && (
                <div className="reqInfo">
                  AI가 최적 경로를 분석 중입니다… ⏳<br/>
                  (자동으로 결과를 가져옵니다)
                </div>
              )}
              {showReqUI && carReqPhase === "done" && decision && (
                <div className="decisionBox">
                  {decision.decision === "Vehicle" && (
                    <>
                      <div className="decTitle">🚗 자율주행차 이용을 추천합니다!</div>
                      {Number.isFinite(decision.carTotalTime) && <div className="decRow"><span>총 소요시간</span><b>{decision.carTotalTime}분</b></div>}
                      {decision.pickupTime && <div className="decRow"><span>예상 픽업</span><b>{String(decision.pickupTime)}</b></div>}
                      {decision.destinationTime && <div className="decRow"><span>도착 예상</span><b>{String(decision.destinationTime)}</b></div>}
                      {decision.reason && <p className="decReason">{decision.reason}</p>}
                      {Array.isArray(decision.carpoolMembers) && decision.carpoolMembers.length > 0 && (
                        <div className="decRow"><span>카풀</span><b>{decision.carpoolMembers.map(m=>m.userName).join(", ")}</b></div>
                      )}
                    </>
                  )}
                  {decision.decision === "Public_Transport" && (
                    <>
                      <div className="decTitle">🚌 대중교통 이용을 추천합니다!</div>
                      {Number.isFinite(decision.transitTotalTime) && <div className="decRow"><span>총 소요시간</span><b>{decision.transitTotalTime}분</b></div>}
                      {decision.reason && <p className="decReason">{decision.reason}</p>}
                    </>
                  )}
                  {decision.decision !== "Vehicle" && decision.decision !== "Public_Transport" && (
                    <>
                      <div className="decTitle">🚫 요청이 거절되었습니다</div>
                      <p className="decReason">{decision.reason || "분석에 실패했습니다. 잠시 후 다시 시도해 주세요."}</p>
                    </>
                  )}
                </div>
              )}
              {showReqUI && carReqPhase === "error" && (
                <div className="reqErr">{carReqError || "처리 중 오류가 발생했습니다."}</div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .mainShell{ min-height:100dvh; display:flex; flex-direction:column; position:relative; overflow:hidden; max-width:420px; margin:0 auto; border-radius:22px; }
        .mapCanvas{ flex:1; }
        .mapStatus{ position:absolute; top:64px; left:0; right:0; text-align:center; font-weight:700; color:#555; }
        .searchWrap{ position:absolute; left:12px; right:12px; top: 30px; z-index:10; display:flex; flex-direction:column; gap:8px; }
        .searchBar{ display:flex; align-items:center; gap:8px; background:#fff; border-radius:12px; padding:10px 12px; border:1px solid #e5e6ea; box-shadow:0 6px 18px rgba(0,0,0,.12); }
        .searchBar input{ flex:1; border:none; outline:none; font-size:15px; }
        .pin{ opacity:.7; }
        .clearBtn{ border:none; background:transparent; font-size:22px; line-height:1; cursor:pointer; opacity:.55; }
        .resultBox{ background:#fff; border:1px solid #e5e6ea; border-radius:12px; box-shadow:0 10px 24px rgba(0,0,0,.12); max-height:320px; overflow:auto; }
        .resultItem{ width:100%; text-align:left; padding:10px 12px; background:#fff; border:none; border-bottom:1px solid #f4f5f8; cursor:pointer; }
        .resultItem:hover{ background:#f8f7ff; }
        .rTitle{ font-weight:700; }
        .rAddr{ color:#666; font-size:12px; margin-top:2px; }

        .etaBackdrop{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.25); z-index:20; padding:16px; }
        .etaCard{ width:100%; max-width:360px; background:#fff; border-radius:16px; box-shadow:0 14px 34px rgba(0,0,0,.22); padding:20px 18px 22px; position:relative; }
        .etaClose{ position:absolute; top:10px; right:10px; border:none; background:transparent; font-size:22px; line-height:1; cursor:pointer; opacity:.5; }
        .etaTitle{ text-align:center; font-weight:800; font-size:16px; color:#333; margin-top:2px; margin-bottom:10px; }
        .etaHr{ border:0; border-top:1px solid #e9e9ee; margin:8px 0 14px; }
        .etaRow{ display:flex; align-items:center; justify-content:space-between; padding:12px 4px; font-size:15px; color:#444; }
        .etaRow strong{ font-size:17px; font-weight:800; color:#222; }
        .etaDesc{ text-align:center; color:#555; margin:12px 2px 2px; line-height:1.5; }
        .etaSub{ text-align:center; color:#666; margin:2px 2px 14px; line-height:1.5; }
        .etaPrimary{ display:block; width:100%; padding:12px 16px; border:none; border-radius:12px; background:#6A38F0; color:#fff; font-weight:800; font-size:16px; cursor:pointer; box-shadow:0 10px 18px rgba(106,56,240,.28); }
        .etaPrimary:active{ transform:translateY(1px); }

        .reqArea{ margin-top:8px; }
        .reqInfo{ text-align:center; color:#4b4b4b; font-size:14px; padding:10px 0; }
        .reqErr{ text-align:center; color:#d3003f; font-size:14px; padding:10px 0; }
        .decisionBox{ background:#faf9ff; border:1px solid #ece9ff; border-radius:12px; padding:12px; }
        .decTitle{ font-weight:800; margin-bottom:8px; }
        .decRow{ display:flex; justify-content:space-between; padding:6px 2px; }
        .decReason{ color:#555; margin-top:8px; line-height:1.5; }
      `}</style>
    </div>
  );
}
