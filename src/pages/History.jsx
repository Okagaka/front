// src/pages/History.jsx
import React, { useEffect, useMemo, useState } from "react";

/** 백엔드 주소/엔드포인트 */
const BASE = "http://13.209.57.96:8080";
const RESERVE_ENDPOINT = `${BASE}/api/reservations`;
// (선택) 실제 주행/탑승 이력을 분리해서 제공한다면 여기에 추가:
// 존재하지 않아도 try/catch로 무시되니 안전합니다.
const CANDIDATE_RIDE_ENDPOINTS = [
  `${BASE}/api/rides`,
  `${BASE}/api/trips`,
  `${BASE}/api/histories`,
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

/** 날짜/시간 문자열 정리 */
function normTime(t) {
  if (!t) return "";
  const s = String(t);
  // "HH:MM:SS" -> "HH:MM"
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  return s;
}
function dtKey(date, time) {
  // 정렬 키 (내림차순)
  const d = date ? String(date).replaceAll("-", "") : "";
  const tm = time ? normTime(time).replace(":", "") : "0000";
  return `${d}${tm}`; // 예: 202501160930
}

/** 서버 응답을 공통 포맷으로 맵핑 */
function mapReservation(r, idx) {
  const title = r.title || r.name || "차량 예약";
  const date = r.date || r.reservationDate || "";
  const time = normTime(r.arrivalTime || r.time || "");
  const from = [
    r.departureCityDo, r.departureGuGun, r.departureDong, r.departureBunji,
  ].filter(Boolean).join(" ");
  const to = [
    r.destinationCityDo, r.destinationGuGun, r.destinationDong, r.destinationBunji,
  ].filter(Boolean).join(" ");
  return {
    id: r.id ?? `res-${date}-${time}-${idx}`,
    type: "예약",
    title, date, time, from, to,
    _raw: r,
  };
}
function mapRide(r, idx) {
  // 백엔드 필드명이 다를 수 있어 넉넉하게 가드함
  const title = r.title || r.rideTitle || r.tripTitle || "탑승 내역";
  const date = r.date || r.rideDate || r.tripDate || r.startedAt?.slice(0, 10) || "";
  const time = normTime(r.time || r.rideTime || r.tripTime || r.startedAt?.slice(11, 16) || "");
  const from = r.from || [
    r.startCityDo, r.startGuGun, r.startDong, r.startBunji,
  ].filter(Boolean).join(" ");
  const to = r.to || [
    r.endCityDo, r.endGuGun, r.endDong, r.endBunji,
  ].filter(Boolean).join(" ");

  return {
    id: r.id ?? `ride-${date}-${time}-${idx}`,
    type: "탑승",
    title, date, time, from, to,
    _raw: r,
  };
}

export default function History() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [reservations, setReservations] = useState([]); // 서버에서 온 예약
  const [rides, setRides] = useState([]);               // 서버에서 온 탑승(있다면)

  // Reserve.jsx에서 성공 시 쌓아둔 로컬 백업 활용
  const localReservations = useMemo(() => {
    try {
      return (JSON.parse(localStorage.getItem("carpool_local") || "[]") || [])
        .map(mapReservation);
    } catch { return []; }
  }, []);

  useEffect(() => {
    const go = async () => {
      setLoading(true); setErr("");
      const token = getToken();

      // 1) 예약 목록
      try {
        const res = await fetch(RESERVE_ENDPOINT, {
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `HTTP ${res.status}`);
        }
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data?.content ?? []);
        setReservations(list.map(mapReservation));
      } catch (e) {
        // 서버 실패해도 로컬 백업만으로라도 표시
        setReservations([]);
        setErr((prev) => prev || e.message || "예약 목록을 불러오지 못했습니다.");
      }

      // 2) 탑승/주행 후보 엔드포인트들 중 성공하는 것만 수집 (없으면 0건)
      const rideAgg = [];
      for (const url of CANDIDATE_RIDE_ENDPOINTS) {
        try {
          const res = await fetch(url, {
            headers: {
              Accept: "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          });
          if (!res.ok) continue; // 존재 안 하거나 권한 없이 4xx면 무시
          const data = await res.json();
          const arr = Array.isArray(data) ? data : (data?.content ?? []);
          rideAgg.push(...arr);
        } catch { /* 무시 */ }
      }
      setRides(rideAgg.map(mapRide));

      setLoading(false);
    };
    go();
  }, []);

  // 서버 결과 우선 + 서버가 비거나 실패면 로컬 백업 보강
  const combinedReservations =
    reservations.length > 0 ? reservations : localReservations;

  const all = [...combinedReservations, ...rides];

  // 정렬(최신 먼저)
  all.sort((a, b) => {
    const ka = dtKey(a.date, a.time);
    const kb = dtKey(b.date, b.time);
    return kb.localeCompare(ka);
  });

  const [tab, setTab] = useState("ALL");
  const filtered =
    tab === "ALL" ? all :
    tab === "RES" ? combinedReservations :
    rides;

  return (
    <div className="hisWrap">
      <h1 className="title">이용 내역</h1>

      <div className="tabs" role="tablist" aria-label="이용내역 종류">
        <button className={`tab ${tab==="ALL"?"active":""}`} onClick={()=>setTab("ALL")}>전체</button>
        <button className={`tab ${tab==="RES"?"active":""}`} onClick={()=>setTab("RES")}>예약</button>
        <button className={`tab ${tab==="RIDE"?"active":""}`} onClick={()=>setTab("RIDE")}>탑승</button>
      </div>

      {loading && <div className="hint">불러오는 중…</div>}
      {!loading && err && <div className="error">⚠ {err}</div>}

      {!loading && filtered.length === 0 && (
        <div className="empty">
          아직 표시할 내역이 없습니다.
          <br />상단 메뉴에서 <b>차량 예약</b> 후 이용해 보세요.
        </div>
      )}

      <ul className="list">
        {filtered.map((it) => (
          <li key={it.id} className="card">
            <div className="row1">
              <span className={`chip ${it.type==="예약" ? "res":"ride"}`}>{it.type}</span>
              <span className="dt">{it.date} {it.time && `· ${it.time}`}</span>
            </div>
            <div className="tt">{it.title}</div>
            <div className="addr">
              <div>출발지: <b>{it.from || "-"}</b></div>
              <div>도착지: <b>{it.to || "-"}</b></div>
            </div>
          </li>
        ))}
      </ul>

      <style>{`
        .hisWrap{ padding:16px; max-width:720px; margin:0 auto; }
        .title{ font-weight:800; font-size:22px; text-align:center; margin:8px 0 12px; }

        .tabs{ display:flex; gap:8px; justify-content:center; margin-bottom:10px; }
        .tab{
          padding:8px 12px; border-radius:999px; border:1px solid #e6e6ff; background:#fff; cursor:pointer;
          font-weight:600; font-size:14px;
        }
        .tab.active{ background:#6a5af9; color:#fff; border-color:#6a5af9; }

        .hint{ color:#666; text-align:center; padding:10px 0; }
        .error{ color:#b00020; background:#fee; border:1px solid #fcc; padding:10px 12px; border-radius:10px; margin:10px auto; max-width:520px; }
        .empty{
          color:#555; background:#f8f8ff; border:1px dashed #d9d6ff; padding:16px; border-radius:12px; text-align:center;
        }

        .list{ list-style:none; margin:12px 0 0; padding:0; display:flex; flex-direction:column; gap:10px; }
        .card{
          background:#fff; border:1px solid #ecebff; border-radius:14px; padding:12px;
          box-shadow:0 8px 18px rgba(0,0,0,.05);
        }
        .row1{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .chip{
          font-size:12px; font-weight:800; padding:4px 8px; border-radius:999px; border:1px solid transparent;
        }
        .chip.res{ background:#f0eaff; color:#5a45d9; border-color:#e1d8ff; }
        .chip.ride{ background:#ffe9ef; color:#d93a66; border-color:#ffd2df; }
        .dt{ color:#666; font-size:13px; white-space:nowrap; }

        .tt{ margin-top:6px; font-weight:700; }
        .addr{ margin-top:6px; color:#333; font-size:14px; display:grid; gap:4px; }

        @media (prefers-color-scheme: dark){
          .card{ background:#171b26; border-color:#23283a; }
          .tab{ background:#171b26; border-color:#23283a; color:#e7e7ea; }
          .tab.active{ background:#6a5af9; color:#fff; border-color:#6a5af9; }
          .empty{ background:#151821; border-color:#2d3150; }
        }
      `}</style>
    </div>
  );
}
