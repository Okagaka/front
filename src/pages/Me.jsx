// src/pages/Me.jsx
import React, { useEffect, useMemo, useState } from "react";

/** ===== 서버 기본 주소 & 엔드포인트 (Carpool.jsx 와 동일 스타일) ===== */
const BASE = "http://13.209.57.96:8080";
const ME_ENDPOINT = `${BASE}/api/me`;

function getToken() {
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
}

function getAuthFallback() {
  try {
    const auth = JSON.parse(sessionStorage.getItem("auth") || "{}");
    return { name: auth?.name || "", phone: auth?.phone || "" };
  } catch {
    return { name: "", phone: "" };
  }
}

/** 값 보조 */
const pick = (...cands) => cands.find((v) => v != null && v !== "") ?? "";
const safeArr = (a) => (Array.isArray(a) ? a : a ? [a] : []);

/** 얼굴사진 4장 만들기 */
function collectFacePhotos(p) {
  const arr =
    safeArr(p?.facePhotos) ||
    safeArr(p?.faces) ||
    safeArr(p?.photos) ||
    [];
  const more = [
    p?.face1, p?.face2, p?.face3, p?.face4,
    p?.photo1, p?.photo2, p?.photo3, p?.photo4,
    p?.avatar, p?.imageUrl,
  ].filter(Boolean);

  const urls = [...arr, ...more].map(String).filter(Boolean);
  while (urls.length < 4) urls.push(null);
  return urls.slice(0, 4);
}

/** 주소 추출(영역/집) */
function extractRegion(p) {
  const areaName = pick(p?.areaName, p?.regionName, p?.zoneName, p?.groupName) || "";
  const cityDo   = pick(p?.cityDo, p?.sido, p?.region1, p?.region_1depth_name);
  const guGun    = pick(p?.guGun, p?.sigungu, p?.region2, p?.region_2depth_name);
  const dong     = pick(p?.dong, p?.bname,  p?.region3, p?.region_3depth_name);
  const bunji    = pick(p?.bunji, p?.lotNumber, p?.addrNo, p?.number);
  return { areaName, cityDo, guGun, dong, bunji };
}
function extractHome(p) {
  return pick(p?.homeAddress, p?.address, p?.addr, p?.jibunAddress, p?.roadAddress) || "";
}

