import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function SignupProfile() {
  const nav = useNavigate();

  // 로컬 UI 상태 (프론트만)
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [placeLabel, setPlaceLabel] = useState("");

  // 주소(시/도, 구/군, 동, 번지)
  const [cityDo, setCityDo] = useState("");  // 예) 서울특별시
  const [guGun, setGuGun] = useState("");    // 예) 마포구
  const [dong, setDong] = useState("");      // 예) 상암동
  const [bunji, setBunji] = useState("");    // 예) 1605

  // 얼굴 사진 4장 (파일과 미리보기 URL을 함께 관리)
  const [photos, setPhotos] = useState({
    front: { file: null, url: null },
    left: { file: null, url: null },
    right: { file: null, url: null },
    up: { file: null, url: null },
  });

  // 각 입력을 여는 숨김 input refs
  const refFront = useRef(null);
  const refLeft = useRef(null);
  const refRight = useRef(null);
  const refUp = useRef(null);

  // ObjectURL 누수 방지: url 바뀔 때/언마운트 시 revoke
  useEffect(() => {
    return () => {
      Object.values(photos).forEach(({ url }) => url && URL.revokeObjectURL(url));
    };
  }, [photos]);

  // 파일 선택 공용 핸들러
  const onPick = (key, file) => {
    if (!file) return;
    const nextUrl = URL.createObjectURL(file);

    setPhotos((prev) => {
      const prevUrl = prev[key]?.url;
      if (prevUrl) URL.revokeObjectURL(prevUrl);
      return {
        ...prev,
        [key]: { file, url: nextUrl },
      };
    });
  };

  const onSubmit = (e) => {
    e.preventDefault();
    // 간단 검증
    if (!name.trim()) return alert("이름을 입력해 주세요.");
    if (!/^01[0-9]-?\d{3,4}-?\d{4}$/.test(phone))
      return alert("전화번호는 010-1234-5678 형식으로 입력해 주세요.");

    // 주소 4칸 검증
    if (!cityDo.trim()) return alert("시/도를 입력해 주세요. (예: 서울특별시)");
    if (!guGun.trim()) return alert("구/군을 입력해 주세요. (예: 마포구)");
    if (!dong.trim()) return alert("동을 입력해 주세요. (예: 상암동)");
    // 번지: 숫자 또는 숫자-숫자 형식 허용 (예: 1605, 1605-1)
    if (!/^\d{1,5}(-\d{1,4})?$/.test(bunji.trim()))
      return alert("번지는 숫자 또는 숫자-숫자 형식으로 입력해 주세요. (예: 1605)");

    // 얼굴 사진 4장 필수
    const missing = ["front", "left", "right", "up"].filter((k) => !photos[k].file);
    if (missing.length) {
      const mapKor = { front: "정면", left: "왼쪽", right: "오른쪽", up: "위쪽" };
      return alert(
        `본인 얼굴 사진 4장이 필요해요.\n누락: ${missing.map((k) => mapKor[k]).join(", ")}`
      );
    }

    // TODO: 백엔드 POST /api/signup/* 연결
    console.log({
      name,
      phone,
      address: {
        cityDo,
        guGun,
        dong,
        bunji,
      },
      placeLabel,
      photos,
    });
    alert("임시로 회원가입 정보가 저장되었습니다. (백엔드 연결 예정)");
  };

  // 업로드 박스 공용 컴포넌트
  const UploadBox = ({ label, refInput, photoKey }) => (
    <div className="uploadSlot" onClick={() => refInput.current?.click()}>
      {photos[photoKey].url ? (
        <img className="uploadImg" src={photos[photoKey].url} alt={`${label} 미리보기`} />
      ) : (
        <div className="uploadPlaceholder">
          <span className="pillIcon" aria-hidden>📷</span>
          <div>{label}</div>
          <small>클릭하여 업로드</small>
        </div>
      )}
      <input
        ref={refInput}
        type="file"
        accept="image/*"
        hidden
        capture="user"
        onChange={(e) => onPick(photoKey, e.target.files?.[0])}
      />
    </div>
  );

  return (
    <div className="wrap">
      {/* 카드에 signup 클래스로 중앙정렬 해제(상단부터 스크롤) */}
      <div className="card signup">
        {/* 상단 헤더 */}
        <div className="header">
          <button
            className="iconBtn backBtn"
            aria-label="뒤로"
            onClick={() => nav(-1)}
          >
            ←
          </button>
        </div>

        {/* 로고 */}
        <div className="logoArea">
          <span className="car">🚗</span>
          <h1 className="brand">오카가카</h1>
        </div>

        {/* 폼 (스크롤 영역) */}
        <form onSubmit={onSubmit} className="screen" noValidate>
          <label className="label">이름</label>
          <input
            className="input"
            placeholder="이름(예: 김눈송)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />

          <label className="label">전화번호</label>
          <input
            className="input"
            placeholder="전화번호(예: 010-1234-5678)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
          />

          <div className="sectionTitle">본인 얼굴 사진 업로드 (4장)</div>

          {/* 4칸 그리드 */}
          <div className="grid4">
            <UploadBox label="정면" refInput={refFront} photoKey="front" />
            <UploadBox label="왼쪽" refInput={refLeft} photoKey="left" />
            <UploadBox label="오른쪽" refInput={refRight} photoKey="right" />
            <UploadBox label="위쪽" refInput={refUp} photoKey="up" />
          </div>

          <div className="sectionTitle">자주 이용하는 장소 (주소)</div>

          <label className="label">시/도</label>
          <input
            className="input"
            placeholder="예: 서울특별시"
            value={cityDo}
            onChange={(e) => setCityDo(e.target.value)}
          />

          <label className="label">구/군</label>
          <input
            className="input"
            placeholder="예: 마포구"
            value={guGun}
            onChange={(e) => setGuGun(e.target.value)}
          />

          <label className="label">동</label>
          <input
            className="input"
            placeholder="예: 상암동"
            value={dong}
            onChange={(e) => setDong(e.target.value)}
          />

          <label className="label">번지</label>
          <input
            className="input"
            placeholder="예: 1605 또는 1605-1"
            value={bunji}
            onChange={(e) => setBunji(e.target.value)}
            inputMode="numeric"
          />

          <label className="label">자주 이용하는 장소 이름</label>
          <input
            className="input"
            placeholder="장소 이름 입력(8자 이내)"
            value={placeLabel}
            onChange={(e) => setPlaceLabel(e.target.value)}
            maxLength={8}
          />

          {/* 스크롤 끝에서 보이도록 마지막에 배치 */}
          <div className="formFooter">
            <button className="primaryBtn" type="submit">다음</button>
          </div>
        </form>
      </div>

      {/* 최소 스타일: 스크롤/하단 여백/그리드 */}
      <style>{`
        /* 카드 전체를 화면 높이에 맞추고 내부를 스크롤 */
        .card.signup {
          height: 100vh;
          overflow-y: auto;
        }
        /* 내부 컨텐츠가 버튼까지 스크롤되도록 하단 여백 확보 */
        .screen {
          padding-bottom: 120px; /* 마지막 버튼이 가려지지 않도록 여유 */
        }
        .formFooter {
          margin-top: 16px;
          padding-bottom: 8px;
        }
        .grid4 {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          margin: 8px 0 16px;
        }
        .uploadSlot {
          position: relative;
          width: 100%;
          padding-top: 100%;
          border: 1px dashed #c9c9c9;
          border-radius: 12px;
          cursor: pointer;
          overflow: hidden;
          background: #fafafa;
        }
        .uploadPlaceholder {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
          color: #777;
          font-size: 14px;
          text-align: center;
        }
        .uploadImg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
      `}</style>
    </div>
  );
}
