// src/pages/Carpool.jsx
import React, { useEffect, useMemo, useState } from "react";

const BASE = "http://13.209.57.96:8080";
const LIST_ENDPOINT = `${BASE}/api/reservations/proposals/received`;
const ACCEPT_ENDPOINT = (proposalId) =>
  `${BASE}/api/reservations/proposals/${encodeURIComponent(proposalId)}/accept`;
const REJECT_ENDPOINT = (proposalId) =>
  `${BASE}/api/reservations/proposals/${encodeURIComponent(proposalId)}/reject`;

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

const fmtDT = (s) => {
  if (!s || typeof s !== "string") return "";
  // "2025-09-01T08:35:00" -> "2025-09-01 08:35"
  const [d, t] = s.split("T");
  return `${d} ${String(t || "").slice(0, 5)}`;
};

export default function Carpool() {
  const [serverItems, setServerItems] = useState(null); // null=미시도, 배열=결과
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState({}); // { [proposalId]: 'accept'|'reject' }

  // (옵션) 로컬 백업: 비어있으면 안내용
  const localItems = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("carpool_local") || "[]");
    } catch {
      return [];
    }
  }, []);

  // 받은 카풀 제안 목록 조회
  useEffect(() => {
    const fetchList = async () => {
      setLoading(true);
      setErr("");
      try {
        const token = getToken();
        const res = await fetch(LIST_ENDPOINT, {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: "include",
        });

        // 서버는 {status, message, data:[...]} 포맷을 보냄
        const payload = await res.json().catch(() => null);

        if (!res.ok) {
          const msg =
            payload?.message ||
            `HTTP ${res.status}`;
          throw new Error(msg);
        }

        if (payload?.status !== 200) {
          throw new Error(payload?.message || "목록 조회 실패");
        }

        const list = Array.isArray(payload?.data) ? payload.data : [];
        console.info("[Carpool] 받은 제안 목록:", list);
        setServerItems(list);
      } catch (e) {
        console.warn("[Carpool] 목록 조회 실패:", e);
        setErr(e.message || "목록을 불러오지 못했습니다.");
        setServerItems([]); // 실패해도 화면은 렌더링
      } finally {
        setLoading(false);
      }
    };

    fetchList();
  }, []);

  const items = (serverItems && serverItems.length > 0) ? serverItems : localItems;

  // 수락
  const acceptProposal = async (proposalId) => {
    setBusy((b) => ({ ...b, [proposalId]: "accept" }));
    const token = getToken();
    try {
      const res = await fetch(ACCEPT_ENDPOINT(proposalId), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
      });
      const payload = await res.json().catch(() => null);

      // 정상/오류별 분기 (2.1/2.2)
      if (res.ok && payload?.status === 200) {
        console.info("[Carpool] 제안 수락 성공:", payload?.data);
        // 메시지 예: "카풀 제안을 수락했습니다." + 요청자 예약 CONFIRMED
        alert(payload?.message || "카풀 제안을 수락했습니다.");
        // UI 갱신: 해당 proposal 상태를 임시로 'ACCEPTED'로 변경 or 목록에서 제거
        setServerItems((prev) =>
          (prev || []).filter((p) => p.proposalId !== proposalId)
        );
      } else {
        // 403 권한 없음 등
        const msg = payload?.message || `수락 실패 (HTTP ${res.status})`;
        console.warn("[Carpool] 제안 수락 실패:", msg, payload);
        alert(msg);
      }
    } catch (e) {
      console.error("[Carpool] 제안 수락 에러:", e);
      alert(e.message || "제안 수락 중 오류가 발생했습니다.");
    } finally {
      setBusy((b) => {
        const n = { ...b };
        delete n[proposalId];
        return n;
      });
    }
  };

  // 거절
  const rejectProposal = async (proposalId) => {
    setBusy((b) => ({ ...b, [proposalId]: "reject" }));
    const token = getToken();
    try {
      const res = await fetch(REJECT_ENDPOINT(proposalId), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
      });
      const payload = await res.json().catch(() => null);

      // 정상/오류별 분기 (3.1/3.2/3.3)
      if (res.ok && payload?.status === 200) {
        console.info("[Carpool] 제안 거절 성공:", payload);
        alert(payload?.message || "카풀 제안을 거절했습니다.");
        // UI 갱신: 해당 proposal 제거
        setServerItems((prev) =>
          (prev || []).filter((p) => p.proposalId !== proposalId)
        );
      } else {
        const msg = payload?.message || `거절 실패 (HTTP ${res.status})`;
        console.warn("[Carpool] 제안 거절 실패:", msg, payload);
        alert(msg);
      }
    } catch (e) {
      console.error("[Carpool] 제안 거절 에러:", e);
      alert(e.message || "제안 거절 중 오류가 발생했습니다.");
    } finally {
      setBusy((b) => {
        const n = { ...b };
        delete n[proposalId];
        return n;
      });
    }
  };

  return (
    <div className="cpWrap">
      <h1 className="title">받은 카풀 제안</h1>

      {loading && <div className="hint">불러오는 중…</div>}
      {!loading && err && <div className="error">⚠ {err}</div>}

      {!loading && items.length === 0 && (
        <div className="empty">
          받은 <b>카풀 제안</b>이 없습니다.
        </div>
      )}

      <ul className="list">
        {items.map((p) => {
          // 서버 포맷 (4.x): proposalId / proposedDepartureTime / status
          const id = p.proposalId ?? p.id;
          const fromId = p.fromReservationId ?? p.fromId;
          const toId = p.toReservationId ?? p.toId;
          const when = fmtDT(p.proposedDepartureTime || p.time);
          const status = (p.status || "").toUpperCase();

          return (
            <li key={id} className="card">
              <div className="row1">
                <span className="tt">제안 #{id}</span>
                <span className={`badge ${status === "PENDING" ? "pending" : "other"}`}>
                  {status || "상태없음"}
                </span>
              </div>

              <div className="meta">
                <div>출발 예정: <b>{when || "-"}</b></div>
                <div>From 예약: <b>{fromId ?? "-"}</b></div>
                <div>To(요청자) 예약: <b>{toId ?? "-"}</b></div>
              </div>

              {status === "PENDING" && (
                <div className="actions">
                  <button
                    className="btn primary"
                    onClick={() => acceptProposal(id)}
                    disabled={!!busy[id]}
                  >
                    {busy[id] === "accept" ? "수락 중..." : "수락"}
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => rejectProposal(id)}
                    disabled={!!busy[id]}
                  >
                    {busy[id] === "reject" ? "거절 중..." : "거절"}
                  </button>
                </div>
              )}
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

        .list{ list-style:none; margin:14px 0 0; padding:0; display:flex; flex-direction:column; gap:12px; }
        .card{
          background:#fff; border:1px solid #ecebff; border-radius:14px;
          padding:12px; box-shadow:0 8px 18px rgba(0,0,0,.05);
        }
        .row1{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .tt{ font-weight:700; }
        .badge{ font-size:12px; padding:4px 8px; border-radius:999px; }
        .badge.pending{ background:#fff4e6; color:#b46200; border:1px solid #ffd9a8; }
        .badge.other{ background:#eef2ff; color:#3842a3; border:1px solid #d7ddff; }
        .meta{ margin-top:8px; color:#333; font-size:14px; display:grid; gap:4px; }

        .actions{ margin-top:10px; display:flex; gap:8px; }
        .btn{ border-radius:10px; padding:10px 14px; border:none; cursor:pointer; }
        .btn.primary{ background:#6a5af9; color:#fff; font-weight:700; }
        .btn.ghost{ background:#f5f5f7; color:#333; }
        .btn:disabled{ opacity:.6; cursor:default; }

        @media (prefers-color-scheme: dark){
          .card{ background:#171b26; border-color:#23283a; }
          .empty{ background:#151821; border-color:#2d3150; }
          .badge.pending{ background:#3a2b17; color:#ffd9a8; border-color:#6a4a21; }
          .badge.other{ background:#222948; color:#d7ddff; border-color:#2d3150; }
          .btn.ghost{ background:#1c2030; color:#ddd; }
        }
      `}</style>
    </div>
  );
}
