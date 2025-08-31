// src/pages/Carpool.jsx
import React, { useEffect, useMemo, useState } from "react";

const BASE = "http://13.209.57.96:8080";
const RESERVE_ENDPOINT = `${BASE}/api/reservations`;

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

export default function Carpool() {
  const [serverItems, setServerItems] = useState(null);   // null=미시도, []=빈 결과
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // 로컬백업: Reserve.jsx에서 성공 시 저장해둔 내역
  const localItems = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("carpool_local") || "[]");
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    const fetchList = async () => {
      setLoading(true); setErr("");
      try {
        const token = getToken();
        const res = await fetch(RESERVE_ENDPOINT, {
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) {
          // 서버가 401/403 등을 줄 수 있으므로 에러 메시지 저장하고 로컬백업만 표시
          const text = await res.text().catch(() => "");
          throw new Error(text || `HTTP ${res.status}`);
        }
        const data = await res.json();
        // 백엔드 포맷에 맞게 맵핑 (필드명 다르면 여기서 조정)
        const list = Array.isArray(data) ? data : (data?.content ?? []);
        setServerItems(list);
      } catch (e) {
        setErr(e.message || "목록을 불러오지 못했습니다.");
        setServerItems([]); // 서버 실패 시에도 화면은 렌더링
      } finally {
        setLoading(false);
      }
    };
    fetchList();
  }, []);

  // 서버 결과가 있으면 서버 우선, 실패/비어있으면 로컬백업 사용
  const items = (serverItems && serverItems.length > 0) ? serverItems : localItems;

  return (
    <div className="cpWrap">
      <h1 className="title">카풀 내역</h1>

      {loading && <div className="hint">불러오는 중…</div>}
      {!loading && err && <div className="error">⚠ {err}</div>}

      {!loading && items.length === 0 && (
        <div className="empty">
          아직 예약 내역이 없습니다.
          <br />상단 메뉴의 <b>차량 예약</b>에서 먼저 예약해 보세요.
        </div>
      )}

      <ul className="list">
        {items.map((r, i) => {
          // 백엔드/로컬 모두 커버: 키/필드명 가드
          const title = r.title || r.name || "차량 예약";
          const date = r.date || r.reservationDate || "";
          const time = (r.arrivalTime || r.time || "").toString().replace(/:00$/, "");
          const from = [
            r.departureCityDo || r.fromCityDo,
            r.departureGuGun || r.fromGuGun,
            r.departureDong || r.fromDong,
            r.departureBunji || r.fromBunji,
          ].filter(Boolean).join(" ");
          const to = [
            r.destinationCityDo || r.toCityDo,
            r.destinationGuGun || r.toGuGun,
            r.destinationDong || r.toDong,
            r.destinationBunji || r.toBunji,
          ].filter(Boolean).join(" ");

          return (
            <li key={r.id ?? `${title}-${date}-${time}-${i}`} className="card">
              <div className="row1">
                <span className="tt">{title}</span>
                <span className="dt">{date} {time && `· ${time}`}</span>
              </div>
              <div className="addr">
                <div>출발지: <b>{from || "-"}</b></div>
                <div>도착지: <b>{to || "-"}</b></div>
              </div>
            </li>
          );
        })}
      </ul>

      <style>{`
        .cpWrap{ padding:16px; max-width:720px; margin:0 auto; }
        .title{ font-weight:800; font-size:22px; text-align:center; margin:8px 0 14px; }
        .hint{ color:#666; text-align:center; padding:12px 0; }
        .error{ color:#b00020; background:#fee; border:1px solid #fcc; padding:10px 12px; border-radius:10px; margin:10px auto; max-width:520px; }
        .empty{ color:#555; background:#f8f8ff; border:1px dashed #d9d6ff; padding:16px; border-radius:12px; text-align:center; }
        .list{ list-style:none; margin:14px 0 0; padding:0; display:flex; flex-direction:column; gap:10px; }
        .card{
          background:#fff; border:1px solid #ecebff; border-radius:14px;
          padding:12px; box-shadow:0 8px 18px rgba(0,0,0,.05);
        }
        .row1{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .tt{ font-weight:700; }
        .dt{ color:#666; font-size:13px; white-space:nowrap; }
        .addr{ margin-top:6px; color:#333; font-size:14px; display:grid; gap:4px; }
        @media (prefers-color-scheme: dark){
          .card{ background:#171b26; border-color:#23283a; }
          .empty{ background:#151821; border-color:#2d3150; }
        }
      `}</style>
    </div>
  );
}
