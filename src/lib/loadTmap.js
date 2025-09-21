// src/lib/loadTmap.js
let loadingPromise = null;

export function loadTmap() {
  // 이미 로드됨
  if (window.Tmapv2) return Promise.resolve(window.Tmapv2);
  // 로딩 중이면 기존 Promise 반환
  if (loadingPromise) return loadingPromise;

  const appKey = process.env.REACT_APP_TMAP_APPKEY;
  if (!appKey) {
    return Promise.reject(new Error("TMAP APPKEY가 없습니다(.env.local 확인)."));
  }

  loadingPromise = new Promise((resolve, reject) => {
    const id = "tmap-js-v2";
    if (document.getElementById(id)) {
      document.getElementById(id).addEventListener("load", () => resolve(window.Tmapv2));
      return;
    }
    const s = document.createElement("script");
    s.id = id;
    s.async = true;
    s.src = `https://apis.openapi.sk.com/tmap/jsv2?version=1&appKey=${appKey}`;
    s.onload = () => resolve(window.Tmapv2);
    s.onerror = () => reject(new Error("Tmap 스크립트 로드 실패"));
    document.head.appendChild(s);

    // 디버그용(원치 않으면 삭제)
    console.debug("[Tmap] loading:", s.src);
  });

  return loadingPromise;
}
