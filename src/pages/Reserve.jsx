import React, { useEffect, useRef, useState } from "react";

const BASE = "http://13.209.57.96:8080";
const RESERVE_ENDPOINT = `${BASE}/api/reservations`;
const TMAP_APP_KEY = process.env.REACT_APP_TMAP_APPKEY || "";

/* ---------------- 공통 유틸 ---------------- */
function extractBunjiFromData(data) {
  const pick = (s) => {
    if (!s) return "";
    const cleaned = s.replace(/\s*\(.*?\)\s*/g, "").trim();
    const m = cleaned.match(/(\d+(?:-\d+)?)$/);
    return m ? m[1] : "";
  };
  return pick(data?.jibunAddress) || pick(data?.autoJibunAddress) || "";
}

const CITY_MAP = {
  "서울": "서울특별시","부산":"부산광역시","대구":"대구광역시","인천":"인천광역시",
  "광주":"광주광역시","대전":"대전광역시","울산":"울산광역시","세종":"세종특별자치시",
  "경기":"경기도","강원":"강원특별자치도","충북":"충청북도","충남":"충청남도",
  "전북":"전북특별자치도","전남":"전라남도","경북":"경상북도","경남":"경상남도",
  "제주":"제주특별자치도",
};
function normalizeCityDo(v = "") {
  const t = v.trim();
  if (!t) return t;
  if (/(특별시|광역시|도|특별자치도|특별자치시)$/.test(t)) return t;
  return CITY_MAP[t] || t;
}

function nowDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function nowTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ---- 예약 POST (세션/토큰 둘 다 대응) ---- */
async function postReservation(url, payload, opts = {}) {
  const token =
    localStorage.getItem("accessToken") ||
    sessionStorage.getItem("accessToken") ||
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    credentials: "include",
    ...opts,
  });

  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();

  if (!res.ok) {
    const msg = typeof body === "string" ? body || `HTTP ${res.status}` : body?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

/* ---- Tmap 역지오코딩 ---- */
async function tmapReverseGeocode(lat, lon) {
  if (!TMAP_APP_KEY) throw new Error("TMAP AppKey가 없습니다. .env에 REACT_APP_TMAP_APPKEY를 설정하세요.");

  const url = new URL("https://apis.openapi.sk.com/tmap/geo/reversegeocoding");
  url.searchParams.set("version", "1");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("coordType", "WGS84GEO");
  url.searchParams.set("addressType", "A10"); // 법정동/지번 기준

  const res = await fetch(url.toString(), {
    headers: { accept: "application/json", appKey: TMAP_APP_KEY },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `ReverseGeocoding ${res.status}`);
  }
  const data = await res.json();
  const info = data?.addressInfo || {};

  const cityDo = normalizeCityDo(info.city_do || info.sido || "");
  const guGun = info.gu_gun || info.sigungu || "";
  const dong = info.legalDong || info.dong || info.adminDong || "";
  const bunji = info.jibun ?? info.bunji ?? "";

  return { cityDo, guGun, dong, bunji };
}

export default function Reserve() {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(nowDateStr());
  const [time, setTime] = useState(nowTimeStr());
  const [from, setFrom] = useState({ cityDo: "", guGun: "", dong: "", bunji: "" });
  const [to, setTo] = useState({ cityDo: "", guGun: "", dong: "", bunji: "" });

  const [showPostcode, setShowPostcode] = useState(false);
  const [pcTarget, setPcTarget] = useState(null);
  const postcodeRef = useRef(null);

  /* ---- Daum 우편번호 임베드 ---- */
  useEffect(() => {
    if (!showPostcode || !postcodeRef.current) return;
    // 스크립트 미로딩 시 자동 주입
    if (!window.daum?.Postcode) {
      const s = document.createElement("script");
      s.src = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
      s.onload = () => {
        const pc = new window.daum.Postcode({
          oncomplete: onPostcodeComplete,
          width: "100%",
          height: "100%",
        });
        pc.embed(postcodeRef.current);
      };
      document.head.appendChild(s);
      return;
    }
    const pc = new window.daum.Postcode({
      oncomplete: onPostcodeComplete,
      width: "100%",
      height: "100%",
    });
    pc.embed(postcodeRef.current);

    function onPostcodeComplete(data) {
      const cityDo = normalizeCityDo((data.sido || "").trim());
      const guGun = (data.sigungu || "").trim();
      const dong = (data.bname || data.bname1 || "").trim();
      const bunji = extractBunjiFromData(data);
      if (pcTarget === "from") setFrom({ cityDo, guGun, dong, bunji });
      else setTo({ cityDo, guGun, dong, bunji });
      setShowPostcode(false);
      setPcTarget(null);
    }
  }, [showPostcode, pcTarget]);

  /* ---- 현 위치 → 주소 채우기 (Tmap 사용) ---- */
  const fillCurrentAddress = async (target = "from") => {
    if (!navigator.geolocation) {
      alert("이 브라우저는 위치 기능을 지원하지 않습니다.");
      return;
    }
    try {
      const coords = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos.coords),
          (err) => reject(err),
          { enableHighAccuracy: true, timeout: 8000 }
        )
      );
      const addr = await tmapReverseGeocode(coords.latitude, coords.longitude);
      if (target === "from") setFrom(addr);
      else setTo(addr);
    } catch (e) {
      console.error(e);
      alert(e.message || "현재 위치를 불러오지 못했습니다. 위치 권한/네트워크를 확인하세요.");
    }
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    const payload = {
      title: (title || "").trim() || "개인 출근",
      date,
      arrivalTime: `${time}:00`,
      departureCityDo: from.cityDo || "",
      departureGuGun: from.guGun || "",
      departureDong: from.dong || "",
      departureBunji: from.bunji || "",
      destinationCityDo: to.cityDo || "",
      destinationGuGun: to.guGun || "",
      destinationDong: to.dong || "",
      destinationBunji: to.bunji || "",
    };

    try {
      const result = await postReservation(RESERVE_ENDPOINT, payload);
      if (result?.status === 200) {
        alert(result.message || "예약이 확정되었습니다.");
      } else {
        throw new Error(result?.message || "예약에 실패했습니다.");
      }
    } catch (err) {
      alert(err?.message || "서버 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const Input = ({ label, value, onChange, placeholder, type = "text" }) => (
    <div className="field">
      <label className="label">{label}</label>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
      />
    </div>
  );

  return (
    <div className="phoneViewport">
      <main className="contentScroll" aria-label="차량 예약">
        <h1 className="title">차량 예약</h1>

        <form onSubmit={handleSubmit} id="reserveForm" className="formCard">
          {/* 일정 이름 */}
          <div className="field">
            <label className="label">일정 이름</label>
            <input
              className="input"
              value={title}
              placeholder="예) 출근, 마트, 병원 방문 등"
              name="title"
              autoComplete="off"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* 출발지 */}
          <section className="addr-section">
            <div className="row">
              <span className="section-title">출발지 설정</span>
              <div className="rowBtns">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => { setPcTarget("from"); setShowPostcode(true); }}
          >
            주소검색
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fillCurrentAddress("from")}
          >
            현 위치로 불러오기
          </button>
        </div>

            </div>
            <div className="addr-grid">
              <Input label="시/도" value={from.cityDo} onChange={(v) => setFrom({ ...from, cityDo: v })} />
              <Input label="구/군" value={from.guGun} onChange={(v) => setFrom({ ...from, guGun: v })} />
              <Input label="동" value={from.dong} onChange={(v) => setFrom({ ...from, dong: v })} />
              <Input label="번지" value={from.bunji} onChange={(v) => setFrom({ ...from, bunji: v })} />
            </div>
          </section>

          {/* 도착지 */}
          <section className="addr-section">
            <div className="row">
              <span className="section-title">어디로 갈까요? (도착지 설정)</span>
              <button type="button" className="btn btn-secondary" onClick={() => { setPcTarget("to"); setShowPostcode(true); }}>
                주소검색
              </button>
            </div>
            <div className="addr-grid">
              <Input label="시/도" value={to.cityDo} onChange={(v) => setTo({ ...to, cityDo: v })} />
              <Input label="구/군" value={to.guGun} onChange={(v) => setTo({ ...to, guGun: v })} />
              <Input label="동" value={to.dong} onChange={(v) => setTo({ ...to, dong: v })} />
              <Input label="번지" value={to.bunji} onChange={(v) => setTo({ ...to, bunji: v })} />
            </div>
          </section>

          {/* 날짜/시간 */}
          <section className="datetime-section">
            <Input label="날짜" type="date" value={date} onChange={setDate} />
            <Input label="시간" type="time" value={time} onChange={setTime} />
          </section>

          {/* 액션 */}
          <div className="actions">
            <button type="submit" className="btn btn-primary big" disabled={submitting}>
              {submitting ? "예약 중..." : "예약하기"}
            </button>
          </div>

          <div style={{ height: "max(env(safe-area-inset-bottom,0),16px)" }} />
        </form>
      </main>

      {/* 주소검색 모달 */}
      {showPostcode && (
        <div className="pcOverlay" onClick={() => setShowPostcode(false)}>
          <div className="pcInner" onClick={(e) => e.stopPropagation()}>
            <div ref={postcodeRef} style={{ width: "100%", height: "100%" }} />
          </div>
        </div>
      )}

      <style>{`
        .phoneViewport{
          position:relative;
          height:100dvh;
          max-width:420px;
          margin:0 auto;
          background:transparent;
        }
        .contentScroll{
          position:absolute;
          left:0; right:0; top:0; bottom:0;
          overflow:auto;
          padding:16px 16px 12px;
          -webkit-overflow-scrolling: touch;
        }

        .formCard{ max-width:720px; margin:0 auto; }
        .title{ font-weight:800; font-size:22px; text-align:center; margin:10px 0 14px; }
        .field{ margin-bottom:14px; }
        .label{ display:block; font-size:13px; margin-bottom:6px; color:#555; }
        .input{ width:100%; border:1.5px solid #6a5af9; border-radius:22px; padding:12px 16px; outline:none; font-size:16px; background:#fff; }
        .row{ display:flex; align-items:center; gap:8px; margin: 12px 0 6px; justify-content:space-between; }
        .rowBtns{ display:flex; gap:8px; }
        .section-title{ font-weight:700; }
        .addr-grid{ display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; }
        @media (max-width:560px){ .addr-grid{ grid-template-columns: repeat(2, 1fr); } }

        .btn{ border-radius:16px; padding:10px 14px; border:none; cursor:pointer; }
        .btn-secondary{ background:#e7dbff; color:#6a5af9; }
        .btn-ghost{ background:#f5f5f7; color:#333; }
        .btn-primary.big{
          width:100%; height:48px;
          background:#6a5af9; color:#fff; font-weight:700; border-radius:16px;
          display:flex; align-items:center; justify-content:center;
        }

        .actions{
          position: sticky;
          bottom: 0;
          z-index: 5;
          padding: 8px 0 calc(env(safe-area-inset-bottom,0) + 4px);
          background: linear-gradient(to bottom, rgba(246,247,251,0), rgba(246,247,251,1) 40%);
        }

        .pcOverlay{ position: fixed; inset: 0; background: rgba(0,0,0,.35); display:flex; align-items:center; justify-content:center; z-index:99999; }
        .pcInner{ width:min(720px, 92vw); height:min(620px, 82vh); background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,.25); }
      `}</style>
    </div>
  );
}
