// src/pages/Me.jsx
import React, { useEffect, useMemo, useState } from "react";

/** ===== 서버 기본 주소 & 후보 엔드포인트 ===== */
const BASE = "http://13.209.57.96:8080";
const ME_ENDPOINTS = [
  `${BASE}/api/me`,
  `${BASE}/api/profile`,
  `${BASE}/api/users/me`,
];

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
const normTime = (s) => (s ? String(s) : "");
const safeArr = (a) => (Array.isArray(a) ? a : a ? [a] : []);

/** 얼굴사진 4장 만들기 */
function collectFacePhotos(p) {
  // 1) 배열 기반
  const arr =
    safeArr(p?.facePhotos) ||
    safeArr(p?.faces) ||
    safeArr(p?.photos) ||
    [];
  // 2) 단일 키 기반
  const more = [
    p?.face1, p?.face2, p?.face3, p?.face4,
    p?.photo1, p?.photo2, p?.photo3, p?.photo4,
    p?.avatar, p?.imageUrl,
  ].filter(Boolean);

  const urls = [...arr, ...more].map(String).filter(Boolean);
  // 4장으로 맞추기 (부족하면 플레이스홀더)
  while (urls.length < 4) urls.push(null);
  return urls.slice(0, 4);
}

/** 주소 추출(영역/집) */
function extractRegion(p) {
  const areaName =
    pick(p?.areaName, p?.regionName, p?.zoneName, p?.groupName) || "";
  const cityDo = pick(
    p?.cityDo, p?.sido, p?.region1, p?.region_1depth_name
  );
  const guGun = pick(
    p?.guGun, p?.sigungu, p?.region2, p?.region_2depth_name
  );
  const dong = pick(
    p?.dong, p?.bname, p?.region3, p?.region_3depth_name
  );
  const bunji = pick(
    p?.bunji, p?.lotNumber, p?.addrNo, p?.number
  );
  return { areaName, cityDo, guGun, dong, bunji };
}

function extractHome(p) {
  // 집 주소는 하나의 문자열 혹은 구성요소로 올 수 있음
  const home =
    pick(p?.homeAddress, p?.address, p?.addr, p?.jibunAddress, p?.roadAddress) || "";
  return home;
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
      const token = getToken();

      // 여러 후보 엔드포인트 중 성공하는 것 사용
      for (const url of ME_ENDPOINTS) {
        try {
          const res = await fetch(url, {
            headers: {
              Accept: "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          });
          if (!res.ok) continue;
          const data = await res.json();

          // 서버 응답이 {data:{...}} 형태일 수도 있으니 최대한 내부로 파고듦
          const p = data?.data ?? data;

          // 이름/전화
          const name = pick(p?.name, p?.username, p?.displayName, authFallback.name);
          const phone = pick(p?.phone, p?.phoneNumber, p?.mobile, authFallback.phone);

          // 얼굴사진 4장
          const faces = collectFacePhotos(p);

          // 영역 이름 + 영역 주소(시/도, 구/군, 동, 번지)
          const region = extractRegion(p?.region ?? p?.area ?? p);

          // 가족 이름
          const familyName = pick(
            p?.familyName, p?.family?.name, p?.group?.name, p?.householdName
          );

          // 집 주소
          const homeAddress = extractHome(p?.home ?? p);

          // 차 모델명
          const carModel = pick(
            p?.carModel, p?.vehicleModel, p?.car?.model, p?.vehicle?.modelName
          );

          setProfile({
            name,
            phone,
            faces,
            areaName: region.areaName,
            cityDo: region.cityDo,
            guGun: region.guGun,
            dong: region.dong,
            bunji: region.bunji,
            familyName,
            homeAddress,
            carModel,
          });
          setLoading(false);
          return;
        } catch {
          // 다음 후보로
        }
      }

      // 전부 실패 시: fallback만 유지
      setErr("서버에서 프로필 정보를 불러오지 못했습니다. (로그인 토큰/권한 확인 필요)");
      setLoading(false);
    };

    fetchProfile();
  }, [authFallback.name, authFallback.phone]);

  const {
    name = "",
    phone = "",
    faces = [null, null, null, null],
    areaName = "",
    cityDo = "",
    guGun = "",
    dong = "",
    bunji = "",
    familyName = "",
    homeAddress = "",
    carModel = "",
  } = profile || {};

  return (
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
          {faces.map((url, idx) => (
            <FaceBox key={idx} url={url} />
          ))}
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
        <div className="kv">
          <div className="k">가족 이름</div>
          <div className="v">{familyName || "-"}</div>
        </div>
        <div className="kv">
          <div className="k">집 주소</div>
          <div className="v">{homeAddress || "-"}</div>
        </div>
        <div className="kv">
          <div className="k">차 모델명</div>
          <div className="v">{carModel || "-"}</div>
        </div>
      </section>

      <style>{`
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

        .faces{
          display:grid; grid-template-columns: repeat(4, 1fr); gap:10px;
        }
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
      <div className="faceBox">
        <div className="facePh">+</div>
      </div>
    );
  }
  return (
    <div className="faceBox">
      <img src={url} alt="사용자 얼굴" />
    </div>
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
