import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

// 도로명/지번 주소 문자열에서 마지막 번지(예: "73" 또는 "73-1")만 추출
function extractBunjiFromData(data) {
  const pick = (s) => {
    if (!s) return "";
    const cleaned = s.replace(/\s*\(.*?\)\s*/g, "").trim();
    const m = cleaned.match(/(\d+(?:-\d+)?)$/); // 끝의 번지 or 번지-부번
    return m ? m[1] : "";
  };
  return pick(data?.jibunAddress) || pick(data?.autoJibunAddress) || "";
}

function formatPhoneView(v = "") {
  const d = String(v).replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return v || "";
}

const CITY_MAP = {
  "서울": "서울특별시","부산": "부산광역시","대구": "대구광역시","인천": "인천광역시","광주": "광주광역시",
  "대전": "대전광역시","울산": "울산광역시","세종": "세종특별자치시","경기": "경기도","강원": "강원특별자치도",
  "충북": "충청북도","충남": "충청남도","전북": "전북특별자치도","전남": "전라남도","경북": "경상북도",
  "경남": "경상남도","제주": "제주특별자치도",
};
function normalizeCityDo(v = "") {
  const t = v.trim();
  if (!t) return t;
  if (/(특별시|광역시|도|특별자치도|특별자치시)$/.test(t)) return t;
  return CITY_MAP[t] || t;
}

/** ---------------------------------------------- */
const USE_MOCK = false;
const BASE = "http://13.209.57.96:8080";
/** ---------------------------------------------- */

