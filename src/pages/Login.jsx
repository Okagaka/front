// src/pages/Login.jsx
import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";

const BASE = process.env.REACT_APP_API_BASE || "http://13.209.57.96:8080";

const LOGIN_ENDPOINTS = [
  `${BASE}/api/auth/login`,
  `${BASE}/api/login`,
  `${BASE}/login`,
];

function toDashedPhone(v) {
  const d = String(v || "").replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`; // 010-1234-5678
  if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`; // 010-123-4567
  return v;
}

async function tryLogin(name, phone) {
  // 서버가 phoneNumber/phone 둘 다 가능하도록 시도
  const bodies = [
    { name, phoneNumber: phone },
    { name, phone: phone },
  ];

  let lastErrText = "";
  for (const url of LOGIN_ENDPOINTS) {
    for (const body of bodies) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          credentials: "include", // 세션 쿠키 사용하는 서버 대비(무해)
          body: JSON.stringify(body),
        });

        const text = await res.text().catch(() => "");

        if (!res.ok) {
          console.log("[login] FAIL:", res.status, "at", url, "-", text?.slice(0, 160));
          lastErrText = text || `HTTP ${res.status}`;
          continue; // 다음 바디/엔드포인트로
        }

        console.log("[login] OK:", res.status, "at", url);

        // 응답 파싱(다양한 포맷을 표준화)
        let raw;
        try { raw = JSON.parse(text); } catch { raw = { rawText: text }; }

        // 흔한 응답 포맷들:
        // { status:200, message:"", data:{ accessToken, user:{name, phone}} }
        // { accessToken, user:{...} }
        // { token, name, phone } ...
        const data = raw?.data ?? raw;
        const token =
          data?.accessToken ??
          data?.token ??
          data?.jwt ??
          data?.access_token ??
          null;

        const user =
          data?.user ??
          data?.profile ??
          { name: data?.name, phone: data?.phone || data?.phoneNumber };

        return { ok: true, token, user, raw };
      } catch (e) {
        lastErrText = e?.message || String(e);
      }
    }
  }
  return { ok: false, error: lastErrText || "로그인 요청 실패" };
}

export default function Login() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");

    // 프론트 검증
    if (!name.trim()) return setError("이름을 입력해 주세요.");
    if (!/^01[0-9]-?\d{3,4}-?\d{4}$/.test(phone))
      return setError("전화번호는 010-1234-5678 형식으로 입력해 주세요.");

    setLoading(true); 
    const dashed = toDashedPhone(phone);

    // 백엔드 로그인 시도
    const result = await tryLogin(name.trim(), dashed);
    setLoading(false);

    if (!result.ok) {
      return setError(result.error || "로그인에 실패했습니다.");
    }

    // 토큰이 있으면 저장(향후 인증 호출용)
    if (result.token) {
      try { localStorage.setItem("accessToken", result.token); } catch {}
      try { sessionStorage.setItem("jwt", result.token); } catch {}
    }

    const me = {
      name: result?.user?.name || name.trim(),
      phone: result?.user?.phone || dashed,
      token: result.token || undefined,
    };
    try { sessionStorage.setItem("auth", JSON.stringify(me)); } catch {}

    // 뒤로가기로 로그인 화면 안 돌아오게 replace 사용
    nav("/home", { replace: true, state: me });
  };

  return (
    <div className="wrap">
      <div className="card">
        <div className="logoArea">
          <span className="car">🚗</span>
          <h1 className="brand">오카가카</h1>
        </div>

        <form onSubmit={onSubmit} noValidate>
          <label className="label">이름</label>
          <input
            className="input"
            placeholder="이름(예: 김눈송)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            name="name"
          />

          <label className="label">전화번호</label>
          <input
            className="input"
            placeholder="전화번호(예: 010-1234-5678)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            name="phone"
          />

          {error && <p className="error">{error}</p>}

          <button className="primaryBtn" type="submit" disabled={loading}>
            {loading ? "로그인 중…" : "로그인"}
          </button>
        </form>

        <div className="sub">
          <span>or </span><Link to="/signup">회원가입</Link>
        </div>
      </div>
    </div>
  );
}
