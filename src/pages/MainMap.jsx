// src/pages/MainMap.jsx
import React, { useEffect, useRef, useState } from "react";

export default function MainMap() {
  const mapDivRef = useRef(null);
  const [status, setStatus] = useState("지도 로딩 중…");

  useEffect(() => {
    const init = () => {
      if (!window.Tmapv2) {
        setStatus("지도 로드 실패: Tmapv2가 없습니다.");
        return;
      }
      try {
        const { Tmapv2 } = window;
        const map = new Tmapv2.Map(mapDivRef.current, {
          center: new Tmapv2.LatLng(37.5666805, 126.9784147), // 서울시청
          width: "100%",
          height: "100%",
          zoom: 15,
        });

        // 클릭 시 마커
        map.addListener("click", (evt) => {
          new Tmapv2.Marker({ position: evt.latLng, map });
        });

        // 현재 위치로 이동(선택)
        if ("geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition(
            ({ coords }) => {
              const here = new Tmapv2.LatLng(coords.latitude, coords.longitude);
              map.setCenter(here);
              new Tmapv2.Marker({
                position: here,
                map,
                icon: "https://tmapapi.sktelecom.com/upload/tmap/marker/pin_r_m_p.png",
              });
            },
            () => {},
            { enableHighAccuracy: true, timeout: 8000 }
          );
        }

        setStatus("");
      } catch (e) {
        console.error(e);
        setStatus("지도 로드 실패: 콘솔/네트워크 탭을 확인하세요.");
      }
    };

    if (window.Tmapv2) {
      init(); // 이미 로드됨
    } else {
      // HTML에 넣은 <script id="tmap-js-sdk">가 로드되면 초기화
      const tag = document.getElementById("tmap-js-sdk");
      if (tag) {
        const onLoad = () => init();
        tag.addEventListener("load", onLoad);
        // 혹시 이미 로드된 경우를 대비해 폴백
        setTimeout(() => window.Tmapv2 && init(), 0);
        return () => tag.removeEventListener("load", onLoad);
      } else {
        setStatus("지도 로드 실패: index.html의 Tmap 스크립트를 확인하세요.");
      }
    }
  }, []);

  return (
    <div className="mainShell">
      <header className="appBar">
        <button className="appIcon" aria-label="메뉴">≡</button>
        <div className="appTitle">오카가카</div>
        <button className="appIcon" aria-label="음성">🎤</button>
      </header>

      <div className="mapCanvas" ref={mapDivRef} />
      {status && <div className="mapStatus">{status}</div>}

      <style>{`
        .mainShell{ min-height:100dvh; display:flex; flex-direction:column; position:relative; }
        .appBar{ height:56px; background:#6a34d6; color:#fff; padding:0 12px; display:flex; align-items:center; gap:12px; }
        .appTitle{ flex:1; text-align:center; font-weight:800; letter-spacing:.5px; }
        .appIcon{ width:40px; height:40px; border:none; background:transparent; color:#fff; font-size:22px; cursor:pointer; }
        .mapCanvas{ flex:1; } /* 반드시 높이가 있어야 지도가 보입니다 */
        .mapStatus{ position:absolute; top:64px; left:0; right:0; text-align:center; font-weight:700; color:#555; }
      `}</style>
    </div>
  );
}