const realApi = {
  name: async (name) => {
    const r = await fetch(`${BASE}/api/signup/name`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) throw new Error(await r.text());
    const raw = await r.json().catch(async () => {
      const t = await r.text();
      try { return JSON.parse(t); } catch { return { rawText: t }; }
    });
    const tempId =
      raw?.tempId ?? raw?.tempID ?? raw?.id ?? raw?.data?.tempId ?? raw?.result?.tempId;
    if (tempId == null) throw new Error("서버에서 임시 가입 ID(tempId)를 받지 못했습니다.");
    return { tempId };
  },

  phone: async (tempId, phoneInput) => {
    if (tempId == null) throw new Error("임시 가입 ID가 없어 전화번호를 보낼 수 없어요.");
    const toDashed = (v) => {
      const d = String(v || "").replace(/\D/g, "");
      if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
      if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
      return v;
    };
    const rawInput = typeof phoneInput === "string" ? phoneInput : (phoneInput?.raw ?? "");
    const dashed = toDashed(rawInput);

    const url = `${BASE}/api/signup/phone?tempId=${encodeURIComponent(tempId)}`;
    const body = JSON.stringify({ phoneNumber: dashed });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body,
    });
    const text = await res.text().catch(() => "");

    if (!res.ok && /형식|format|phoneNumber/i.test(text)) {
      const res2 = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ phone: dashed }),
      });
      const text2 = await res2.text().catch(() => "");
      if (!res2.ok) throw new Error(text2 || `HTTP ${res2.status}`);
      try { return JSON.parse(text2); } catch { return {}; }
    }

    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    try { return JSON.parse(text); } catch { return {}; }
  },

  faces: async (tempId, files) => {
    if (tempId == null) throw new Error("임시 가입 ID가 없습니다.");
    if (!Array.isArray(files) || files.length !== 4) throw new Error("얼굴 사진 4장을 모두 선택해 주세요.");
    const fd = new FormData();
    files.forEach((f) => fd.append("imageUrls", f, f.name));
    const res = await fetch(`${BASE}/api/signup/faces?tempId=${encodeURIComponent(tempId)}`, { method: "POST", body: fd });
    const isNoContent = res.status === 204;
    const text = isNoContent ? "" : await res.text().catch(() => "");
    if (!res.ok) throw new Error(text || `faces HTTP ${res.status}`);
    return text ? JSON.parse(text) : {};
  },

  zone: async (tempId, payload) => {
    if (tempId == null) throw new Error("임시 가입 ID가 없습니다.");
    const body = {
      name: String(payload.name || "").trim(),
      cityDo: String(payload.cityDo || "").trim(),
      guGun: String(payload.guGun || "").trim(),
      dong: String(payload.dong || "").trim(),
      bunji: String(payload.bunji || "").trim(),
    };
    const url = `${BASE}/api/signup/zone?tempId=${encodeURIComponent(tempId)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) throw new Error(text || `zone HTTP ${res.status}`);
    try { return JSON.parse(text); } catch { return {}; }
  },

  familySearch: async (tempId, familyName) => {
    const url = `${BASE}/api/signup/family/search?tempId=${encodeURIComponent(tempId)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ familyName }),
    });
    const text = await r.text().catch(() => "");
    if (!r.ok) throw new Error(text || `familySearch HTTP ${r.status}`);
    let raw; try { raw = JSON.parse(text); } catch { raw = {}; }
    const found = raw?.data?.exists ?? raw?.exists ?? false;
    const familyId = raw?.data?.familyId ?? raw?.familyId ?? null;
    return { found: !!found, familyId };
  },

  familyCreate: async (tempId, payload) => {
    const url = `${BASE}/api/signup/family/create?tempId=${encodeURIComponent(tempId)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await r.text().catch(() => "");
    if (!r.ok) throw new Error(text || `familyCreate HTTP ${r.status}`);
    let raw; try { raw = JSON.parse(text); } catch { raw = {}; }
    const familyId = raw?.data?.familyId ?? raw?.familyId ?? null;
    return { familyId, ...raw?.data };
  },

  complete: async (tempId) => {
    const url = `${BASE}/api/signup/complete?tempId=${encodeURIComponent(tempId)}`;
    const r = await fetch(url, { method: "POST", headers: { "Accept": "application/json" } });
    const text = await r.text().catch(() => "");
    if (!r.ok) throw new Error(text || `complete HTTP ${r.status}`);
    try { return JSON.parse(text); } catch { return {}; }
  },
};

const mockApi = {
  _temp: { id: 10001 },
  name: async (name) => { await wait(400); return { tempId: mockApi._temp.id, echo: { name } }; },
  phone: async (tempId, phoneNumber) => { await wait(300); return { ok: true, tempId, phoneNumber }; },
  faces: async () => { await wait(500); return { ok: true, imageUrls: ["url1","url2","url3","url4"] }; },
  zone: async (tempId, payload) => { await wait(400); return { ok:true, tempId, zoneId:5, zoneName:payload.name, zoneLatitude:37.5665, zoneLongitude:126.9780 }; },
  familySearch: async (tempId, familyName) => { await wait(400); const found = familyName.trim() === "김씨네"; return { found, familyId: found ? 10 : null, tempId }; },
  familyCreate: async (tempId, payload) => { await wait(500); return { ok: true, tempId, familyId: 777, ...payload }; },
  complete: async (tempId) => {
    await wait(400);
    return {
      userId: 1,
      userName: "홍길동",
      phoneNumber: "010-1234-5678",
      imageUrls: ["a","b","c","d"],
      familyId: 777,
      zoneId: 5,
      zoneName: "우리집",
      zoneLatitude: 37.123456,
      zoneLongitude: 127.654321,
    };
  },
};

const API = USE_MOCK ? mockApi : realApi;
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** ==============================================
 *  메인 컴포넌트
 *  ============================================== */
export default function Signup() {
  const nav = useNavigate();

  const [step, setStep] = useState(1); // 1~6
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [tempId, setTempId] = useState(null);

  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");

  const [photos, setPhotos] = useState({
    front: { file: null, url: null },
    left: { file: null, url: null },
    right: { file: null, url: null },
    up: { file: null, url: null },
  });
  const refFront = useRef(null);
  const refLeft = useRef(null);
  const refRight = useRef(null);
  const refUp = useRef(null);
  const refAll = useRef(null);
  const FACE_KEYS = ["front", "left", "right", "up"];

  useEffect(() => () => {
    Object.values(photos).forEach(({ url }) => url && URL.revokeObjectURL(url));
  }, [photos]);

  const [zoneName, setZoneName] = useState("");
  const [cityDo, setCityDo] = useState("");
  const [guGun, setGuGun] = useState("");
  const [dong, setDong] = useState("");
  const [bunji, setBunji] = useState("");

  const [familyName, setFamilyName] = useState("");
  const [familySearchResult, setFamilySearchResult] = useState(null);
  const [createMode, setCreateMode] = useState(false);
  const [createAddr, setCreateAddr] = useState({ cityDo: "", guGun: "", dong: "", bunji: "" });

  const [finalUser, setFinalUser] = useState(null);

  const [showPostcode, setShowPostcode] = useState(false);
  const [pcTarget, setPcTarget] = useState(null); // 'zone' | 'family'
  const postcodeRef = useRef(null);

  const openAddressSearch = (target) => {
    if (!window.daum?.Postcode) { alert("주소 검색 스크립트를 로드하지 못했습니다. index.html을 확인하세요."); return; }
    setPcTarget(target);
    setShowPostcode(true);
  };

  useEffect(() => {
    if (!showPostcode || !postcodeRef.current || !window.daum?.Postcode) return;
    const pc = new window.daum.Postcode({
      oncomplete: (data) => {
        const sido = (data.sido || "").trim();
        const sigungu = (data.sigungu || "").trim();
        const bname = (data.bname || data.bname1 || "").trim();
        const bunjiV = extractBunjiFromData(data);

        if (pcTarget === "zone") {
          setCityDo(sido); setGuGun(sigungu); setDong(bname); setBunji(bunjiV);
        } else if (pcTarget === "family") {
          setCreateAddr(prev => ({ ...prev, cityDo: sido, guGun: sigungu, dong: bname, bunji: bunjiV }));
        }
        setShowPostcode(false);
        setPcTarget(null);
      },
      width: "100%", height: "100%",
    });
    pc.embed(postcodeRef.current);
  }, [showPostcode, pcTarget]);

  const onPick = (key, file) => {
    if (!file) return;
    const nextUrl = URL.createObjectURL(file);
    setPhotos((prev) => {
      prev[key]?.url && URL.revokeObjectURL(prev[key].url);
      return { ...prev, [key]: { file, url: nextUrl } };
    });
  };

  const onPickAll = (fileList) => {
    const arr = Array.from(fileList || []).slice(0, 4);
    if (arr.length === 0) return;
    setPhotos((prev) => {
      FACE_KEYS.forEach((k) => prev[k]?.url && URL.revokeObjectURL(prev[k].url));
      const next = { ...prev };
      FACE_KEYS.forEach((k, i) => {
        const file = arr[i] || null;
        next[k] = file ? { file, url: URL.createObjectURL(file) } : { file: null, url: null };
      });
      return next;
    });
  };

  const goBack = () => setStep(s => Math.max(1, s - 1));
  const handleBack = () => {
    if (step > 1) {
      setStep((s) => Math.max(1, s - 1));
    } else {
      if (window.history.length > 1) nav(-1);
      else nav("/");
    }
  };

  const goNext = async () => {
    try {
      setError(""); setLoading(true);
      if (step === 1) {
        if (!name.trim()) throw new Error("이름을 입력해 주세요.");
        const { tempId } = await API.name(name.trim());
        setTempId(tempId);
        try { sessionStorage.setItem("signup_tempId", String(tempId)); } catch { }
        setStep(2);
      }
      else if (step === 2) {
        if (tempId == null) throw new Error("임시 가입 ID가 없습니다. 1단계를 먼저 완료해 주세요.");
        if (!/^01[0-9]-?\d{3,4}-?\d{4}$/.test(phoneNumber)) throw new Error("전화번호는 010-1234-5678 형식으로 입력해 주세요.");
        await API.phone(tempId, phoneNumber);
        setStep(3);
      }
      else if (step === 3) {
        const files = FACE_KEYS.map(k => photos[k].file).filter(Boolean);
        if (files.length !== 4) throw new Error("얼굴 사진 4장을 모두 업로드해 주세요.");
        await API.faces(tempId, files);
        setStep(4);
      }
      else if (step === 4) {
        if (!zoneName.trim()) throw new Error("영역 이름을 입력해 주세요. (예: 우리집)");
        if (!cityDo.trim()) throw new Error("시/도를 입력해 주세요. (예: 서울특별시)");
        if (!guGun.trim()) throw new Error("구/군을 입력해 주세요. (예: 용산구)");
        if (!dong.trim()) throw new Error("동을 입력해 주세요. (예: 효창동)");
        if (!/^\d{1,5}(-\d{1,4})?$/.test(bunji.trim())) throw new Error("번지는 숫자 또는 숫자-숫자 형식으로 입력해 주세요. (예: 1605 또는 123-45)");
        const payload = { name: zoneName.trim(), cityDo: normalizeCityDo(cityDo), guGun, dong, bunji };
        await API.zone(tempId, payload);
        setStep(5);
      }
      else if (step === 5) {
        if (!createMode) {
          if (!familyName.trim()) throw new Error("가족 이름을 입력해 주세요.");
          const res = await API.familySearch(tempId, familyName.trim());
          setFamilySearchResult(res);
          if (res.found) {
            const user = await API.complete(tempId);
            setFinalUser(user);
            setStep(6);
          } else {
            setCreateMode(true);
          }
        } else {
          if (!familyName.trim()) throw new Error("가족 이름을 입력해 주세요.");
          const { cityDo, guGun, dong, bunji } = createAddr;
          if (!cityDo.trim() || !guGun.trim() || !dong.trim() || !bunji.trim())
            throw new Error("가족 주소(시/도, 구/군, 동, 번지)를 모두 입력해 주세요.");
          await API.familyCreate(tempId, {
            familyName: familyName.trim(),
            cityDo, guGun, dong, bunji
          });
          const user = await API.complete(tempId);
          setFinalUser(user);
          setStep(6);
        }
      }
      else if (step === 6) {
        // 가입 완료 후 홈으로 이동 (auth 저장)
        const displayName = (finalUser?.userName ?? name)?.trim() || "";
        const displayPhone = finalUser?.phoneNumber ?? phoneNumber ?? "";

        const auth = {
          name: displayName,
          phone: displayPhone,
          token: undefined, // 보통 회원가입 후엔 로그인 토큰 별도 발급 절차
          userId: finalUser?.userId ?? finalUser?.id ?? null,
          groupId: finalUser?.familyId ?? finalUser?.groupId ?? null,
        };
        try { sessionStorage.setItem("auth", JSON.stringify(auth)); } catch {}
        nav("/home", { replace: true, state: auth });
      }
    } catch (e) { setError(e.message || String(e)); }
    finally { setLoading(false); }
  };

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
      <div className="card signup">
        <div className="header">
          <button className="iconBtn backBtn" aria-label="뒤로" onClick={handleBack}>←</button>
          <div className="stepTitle">회원가입 ({step}/6)</div><span />
        </div>

        <div className="logoArea"><span className="car">🚗</span><h1 className="brand">오카가카</h1></div>

        <div className="screen">
          {step === 1 && (<>
            <label className="label">이름</label>
            <input className="input" placeholder="이름(예: 김눈송)" value={name}
              onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </>)}

          {step === 2 && (<>
            <label className="label">전화번호</label>
            <input className="input" placeholder="전화번호(예: 010-1234-5678)" value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)} inputMode="tel" autoComplete="tel" />
          </>)}

          {step === 3 && (<>
            <div className="sectionTitle">본인 얼굴 사진 업로드 (4장)</div>
            <div style={{ marginBottom: 8 }}>
              <button type="button" className="ghostBtn" onClick={() => refAll.current?.click()}>사진 4장 한꺼번에 업로드</button>
              <input ref={refAll} type="file" accept="image/*" multiple hidden onChange={(e) => onPickAll(e.target.files)} />
              <div className="hint" style={{ marginTop: 6 }}>선택 순서대로 <b>정면 → 왼쪽 → 오른쪽 → 위쪽</b>에 자동 배치돼요.</div>
            </div>
            <div className="grid4">
              <UploadBox label="정면" refInput={refFront} photoKey="front" />
              <UploadBox label="왼쪽" refInput={refLeft} photoKey="left" />
              <UploadBox label="오른쪽" refInput={refRight} photoKey="right" />
              <UploadBox label="위쪽" refInput={refUp} photoKey="up" />
            </div>
          </>)}

          {step === 4 && (<>
            <div className="sectionTitle">자주 이용하는 장소 (영역)</div>
            <label className="label">영역 이름</label>
            <input className="input" placeholder="예: 우리집" value={zoneName} onChange={(e) => setZoneName(e.target.value)} />
            <div style={{ display: "flex", margin: "8px 0" }}>
              <button type="button" className="ghostBtn" onClick={() => openAddressSearch("zone")} style={{ width: "auto" }}>주소 검색</button>
            </div>
            <label className="label">시/도</label>
            <input className="input" value={cityDo} onChange={(e) => setCityDo(e.target.value)} placeholder="예: 서울특별시" />
            <label className="label">구/군</label>
            <input className="input" value={guGun} onChange={(e) => setGuGun(e.target.value)} placeholder="예: 성동구" />
            <label className="label">동</label>
            <input className="input" value={dong} onChange={(e) => setDong(e.target.value)} placeholder="예: 하왕십리동" />
            <label className="label">번지</label>
            <input className="input" value={bunji} onChange={(e) => setBunji(e.target.value)} placeholder="예: 73 또는 73-1" />
          </>)}

          {step === 5 && (<>
            {!createMode ? (
              <>
                <div className="sectionTitle">가족 그룹 검색</div>
                <label className="label">가족 이름</label>
                <input className="input" placeholder="예: 김씨네" value={familyName}
                  onChange={(e) => { setFamilyName(e.target.value); setFamilySearchResult(null); }} />
                {familySearchResult && (
                  <div className="hintBox">
                    {familySearchResult.found ? `가족 그룹을 찾았습니다. (ID: ${familySearchResult.familyId})` : "해당 이름의 가족 그룹이 없습니다. 새로 생성해 주세요."}
                  </div>
                )}
                <button className="ghostBtn" type="button" onClick={() => setCreateMode(true)}>가족 그룹이 없으신가요? 새로 생성</button>
              </>
            ) : (
              <>
                <div className="sectionTitle">가족 그룹 생성</div>
                <label className="label">가족 이름</label>
                <input className="input" value={familyName} onChange={(e) => setFamilyName(e.target.value)} placeholder="예: 김씨네" />

                <div className="subTitle" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>가족 주소</span>
                  <button type="button" className="ghostBtn" onClick={() => openAddressSearch("family")} style={{ width: "auto" }}>주소 검색</button>
                </div>
                <label className="label">시/도</label>
                <input className="input" value={createAddr.cityDo} onChange={(e) => setCreateAddr(v => ({ ...v, cityDo: e.target.value }))} />
                <label className="label">구/군</label>
                <input className="input" value={createAddr.guGun} onChange={(e) => setCreateAddr(v => ({ ...v, guGun: e.target.value }))} />
                <label className="label">동</label>
                <input className="input" value={createAddr.dong} onChange={(e) => setCreateAddr(v => ({ ...v, dong: e.target.value }))} />
                <label className="label">번지</label>
                <input className="input" value={createAddr.bunji} onChange={(e) => setCreateAddr(v => ({ ...v, bunji: e.target.value }))} placeholder="예: 123-45" />

                <button className="ghostBtn" type="button" onClick={() => setCreateMode(false)}>⇦ 검색으로 돌아가기</button>
              </>
            )}
          </>)}

          {step === 6 && (() => {
            const displayName = (finalUser?.userName ?? name)?.trim();
            const displayPhone = formatPhoneView(finalUser?.phoneNumber ?? phoneNumber);
            return (
              <>
                <div className="sectionTitle">회원가입 완료</div>
                <div className="resultBox resultPairs">
                  <div className="pair">
                    <span className="k">이름</span>
                    <span className="v">{displayName || '-'}</span>
                  </div>
                  <div className="pair">
                    <span className="k">전화번호</span>
                    <span className="v">{displayPhone || '-'}</span>
                  </div>
                </div>
                <div className="hint">확인을 누르면 홈으로 이동합니다.</div>
              </>
            );
          })()}

          {error && <p className="error">{error}</p>}

          <div className="formFooter">
            <button className="primaryBtn" onClick={goNext} disabled={loading}>
              {loading ? "처리 중…" : step < 6 ? "다음" : "확인"}
            </button>
          </div>
        </div>
      </div>

      {/* 주소검색 오버레이(공용) */}
      {showPostcode && (
        <div className="pcOverlay" onClick={() => setShowPostcode(false)}>
          <div className="pcInner" onClick={(e) => e.stopPropagation()}>
            <div ref={postcodeRef} style={{ width: "100%", height: "100%" }} />
          </div>
        </div>
      )}

      <style>{`
        .card.signup { height: 100vh; overflow-y: auto; display:flex; flex-direction:column; }
        .screen { flex:1; padding-bottom:140px; }
        .formFooter { position: sticky; bottom: 0; z-index: 20; background:#fff; padding:12px 16px calc(16px + env(safe-area-inset-bottom)); box-shadow:0 -8px 24px rgba(0,0,0,.08); border-top:1px solid #eee; }
        .primaryBtn { width:100%; }

        .header{ display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
        .stepTitle{ font-weight:700; color:#6a34d6; }
        .grid4{ display:grid; grid-template-columns:repeat(2,1fr); gap:12px; margin:8px 0 16px; }
        .uploadSlot{ position:relative; width:100%; padding-top:100%; border:1px dashed #c9c9c9; border-radius:12px; cursor:pointer; overflow:hidden; background:#fafafa; }
        .uploadPlaceholder{ position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; color:#777; font-size:14px; text-align:center; }
        .uploadImg{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
        .ghostBtn{ width:100%; margin-top:8px; background:#f6f4ff; color:#6a34d6; border:1px solid #e1d9ff; border-radius:10px; padding:10px 12px; }
        .resultBox{ border:1px solid #eee; border-radius:12px; padding:12px; background:#fafafa; }
        .hintBox{ margin-top:8px; padding:8px 10px; background:#f6f6f6; border-radius:10px; color:#444; }
        .hint{ color:#666; font-size:13px; }
        .pcOverlay{ position: fixed; inset: 0; background: rgba(0,0,0,.35); display:flex; align-items:center; justify-content:center; z-index:99999; }
        .pcInner{ width:min(720px, 92vw); height:min(620px, 82vh); background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,.25); }

        .resultPairs { display: grid; gap: 10px; }
        .pair { display: flex; align-items: center; }
        .pair .k::after { content: ":"; display: inline-block; padding: 0 10px 0 8px; color: #999; }
        .pair .v { font-weight: 700; }

        .iconBtn.backBtn { border:none; background:transparent; font-size:20px; line-height:1; padding:6px 8px; cursor:pointer; }
      `}</style>
    </div>
  );
}
