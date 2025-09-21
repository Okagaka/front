import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
const MOCK_FAMILIES = ["오카가카", "우리집", "테스트"];


export default function FamilySearch() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [notFound, setNotFound] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    setNotFound(false);

    const v = name.trim();
    if (!v) return alert("가족 이름을 입력해 주세요.");
    if (v.length > 8) return alert("가족 이름은 8자 이내로 입력해 주세요.");

    // UI 전용: 임시 로직 — 일치하는 예시가 없다고 가정하고 에러 표출
    // (나중에 백엔드 붙이면 여기서 /api/signup/family/search 호출)
    // ✅ 존재하면 메인으로 이동, 아니면 "없습니다" 표기
    if (MOCK_FAMILIES.includes(v)) {
      nav("/home", { replace: true });
    } else {
      setNotFound(true);
    }
    // 만약 찾았다고 가정하고 다음 화면으로 이동하려면:
    // nav("/다음-화면");
  };

  const onChange = (e) => {
    setName(e.target.value);
    if (notFound) setNotFound(false);
  };

  return (
    <div className="wrap">
      <div className="card signup">
        {/* 상단 뒤로가기 */}
        <div className="header">
          <button className="iconBtn" aria-label="뒤로" onClick={() => nav(-1)}>←</button>
        </div>

        {/* 로고 */}
        <div className="logoArea">
          <span className="car">🚗</span>
          <h1 className="brand">오카가카</h1>
        </div>

        {/* 안내 문구 */}
        <p className="guide">
          참여하실 가족 이름을 입력해 주세요.
        </p>

        {/* 입력 */}
        <form onSubmit={submit} className="screen" noValidate>
          <input
            className="input"
            placeholder="가족 이름 찾기( 8자 이내 )"
            value={name}
            maxLength={8}
            onChange={onChange}
          />

          {/* 에러 + '새로 생성' 링크 */}
          {notFound && (
            <div className="helpRow">
              <span className="error">입력하신 가족 이름이 없습니다.</span>
              <Link className="newLink" to="/family/create">새로 생성</Link>
            </div>
          )}

          <button className="primaryBtn" type="submit">다음</button>
        </form>
      </div>

      {/* 페이지 전용 소량 스타일 */}
      <style>{`
        .guide{
          margin: 0 0 14px;
          text-align: center;
          color: #333;
          font-size: clamp(14px, 3.8vw, 16px);
          line-height: 1.5;
        }
        .helpRow{
          margin-top: 8px;
          display:flex; align-items:center; gap:10px;
          font-size: 13px;
        }
        .newLink{
          color: var(--primary);
          font-weight: 700;
          text-decoration: none;
        }
        .newLink:hover{ text-decoration: underline; }
        .screen{ gap: 10px; display:flex; flex-direction:column; }
      `}</style>
    </div>
  );
}
