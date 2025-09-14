// src/pages/MainMap.jsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/* ====== 공통 설정 ====== */
const API_BASE = (process.env.REACT_APP_API_BASE || "").replace(/\/$/, "");

/* (보존) STT */
const STT_URL = API_BASE ? `${API_BASE}/api/stt` : "/api/stt";

/* WebSocket URL (환경변수 우선) */
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

/* ====== 유틸 ====== */
function makeMarkerMeta(marker, base, idKey) {
  return { marker, base: { ...base }, idKey };
}

/** RealTimeUpdate 래퍼 해제 */
function unwrapRTU(raw) {
  const hasWrapper = raw && typeof raw === "object" && "payload" in raw;
  if (hasWrapper) return { type: raw.type || "UNKNOWN", payload: raw.payload };
  return { type: "LEGACY", payload: raw };
}

/** [yyyy,M,d,H,m,s,(nano)] → Date */
function fromLocalDateTimeArray(arr) {
  if (!Array.isArray(arr) || arr.length < 6) return null;
  const [y, M, d, H, m, s] = arr;
  try {
    return new Date(y, M - 1, d, H, m, s);
  } catch {
    return null;
  }
}

/** 문자열 해시(작은 정수) */
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** 수신 메시지/헤더로부터 "발신자 키" 만들기 (userId가 없어도 고유키 생성) */
function senderKey(p, headers = {}) {
  const uid = p?.userId ?? p?.user?.id;
  if (uid != null) return `u:${uid}`;
  if (headers["x-user-id"]) return `h:${headers["x-user-id"]}`;
  const alt = p?.deviceId || p?.clientId || p?.phone || p?.name;
  if (alt) return `c:${String(alt)}`;
  return `msg:${headers["message-id"] || Math.random().toString(36).slice(2)}`;
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
  const subUserRef = useRef(null);
  const subVehicleRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const watchIdRef = useRef(null);

  // 가족 마커
  const otherMarkersRef = useRef(new Map());
  const myIdsRef = useRef({ userId: null, groupId: null, myName: null });

  // 이름 캐시 (idKey 기준)
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

  const handleInboundLog = useCallback((msg) => {
    console.log("📩 inbound:", msg);
  }, []);

  // 로그인 복구
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
    if (!me) {
      nav("/", { replace: true });
      return;
    }
    myIdsRef.current.userId = me.userId ?? null;
    myIdsRef.current.groupId = me.groupId ?? null;
    myIdsRef.current.myName = me.name ?? null;
  }, [state, nav]);

  /* ===== 지도 초기화 ===== */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tag = document.getElementById("tmap-js-sdk");
      if (!tag) {
        setStatus("index.html의 Tmap 스크립트를 확인하세요. (id='tmap-js-sdk')");
        return;
      }

      try {
        await waitForTmapV2();
        if (cancelled || didInitRef.current) return;
        const { Tmapv2 } = window;
        if (!Tmapv2 || typeof Tmapv2.Map !== "function") {
          setStatus("지도 로드 실패: Tmap SDK 준비 안 됨");
          return;
        }

        if (mapRef.current?.destroy) {
          try {
            mapRef.current.destroy();
          } catch {}
        }
        const map = new window.Tmapv2.Map(mapDivRef.current, {
          center: new window.Tmapv2.LatLng(37.5666805, 126.9784147),
          width: "100%",
          height: "100%",
          zoom: 15,
        });
        mapRef.current = map;
        didInitRef.current = true;

        try {
          map.addListener("zoom_changed", () => recomputeLineLayout());
        } catch {}

        // 현재 위치
        if ("geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(
            ({ coords }) => {
              const here = new window.Tmapv2.LatLng(
                coords.latitude,
                coords.longitude
              );
              map.setCenter(here);
              try {
                hereMarkerRef.current = new window.Tmapv2.Marker({
                  position: here,
                  map,
                  icon: ICONS.me,
                  title: "현재 위치",
                });
              } catch {}
              hereBaseRef.current = {
                lat: coords.latitude,
                lon: coords.longitude,
              };
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

    return () => {
      cancelled = true;
    };
  }, []);

  /* ===== WebSocket/STOMP 연결 & 위치 송수신 ===== */
  useEffect(() => {
    let cancelled = false;

    const connect = async () => {
      try {
        const token = getJwt();
        const { userId, groupId } = myIdsRef.current || {};
        if (!token || !groupId) {
          console.warn("토큰 또는 groupId 없음 → STOMP 연결 보류", {
            token: !!token,
            groupId,
          });
          return;
        }

        await ensureStomp();

        try {
          subUserRef.current?.unsubscribe();
        } catch {}
        try {
          subVehicleRef.current?.unsubscribe();
        } catch {}
        try {
          stompRef.current?.disconnect(() => {});
        } catch {}
        try {
          wsRef.current?.close?.();
        } catch {}
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
            console.log("🔔 Subscribing topic:", `/topic/group/${groupId}`);

            // (A) 사용자 위치
            subUserRef.current = stomp.subscribe(
              `/topic/group/${groupId}`,
              (message) => {
                try {
                  const raw = JSON.parse(message.body);
                  const { type, payload } = unwrapRTU(raw);
                  handleInboundLog({ type, payload });

                  const p = type === "LEGACY" ? raw : payload;
                  const lat = Number(p?.latitude);
                  const lon = Number(p?.longitude);
                  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

                  // 내 위치 메시지는 userId 있을 때만 필터
                  const fromId = p?.userId ?? p?.user?.id ?? null;
                  if (
                    fromId != null &&
                    myIdsRef.current?.userId != null &&
                    Number(fromId) === Number(myIdsRef.current.userId)
                  ) {
                    return;
                  }

                  const key = senderKey(p, message.headers);
                  const display =
                    p?.name || p?.userName || p?.nickname || p?.user?.name;
                  if (display) setCachedName(key, display);

                  placeOrMoveOtherMarker(key, lat, lon, display);
                } catch (e) {
                  console.warn("USER stream parse fail:", e, message?.body);
                }
              }
            );

            // (B) 차량 위치
            subVehicleRef.current = stomp.subscribe(
              `/topic/group/${groupId}/location`,
              (message) => {
                try {
                  const raw = JSON.parse(message.body);
                  const { type, payload } = unwrapRTU(raw);
                  handleInboundLog({ type, payload });

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
                  if (herePos) drawCarToHereRoute({ lat, lon }, herePos);
                } catch (e) {
                  console.warn("VEHICLE stream parse fail:", e, message?.body);
                }
              }
            );

            // (C) 내 위치 전송
            if ("geolocation" in navigator) {
              try {
                navigator.geolocation.clearWatch(watchIdRef.current);
              } catch {}
              watchIdRef.current = navigator.geolocation.watchPosition(
                (pos) => {
                  const lat = pos.coords.latitude;
                  const lon = pos.coords.longitude;
                  moveMyMarker(lat, lon);
                  try {
                    const body = JSON.stringify({ latitude: lat, longitude: lon });
                    console.log("📤 sending:", { latitude: lat, longitude: lon });
                    stomp.send("/app/location/update", {}, body);
                  } catch (e) {
                    console.warn("위치 전송 실패", e);
                  }
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

    // 지도 & groupId 준비되면 연결
    const readyCheck = setInterval(() => {
      const hasMap = !!mapRef.current;
      const { groupId } = myIdsRef.current || {};
      if (hasMap && groupId) {
        clearInterval(readyCheck);
        connect();
      }
    }, 300);

    return () => {
      cancelled = true;
      clearInterval(readyCheck);
      try {
        subUserRef.current?.unsubscribe();
      } catch {}
      try {
        subVehicleRef.current?.unsubscribe();
      } catch {}
      try {
        stompRef.current?.disconnect(() => {});
      } catch {}
      try {
        wsRef.current?.close?.();
      } catch {}
      try {
        navigator.geolocation.clearWatch(watchIdRef.current);
      } catch {}
      clearTimeout(reconnectTimerRef.current);

      for (const meta of otherMarkersRef.current.values()) {
        try {
          meta.marker.setMap(null);
        } catch {}
      }
      otherMarkersRef.current.clear();
      try {
        carMarkerRef.current?.setMap(null);
      } catch {}
    };
  }, [handleInboundLog, setCachedName, getDisplayName]); // eslint-disable-line

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

    // idKey 기준으로 안정 정렬
    near.sort((a, b) => (a.meta.idKey || "").localeCompare(b.meta.idKey || ""));

    const R = 6378137,
      rad = Math.PI / 180;
    try {
      hereMarkerRef.current?.setPosition(
        new window.Tmapv2.LatLng(meLat, meLon)
      );
    } catch {}

    for (let i = 0; i < near.length; i++) {
      const sign = i % 2 === 0 ? 1 : -1;
      const k = Math.ceil((i + 1) / 2);
      const offsetM = stepM * k * sign;
      const dLon = (offsetM / (R * Math.cos(meLat * rad))) * (180 / Math.PI);
      const adj = { lat: meLat, lon: meLon + dLon };
      const { marker } = near[i].meta;
      try {
        marker.setPosition(new window.Tmapv2.LatLng(adj.lat, adj.lon));
      } catch {}
    }

    otherMarkersRef.current.forEach((meta) => {
      const inNear = near.some((x) => x.meta === meta);
      if (!inNear) {
        try {
          meta.marker.setPosition(
            new window.Tmapv2.LatLng(meta.base.lat, meta.base.lon)
          );
        } catch {}
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

  /** idKey 기반으로 가족 마커 배치 */
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
        icon,
        title: titleNow,
      });
      meta = makeMarkerMeta(marker, base, key);
      otherMarkersRef.current.set(key, meta);
    } else {
      meta.base = base;
      try {
        if (typeof meta.marker.setTitle === "function")
          meta.marker.setTitle(titleNow);
        else meta.marker.options && (meta.marker.options.title = titleNow);
      } catch {}
      try {
        meta.marker.setPosition(new window.Tmapv2.LatLng(base.lat, base.lon));
      } catch {}
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
          map: mapRef.current,
          icon: ICONS.car,
          title: title || "차량",
        });
      } catch {}
    } else {
      try {
        carMarkerRef.current.setPosition(new window.Tmapv2.LatLng(lat, lon));
      } catch {}
      try {
        if (title) {
          if (typeof carMarkerRef.current.setTitle === "function")
            carMarkerRef.current.setTitle(title);
          else
            carMarkerRef.current.options &&
              (carMarkerRef.current.options.title = title);
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
      setResults([]);
      setOpen(false);
      abortRef.current?.abort();
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
        const centerLat = center?._lat,
          centerLon = center?._lng;

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
            const latStr =
              p.frontLat ?? p.noorLat ?? p.lat ?? p.centerLat ?? p.newLat;
            const lonStr =
              p.frontLon ?? p.noorLon ?? p.lon ?? p.centerLon ?? p.newLon;
            const lat = toNum(latStr),
              lon = toNum(lonStr);
            return {
              id: p.id,
              name: p.name,
              addr:
                p?.newAddressList?.newAddress?.[0]?.fullAddressRoad ??
                [
                  p.upperAddrName,
                  p.middleAddrName,
                  p.lowerAddrName,
                  p.roadName,
                  p.buildingNo,
                ]
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
        if (e.name !== "AbortError") {
          console.error(e);
          setResults([]);
          setOpen(false);
        }
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  useEffect(() => {
    if (!selectedPlace) return;
    const map = mapRef.current;
    if (!map || !window.Tmapv2) return;
    const pos = new window.Tmapv2.LatLng(selectedPlace.lat, selectedPlace.lon);
    map.setCenter(pos);
    map.setZoom(16);
    try {
      if (destMarkerRef.current) destMarkerRef.current.setMap(null);
      destMarkerRef.current = new window.Tmapv2.Marker({
        position: pos,
        map,
        icon: ICONS.dest,
        title: selectedPlace.name,
      });
    } catch {}
    if (herePos) {
      drawRoute(herePos, {
        lat: selectedPlace.lat,
        lon: selectedPlace.lon,
      });
    }
  }, [selectedPlace, herePos]);

  useEffect(() => {
    if (herePos && lastCarPosRef.current) {
      drawCarToHereRoute(lastCarPosRef.current, herePos);
    }
  }, [herePos]);

  const drawRoute = async (start, end) => {
    try {
      if (!mapRef.current) return;
      const appKey = process.env.REACT_APP_TMAP_APPKEY;
      if (!appKey) return alert("TMAP AppKey가 없습니다.");
      if (![start, end].every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)))
        return;

      if (routeLineRef.current) {
        routeLineRef.current.halo?.setMap(null);
        routeLineRef.current.main?.setMap(null);
        routeLineRef.current = null;
      }

      const url = "https://apis.openapi.sk.com/tmap/routes?version=1&format=json";
      const body = {
        startX: start.lon,
        startY: start.lat,
        endX: end.lon,
        endY: end.lat,
        reqCoordType: "WGS84GEO",
        resCoordType: "WGS84GEO",
        trafficInfo: "Y",
      };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          appKey,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.error("경로 API 실패:", res.status, await res.text());
        return alert("경로 API 호출 실패");
      }

      const data = await res.json();
      const features = data?.features ?? [];
      const pts = [];
      for (const f of features) {
        if (f?.geometry?.type === "LineString") {
          for (const c of f.geometry.coordinates) {
            const x = Number(c[0]),
              y = Number(c[1]);
            if (Number.isFinite(x) && Number.isFinite(y))
              pts.push(new window.Tmapv2.LatLng(y, x));
          }
        }
      }
      if (!pts.length) return alert("경로 선 정보를 찾지 못했습니다.");

      const halo = new window.Tmapv2.Polyline({
        map: mapRef.current,
        path: pts,
        strokeColor: "#FFFFFF",
        strokeWeight: 10,
        strokeOpacity: 1,
        zIndex: 9998,
      });
      const main = new window.Tmapv2.Polyline({
        map: mapRef.current,
        path: pts,
        strokeColor: "#0066FF",
        strokeWeight: 6,
        strokeOpacity: 1,
        zIndex: 9999,
      });
      routeLineRef.current = { halo, main };

      const bounds = new window.Tmapv2.LatLngBounds();
      pts.forEach((p) => bounds.extend(p));
      mapRef.current.fitBounds(bounds);
    } catch (e) {
      console.error("경로 그리기 실패:", e);
      alert("경로를 불러오는 중 오류");
    }
  };

  const drawCarToHereRoute = async (start, end) => {
    try {
      if (!mapRef.current) return;
      const appKey = process.env.REACT_APP_TMAP_APPKEY;
      if (!appKey) return; // 조용히 무시
      if (![start, end].every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)))
        return;

      if (carRouteRef.current) {
        carRouteRef.current.halo?.setMap(null);
        carRouteRef.current.main?.setMap(null);
        carRouteRef.current = null;
      }

      const url = "https://apis.openapi.sk.com/tmap/routes?version=1&format=json";
      const body = {
        startX: Number(start.lon),
        startY: Number(start.lat),
        endX: Number(end.lon),
        endY: Number(end.lat),
        reqCoordType: "WGS84GEO",
        resCoordType: "WGS84GEO",
        trafficInfo: "N",
        searchOption: 0,
        startName: "차량",
        endName: "내 위치",
      };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          appKey,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.error("차→나 경로 실패:", res.status, await res.text());
        return;
      }

      const data = await res.json();
      const features = data?.features ?? [];
      const pts = [];
      for (const f of features) {
        if (f?.geometry?.type === "LineString") {
          for (const [lon, lat] of f.geometry.coordinates) {
            if (Number.isFinite(lon) && Number.isFinite(lat))
              pts.push(new window.Tmapv2.LatLng(lat, lon));
          }
        }
      }
      if (!pts.length) return;

      const halo = new window.Tmapv2.Polyline({
        map: mapRef.current,
        path: pts,
        strokeColor: "#FFFFFF",
        strokeWeight: 10,
        strokeOpacity: 1,
        zIndex: 9996,
      });
      const main = new window.Tmapv2.Polyline({
        map: mapRef.current,
        path: pts,
        strokeColor: "#FF2D55",
        strokeWeight: 6,
        strokeOpacity: 1,
        zIndex: 9997,
      });
      carRouteRef.current = { halo, main };
    } catch (e) {
      console.error("차→나 경로 그리기 실패:", e);
    }
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
    setQuery("");
    setResults([]);
    setOpen(false);
    setSelectedPlace(null);
    setStatus("");
    if (destMarkerRef.current) {
      destMarkerRef.current.setMap(null);
      destMarkerRef.current = null;
    }
    if (routeLineRef.current) {
      routeLineRef.current.halo?.setMap(null);
      routeLineRef.current.main?.setMap(null);
      routeLineRef.current = null;
    }
  };

  return (
    <div className="mainShell" onClick={() => setOpen(false)}>
      <div className="searchWrap" onClick={(e) => e.stopPropagation()}>
        <div className="searchBar">
          <span className="pin">📍</span>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              setOpen(Boolean(query));
            }}
            placeholder="도착지 검색(장소명)"
          />
          {query && (
            <button className="clearBtn" onClick={clearQuery} aria-label="지우기">
              ×
            </button>
          )}
        </div>
        {open && (results.length > 0 || loading) && (
          <div className="resultBox">
            {loading && <div className="hint">검색 중…</div>}
            {!loading &&
              results.map((r) => (
                <button
                  key={`${r.id}-${r.name}`}
                  className="resultItem"
                  onClick={() => pickResult(r)}
                >
                  <div className="rTitle">{r.name}</div>
                  <div className="rAddr">{r.addr}</div>
                </button>
              ))}
            {!loading && results.length === 0 && (
              <div className="hint">검색 결과가 없습니다</div>
            )}
          </div>
        )}
      </div>

      <div className="mapCanvas" ref={mapDivRef} />
      {status && <div className="mapStatus">{status}</div>}

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
      `}</style>
    </div>
  );
}
