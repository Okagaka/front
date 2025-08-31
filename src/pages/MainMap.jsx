// src/pages/MainMap.jsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/* =========================
   상수 & JWT/URL 유틸
   ========================= */
export const CAR_POS = Object.freeze({ lat: 37.5666805, lon: 126.9784147 });

// API_BASE가 있으면 절대 경로, 없으면 개발 프록시(/api/...) 사용
const API_BASE = (process.env.REACT_APP_API_BASE || "").replace(/\/$/, "");
const STT_URL = API_BASE ? `${API_BASE}/api/stt` : "/api/stt";

const setJwt = (t) => { try { if (t) sessionStorage.setItem("jwt", t); } catch {} };
const getJwt = () => {
  try {
    return (
      sessionStorage.getItem("jwt") ||
      localStorage.getItem("accessToken") || // ★ Login.jsx에서 저장
      (JSON.parse(sessionStorage.getItem("auth") || "{}")?.token) ||
      process.env.REACT_APP_TEST_JWT ||
      ""
    );
  } catch {
    return localStorage.getItem("accessToken") || "";
  }
};

/* =========================
   브라우저 마이크 → 16kHz WAV
   ========================= */
class WavRecorder {
  constructor(stream, ctx, source, proc) {
    this.stream = stream;
    this.ctx = ctx;
    this.source = source;
    this.proc = proc;
    this.chunks = [];
  }
  static async create() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC(); // 44.1k/48k
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1); // mono
    return new WavRecorder(stream, ctx, source, proc);
  }
  start() {
    this.chunks = [];
    this.proc.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(input)); // 복사
    };
    this.source.connect(this.proc);
    this.proc.connect(this.ctx.destination);
  }
  async stop() {
    this.proc.disconnect();
    this.source.disconnect();
    this.stream.getTracks().forEach(t => t.stop());
    try { await this.ctx.close(); } catch {}
    const sampleRate = this.ctx.sampleRate;
    let total = 0;
    for (const c of this.chunks) total += c.length;
    const buf = new Float32Array(total);
    let off = 0;
    for (const c of this.chunks) { buf.set(c, off); off += c.length; }
    const targetRate = 16000;
    const ds = downsampleBuffer(buf, sampleRate, targetRate);
    const wavAB = encodeWAV(ds, targetRate);
    return new Blob([wavAB], { type: "audio/wav" });
  }
}
function downsampleBuffer(buffer, srcRate, dstRate) {
  if (dstRate === srcRate) return buffer;
  const ratio = srcRate / dstRate;
  const newLen = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLen);
  let o = 0, i = 0;
  while (o < newLen) {
    const nextI = Math.round((o + 1) * ratio);
    let sum = 0, cnt = 0;
    for (; i < nextI && i < buffer.length; i++) { sum += buffer[i]; cnt++; }
    result[o++] = sum / (cnt || 1);
  }
  return result;
}
function encodeWAV(samples, sampleRate) {
  const bps = 2, blockAlign = bps * 1;
  const buffer = new ArrayBuffer(44 + samples.length * bps);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bps, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * bps, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}
function writeString(v, o, s) { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }

