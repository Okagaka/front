// src/pages/Login.jsx
import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";

export default function Login() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  const onSubmit = (e) => {
    e.preventDefault();
    setError("");

    // 간단 검증 (백엔드 없이 프론트만)
    if (!name.trim()) return setError("이름을 입력해 주세요.");
    if (!/^01[0-9]-?\d{3,4}-?\d{4}$/.test(phone))
      return setError("전화번호는 010-1234-5678 형식으로 입력해 주세요.");

    // 임시 동작: 지금은 UI만, 나중엔 여기서 login API 호출로 교체
    console.log({ name, phone });

    nav("/family/search", {repalce: true});
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

          <button className="primaryBtn" type="submit">로그인</button>
        </form>

        <div className="sub">
        <span>or </span><Link to="/signup">회원가입</Link>
        </div>
      </div>
    </div>
  );
}
