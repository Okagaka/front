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
  const [d, t] = s.split("T");
  return `${d} ${String(t || "").slice(0, 5)}`;
};

export default function Carpool() {
  const [serverItems, setServerItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState({});

  const localItems = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("carpool_local") || "[]");
    } catch {
      return [];
    }
  }, []);

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

        const payload = await res.json().catch(() => null);

        if (!res.ok) throw new Error(payload?.message || `HTTP ${res.status}`);
        if (payload?.status !== 200)
          throw new Error(payload?.message || "목록 조회 실패");

        const list = Array.isArray(payload?.data) ? payload.data : [];
        setServerItems(list);
      } catch (e) {
        setErr(e.message || "목록을 불러오지 못했습니다.");
        setServerItems([]);
      } finally {
        setLoading(false);
      }
    };

    fetchList();
  }, []);

  const items = (serverItems && serverItems.length > 0) ? serverItems : localItems;

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

      if (res.ok && payload?.status === 200) {
        alert(payload?.message || "카풀 제안을 수락했습니다.");
        setServerItems((prev) => (prev || []).filter((p) => p.proposalId !== proposalId));
      } else {
        alert(payload?.message || `수락 실패 (HTTP ${res.status})`);
      }
    } catch (e) {
      alert(e.message || "제안 수락 중 오류가 발생했습니다.");
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[proposalId]; return n; });
    }
  };

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

      if (res.ok && payload?.status === 200) {
        alert(payload?.message || "카풀 제안을 거절했습니다.");
        setServerItems((prev) => (prev || []).filter((p) => p.proposalId !== proposalId));
      } else {
        alert(payload?.message || `거절 실패 (HTTP ${res.status})`);
      }
    } catch (e) {
      alert(e.message || "제안 거절 중 오류가 발생했습니다.");
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[proposalId]; return n; });
    }
  };

  return (
    <div className="cpWrap">
      <h1 className="title">받은 카풀 제안</h1>

      {loading && <div className="hint">불러오는 중…</div>}
      {!loading && err && <div className="error">⚠ {err}</div>}

      {!loading && items.length === 0 && (
        <div className="empty">받은 <b>카풀 제안</b>이 없습니다.</div>
      )}

      <ul className="list">
        {items.map((p) => {
          const id = p.proposalId ?? p.id;
          const toUser = p.toReservationUserName || "-";
          const depart = fmtDT(p.proposedDepartureTime) || "-";
          const arrive = fmtDT(p.proposedArrivalTime) || "-";
          const status = (p.status || "").toUpperCase();

          return (
            <li key={id} className="card compactCard">
              <div className="line">
                <span className="label">요청자</span>
                <span className="value">{toUser}</span>
              </div>
              <div className="line">
                <span className="label">출발</span>
                <span className="value">{depart}</span>
              </div>
              <div className="line">
                <span className="label">도착</span>
                <span className="value">{arrive}</span>
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
        .cpWrap{ padding:14px; max-width:720px; margin:0 auto; }
        .title{ font-weight:800; font-size:22px; text-align:center; margin:6px 0 12px; }
        .hint{ color:#666; text-align:center; padding:10px 0; }
        .error{ color:#b00020; background:#fee; border:1px solid #fcc; padding:8px 10px; border-radius:8px; margin:8px auto; max-width:480px; }
        .empty{ color:#555; background:#f8f8ff; border:1px dashed #d9d6ff; padding:12px; border-radius:10px; text-align:center; }

        .list{ list-style:none; margin:10px 0 0; padding:0; display:flex; flex-direction:column; gap:8px; }
        .card{
          background:#fff; border:1px solid #ecebff; border-radius:10px;
          padding:6px 8px; box-shadow:0 2px 6px rgba(0,0,0,.05);
        }
        .compactCard { padding: 6px 8px; }
        .line{ display:grid; grid-template-columns: 64px 1fr; gap:6px; align-items:center; padding:2px 0; }
        .label{ color:#555; font-size:14px; }
        .value{ font-weight:700; font-size:16px; }

        .actions{ margin-top:6px; display:flex; gap:6px; }
        .btn{ border-radius:8px; padding:7px 11px; border:none; cursor:pointer; font-size:15px; }
        .btn.primary{ background:#6a5af9; color:#fff; font-weight:700; }
        .btn.ghost{ background:#f5f5f7; color:#333; }
        .btn:disabled{ opacity:.6; cursor:default; }

        @media (prefers-color-scheme: dark){
          .card{ background:#171b26; border-color:#23283a; }
          .label{ color:#9aa0ad; }
          .btn.ghost{ background:#1c2030; color:#ddd; }
        }
      `}</style>
    </div>
  );
}