export default function Me() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const authFallback = useMemo(() => getAuthFallback(), []);
  const [profile, setProfile] = useState({
    name: authFallback.name,
    phone: authFallback.phone,
  });

  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true);
      setErr("");
      try {
        const token = getToken();
        const res = await fetch(ME_ENDPOINT, {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: "include", // ← Carpool 방식과 동일
        });

        const payload = await res.json().catch(() => null);

        // Carpool.jsx와 같은 규칙: HTTP ok + payload.status === 200 여야 성공
        if (!res.ok) {
          const msg = payload?.message || `HTTP ${res.status}`;
          throw new Error(msg);
        }
        if (payload?.status !== 200) {
          throw new Error(payload?.message || "프로필 조회 실패");
        }

        // data로부터 화면 필드 매핑
        const p = payload?.data ?? {};
        const name        = pick(p?.name, p?.username, p?.displayName, authFallback.name);
        const phone       = pick(p?.phone, p?.phoneNumber, p?.mobile, authFallback.phone);
        const faces       = collectFacePhotos(p);
        const regionSrc   = p?.region ?? p?.area ?? p;
        const region      = extractRegion(regionSrc);
        const familyName  = pick(p?.familyName, p?.family?.name, p?.group?.name, p?.householdName);
        const homeAddress = extractHome(p?.home ?? p);
        const carModel    = pick(p?.carModel, p?.vehicleModel, p?.car?.model, p?.vehicle?.modelName);

        setProfile({
          name, phone, faces,
          areaName: region.areaName, cityDo: region.cityDo, guGun: region.guGun, dong: region.dong, bunji: region.bunji,
          familyName, homeAddress, carModel,
        });
      } catch (e) {
        console.warn("[Me] 프로필 조회 실패:", e);
        setErr(e.message || "서버에서 프로필 정보를 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [authFallback.name, authFallback.phone]);

  const {
    name = "", phone = "", faces = [null, null, null, null],
    areaName = "", cityDo = "", guGun = "", dong = "", bunji = "",
    familyName = "", homeAddress = "", carModel = "",
  } = profile || {};

  return (
    <div className="meRoot">
      {/* 독립 스크롤 컨테이너 */}
      <div className="meScroll">
        {/* 화면 높이가 작을수록 자동 축소되는 래퍼 */}
        <div className="meScale">
          <div className="meWrap">
            <h1 className="title">내 정보</h1>

            {loading && <div className="hint">불러오는 중…</div>}
            {!loading && err && <div className="error">⚠ {err}</div>}

            <section className="card">
              <h2 className="secTitle">기본 정보</h2>
              <div className="grid2">
                <div className="kv">
                  <div className="k">이름</div>
                  <div className="v">{name || "-"}</div>
                </div>
                <div className="kv">
                  <div className="k">전화번호</div>
                  <div className="v">{phone || "-"}</div>
                </div>
              </div>
            </section>

            <section className="card">
              <h2 className="secTitle">얼굴 사진 (4장)</h2>
              <div className="faces">
                {faces.map((url, idx) => (<FaceBox key={idx} url={url} />))}
              </div>
            </section>

            <section className="card">
              <h2 className="secTitle">영역 정보</h2>
              <div className="kv">
                <div className="k">영역 이름</div>
                <div className="v">{areaName || "-"}</div>
              </div>
              <div className="addrGrid">
                <AddrItem label="시/도" value={cityDo} />
                <AddrItem label="구/군" value={guGun} />
                <AddrItem label="동" value={dong} />
                <AddrItem label="번지" value={bunji} />
              </div>
            </section>

            <section className="card">
              <h2 className="secTitle">가족 / 거주 / 차량</h2>
              <div className="kv"><div className="k">가족 이름</div><div className="v">{familyName || "-"}</div></div>
              <div className="kv"><div className="k">집 주소</div><div className="v">{homeAddress || "-"}</div></div>
              <div className="kv"><div className="k">차 모델명</div><div className="v">{carModel || "-"}</div></div>
            </section>
          </div>
        </div>
      </div>

      <style>{`
        /* ===== 스크롤 레이아웃 ===== */
        .meRoot{ --app-header-h:56px; height:100%; }
        .meScroll{
          height: calc(100dvh - var(--app-header-h));
          overflow-y:auto;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          padding: 8px 0 max(16px, env(safe-area-inset-bottom));
        }

        /* ===== 축소(스케일) 컨테이너 ===== */
        .meScale{
          --scale: 1;
          transform: scale(var(--scale));
          transform-origin: top center;
          width: calc(100% / var(--scale));
          margin: 0 auto;
        }
        @media (max-height: 900px){ .meScale{ --scale: .95; } }
        @media (max-height: 820px){ .meScale{ --scale: .9; } }
        @media (max-height: 740px){ .meScale{ --scale: .85; } }
        @media (max-height: 680px){ .meScale{ --scale: .8; } }

        .meWrap{ padding:16px; max-width:720px; margin:0 auto; }
        .title{ font-weight:800; font-size:22px; text-align:center; margin:8px 0 14px; }
        .hint{ color:#666; text-align:center; padding:10px 0; }
        .error{ color:#b00020; background:#fee; border:1px solid #fcc; padding:10px 12px; border-radius:10px; margin:10px auto; max-width:520px; }

        .card{
          background:#fff; border:1px solid #ecebff; border-radius:14px;
          padding:14px; box-shadow:0 8px 18px rgba(0,0,0,.05);
          margin-bottom:12px;
        }
        .secTitle{ font-size:16px; font-weight:800; margin:0 0 10px; }

        .grid2{ display:grid; grid-template-columns: 1fr 1fr; gap:8px; }
        @media (max-width:560px){ .grid2{ grid-template-columns: 1fr; } }

        .kv{ display:grid; grid-template-columns: 92px 1fr; gap:10px; align-items:center; }
        .k{ color:#666; font-size:13px; }
        .v{ font-weight:700; }

        .faces{ display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; }
        @media (max-width:560px){ .faces{ grid-template-columns: repeat(2, 1fr); } }

        .faceBox{
          width:100%; aspect-ratio:1/1; border-radius:12px; overflow:hidden;
          border:1px solid #ecebff; background:#f7f7fb; position:relative;
          display:flex; align-items:center; justify-content:center;
        }
        .faceBox img{ width:100%; height:100%; object-fit:cover; display:block; }
        .facePh{
          width:48px; height:48px; border-radius:50%;
          border:2px dashed #cfcfff; color:#7a76c9;
          display:flex; align-items:center; justify-content:center; font-weight:800;
          background:#fafaff;
        }

        .addrGrid{ display:grid; grid-template-columns: repeat(4, 1fr); gap:8px; margin-top:6px; }
        @media (max-width:560px){ .addrGrid{ grid-template-columns: repeat(2, 1fr); } }
        .addrItem{ display:grid; gap:4px; }
        .addrItem label{ color:#666; font-size:12px; }
        .addrItem .box{
          min-height:40px; display:flex; align-items:center; padding:8px 10px;
          border:1px solid #ecebff; border-radius:10px; background:#fafaff; font-weight:700;
        }

        @media (prefers-color-scheme: dark){
          .card{ background:#171b26; border-color:#23283a; }
          .k{ color:#9aa0ad; }
          .faceBox{ border-color:#23283a; background:#141a24; }
          .facePh{ border-color:#2b3150; color:#a6a3ff; background:#141728; }
          .addrItem .box{ border-color:#23283a; background:#151b27; }
          .error{ background:#2a1315; border-color:#5d1f29; }
        }
      `}</style>
    </div>
  );
}

function FaceBox({ url }) {
  if (!url) {
    return (
      <div className="faceBox"><div className="facePh">+</div></div>
    );
    }
  return (
    <div className="faceBox"><img src={url} alt="사용자 얼굴" /></div>
  );
}

function AddrItem({ label, value }) {
  return (
    <div className="addrItem">
      <label>{label}</label>
      <div className="box">{value || "-"}</div>
    </div>
  );
}
