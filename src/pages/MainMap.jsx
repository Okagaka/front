// src/pages/MainMap.jsx
import React, { useEffect, useRef, useState } from "react";

export default function MainMap() {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const didInitRef = useRef(false);

  // 마커들
  const hereMarkerRef = useRef(null);
  const destMarkerRef = useRef(null);
  const carMarkerRef = useRef(null);       // 🚗 차량 마커

  // 경로들
  const routeLineRef = useRef(null);       // 🔵 내 위치 → 목적지 {main, halo}
  const carRouteRef = useRef(null);        // 🔴 차량 → 내 위치 {main, halo}

  // 하드코딩 차량 위치(서울시청)
  const CAR_POS = { lat: 37.5666805, lon: 126.9784147 };

  const [herePos, setHerePos] = useState(null); // { lat, lon }
  const [status, setStatus] = useState("지도 로딩 중…");

  // 검색 상태
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // 선택된 장소 상태
  const [selectedPlace, setSelectedPlace] = useState(null);

  /* ───────────── 1) 지도 초기화 ───────────── */
  useEffect(() => {
    const init = () => {
      if (didInitRef.current) return;
      if (!window.Tmapv2) {
        setStatus("지도 로드 실패: Tmapv2가 없습니다.");
        return;
      }
      const { Tmapv2 } = window;

      // 기존 맵 안전 파괴
      if (mapRef.current?.destroy) {
        try { mapRef.current.destroy(); } catch {}
      }

      const map = new Tmapv2.Map(mapDivRef.current, {
        center: new Tmapv2.LatLng(37.5666805, 126.9784147),
        width: "100%",
        height: "100%",
        zoom: 15,
      });
      mapRef.current = map;
      didInitRef.current = true;

      // 🚗 차량 마커(시청)
      try {
        carMarkerRef.current = new Tmapv2.Marker({
          position: new Tmapv2.LatLng(CAR_POS.lat, CAR_POS.lon),
          map,
          // 필요 시 /public/images/car.png 로 교체
          // icon: `${process.env.PUBLIC_URL}/images/car.png`,
          icon: `${process.env.PUBLIC_URL}/images/Car.png`,
          title: "차량",
        });
      } catch (e) {
        console.error("차량 마커 생성 오류:", e);
      }

      // 현재 위치로 이동
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          ({ coords }) => {
            const here = new Tmapv2.LatLng(coords.latitude, coords.longitude);
            map.setCenter(here);

            try {
              hereMarkerRef.current = new Tmapv2.Marker({
                position: here,
                map,
                icon: `${process.env.PUBLIC_URL}/images/pin_r.png`,
                title: "현재 위치",
              });
              // 경로 API용 현재 좌표 저장
              setHerePos({ lat: coords.latitude, lon: coords.longitude });
            } catch (e) {
              console.error("현재 위치 마커 생성 오류:", e);
            }
            setStatus("");
          },
          (err) => {
            console.warn("위치 권한/획득 실패:", err);
            setStatus("현재 위치를 가져오지 못했습니다.");
          },
          { enableHighAccuracy: true, timeout: 8000 }
        );
      } else {
        setStatus("");
      }
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

  /* ───────────── 2) 장소(POI) 검색 ───────────── */
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

        // 이전 요청 취소
        abortRef.current?.abort();
        abortRef.current = new AbortController();

        const appKey = process.env.REACT_APP_TMAP_APPKEY;

        const center = mapRef.current?.getCenter?.();
        const centerLat = center?._lat;
        const centerLon = center?._lng;

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
            const lat = toNum(latStr);
            const lon = toNum(lonStr);
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

  /* ───────────── 3) 장소 선택 → 목적지 마커(B) + 파란 경로 ───────────── */
  useEffect(() => {
    if (!selectedPlace) return;

    const map = mapRef.current;
    if (!map || !window.Tmapv2) {
      console.error("맵 객체 또는 Tmapv2 라이브러리가 없습니다.");
      return;
    }

    const { Tmapv2 } = window;
    const pos = new Tmapv2.LatLng(selectedPlace.lat, selectedPlace.lon);

    // 지도 이동 및 줌
    map.setCenter(pos);
    map.setZoom(16);

    // B 마커 생성
    try {
      if (destMarkerRef.current) destMarkerRef.current.setMap(null);
      destMarkerRef.current = new Tmapv2.Marker({
        position: pos,
        map,
        icon: `${process.env.PUBLIC_URL}/images/pin_b.png`,
        title: selectedPlace.name,
      });
    } catch (e) {
      console.error("목적지 마커 생성 오류:", e);
    }

    // herePos 준비되면 내 위치 → 목적지(파란선)
    if (herePos) {
      drawRoute(herePos, { lat: selectedPlace.lat, lon: selectedPlace.lon });
    }
  }, [selectedPlace, herePos]);

  /* ───────────── 3.5) herePos 준비되면 차량→나(빨간선) ───────────── */
  useEffect(() => {
    if (!herePos) return;
    drawCarToHereRoute(CAR_POS, herePos);
  }, [herePos]);

  /* ───────────── 4) 파란 경로(내 위치 → 목적지) ───────────── */
  const drawRoute = async (start, end) => {
    try {
      if (!mapRef.current) {
        console.warn("mapRef가 없어 경로를 그릴 수 없습니다(초기화 가드 확인).");
        return;
      }
      const appKey = process.env.REACT_APP_TMAP_APPKEY;
      if (!appKey) {
        alert("TMAP AppKey가 없습니다. .env에 REACT_APP_TMAP_APPKEY를 설정하세요.");
        return;
      }
      if (
        !Number.isFinite(start.lat) || !Number.isFinite(start.lon) ||
        !Number.isFinite(end.lat)   || !Number.isFinite(end.lon)
      ) {
        console.warn("경로 좌표 유효하지 않음:", { start, end });
        return;
      }

      // 이전 파란 라인 제거
      if (routeLineRef.current) {
        routeLineRef.current.halo?.setMap(null);
        routeLineRef.current.main?.setMap(null);
        routeLineRef.current = null;
      }

      const url = "https://apis.openapi.sk.com/tmap/routes?version=1&format=json";
      const body = {
        startX: start.lon,
        startY: start.lat,
        endX:   end.lon,
        endY:   end.lat,
        reqCoordType: "WGS84GEO",
        resCoordType: "WGS84GEO",
        trafficInfo: "Y",
        // searchOption: "0",
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
        const t = await res.text();
        console.error("경로 API 실패:", res.status, t);
        alert("경로 API 호출 실패(콘솔 참조).");
        return;
      }

      const data = await res.json();
      const features = data?.features ?? [];

      const linePoints = [];
      for (const f of features) {
        if (f?.geometry?.type === "LineString" && Array.isArray(f.geometry.coordinates)) {
          for (const c of f.geometry.coordinates) {
            const x = Number(c[0]); // lon
            const y = Number(c[1]); // lat
            if (Number.isFinite(x) && Number.isFinite(y)) {
              linePoints.push(new window.Tmapv2.LatLng(y, x));
            }
          }
        }
      }
      if (!linePoints.length) {
        console.warn("LineString 없음. geometry types:", features.map(f => f?.geometry?.type));
        alert("경로 선 정보를 찾지 못했습니다.");
        return;
      }

      // 흰 아웃라인 + 파란 본선
      const haloLine = new window.Tmapv2.Polyline({
        map: mapRef.current,
        path: linePoints,
        strokeColor: "#FFFFFF",
        strokeWeight: 10,
        strokeOpacity: 1,
        zIndex: 9998,
      });
      const mainLine = new window.Tmapv2.Polyline({
        map: mapRef.current,
        path: linePoints,
        strokeColor: "#0066FF",
        strokeWeight: 6,
        strokeOpacity: 1,
        zIndex: 9999,
      });
      try {
        haloLine.setOptions?.({ strokeColor: "#FFFFFF", strokeWeight: 10, strokeOpacity: 1, zIndex: 9998 });
        mainLine.setOptions?.({ strokeColor: "#0066FF", strokeWeight: 6, strokeOpacity: 1, zIndex: 9999 });
      } catch {}

      routeLineRef.current = { main: mainLine, halo: haloLine };

      // 파란 라인 기준 화면 맞춤
      const bounds = new window.Tmapv2.LatLngBounds();
      linePoints.forEach(p => bounds.extend(p));
      mapRef.current.fitBounds(bounds);
    } catch (e) {
      console.error("경로 그리기 실패:", e);
      alert("경로를 불러오는 중 오류(콘솔 참조).");
    }
  };

  /* ───────────── 4.5) 빨간 경로(차량 → 내 위치) ───────────── */
  const drawCarToHereRoute = async (start, end) => {
    try {
      if (!mapRef.current) return;
      const appKey = process.env.REACT_APP_TMAP_APPKEY;
      if (!appKey) return alert("TMAP AppKey가 없습니다.");

      if (
        !Number.isFinite(start.lat) || !Number.isFinite(start.lon) ||
        !Number.isFinite(end.lat)   || !Number.isFinite(end.lon)
      ) return;

      // 기존 빨간 라인 제거
      if (carRouteRef.current) {
        carRouteRef.current.halo?.setMap(null);
        carRouteRef.current.main?.setMap(null);
        carRouteRef.current = null;
      }

      const url = "https://apis.openapi.sk.com/tmap/routes?version=1&format=json";
      const body = {
        startX: Number(start.lon),
        startY: Number(start.lat),
        endX:   Number(end.lon),
        endY:   Number(end.lat),
        reqCoordType: "WGS84GEO",
        resCoordType: "WGS84GEO",
        trafficInfo: "N",
        searchOption: 0,
        startName: "차량",
        endName:   "내 위치",
      };

      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", appKey },
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
            if (Number.isFinite(lon) && Number.isFinite(lat)) {
              pts.push(new window.Tmapv2.LatLng(lat, lon));
            }
          }
        }
      }
      if (!pts.length) return;

      // 흰 아웃라인 + 빨간 본선
      const halo = new window.Tmapv2.Polyline({
        map: mapRef.current, path: pts, strokeColor: "#FFFFFF", strokeWeight: 10, strokeOpacity: 1, zIndex: 9996,
      });
      const main = new window.Tmapv2.Polyline({
        map: mapRef.current, path: pts, strokeColor: "#FF2D55", strokeWeight: 6, strokeOpacity: 1, zIndex: 9997,
      });
      carRouteRef.current = { halo, main };
      // fitBounds는 생략(파란 경로 UX 유지)
    } catch (e) {
      console.error("차→나 경로 그리기 실패:", e);
    }
  };

  /* ───────────── 5) 핸들러들 ───────────── */
  const pickResult = (item) => {
    setQuery(item.name);
    setOpen(false);

    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) {
      alert("선택한 장소의 좌표가 없습니다. 다른 항목을 선택해 주세요.");
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

    // 목적지/파란 경로만 초기화 (빨간 경로는 유지)
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

  /* ───────────── UI ───────────── */
  return (
    <div className="mainShell" onClick={() => setOpen(false)}>
      <header className="appBar">
        <button className="appIcon" aria-label="메뉴">≡</button>
        <div className="appTitle">오카가카</div>
        <button className="appIcon" aria-label="음성">🎤</button>
      </header>

      {/* 검색 바 + 결과 드롭다운 */}
      <div className="searchWrap" onClick={(e) => e.stopPropagation()}>
        <div className="searchBar">
          <span className="pin">📍</span>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => query && setOpen(true)}
            placeholder="도착지 검색(장소명)"
          />
          {query && (
            <button className="clearBtn" onClick={clearQuery} aria-label="지우기">×</button>
          )}
        </div>

        {(open && (results.length > 0 || loading)) && (
          <div className="resultBox">
            {loading && <div className="hint">검색 중…</div>}
            {!loading && results.map((r) => (
              <button
                key={`${r.id}-${r.name}`}
                className="resultItem"
                onClick={() => pickResult(r)}
              >
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
        .mainShell{ min-height:100dvh; display:flex; flex-direction:column; position:relative; }
        .appBar{ height:56px; background:#6a34d6; color:#fff; padding:0 12px; display:flex; align-items:center; gap:12px; }
        .appTitle{ flex:1; text-align:center; font-weight:800; letter-spacing:.5px; }
        .appIcon{ width:40px; height:40px; border:none; background:transparent; color:#fff; font-size:22px; cursor:pointer; }
        .mapCanvas{ flex:1; }
        .mapStatus{ position:absolute; top:64px; left:0; right:0; text-align:center; font-weight:700; color:#555; }

        .searchWrap{ position:absolute; left:12px; right:12px; top:64px; z-index:10; display:flex; flex-direction:column; gap:8px; }
        .searchBar{
          display:flex; align-items:center; gap:8px;
          background:#fff; border-radius:12px; padding:10px 12px;
          border:1px solid #e5e6ea; box-shadow:0 6px 18px rgba(0,0,0,.12);
        }
        .searchBar input{ flex:1; border:none; outline:none; font-size:15px; }
        .pin{ opacity:.7; }
        .clearBtn{ border:none; background:transparent; font-size:22px; line-height:1; cursor:pointer; opacity:.55; }

        .resultBox{
          background:#fff; border:1px solid #e5e6ea; border-radius:12px;
          box-shadow:0 10px 24px rgba(0,0,0,.12);
          max-height:320px; overflow:auto;
        }
        .resultItem{ width:100%; text-align:left; padding:10px 12px; background:#fff; border:none; border-bottom:1px solid #f4f5f8; cursor:pointer; }
        .resultItem:hover{ background:#f8f7ff; }
        .rTitle{ font-weight:700; }
        .rAddr{ color:#666; font-size:12px; margin-top:2px; }
        .hint{ padding:10px 12px; color:#666; font-size:13px; }
      `}</style>
    </div>
  );
}
