// src/pages/MainMap.jsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import LocationSharing from "../components/LocationSharing";


export const CAR_POS = Object.freeze({ lat: 37.5666805, lon: 126.9784147 });
const API_BASE = (process.env.REACT_APP_API_BASE || "").replace(/\/$/, "");
const STT_URL = API_BASE ? `${API_BASE}/api/stt` : "/api/stt";

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

/* ====== 녹음기 ====== (생략 없이 그대로) */
class WavRecorder {
  constructor(stream, ctx, source, proc) { this.stream=stream; this.ctx=ctx; this.source=source; this.proc=proc; this.chunks=[]; }
  static async create(){ const s=await navigator.mediaDevices.getUserMedia({audio:true}); const AC=window.AudioContext||window.webkitAudioContext; const ctx=new AC(); const src=ctx.createMediaStreamSource(s); const p=ctx.createScriptProcessor(4096,1,1); return new WavRecorder(s,ctx,src,p); }
  start(){ this.chunks=[]; this.proc.onaudioprocess=(e)=>{ const i=e.inputBuffer.getChannelData(0); this.chunks.push(new Float32Array(i)); }; this.source.connect(this.proc); this.proc.connect(this.ctx.destination); }
  async stop(){ this.proc.disconnect(); this.source.disconnect(); this.stream.getTracks().forEach(t=>t.stop()); try{await this.ctx.close();}catch{} const rate=this.ctx.sampleRate; let total=0; for(const c of this.chunks) total+=c.length; const buf=new Float32Array(total); let off=0; for(const c of this.chunks){ buf.set(c,off); off+=c.length; } const ds=downsampleBuffer(buf,rate,16000); const wavAB=encodeWAV(ds,16000); return new Blob([wavAB],{type:"audio/wav"}); }
}
function downsampleBuffer(buffer,srcRate,dstRate){ if(dstRate===srcRate) return buffer; const r=srcRate/dstRate; const len=Math.round(buffer.length/r); const out=new Float32Array(len); let o=0,i=0; while(o<len){ const next=Math.round((o+1)*r); let sum=0,cnt=0; for(; i<next && i<buffer.length; i++){ sum+=buffer[i]; cnt++; } out[o++]=sum/(cnt||1); } return out; }
function encodeWAV(samples,sampleRate){ const bps=2,ba=bps*1; const buf=new ArrayBuffer(44+samples.length*bps); const v=new DataView(buf); const ws=(s,o)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));}; ws("RIFF",0); v.setUint32(4,36+samples.length*bps,true); ws("WAVE",8); ws("fmt ",12); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,sampleRate,true); v.setUint32(28,sampleRate*ba,true); v.setUint16(32,ba,true); v.setUint16(34,16,true); ws("data",36); v.setUint32(40,samples.length*bps,true); let off=44; for(let i=0;i<samples.length;i++,off+=2){ let s=Math.max(-1,Math.min(1,samples[i])); v.setInt16(off,s<0?s*0x8000:s*0x7fff,true);} return buf; }

/* ====== Tmap SDK 준비 보장 유틸 ======
   document.write로 내부 스크립트를 추가하기 때문에,
   <script id="tmap-js-sdk">의 load 직후엔 아직 Tmapv2가 완전히 준비되지 않을 수 있음.
   아래 폴링으로 Tmapv2.LatLng / Tmapv2.Map이 실제 생성자일 때까지 대기. */
function waitForTmapV2({ timeoutMs = 12000, intervalMs = 50 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const T = window.Tmapv2;
      const ok =
        T &&
        typeof T.Map === "function" &&
        typeof T.LatLng === "function" &&
        // 어떤 환경에서는 함수 객체지만 constructor 프로퍼티가 없는 경우가 있었음 → instanceof Function으로 넉넉히 체크
        T.Map.prototype &&
        T.LatLng.prototype;
      if (ok) return resolve(T);
      if (Date.now() - start > timeoutMs)
        return reject(new Error("Tmap SDK not ready"));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

export default function MainMap() {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const didInitRef = useRef(false);

  const hereMarkerRef = useRef(null);
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

  // 📡 수신 로그 (가족 마커는 LocationSharing이 자동 표시)
  const handleIncomingLocation = useCallback((msg) => {
    console.log("📡 그룹 위치 수신:", msg);
  }, []);

  // 하단 시간 카드 상태 + 복원용 버퍼
  const [compare, setCompare] = useState(null);
  const compareRef = useRef(null);
  const compareBackupRef = useRef(null);
  const drawerHidCompareRef = useRef(false);
  useEffect(() => { compareRef.current = compare; }, [compare]);

  // AppShell에서 쏘는 드로어 열림/닫힘 이벤트 구독
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

  // 로그인 체크/복구
  useEffect(() => {
    if (state?.name && state?.phone) {
      if (state?.token) setJwt(state.token);
      try { sessionStorage.setItem("auth", JSON.stringify(state)); } catch {}
      return;
    }
    const saved = sessionStorage.getItem("auth");
    if (saved) {
      try { const p = JSON.parse(saved); if (p?.name && p?.phone) return; } catch {}
    }
    nav("/", { replace: true });
  }, [state, nav]);

  // 지도 초기화 (SDK 준비 보장 후 실행)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const tag = document.getElementById("tmap-js-sdk");
      if (!tag) {
        setStatus("index.html의 Tmap 스크립트를 확인하세요. (id='tmap-js-sdk')");
        return;
      }

      try {
        // 스크립트 load 이벤트만 믿지 말고, 실제 생성자 준비까지 대기
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

        try {
          carMarkerRef.current = new window.Tmapv2.Marker({
            position: new window.Tmapv2.LatLng(CAR_POS.lat, CAR_POS.lon),
            map,
            icon: `${process.env.PUBLIC_URL}/images/Car.png`,
            title: "차량",
          });
        } catch (e) {}

        if ("geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(
            ({ coords }) => {
              const here = new window.Tmapv2.LatLng(coords.latitude, coords.longitude);
              map.setCenter(here);
              try {
                hereMarkerRef.current = new window.Tmapv2.Marker({
                  position: here,
                  map,
                  icon: `${process.env.PUBLIC_URL}/images/pin_r.png`,
                  title: "현재 위치",
                });
                setHerePos({ lat: coords.latitude, lon: coords.longitude });
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
        position: pos, map, icon: `${process.env.PUBLIC_URL}/images/pin_b.png`, title: selectedPlace.name,
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
      {/* ✅ 가족 위치 자동 마커 표시 (pin_o.png / pin_y.png) */}
      <LocationSharing mapRef={mapRef} onIncoming={handleIncomingLocation} />

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
