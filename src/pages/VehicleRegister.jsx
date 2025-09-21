// src/pages/VehicleRegister.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

/** ===== 공통 설정 ===== */
const API_BASE = process.env.REACT_APP_API_BASE || "http://13.209.57.96:8080";
const REGISTER_URL = `${API_BASE}/api/vehicles/register`;

/** 저장된 토큰/프로필 가져오기 (항상 최신값 읽기) */
function safeJSON(v, fb = {}) { try { return JSON.parse(v || ""); } catch { return fb; } }
function pickToken() {
  const cands = [
    sessionStorage.getItem("jwt"),
    localStorage.getItem("jwt"),
    sessionStorage.getItem("accessToken"),
    localStorage.getItem("accessToken"),
    safeJSON(sessionStorage.getItem("auth")).token,
    safeJSON(sessionStorage.getItem("auth")).accessToken,
    safeJSON(localStorage.getItem("auth")).token,
    safeJSON(localStorage.getItem("auth")).accessToken,
    process.env.REACT_APP_TEST_JWT,
  ].filter(Boolean);
  return (cands[0] || "").toString().trim();
}
function getAuth() {
  return safeJSON(sessionStorage.getItem("auth"), {});
}

/** 응답 파싱 (명세 준수) */
function parseRegisterResponse(json) {
  const status = json?.status ?? null;
  const data = json?.data ?? null;
  if (status !== 200 || !data) {
    return { ok: false, error: json?.message || "등록 실패", json };
  }
  const vehicleId = data.vehicleId ?? null;
  const vehicleModel = data.vehicleModel ?? null;
  const apiKey = data.apiKey ?? null;
  return { ok: true, vehicleId, vehicleModel, apiKey, json };
}

/** apiKey 저장 (vehicleId -> …) */
function saveApiKey(vehicleId, info) {
  try {
    const key = "vehicle_api_keys";
    const prev = JSON.parse(localStorage.getItem(key) || "{}");
    prev[String(vehicleId)] = {
      apiKey: String(info.apiKey || ""),
      vehicleModel: String(info.vehicleModel || ""),
      vehicleNumber: String(info.vehicleNumber || ""),
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(key, JSON.stringify(prev));
  } catch {}
}

export default function VehicleRegister() {
  const nav = useNavigate();
  const auth = useMemo(getAuth, []); // 프로필만 메모

  // 폼 상태
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // 로그인/프로필 가드 (토큰은 제출 시마다 읽음)
  useEffect(() => {
    if (!auth?.name || !auth?.phone) {
      setErr("사용자 인증이 필요합니다. 다시 로그인해 주세요.");
      // nav("/", { replace: true }); // 필요 시 활성화
    }
  }, [auth, nav]);

  const validate = () => {
    if (!vehicleModel.trim() || !vehicleNumber.trim()) {
      throw new Error("차량 이름(모델)과 차량 번호를 모두 입력해 주세요.");
    }
    const loosePlate = /^[0-9가-힣\s-]{5,12}$/;
    if (!loosePlate.test(vehicleNumber.trim())) {
      throw new Error("차량 번호를 올바르게 입력해 주세요. (예: 12가3456)");
    }
  };

  async function registerVehicle(body) {
    const token = pickToken(); // ✅ 항상 최신 토큰 사용
    if (!token) return { ok: false, error: "로그인이 필요합니다. 다시 로그인해 주세요." };

    try {
      const res = await fetch(REGISTER_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        credentials: "include",
        body: JSON.stringify(body),
      });

      // 디버그에 도움: 상태와 응답 원문
      const raw = await res.text().catch(() => "");
      let payload = null; try { payload = raw ? JSON.parse(raw) : null; } catch {}
      console.debug("[register]", res.status, raw);

      // 401/403
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: payload?.message || "사용자 인증이 필요합니다." };
      }
      // 409: 그룹 중복/이미 등록됨
      if (res.status === 409) {
        // 백엔드 메시지 그대로 노출
        const msg = payload?.message || "해당 그룹에는 이미 차량이 등록되어 있습니다.";
        return { ok: false, error: msg };
      }

      if (!payload) return { ok: false, error: `HTTP ${res.status}` };

      const parsed = parseRegisterResponse(payload);
      if (!res.ok || !parsed.ok) {
        return { ok: false, error: payload?.message || `HTTP ${res.status}` };
      }
      return parsed;
    } catch (e) {
      return { ok: false, error: e?.message || "요청 실패" };
    }
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      validate();
      setLoading(true);

      const payload = {
        vehicleModel: vehicleModel.trim(),
        vehicleNumber: vehicleNumber.trim(),
      };

      const result = await registerVehicle(payload);
      if (!result.ok) throw new Error(result.error || "차량 등록에 실패했습니다.");

      const { vehicleId, apiKey } = result;
      if (vehicleId != null && apiKey) {
        saveApiKey(vehicleId, {
          apiKey,
          vehicleModel: vehicleModel.trim(),
          vehicleNumber: vehicleNumber.trim(),
        });
      }

      alert("등록이 완료됐습니다.");
      setVehicleModel("");
      setVehicleNumber("");
    } catch (error) {
      setErr(error.message || "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="vrWrap">
      <h1 className="title">차량 등록</h1>
      {err && <div className="error">⚠ {err}</div>}

      <form className="card vrCard" onSubmit={onSubmit} noValidate>
        <div className="line">
          <label className="label" htmlFor="vr-model">차량 이름(모델)</label>
          <input
            id="vr-model"
            className="input"
            placeholder="예: 제네시스 GV80"
            value={vehicleModel}
            onChange={(e)=>setVehicleModel(e.target.value)}
          />
        </div>

        <div className="line">
          <label className="label" htmlFor="vr-number">차량 번호</label>
          <input
            id="vr-number"
            className="input"
            placeholder="예: 12가5940"
            value={vehicleNumber}
            onChange={(e)=>setVehicleNumber(e.target.value)}
            inputMode="text"
          />
        </div>

        <div className="actions">
          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? "등록 중..." : "등록"}
          </button>
        </div>
      </form>

      <style>{`
        .vrWrap{ padding:14px; max-width:720px; margin:0 auto; }
        .title{ font-weight:800; font-size:22px; text-align:center; margin:6px 0 12px; }
        .error{ color:#b00020; background:#fee; border:1px solid #fcc; padding:8px 10px; border-radius:8px; margin:8px auto; max-width:480px; }
        .card{ background:#fff; border:1px solid #ecebff; border-radius:10px; padding:10px 12px; box-shadow:0 2px 6px rgba(0,0,0,.05); }
        .vrCard{ display:flex; flex-direction:column; gap:10px; }
        .line{ display:grid; grid-template-columns: 110px 1fr; gap:8px; align-items:center; }
        .label{ color:#555; font-size:14px; }
        .input{ height:40px; border:1px solid #e6e6ef; border-radius:8px; padding:8px 10px; outline:none; background:#fff; font-size:15px; }
        .actions{ margin-top:8px; display:flex; gap:6px; justify-content:flex-end; }
        .btn{ border-radius:8px; padding:9px 14px; border:none; cursor:pointer; font-size:15px; }
        .btn.primary{ background:#6a5af9; color:#fff; font-weight:700; }
        .btn:disabled{ opacity:.6; cursor:default; }
        @media (prefers-color-scheme: dark){
          .card{ background:#171b26; border-color:#23283a; }
          .label{ color:#9aa0ad; }
          .input{ background:#1b2130; border-color:#2a3044; color:#e7e7ea; }
        }
      `}</style>
    </div>
  );
}
