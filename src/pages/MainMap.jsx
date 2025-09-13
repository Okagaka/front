// src/pages/MainMap.jsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/* ====== 공통 설정 ====== */
export const CAR_POS = Object.freeze({ lat: 37.5666805, lon: 126.9784147 });
const API_BASE = (process.env.REACT_APP_API_BASE || "").replace(/\/$/, "");
const STT_URL = API_BASE ? `${API_BASE}/api/stt` : "/api/stt";

/* WebSocket URL 결정 (API_BASE 기준, 없으면 현재 호스트) */
const WS_URL = (() => {
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

/** 일렬 배치(가로) 간격 설정 (반쯤 겹치게) */
const LINE_LAYOUT = { desiredPx: 18, clusterPx: 14 };

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

/* ====== 녹음기 (원문 그대로) ====== */
class WavRecorder {
  constructor(stream, ctx, source, proc) { this.stream=stream; this.ctx=ctx; this.source=source; this.proc=proc; this.chunks=[]; }
  static async create(){ const s=await navigator.mediaDevices.getUserMedia({audio:true}); const AC=window.AudioContext||window.webkitAudioContext; const ctx=new AC(); const src=ctx.createMediaStreamSource(s); const p=ctx.createScriptProcessor(4096,1,1); return new WavRecorder(s,ctx,src,p); }
  start(){ this.chunks=[]; this.proc.onaudioprocess=(e)=>{ const i=e.inputBuffer.getChannelData(0); this.chunks.push(new Float32Array(i)); }; this.source.connect(this.proc); this.proc.connect(this.ctx.destination); }
  async stop(){ this.proc.disconnect(); this.source.disconnect(); this.stream.getTracks().forEach(t=>t.stop()); try{await this.ctx.close();}catch{} const rate=this.ctx.sampleRate; let total=0; for(const c of this.chunks) total+=c.length; const buf=new Float32Array(total); let off=0; for(const c of this.chunks){ buf.set(c,off); off+=c.length; } const ds=downsampleBuffer(buf,rate,16000); const wavAB=encodeWAV(ds,16000); return new Blob([wavAB],{type:"audio/wav"}); }
}
function downsampleBuffer(buffer,srcRate,dstRate){ if(dstRate===srcRate) return buffer; const r=srcRate/dstRate; const len=Math.round(buffer.length/r); const out=new Float32Array(len); let o=0,i=0; while(o<len){ const next=Math.round((o+1)*r); let sum=0,cnt=0; for(; i<next && i<buffer.length; i++){ sum+=buffer[i]; cnt++; } out[o++]=sum/(cnt||1); } return out; }
function encodeWAV(samples,sampleRate){ const bps=2,ba=bps*1; const buf=new ArrayBuffer(44+samples.length*bps); const v=new DataView(buf); const ws=(s,o)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));}; ws("RIFF",0); v.setUint32(4,36+samples.length*bps,true); ws("WAVE",8); ws("fmt ",12); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,sampleRate,true); v.setUint32(28,sampleRate*ba,true); v.setUint16(32,ba,true); v.setUint16(34,16,true); ws("data",36); v.setUint32(40,samples.length*bps,true); let off=44; for(let i=0;i<samples.length;i++,off+=2){ let s=Math.max(-1,Math.min(1,samples[i])); v.setInt16(off,s<0?s*0x8000:s*0x7fff,true);} return buf; }