/* ========================= */
export default function MainMap() {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const didInitRef = useRef(false);

  // 마커/경로
  const hereMarkerRef = useRef(null);
  const destMarkerRef = useRef(null);
  const carMarkerRef = useRef(null);
  const routeLineRef = useRef(null);
  const carRouteRef = useRef(null);

  const [herePos, setHerePos] = useState(null);
  const [status, setStatus] = useState("지도 로딩 중…");

  // 검색 상태
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState(null);

  // 드로어/라우팅
  const [drawerOpen, setDrawerOpen] = useState(false);
  const nav = useNavigate();
  const { state } = useLocation(); // { name, phone, token? }

  // 음성 인식 상태
  const [recorder, setRecorder] = useState(null);
  const [recState, setRecState] = useState("idle"); // idle | recording | uploading
  const uploadAbortRef = useRef(null);

  /* === 녹음 시작 === */
  const startRecording = async () => {
    if (recState !== "idle") return;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert("이 브라우저는 마이크 녹음을 지원하지 않습니다."); return;
      }
      const rec = await WavRecorder.create();
      rec.start();
      setRecorder(rec);
      setRecState("recording");
      setStatus("듣는 중… 마이크에 말씀해 주세요 (최대 8초)");
    } catch (e) {
      console.error(e);
      alert("마이크 접근에 실패했습니다. 브라우저 권한을 확인하세요.");
    }
  };

  /* === 녹음 종료 + 업로드 (FormData file=.wav + Authorization) === */
  const stopAndTranscribe = useCallback(async () => {
    if (recState !== "recording" || !recorder) return;
    try {
      setRecState("uploading");
      setStatus("음성 업로드 중…");

      const wavBlob = await recorder.stop();
      // FormData에 .wav 파일로 첨부 (파일명 확장자 꼭 .wav)
      const wavFile = new File([wavBlob], "speech.wav", { type: "audio/wav" });

      // 디버그: 크기/유형 확인
      console.log(`[WAV] size: ${wavFile.size} bytes, type: ${wavFile.type}`);

      const token = getJwt();
      if (!token) {
        setStatus("로그인이 필요합니다.");
        alert("로그인이 필요합니다. 다시 로그인해 주세요.");
        return;
      }

      const form = new FormData();
      form.append("file", wavFile); // ★ 서버 명세: 필드명은 정확히 'file'

      const controller = new AbortController();
      uploadAbortRef.current = controller;

      const res = await fetch(STT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`, // ★ 오직 Authorization만 설정
          // Content-Type은 설정하지 않음(FormData가 boundary 포함해서 자동 설정)
        },
        body: form,
        signal: controller.signal,
      });

      // 5xx는 서버 문제라 텍스트 먼저 확인
      if (res.status >= 500) {
        const txt = await res.text().catch(() => "");
        alert("서버 내부 오류가 발생했습니다. (STT)\n개발자 콘솔 로그를 확인해 주세요.");
        setStatus("");
        return;
      }

      // 보통 JSON: { status:200, message:"...", data:"문장" }
      let payload;
      try { payload = await res.json(); }
      catch { payload = { message: "Invalid JSON", data: "" }; }

      if (!res.ok) {
        const msg = payload?.message || `STT 실패: ${res.status}`;
        throw new Error(msg);
      }

      const text = payload?.data || payload?.text || "";
      console.log("[STT response]", payload);
      if (text) {
        setStatus("인식 완료");
        setQuery(text);   // 검색창에 넣어줌 (원하시면 다른 곳에 활용)
        setOpen(true);
      } else {
        setStatus("음성을 인식하지 못했어요. 다시 말씀해 주세요.");
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        console.error(e);
        alert(e.message || "음성 인식 중 오류가 발생했습니다.");
      }
    } finally {
      setRecState("idle");
      setRecorder(null);
      uploadAbortRef.current = null;
    }
  }, [recState, recorder]);

  // 8초 자동 종료
  useEffect(() => {
    if (recState !== "recording") return;
    const t = setTimeout(stopAndTranscribe, 8000);
    return () => clearTimeout(t);
  }, [recState, stopAndTranscribe]);

  // 🎤 버튼 토글
  const onMicClick = async (e) => {
    e.stopPropagation();
    if (recState === "idle") return startRecording();
    if (recState === "recording") return stopAndTranscribe();
    if (recState === "uploading") uploadAbortRef.current?.abort();
  };

  /* ===== 로그인 정보 수신/복구 ===== */
  useEffect(() => {
    if (state?.name && state?.phone) {
      if (state?.token) setJwt(state.token);
      try { sessionStorage.setItem("auth", JSON.stringify(state)); } catch {}
      return;
    }
    const saved = sessionStorage.getItem("auth");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed?.name && parsed?.phone) return;
      } catch {}
    }
    nav("/", { replace: true });
  }, [state, nav]);

  // ESC로 드로어 닫기
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ───────────── 지도 초기화 ───────────── */
  useEffect(() => {
    const init = () => {
      if (didInitRef.current) return;
      if (!window.Tmapv2) { setStatus("지도 로드 실패: Tmapv2가 없습니다."); return; }
      const { Tmapv2 } = window;

      if (mapRef.current?.destroy) { try { mapRef.current.destroy(); } catch {} }

      const map = new Tmapv2.Map(mapDivRef.current, {
        center: new Tmapv2.LatLng(37.5666805, 126.9784147),
        width: "100%", height: "100%", zoom: 15,
      });
      mapRef.current = map;
      didInitRef.current = true;

      try {
        carMarkerRef.current = new Tmapv2.Marker({
          position: new Tmapv2.LatLng(CAR_POS.lat, CAR_POS.lon),
          map, icon: `${process.env.PUBLIC_URL}/images/Car.png`, title: "차량",
        });
      } catch (e) { console.error("차량 마커 생성 오류:", e); }

      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          ({ coords }) => {
            const here = new Tmapv2.LatLng(coords.latitude, coords.longitude);
            map.setCenter(here);
            try {
              hereMarkerRef.current = new Tmapv2.Marker({
                position: here, map,
                icon: `${process.env.PUBLIC_URL}/images/pin_r.png`,
                title: "현재 위치",
              });
              setHerePos({ lat: coords.latitude, lon: coords.longitude });
            } catch (e) { console.error("현재 위치 마커 생성 오류:", e); }
            setStatus("");
          },
          (err) => { console.warn("위치 권한/획득 실패:", err); setStatus("현재 위치를 가져오지 못했습니다."); },
          { enableHighAccuracy: true, timeout: 8000 }
        );
      } else { setStatus(""); }
    };

    if (window.Tmapv2) init();
    else {
      const tag = document.getElementById("tmap-js-sdk");
      if (!tag) return setStatus("index.html의 Tmap 스크립트를 확인하세요.");
      const onLoad = () => init();
      tag.addEventListener("load", onLoad);
      setTimeout(() => window.Tmapv2 && init(), 0);
      return () => tag.removeEventListener("load", onLoad);
    }
  }, []);

  /* ───────────── POI 검색 ───────────── */
  const debounceRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    const keyword = query.trim();
    if (!keyword) {
      setResults([]); setOpen(false); abortRef.current?.abort(); return;
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
              id: p.id, name: p.name,
              addr: p?.newAddressList?.newAddress?.[0]?.fullAddressRoad ??
                [p.upperAddrName, p.middleAddrName, p.lowerAddrName, p.roadName, p.buildingNo].filter(Boolean).join(" "),
              lat, lon, _raw: p,
            };
          })
          .filter((it) => Number.isFinite(it.lat) && Number.isFinite(it.lon));

        setResults(items); setOpen(true);
      } catch (e) {
        if (e.name !== "AbortError") { console.error(e); setResults([]); setOpen(false); }
      } finally { setLoading(false); }
    }, 250);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  /* ───────────── 목적지 선택 시 경로 ───────────── */
  useEffect(() => {
    if (!selectedPlace) return;
    const map = mapRef.current;
    if (!map || !window.Tmapv2) { console.error("맵/Tmapv2 없음"); return; }
    const { Tmapv2 } = window;
    const pos = new Tmapv2.LatLng(selectedPlace.lat, selectedPlace.lon);
    map.setCenter(pos); map.setZoom(16);

    try {
      if (destMarkerRef.current) destMarkerRef.current.setMap(null);
      destMarkerRef.current = new Tmapv2.Marker({
        position: pos, map, icon: `${process.env.PUBLIC_URL}/images/pin_b.png`,
        title: selectedPlace.name,
      });
    } catch (e) { console.error("목적지 마커 오류:", e); }

    if (herePos) drawRoute(herePos, { lat: selectedPlace.lat, lon: selectedPlace.lon });
  }, [selectedPlace, herePos]);

  /* ───────────── 차량→나 경로 ───────────── */
  useEffect(() => {
    if (!herePos) return;
    drawCarToHereRoute(CAR_POS, herePos);
  }, [herePos]);

  /* ---- 파란 경로 ---- */
  const drawRoute = async (start, end) => {
    try {
      if (!mapRef.current) return console.warn("mapRef 없음");
      const appKey = process.env.REACT_APP_TMAP_APPKEY;
      if (!appKey) return alert("TMAP AppKey가 없습니다. .env에 REACT_APP_TMAP_APPKEY를 설정하세요.");
      if (![start, end].every(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))) return;

      if (routeLineRef.current) {
        routeLineRef.current.halo?.setMap(null);
        routeLineRef.current.main?.setMap(null);
        routeLineRef.current = null;
      }

      const url = "https://apis.openapi.sk.com/tmap/routes?version=1&format=json";
      const body = {
        startX: start.lon, startY: start.lat, endX: end.lon, endY: end.lat,
        reqCoordType: "WGS84GEO", resCoordType: "WGS84GEO", trafficInfo: "Y",
      };

      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", appKey },
        body: JSON.stringify(body),
      });
      if (!res.ok) { console.error("경로 API 실패:", res.status, await res.text()); return alert("경로 API 호출 실패"); }

      const data = await res.json();
      const features = data?.features ?? [];
      const linePoints = [];
      for (const f of features) {
        if (f?.geometry?.type === "LineString") {
          for (const c of f.geometry.coordinates) {
            const x = Number(c[0]), y = Number(c[1]);
            if (Number.isFinite(x) && Number.isFinite(y)) linePoints.push(new window.Tmapv2.LatLng(y, x));
          }
        }
      }
      if (!linePoints.length) return alert("경로 선 정보를 찾지 못했습니다.");

      const haloLine = new window.Tmapv2.Polyline({
        map: mapRef.current, path: linePoints, strokeColor: "#FFFFFF", strokeWeight: 10, strokeOpacity: 1, zIndex: 9998,
      });
      const mainLine = new window.Tmapv2.Polyline({
        map: mapRef.current, path: linePoints, strokeColor: "#0066FF", strokeWeight: 6, strokeOpacity: 1, zIndex: 9999,
      });
      routeLineRef.current = { main: mainLine, halo: haloLine };

      const bounds = new window.Tmapv2.LatLngBounds();
      linePoints.forEach(p => bounds.extend(p));
      mapRef.current.fitBounds(bounds);
    } catch (e) { console.error("경로 그리기 실패:", e); alert("경로를 불러오는 중 오류"); }
  };

  /* ---- 빨간 경로 ---- */
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
      const body = {
        startX: Number(start.lon), startY: Number(start.lat),
        endX: Number(end.lon), endY: Number(end.lat),
        reqCoordType: "WGS84GEO", resCoordType: "WGS84GEO",
        trafficInfo: "N", searchOption: 0, startName: "차량", endName: "내 위치",
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
        map: mapRef.current, path: pts, strokeColor: "#FFFFFF", strokeWeight: 10, strokeOpacity: 1, zIndex: 9996,
      });
      const main = new window.Tmapv2.Polyline({
        map: mapRef.current, path: pts, strokeColor: "#FF2D55", strokeWeight: 6, strokeOpacity: 1, zIndex: 9997,
      });
      carRouteRef.current = { halo, main };
    } catch (e) { console.error("차→나 경로 그리기 실패:", e); }
  };

  /* ───────────── 핸들러/뷰 ───────────── */
  const pickResult = (item) => {
    setQuery(item.name); setOpen(false);
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return alert("선택한 장소의 좌표가 없습니다.");
    setSelectedPlace(item);
  };
  const clearQuery = () => {
    setQuery(""); setResults([]); setOpen(false); setSelectedPlace(null); setStatus("");
    if (destMarkerRef.current) { destMarkerRef.current.setMap(null); destMarkerRef.current = null; }
    if (routeLineRef.current) { routeLineRef.current.halo?.setMap(null); routeLineRef.current.main?.setMap(null); routeLineRef.current = null; }
  };

  return (
    <div className="mainShell" onClick={() => setOpen(false)}>
      <header className="appBar">
        <button className="appIcon" aria-label="메뉴"
          onClick={(e) => { e.stopPropagation(); setDrawerOpen(true); }}>☰</button>
        <div className="appTitle">오카가카</div>
        <button
          className="appIcon"
          aria-label="음성"
          onClick={onMicClick}
          disabled={recState === "uploading"}
          title={recState === "idle" ? "눌러서 말하기 시작" :
                 recState === "recording" ? "다시 눌러서 종료" : "업로드 중…"}
        >
          {recState === "recording" ? "⏺" : "🎤"}
        </button>
      </header>

      <div className={`backdrop ${drawerOpen ? "show" : ""}`} onClick={() => setDrawerOpen(false)} />
      <aside className={`drawer ${drawerOpen ? "open" : ""}`} onClick={(e) => e.stopPropagation()} aria-label="사이드 메뉴">
        <div className="drawerHeader">
          <div className="brandRow"><span className="car">🚗</span><strong>오카가카</strong></div>
          <button className="closeBtn" onClick={() => setDrawerOpen(false)}>×</button>
        </div>
        <nav className="menuList">
          <button className="menuItem" onClick={() => { setDrawerOpen(false); nav("/"); }}>
            <span className="miIcon">🏠</span><span>홈 화면</span>
          </button>
          <button className="menuItem" onClick={() => { setDrawerOpen(false); nav("/reserve"); }}>
            <span className="miIcon">📅</span><span>차량 예약</span>
          </button>
          <button className="menuItem" onClick={() => { setDrawerOpen(false); nav("/history"); }}>
            <span className="miIcon">🧾</span><span>이용 내역</span>
          </button>
          <button className="menuItem" onClick={() => { setDrawerOpen(false); nav("/me"); }}>
            <span className="miIcon">👤</span><span>내 정보</span>
          </button>
          <hr className="menuDivider" />
          <button className="menuItem danger" onClick={() => {
            setDrawerOpen(false); sessionStorage.removeItem("auth"); alert("로그아웃 되었습니다."); nav("/", { replace: true });
          }}>
            <span className="miIcon">↩</span><span>로그아웃</span>
          </button>
        </nav>
      </aside>

      <div className="searchWrap" onClick={(e) => e.stopPropagation()}>
        <div className="searchBar">
          <span className="pin">📍</span>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => query && setOpen(true)}
            placeholder="도착지 검색(장소명)"
          />
          {query && <button className="clearBtn" onClick={clearQuery} aria-label="지우기">×</button>}
        </div>
        {(open && (results.length > 0 || loading)) && (
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

      <style>{`
        .mainShell{ min-height:100dvh; display:flex; flex-direction:column; position:relative; overflow:hidden; }
        .appBar{ height:56px; background:#6a34d6; color:#fff; padding:0 12px; display:flex; align-items:center; gap:12px; }
        .appTitle{ flex:1; text-align:center; font-weight:800; letter-spacing:.5px; }
        .appIcon{ width:40px; height:40px; border:none; background:transparent; color:#fff; font-size:22px; cursor:pointer; }
        .mapCanvas{ flex:1; }
        .mapStatus{ position:absolute; top:64px; left:0; right:0; text-align:center; font-weight:700; color:#555; }
        .backdrop{ position:absolute; inset:0; background:rgba(0,0,0,0); opacity:0; pointer-events:none; transition:opacity .2s; z-index:40; border-radius:inherit; }
        .backdrop.show{ opacity:.35; background:rgba(0,0,0,.45); pointer-events:auto; }
        .drawer{ position:absolute; top:0; bottom:0; left:0; width:min(78vw,320px); background:#fff; box-shadow:6px 0 22px rgba(0,0,0,.18);
                 transform:translateX(-110%); transition:transform .22s; z-index:50; display:flex; flex-direction:column; }
        .drawer.open{ transform:translateX(0); }
        .drawerHeader{ display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid #f0f0f3; }
        .brandRow{ display:flex; align-items:center; gap:8px; font-size:16px; }
        .closeBtn{ width:36px; height:36px; border:none; border-radius:10px; background:#f5f5f7; font-size:20px; cursor:pointer; }
        .menuList{ padding:8px 6px; display:flex; flex-direction:column; gap:2px; }
        .menuItem{ display:flex; align-items:center; gap:12px; width:100%; padding:12px; background:#fff; border:none; cursor:pointer; border-radius:12px; font-size:15px; }
        .menuItem:hover{ background:#f7f4ff; }
        .menuItem .miIcon{ width:24px; text-align:center; font-size:18px; }
        .menuDivider{ border:none; border-top:1px solid #eee; margin:8px 6px; }
        .menuItem.danger{ color:#7b2bd5; font-weight:700; }
        .searchWrap{ position:absolute; left:12px; right:12px; top:64px; z-index:10; display:flex; flex-direction:column; gap:8px; }
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
      `}</style>
    </div>
  );
}
