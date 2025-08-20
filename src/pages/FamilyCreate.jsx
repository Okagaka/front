// src/pages/FamilyCreate.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function FamilyCreate() {
  const nav = useNavigate();
  const [familyName, setFamilyName] = useState("");

  // 주소(시/도, 구/군, 동, 번지)
  const [cityDo, setCityDo] = useState("");  // 예) 서울특별시
  const [guGun, setGuGun] = useState("");    // 예) 마포구
  const [dong, setDong] = useState("");      // 예) 상암동
  const [bunji, setBunji] = useState("");    // 예) 1605

  const [carModel, setCarModel] = useState("");

  const submit = (e) => {
    e.preventDefault();
    const name = familyName.trim();
    if (!name) return alert("가족 이름을 입력해 주세요.");
    if (name.length > 8) return alert("가족 이름은 8자 이내로 입력해 주세요.");

    // 주소 검증 (예시 규칙)
    if (!cityDo.trim()) return alert("시/도를 입력해 주세요. (예: 서울특별시)");
    if (!guGun.trim()) return alert("구/군을 입력해 주세요. (예: 마포구)");
    if (!dong.trim()) return alert("동을 입력해 주세요. (예: 상암동)");
    // 번지: 숫자 또는 숫자-숫자 허용 (예: 1605, 1605-1)
    if (!/^\d{1,5}(-\d{1,4})?$/.test(bunji.trim())) {
      return alert("번지는 숫자 또는 숫자-숫자 형식으로 입력해 주세요. (예: 1605)");
    }

    // UI-only: 백엔드 없이 값만 확인
    console.log({
      familyName: name,
      address: { cityDo, guGun, dong, bunji },
      carModel,
    });
    alert("가족 그룹이 임시로 생성되었습니다. (백엔드 연결 예정)");

    // 다음 단계가 정해지면 아래로 이동
    nav("/home", { replace: true });
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

        {/* 폼 */}
        <form className="screen" onSubmit={submit} noValidate>
          <label className="label">가족 이름</label>
          <input
            className="input"
            placeholder="가족 이름( 8자 이내 )"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            maxLength={8}
          />

          <div className="sectionTitle">집 주소</div>
          <div className="addrGrid">
            <div className="addrCol">
              <label className="label small">시/도</label>
              <input
                className="input"
                placeholder="예: 서울특별시"
                value={cityDo}
                onChange={(e) => setCityDo(e.target.value)}
              />
            </div>
            <div className="addrCol">
              <label className="label small">구/군</label>
              <input
                className="input"
                placeholder="예: 마포구"
                value={guGun}
                onChange={(e) => setGuGun(e.target.value)}
              />
            </div>
            <div className="addrCol">
              <label className="label small">동</label>
              <input
                className="input"
                placeholder="예: 상암동"
                value={dong}
                onChange={(e) => setDong(e.target.value)}
              />
            </div>
            <div className="addrCol">
              <label className="label small">번지</label>
              <input
                className="input"
                placeholder="예: 1605 또는 1605-1"
                value={bunji}
                onChange={(e) => setBunji(e.target.value)}
                inputMode="numeric"
              />
            </div>
          </div>

          <label className="label">차 모델명</label>
          <input
            className="input"
            placeholder="모델명"
            value={carModel}
            onChange={(e) => setCarModel(e.target.value)}
          />

          {/* 하단 고정 느낌의 다음 버튼 */}
          <div className="footerSticky">
            <button className="primaryBtn" type="submit">다음</button>
          </div>
        </form>
      </div>

      {/* 페이지 전용 소량 스타일(기존 App.css와 충돌 없음) */}
      <style>{`
        .screen{ display:flex; flex-direction:column; gap:12px; }

        .addrHeader{
          display:flex; align-items:center; justify-content:space-between;
          gap:8px; margin-top:-4px;
        }
        .addrHint{ color:#888; }
        .miniBtn{
          height:32px; padding:0 10px; border-radius:8px;
          background:#fff; border:1.5px solid var(--border);
          font-size:13px;
        }

        .addrGrid{
          display:grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .addrCol .label.small{
          font-size: 12px; color:#666; margin-bottom:4px;
          display:block;
        }

        /* 작은 화면에서는 2열, 큰 화면에서는 4열로 */
        @media (min-width: 520px){
          .addrGrid{ grid-template-columns: repeat(4, 1fr); }
        }

        /* 하단 고정처럼 보이도록 sticky + safe-area */
        .footerSticky{
          position: sticky;
          bottom: 0;
          padding-top: 8px;
          padding-bottom: calc(16px + env(safe-area-inset-bottom));
          background: linear-gradient(to top, #fff, rgba(255,255,255,0.6), transparent);
          z-index: 1;
        }
      `}</style>
    </div>
  );
}