/* ====== Tmap SDK 준비 대기 ====== */
function waitForTmapV2({ timeoutMs = 12000, intervalMs = 50 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const T = window.Tmapv2;
      const ok = T && typeof T.Map==="function" && typeof T.LatLng==="function" && T.Map.prototype && T.LatLng.prototype;
      if (ok) return resolve(T);
      if (Date.now()-start > timeoutMs) return reject(new Error("Tmap SDK not ready"));
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

/* ====== 아이콘 경로 ====== */
const ICONS = {
  me: `${process.env.PUBLIC_URL}/images/pin_r.png`,
  dest: `${process.env.PUBLIC_URL}/images/pin_b.png`,
  car: `${process.env.PUBLIC_URL}/images/Car.png`,
  otherYellow: `${process.env.PUBLIC_URL}/images/pin_y.png`,
  otherOrange: `${process.env.PUBLIC_URL}/images/pin_o.png`,
};

/* ====== API 유틸 (이름 조회) ====== */
const apiUrl = (path) => {
  const base = API_BASE || "";
  if (!base) return path.startsWith("/") ? path : `/${path}`;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
};

const MEMBER_ENDPOINT_PATHS = [
  (gid) => `/api/group/${gid}/members`,
  (gid) => `/api/family/${gid}/members`,
  (gid) => `/api/groups/${gid}/members`,
  (gid) => `/api/family/members?groupId=${encodeURIComponent(gid)}`,
  (gid) => `/api/members?groupId=${encodeURIComponent(gid)}`,
];

async function fetchGroupMembers(gid, token) {
  if (!gid) return {};
  for (const build of MEMBER_ENDPOINT_PATHS) {
    const url = apiUrl(build(gid));
    try {
      const r = await fetch(url, {
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
      });
      const t = await r.text().catch(() => "");
      if (!r.ok) continue;
      let raw; try { raw = JSON.parse(t); } catch { raw = {}; }

      // 다양한 포맷 방어적으로 파싱
      const arr =
        raw?.data?.members ??
        raw?.members ??
        raw?.data ??
        raw?.list ??
        (Array.isArray(raw) ? raw : raw?.content);

      const list = Array.isArray(arr) ? arr : [];
      const pairs = [];
      for (const it of list) {
        const uid = it?.userId ?? it?.id ?? it?.user?.id ?? null;
        const name = it?.name ?? it?.userName ?? it?.nickname ?? it?.user?.name ?? null;
        if (uid != null && name) pairs.push([String(uid), String(name)]);
      }
      if (pairs.length) return Object.fromEntries(pairs);
    } catch (e) {
      // 다음 후보 엔드포인트로
    }
  }
  return {};
}

/* ====== 거리/투영 유틸 ====== */
function haversineM(a, b) {
  const R = 6378137;
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function metersPerPixelAtLat(lat, zoom) {
  const R = 6378137;
  return Math.cos(lat * Math.PI/180) * 2 * Math.PI * R / (256 * Math.pow(2, zoom));
}

/* ====== 마커 관리 구조 ====== */
function makeMarkerMeta(marker, base, userId) {
  return { marker, base: { ...base }, userId };
}

export default function MainMap() {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const didInitRef = useRef(false);

  const hereMarkerRef = useRef(null);
  const hereBaseRef = useRef({ lat: null, lon: null });
  const destMarkerRef = useRef(null);
  const carMarkerRef = useRef(null);
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

  const [recorder, setRecorder] = useState(null);
  const [recState, setRecState] = useState("idle");
  const uploadAbortRef = useRef(null);

  // ====== 실시간 위치 공유 ======
  const stompRef = useRef(null);
  const wsRef = useRef(null);
  const subRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const watchIdRef = useRef(null);

  // userId -> { marker, base:{lat,lon}, userId }
  const otherMarkersRef = useRef(new Map());
  const myIdsRef = useRef({ userId: null, groupId: null, myName: null });

  // 이름 캐시 (userId -> name)
  const nameCacheRef = useRef(new Map());
  const getDisplayName = useCallback((uid) => {
    if (uid == null) return "가족";
    const n = nameCacheRef.current.get(String(uid));
    return n || `가족 #${uid}`;
  }, []);
  const setCachedName = useCallback((uid, name) => {
    if (uid == null || !name) return;
    const key = String(uid);
    nameCacheRef.current.set(key, String(name));
    const meta = otherMarkersRef.current.get(key);
    if (meta?.marker) {
      try {
        if (typeof meta.marker.setTitle === "function") meta.marker.setTitle(String(name));
        else meta.marker.options && (meta.marker.options.title = String(name));
      } catch {}
    }
  }, []);

  // 디버그 로그
  const handleIncomingLocation = useCallback((msg) => {
    console.log("📡 그룹 위치 수신:", msg);
  }, []);

  // 하단 시간 카드 상태 + 복원
  const [compare, setCompare] = useState(null);
  const compareRef = useRef(null);
  const compareBackupRef = useRef(null);
  const drawerHidCompareRef = useRef(false);
  useEffect(() => { compareRef.current = compare; }, [compare]);

  useEffect(() => {
    const onOpen = () => {
      if (compareRef.current) {
        compareBackupRef.current = compareRef.current;
        drawerHidCompareRef.current = true;
        setCompare(null);
      }
    };
    const onClose = () => {
      if (drawerHidCompareRef.current && compareBackupRef.current) {
        setCompare(compareBackupRef.current);
      }
      drawerHidCompareRef.current = false;
      compareBackupRef.current = null;
    };
    window.addEventListener("app/drawer-open", onOpen);
    window.addEventListener("app/drawer-close", onClose);
    return () => {
      window.removeEventListener("app/drawer-open", onOpen);
      window.removeEventListener("app/drawer-close", onClose);
    };
  }, []);

  // 녹음 토글
  const startRecording = useCallback(async () => {
    if (recState !== "idle") return;
    try {
      if (!navigator.mediaDevices?.getUserMedia) { alert("마이크를 지원하지 않습니다."); return; }
      const rec = await WavRecorder.create();
      rec.start();
      setRecorder(rec);
      setRecState("recording");
      setStatus("듣는 중… 마이크에 말씀해 주세요 (최대 8초)");
    } catch (e) { console.error(e); alert("마이크 권한을 확인하세요."); }
  }, [recState]);

  const stopAndTranscribe = useCallback(async () => {
    if (recState !== "recording" || !recorder) return;
    try {
      setRecState("uploading");
      setStatus("음성 업로드 중…");
      const wavBlob = await recorder.stop();
      const wavFile = new File([wavBlob], "speech.wav", { type: "audio/wav" });
      const token = getJwt();
      if (!token) { setStatus("로그인이 필요합니다."); alert("로그인이 필요합니다."); return; }
      const form = new FormData(); form.append("file", wavFile);
      const controller = new AbortController(); uploadAbortRef.current = controller;
      const res = await fetch(STT_URL, { method:"POST", headers:{ Authorization:`Bearer ${token}` }, body:form, signal:controller.signal });
      if (res.status >= 500) { alert("서버 오류(STT)"); setStatus(""); return; }
      let payload; try { payload = await res.json(); } catch { payload = {}; }
      if (!res.ok) throw new Error(payload?.message || `STT 실패: ${res.status}`);
      const text = payload?.data || payload?.text || "";
      if (text) { setStatus("인식 완료"); setOpen(true); }
      else setStatus("인식 불가. 다시 말씀해 주세요.");
    } catch (e) {
      if (e.name !== "AbortError") { console.error(e); alert(e.message || "오류"); }
    } finally {
      setRecState("idle"); setRecorder(null); uploadAbortRef.current = null;
    }
  }, [recState, recorder]);

  useEffect(() => {
    const onToggle = () => {
      if (recState === "idle") startRecording();
      else if (recState === "recording") stopAndTranscribe();
      else if (recState === "uploading") uploadAbortRef.current?.abort();
    };
    window.addEventListener("app/mic-toggle", onToggle);
    return () => window.removeEventListener("app/mic-toggle", onToggle);
  }, [recState, startRecording, stopAndTranscribe]);

  // 로그인 체크/복구 + userId/groupId/name 세팅
  useEffect(() => {
    let me = null;
    if (state?.name && state?.phone) {
      if (state?.token) setJwt(state.token);
      me = state;
    } else {
      const saved = sessionStorage.getItem("auth");
      if (saved) {
        try { const p = JSON.parse(saved); if (p?.name && p?.phone) me = p; } catch {}
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
        await waitForTmapV2({ timeoutMs: 15000, intervalMs: 50 });
        if (cancelled || didInitRef.current) return;

        const { Tmapv2 } = window;
        if (!Tmapv2 || typeof Tmapv2.Map !== "function" || typeof Tmapv2.LatLng !== "function") {
          setStatus("지도 로드 실패: Tmap SDK 준비 안 됨");
          return;
        }

        if (mapRef.current?.destroy) { try { mapRef.current.destroy(); } catch {} }
        const map = new window.Tmapv2.Map(mapDivRef.current, {
          center: new window.Tmapv2.LatLng(37.5666805, 126.9784147),
          width: "100%",
          height: "100%",
          zoom: 15,
        });
        mapRef.current = map;
        didInitRef.current = true;

        // 줌 변경 시 레이아웃 재계산(픽셀 간격 유지)
        try { map.addListener("zoom_changed", () => recomputeLineLayout()); } catch {}

        try {
          carMarkerRef.current = new window.Tmapv2.Marker({
            position: new window.Tmapv2.LatLng(CAR_POS.lat, CAR_POS.lon),
            map,
            icon: ICONS.car,
            title: "차량",
          });
        } catch (e) {}

        if ("geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(
            ({ coords }) => {
              const here = new window.Tmapv2.LatLng(coords.latitude, coords.longitude);
              map.setCenter(here);
              try {
                const myTitle = myIdsRef.current.myName || "내 위치";
                hereMarkerRef.current = new window.Tmapv2.Marker({
                  position: here,
                  map,
                  icon: ICONS.me,
                  title: myTitle,
                });
                hereBaseRef.current = { lat: coords.latitude, lon: coords.longitude };
                setHerePos({ lat: coords.latitude, lon: coords.longitude });
                recomputeLineLayout();
              } catch {}
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

    const connect = async () => {
      try {
        const token = getJwt();
        const { userId, groupId } = myIdsRef.current || {};
        if (!token || !groupId) { console.warn("토큰 또는 groupId 없음 → STOMP 연결 보류", { token: !!token, groupId }); return; }

        await ensureStomp();

        try { subRef.current?.unsubscribe(); } catch {}
        try { stompRef.current?.disconnect(() => {}); } catch {}
        try { wsRef.current?.close?.(); } catch {}
        clearTimeout(reconnectTimerRef.current);

        const socket = new WebSocket(WS_URL);
        wsRef.current = socket;
        const stomp = window.Stomp.over(socket);
        stomp.debug = null;
        stompRef.current = stomp;

        const headers = { Authorization: `Bearer ${token}` };
        stomp.connect(
          headers,
          async () => {
            if (cancelled) return;
            console.log("✅ STOMP Connected");

            // (A) 구독
            const sub = stomp.subscribe(`/topic/group/${groupId}`, (message) => {
              try {
                const data = JSON.parse(message.body);
                handleIncomingLocation(data);

                const fromId = data?.userId ?? data?.user?.id ?? null;
                const lat = Number(data?.latitude);
                const lon = Number(data?.longitude);
                // 이름 같이 오면 캐시
                const nm = data?.name ?? data?.userName ?? data?.nickname ?? data?.user?.name ?? null;
                if (fromId != null && nm) setCachedName(fromId, nm);

                if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
                if (fromId != null && userId != null && Number(fromId) === Number(userId)) return; // 내 메시지는 무시

                placeOrMoveOtherMarker(fromId, lat, lon);
              } catch (e) {
                console.warn("수신 파싱 실패:", e, message?.body);
              }
            });
            subRef.current = sub;

            // (B) 가족 구성원 이름 미리 가져오기 (서버에 엔드포인트가 있을 때만)
            try {
              const nameMap = await fetchGroupMembers(groupId, token);
              for (const [uid, name] of Object.entries(nameMap)) setCachedName(uid, name);
            } catch (e) {
              // 없으면 무시 (웹소켓 메시지에 이름이 오면 반영됨)
            }

            // (C) 내 위치 watch & 전송
            if ("geolocation" in navigator) {
              try { navigator.geolocation.clearWatch(watchIdRef.current); } catch {}
              watchIdRef.current = navigator.geolocation.watchPosition(
                (pos) => {
                  const lat = pos.coords.latitude;
                  const lon = pos.coords.longitude;
                  moveMyMarker(lat, lon);
                  const payload = {
                    latitude: lat,
                    longitude: lon,
                    ...(groupId ? { groupId } : {}),
                    ...(userId ? { userId } : {}),
                    ...(myIdsRef.current.myName ? { name: myIdsRef.current.myName } : {}),
                  };
                  try { stomp.send("/app/location/update", {}, JSON.stringify(payload)); } catch (e) { console.warn("위치 전송 실패", e); }
                },
                (err) => console.warn("watchPosition 실패", err),
                { enableHighAccuracy: true, maximumAge: 1500, timeout: 12000 }
              );
            }
          },
          (error) => {
            console.error("❌ STOMP 연결 실패:", error);
            if (!cancelled) {
              clearTimeout(reconnectTimerRef.current);
              reconnectTimerRef.current = setTimeout(connect, 2500);
            }
          }
        );
      } catch (e) {
        console.error("STOMP 초기화 실패:", e);
        clearTimeout(reconnectTimerRef.current);
        if (!cancelled) reconnectTimerRef.current = setTimeout(connect, 3000);
      }
    };

    // map 준비 + auth 설정 후 연결 시도
    const readyCheck = setInterval(() => {
      const hasMap = !!mapRef.current;
      const { groupId } = myIdsRef.current || {};
      const hasGroup = !!groupId;
      if (hasMap && hasGroup) {
        clearInterval(readyCheck);
        connect();
      }
    }, 300);

    return () => {
      cancelled = true;
      clearInterval(readyCheck);
      try { subRef.current?.unsubscribe(); } catch {}
      try { stompRef.current?.disconnect(() => {}); } catch {}
      try { wsRef.current?.close?.(); } catch {}
      try { navigator.geolocation.clearWatch(watchIdRef.current); } catch {}
      clearTimeout(reconnectTimerRef.current);
      for (const meta of otherMarkersRef.current.values()) {
        try { meta.marker.setMap(null); } catch {}
      }
      otherMarkersRef.current.clear();
    };
  }, [handleIncomingLocation, setCachedName, getDisplayName]);

  /* ===== 레이아웃: ‘내 위치’를 중심으로 가로 일렬 + 반쯤 겹치기 ===== */
  function recomputeLineLayout() {
    if (!mapRef.current || !window.Tmapv2) return;

    const { lat: meLat, lon: meLon } = hereBaseRef.current || {};
    if (!Number.isFinite(meLat) || !Number.isFinite(meLon)) return;

    const zoom = mapRef.current.getZoom?.() ?? 15;
    const mpp = metersPerPixelAtLat(meLat, zoom);
    const stepM = (LINE_LAYOUT.desiredPx || 18) * mpp;
    const clusterM = (LINE_LAYOUT.clusterPx || 14) * mpp;

    const near = [];
    otherMarkersRef.current.forEach((meta, idKey) => {
      const d = haversineM({ lat: meLat, lon: meLon }, meta.base);
      if (d <= clusterM) near.push({ idKey, meta });
    });

    near.sort((a, b) => {
      const ua = Number(a.meta.userId ?? a.idKey) || 0;
      const ub = Number(b.meta.userId ?? b.idKey) || 0;
      return ua - ub;
    });

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
    } catch {}
  }

  function placeOrMoveOtherMarker(userId, lat, lon) {
    if (!mapRef.current || !window.Tmapv2) return;
    const idKey = userId == null ? "unknown" : String(userId);

    let meta = otherMarkersRef.current.get(idKey);
    const base = { lat, lon };

    const titleNow = getDisplayName(userId);
    if (!meta) {
      const even = userId != null && Number(userId) % 2 === 0;
      const icon = even ? ICONS.otherYellow : ICONS.otherOrange;
      const marker = new window.Tmapv2.Marker({
        position: new window.Tmapv2.LatLng(base.lat, base.lon),
        map: mapRef.current,
        icon,
        title: titleNow,
      });
      meta = makeMarkerMeta(marker, base, userId);
      otherMarkersRef.current.set(idKey, meta);
    } else {
      meta.base = base;
      try {
        if (typeof meta.marker.setTitle === "function") meta.marker.setTitle(titleNow);
        else meta.marker.options && (meta.marker.options.title = titleNow);
      } catch {}
    }

    recomputeLineLayout();
  }

  // POI 검색
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  useEffect(() => {
    const keyword = query.trim();
    if (!keyword) { setResults([]); setOpen(false); abortRef.current?.abort(); return; }
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
        const items = list.map((p) => {
          const latStr = p.frontLat ?? p.noorLat ?? p.lat ?? p.centerLat ?? p.newLat;
          const lonStr = p.frontLon ?? p.noorLon ?? p.lon ?? p.centerLon ?? p.newLon;
          const lat = toNum(latStr), lon = toNum(lonStr);
          return {
            id: p.id, name: p.name,
            addr: p?.newAddressList?.newAddress?.[0]?.fullAddressRoad ??
                  [p.upperAddrName, p.middleAddrName, p.lowerAddrName, p.roadName, p.buildingNo].filter(Boolean).join(" "),
            lat, lon, _raw: p,
          };
        }).filter((it) => Number.isFinite(it.lat) && Number.isFinite(it.lon));

        setResults(items); setOpen(true);
      } catch (e) {
        if (e.name !== "AbortError") { console.error(e); setResults([]); setOpen(false); }
      } finally { setLoading(false); }
    }, 250);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // 목적지 선택 시
  useEffect(() => {
    if (!selectedPlace) return;
    const map = mapRef.current;
    if (!map || !window.Tmapv2) return;
    const pos = new window.Tmapv2.LatLng(selectedPlace.lat, selectedPlace.lon);
    map.setCenter(pos); map.setZoom(16);

    try {
      if (destMarkerRef.current) destMarkerRef.current.setMap(null);
      destMarkerRef.current = new window.Tmapv2.Marker({
        position: pos, map, icon: ICONS.dest, title: selectedPlace.name,
      });
    } catch {}

    if (herePos) {
      drawRoute(herePos, { lat: selectedPlace.lat, lon: selectedPlace.lon });
      openCompare(selectedPlace);
    }
  }, [selectedPlace, herePos]);

  // 차량→나 경로
  useEffect(() => { if (herePos) drawCarToHereRoute(CAR_POS, herePos); }, [herePos]);

  const drawRoute = async (start, end) => {
    try {
      if (!mapRef.current) return;
      const appKey = process.env.REACT_APP_TMAP_APPKEY;
      if (!appKey) return alert("TMAP AppKey가 없습니다.");
      if (![start, end].every(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))) return;

      if (routeLineRef.current) {
        routeLineRef.current.halo?.setMap(null);
        routeLineRef.current.main?.setMap(null);
        routeLineRef.current = null;
      }

      const url = "https://apis.openapi.sk.com/tmap/routes?version=1&format=json";
      const body = { startX:start.lon, startY:start.lat, endX:end.lon, endY:end.lat, reqCoordType:"WGS84GEO", resCoordType:"WGS84GEO", trafficInfo:"Y" };

      const res = await fetch(url, {
        method:"POST",
        headers:{ "content-type":"application/json", accept:"application/json", appKey },
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

      const halo = new window.Tmapv2.Polyline({ map:mapRef.current, path:pts, strokeColor:"#FFFFFF", strokeWeight:10, strokeOpacity:1, zIndex:9998 });
      const main = new window.Tmapv2.Polyline({ map:mapRef.current, path:pts, strokeColor:"#0066FF", strokeWeight:6, strokeOpacity:1, zIndex:9999 });
      routeLineRef.current = { halo, main };

      const bounds = new window.Tmapv2.LatLngBounds();
      pts.forEach(p => bounds.extend(p));
      mapRef.current.fitBounds(bounds);
    } catch (e) { console.error("경로 그리기 실패:", e); alert("경로를 불러오는 중 오류"); }
  };

  const drawCarToHereRoute = async (start, end) => {
    try {
      if (!mapRef.current) return;
      const appKey = process.env.REACT_APP_TMAP_APPKEY;
      if (!appKey) return alert("TMAP AppKey가 없습니다.");
      if (![start, end].every(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))) return;

      if (carRouteRef.current) {
        carRouteRef.current.halo?.setMap(null);
        carRouteRef.current.main?.setMap(null);
        carRouteRef.current = null;
      }

      const url = "https://apis.openapi.sk.com/tmap/routes?version=1&format=json";
      const body = { startX:Number(start.lon), startY:Number(start.lat), endX:Number(end.lon), endY:Number(end.lat), reqCoordType:"WGS84GEO", resCoordType:"WGS84GEO", trafficInfo:"N", searchOption:0, startName:"차량", endName:"내 위치" };

      const res = await fetch(url, {
        method:"POST",
        headers:{ "content-type":"application/json", accept:"application/json", appKey },
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

      const halo = new window.Tmapv2.Polyline({ map:mapRef.current, path:pts, strokeColor:"#FFFFFF", strokeWeight:10, strokeOpacity:1, zIndex:9996 });
      const main = new window.Tmapv2.Polyline({ map:mapRef.current, path:pts, strokeColor:"#FF2D55", strokeWeight:6, strokeOpacity:1, zIndex:9997 });
      carRouteRef.current = { halo, main };
    } catch (e) { console.error("차→나 경로 그리기 실패:", e); }
  };

  const openCompare = (dest) => {
    if (!herePos || !dest) return;
    const dLat = Math.abs(herePos.lat - dest.lat);
    const dLon = Math.abs(herePos.lon - dest.lon);
    const km = Math.sqrt(dLat*dLat + dLon*dLon) * 111;
    const carMin = Math.max(7, Math.round(km * 3.5));
    const transitMin = Math.max(10, Math.round(km * 2.8) + 8);
    setCompare({ carMin, transitMin });
  };

  const pickResult = (item) => {
    setQuery(item.name); setOpen(false);
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) { alert("선택한 장소의 좌표가 없습니다."); return; }
    setSelectedPlace(item);
  };
  const clearQuery = () => {
    setQuery(""); setResults([]); setOpen(false); setSelectedPlace(null); setStatus("");
    if (destMarkerRef.current) { destMarkerRef.current.setMap(null); destMarkerRef.current = null; }
    if (routeLineRef.current) { routeLineRef.current.halo?.setMap(null); routeLineRef.current.main?.setMap(null); routeLineRef.current = null; }
    setCompare(null);
  };

  return (
    <div className="mainShell" onClick={() => setOpen(false)}>
      {/* 실시간 마커는 이 컴포넌트 내부에서 처리 */}

      <div className="searchWrap" onClick={(e) => e.stopPropagation()}>
        <div className="searchBar">
          <span className="pin">📍</span>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => { setOpen(Boolean(query)); setCompare(null); }}
            onClick={() => setCompare(null)}
            placeholder="도착지 검색(장소명)"
          />
          {query && <button className="clearBtn" onClick={clearQuery} aria-label="지우기">×</button>}
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

      {compare && (
        <div className="cmpOverlay" onClick={() => setCompare(null)}>
          <div className="cmpCard" onClick={(e)=>e.stopPropagation()}>
            <div className="cmpHandle" />
            <div className="cmpTitle">도착지까지 걸리는 시간</div>
            <hr className="cmpDiv" />
            <div className="cmpRow"><span>🚗 차량 도착 및 이동 시간</span><b>{compare.carMin}분</b></div>
            <hr className="cmpDiv" />
            <div className="cmpRow"><span>🚇 대중교통 이용 시간</span><b>{compare.transitMin}분</b></div>
            <hr className="cmpDiv" />
            <div className="cmpGuide">차량 이용을 원하시면 <b>좌측 상단 메뉴에서 예약</b>해주세요.</div>
            <button className="cmpOK" onClick={() => setCompare(null)}>확인</button>
          </div>
        </div>
      )}

      <style>{`
        .mainShell{ min-height:100dvh; display:flex; flex-direction:column; position:relative; overflow:hidden; max-width:420px; margin:0 auto; border-radius:22px; }
        .mapCanvas{ flex:1; }
        .mapStatus{ position:absolute; top:64px; left:0; right:0; text-align:center; font-weight:700; color:#555; }
        .searchWrap{ position:absolute; left:12px; right:12px; top:10px; z-index:10; display:flex; flex-direction:column; gap:8px; }
        .searchBar{ display:flex; align-items:center; gap:8px; background:#fff; border-radius:12px; padding:10px 12px; border:1px solid #e5e6ea; box-shadow:0 6px 18px rgba(0,0,0,.12); }
        .searchBar input{ flex:1; border:none; outline:none; font-size:15px; }
        .pin{ opacity:.7; }
        .clearBtn{ border:none; background:transparent; font-size:22px; line-height:1; cursor:pointer; opacity:.55; }
        .resultBox{ background:#fff; border:1px solid #e5e6ea; border-radius:12px; box-shadow:0 10px 24px rgba(0,0,0,.12); max-height:320px; overflow:auto; }
        .resultItem{ width:100%; text-align:left; padding:10px 12px; background:#fff; border:none; border-bottom:1px solid #f4f5f8; cursor:pointer; }
        .resultItem:hover{ background:#f8f7ff; }
        .rTitle{ font-weight:700; }
        .rAddr{ color:#666; font-size:12px; margin-top:2px; }
        .hint{ padding:10px 12px; color:#666; font-size:13px; }
        .cmpOverlay{ position:absolute; inset:0; display:flex; align-items:flex-end; justify-content:center; z-index:10000; padding:12px; }
        .cmpCard{ width:100%; background:#fff; border-radius:16px 16px 12px 12px; box-shadow:0 18px 50px rgba(0,0,0,.18); padding:16px 14px calc(env(safe-area-inset-bottom,0) + 14px); max-height:75vh; overflow:auto; }
        .cmpHandle{ width:48px; height:5px; border-radius:6px; margin:4px auto 10px; background:#e5e7eb; }
        .cmpTitle{ text-align:center; font-weight:800; color:#374151; }
        .cmpDiv{ border:none; border-top:1px solid #eceef2; margin:12px 0; }
        .cmpRow{ display:flex; align-items:center; justify-content:space-between; font-size:15px; color:#4b5563; }
        .cmpRow b{ color:#111827; font-size:16px; }
        .cmpGuide{ text-align:center; color:#6b7280; line-height:1.6; margin:6px 0 8px; }
        .cmpOK{ width:100%; height:44px; border:none; border-radius:12px; background:linear-gradient(135deg,#6a5af9,#8f7bff); color:#fff; font-weight:700; margin-top:8px; cursor:pointer; }
      `}</style>
    </div>
  );
}
