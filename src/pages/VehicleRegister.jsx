// src/pages/VehicleRegister.jsx
import React, { useState } from "react";

export default function VehicleRegister() {
  const [model, setModel] = useState("");

  const onSubmit = (e) => {
    e.preventDefault();
    if (!model.trim()) {
      alert("등록이 되지 않았습니다.");
      return;
    }
    alert("등록이 완료됐습니다.");
    setModel("");
  };

  return (
    <div className="vrWrap" onClick={(e) => e.stopPropagation()}>
      <form className="vrField" onSubmit={onSubmit}>
        <label className="vrLabel">차 모델명 등록</label>

        <input
          className="vrInput"
          placeholder="모델명"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />

        <button className="vrSubmit" type="submit">등록</button>
      </form>

      <style>{`
        .vrWrap{
          min-height:100dvh;
          display:flex;
          align-items:flex-start;
          justify-content:center;
          padding:20px;
        }
        .vrField{ width:min(680px, 92vw); }
        .vrLabel{
          display:block;
          font-weight:700;
          margin-bottom:16px; /* 라벨과 입력칸 간격을 늘렸습니다 */
          color:#111827;
        }
        .vrInput{
          width:100%;
          height:48px;
          padding:10px 14px;
          border-radius:14px;
          border:2px solid #cfc3ff;   /* 보라색 테두리 */
          background:#fff;
          outline:none;
          font-size:15px;
          transition:border-color .15s, box-shadow .15s;
          margin-bottom:14px;          /* 입력칸과 버튼 사이 간격 */
        }
        .vrInput:focus{
          border-color:#8f7bff;
          box-shadow:0 0 0 4px rgba(143,123,255,.15);
        }
        .vrSubmit{
          width:100%;
          height:46px;
          border:none;
          border-radius:12px;
          background:linear-gradient(135deg,#6a5af9,#8f7bff);
          color:#fff;
          font-weight:800;
          cursor:pointer;
        }

        @media (prefers-color-scheme: dark){
          .vrWrap{ background:#0f1115; }
          .vrLabel{ color:#e7e7ea; }
          .vrInput{
            background:#151821;
            color:#e7e7ea;
            border-color:#6f63c7;
          }
          .vrInput::placeholder{ color:#a5a5c2; }
        }
      `}</style>
    </div>
  );
}
