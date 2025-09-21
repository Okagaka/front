// src/layouts/AppShell.jsx
import React, { useState, useEffect, useRef } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";

/* ===== 공통 ===== */
const API_BASE = (process.env.REACT_APP_API_BASE || "").replace(/\/$/, "");

/** JWT 복구 */
function getJwt() {
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

/** STT 업로드 호출: WAV Blob → 텍스트 */
async function sttUpload(wavBlob, { signal } = {}) {
  if (!wavBlob) throw new Error("오디오가 없습니다.");
  const jwt = getJwt();
  if (!jwt) throw new Error("로그인이 필요합니다. 토큰이 없습니다.");

  const form = new FormData();
  form.append("file", wavBlob, "recording.wav");

  const urls = [];
  if (API_BASE) urls.push(`${API_BASE}/api/stt`);
  urls.push("/api/stt");

  let lastErr;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
        body: form,
        credentials: "include",
        signal,
      });
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        const text =
          (typeof body?.data === "string" && body.data) ||
          body?.text ||
          body?.result ||
          "";
        return { text, raw: body };
      }
      // 오류 응답 바디 추출
      let payload = {};
      try { payload = await res.json(); } catch {}
      const msg =
        payload?.msg || payload?.message || `HTTP ${res.status} ${res.statusText}`;
      lastErr = new Error(msg);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("STT 업로드 실패");
}

/* ===== WAV 인코딩 유틸(PCM 16-bit, mono) ===== */
function floatTo16BitPCM(float32Array) {
  const out = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
function encodeWAVPCM16(monoFloat32, sampleRate) {
  const pcm16 = floatTo16BitPCM(monoFloat32);
  const bytesPerSample = 2;
  const blockAlign = 1 * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm16.length * bytesPerSample;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  // fmt sub-chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM
  view.setUint16(20, 1, true);  // audio format = PCM
  view.setUint16(22, 1, true);  // channels = 1 (mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  // data sub-chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // PCM data
  let offset = 44;
  for (let i = 0; i < pcm16.length; i++, offset += 2) {
    view.setInt16(offset, pcm16[i], true);
  }
  return new Blob([view], { type: "audio/wav" });
}

/** 버퍼 병합 */
function mergeFloat32(buffers, totalLen) {
  const out = new Float32Array(totalLen);
  let o = 0;
  for (const b of buffers) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

export default function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 녹음/업로드 상태
  // idle -> recording -> uploading -> idle
  const [recState, setRecState] = useState("idle");
  const [snack, setSnack] = useState("");
  const [elapsed, setElapsed] = useState(0);

  // 오디오 캡처 관련 ref
  const mediaStreamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const sourceRef = useRef(null);
  const procRef = useRef(null);
  const chunksRef = useRef([]);      // Float32Array 조각들
  const lengthRef = useRef(0);       // 총 샘플 수
  const startAtRef = useRef(0);
  const tickTimerRef = useRef(null);
  const abortRef = useRef(null);

  const nav = useNavigate();
  const loc = useLocation();

  // 헤더를 숨길 경로들
  const hideHeader = ["/", "/signup", "/family/create"].includes(loc.pathname);

  const openDrawer = () => {
    setDrawerOpen(true);
    window.dispatchEvent(new CustomEvent("app/drawer-open"));
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    window.dispatchEvent(new CustomEvent("app/drawer-close"));
  };
  const toggleDrawer = () => (drawerOpen ? closeDrawer() : openDrawer());

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && closeDrawer();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 라우트 변경 시 드로어 닫기
  useEffect(() => { closeDrawer(); }, [loc.pathname]);

  // 스낵바 자동 숨김
  useEffect(() => {
    if (!snack) return;
    const t = setTimeout(() => setSnack(""), 2500);
    return () => clearTimeout(t);
  }, [snack]);

  // 페이지 떠날 때 녹음 정리
  useEffect(() => {
    return () => {
      stopRecording({ silent: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 외부에서 마이크 토글 이벤트를 보낼 수도 있으니 유지
  useEffect(() => {
    const onMicToggle = () => {
      if (recState === "idle") startRecording();
      else if (recState === "recording") stopRecording();
    };
    window.addEventListener("app/mic-toggle", onMicToggle);
    return () => window.removeEventListener("app/mic-toggle", onMicToggle);
  }, [recState]);

  /* ===== 녹음 시작/종료 ===== */
  async function startRecording() {
    if (recState !== "idle") return;
    try {
      setSnack("🎙️ 녹음을 시작합니다…");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
        video: false,
      });
      mediaStreamRef.current = stream;

      const AudioContextCtor =
        window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContextCtor({ latencyHint: "interactive" });
      audioCtxRef.current = ctx;

      const src = ctx.createMediaStreamSource(stream);
      sourceRef.current = src;

      // ScriptProcessorNode(브라우저 호환성이 가장 넓음)
      const bufferSize = 4096;
      const proc = ctx.createScriptProcessor(bufferSize, 1, 1);
      proc.onaudioprocess = (e) => {
        if (recState !== "recording") return;
        const input = e.inputBuffer.getChannelData(0);
        // 복사본 저장(원본 버퍼는 순환됨)
        const copy = new Float32Array(input.length);
        copy.set(input);
        chunksRef.current.push(copy);
        lengthRef.current += copy.length;
      };
      procRef.current = proc;

      src.connect(proc);
      proc.connect(ctx.destination); // iOS에서 동작 보장용(음소거 상태로 연결)

      // 타이머 시작
      startAtRef.current = Date.now();
      setElapsed(0);
      tickTimerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startAtRef.current) / 1000));
      }, 200);

      setRecState("recording");
    } catch (e) {
      console.error("녹음 시작 실패:", e);
      setSnack(
        e?.name === "NotAllowedError"
          ? "마이크 권한이 필요합니다."
          : "녹음을 시작할 수 없어요."
      );
      stopRecording({ silent: true });
    }
  }

  async function stopRecording({ silent = false } = {}) {
    if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; }
    try {
      procRef.current?.disconnect();
      sourceRef.current?.disconnect();
    } catch {}
    try { audioCtxRef.current?.close(); } catch {}
    try {
      mediaStreamRef.current?.getTracks()?.forEach((t) => t.stop());
    } catch {}

    const hadRecording = recState === "recording" && lengthRef.current > 0;

    procRef.current = null;
    sourceRef.current = null;
    audioCtxRef.current = null;
    mediaStreamRef.current = null;

    setRecState(hadRecording ? "uploading" : "idle");

    if (!hadRecording) {
      chunksRef.current = [];
      lengthRef.current = 0;
      if (!silent) setSnack("녹음된 소리가 없습니다.");
      setRecState("idle");
      return;
    }

    // Float32 → WAV(PCM16, mono)
    try {
      const sampleRate = 16000; // 업로드 효율을 위해 16kHz로 리샘플(간단한 선형 보간)
      const originalRate = sourceRef.current?.context?.sampleRate || 44100;

      const merged = mergeFloat32(chunksRef.current, lengthRef.current);
      chunksRef.current = [];
      lengthRef.current = 0;

      let mono = merged;

      // 간단 리샘플링(선형 보간)
      if (originalRate !== sampleRate) {
        const ratio = originalRate / sampleRate;
        const newLen = Math.round(mono.length / ratio);
        const resampled = new Float32Array(newLen);
        for (let i = 0; i < newLen; i++) {
          const idx = i * ratio;
          const i0 = Math.floor(idx);
          const i1 = Math.min(i0 + 1, mono.length - 1);
          const frac = idx - i0;
          resampled[i] = mono[i0] * (1 - frac) + mono[i1] * frac;
        }
        mono = resampled;
      }

      const wavBlob = encodeWAVPCM16(mono, sampleRate);

      // 업로드
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      const { text } = await sttUpload(wavBlob, { signal: abortRef.current.signal });

      const pretty = (text || "").trim();
      setSnack(pretty ? `🎤 "${pretty}"` : "음성을 인식했지만 내용이 비어있어요.");
      try { sessionStorage.setItem("lastSpeechText", pretty); } catch {}

      // 전역 이벤트 브로드캐스트
      window.dispatchEvent(new CustomEvent("app/stt-result", {
        detail: { text: pretty, at: Date.now() },
      }));
      window.dispatchEvent(new CustomEvent("app/user-state-update", {
        detail: { source: "stt", recognizedText: pretty },
      }));
    } catch (e) {
      console.error("녹음 업로드 실패:", e);
      setSnack(`⚠ ${e?.message || "업로드 중 오류가 발생했어요."}`);
      window.dispatchEvent(new CustomEvent("app/stt-error", {
        detail: { error: String(e?.message || e) },
      }));
    } finally {
      setRecState("idle");
      setElapsed(0);
    }
  }

  /* ===== UI ===== */
  const isRecording = recState === "recording";
  const isUploading = recState === "uploading";

  return (
    <div className="appShell" onClick={closeDrawer}>
      {!hideHeader && (
        <header className="appBar" onClick={(e) => e.stopPropagation()}>
          {/* 3열 Grid: 좌 햄버거 / 중앙 브랜드 / 우 마이크 */}
          <div className="appBarGrid" style={{ transform: "translateY(6px)" }}>
            <button
              className="iconBtn"
              aria-label={drawerOpen ? "메뉴 닫기" : "메뉴 열기"}
              aria-expanded={drawerOpen}
              onClick={(e) => { e.stopPropagation(); toggleDrawer(); }}
            >
              ☰
            </button>

            <div className="brandRow" role="img" aria-label="오카가카">
              <span className="car" aria-hidden>🚗</span>
              <strong>오카가카</strong>
            </div>

            {/* 🎤 마이크: 클릭으로 토글 녹음, 다시 클릭하면 업로드 */}
            <button
              className={`iconBtn micBtn ${isRecording ? "rec" : ""} ${isUploading ? "busy" : ""}`}
              aria-label={isRecording ? "녹음 중지" : (isUploading ? "업로드 중" : "녹음 시작")}
              title={isRecording ? "눌러서 녹음 종료" : (isUploading ? "업로드 중…" : "말하기")}
              onClick={(e) => {
                e.stopPropagation();
                if (isUploading) return;
                if (isRecording) stopRecording();
                else startRecording();
              }}
            >
              {isUploading ? "⏳" : "🎤"}
            </button>
          </div>

          {/* 녹음 중이면 작은 바 */}
          {isRecording && (
            <div className="recordStrip" aria-live="polite">
              <span className="dot" /> 녹음 중… {elapsed}s
              <button className="stopNow" onClick={(e)=>{e.stopPropagation(); stopRecording();}}>
                종료
              </button>
            </div>
          )}
        </header>
      )}

      {/* 드로어 백드롭 */}
      <div
        className={`backdrop ${drawerOpen ? "show" : ""}`}
        onClick={closeDrawer}
        aria-hidden={!drawerOpen}
      />

      {/* 사이드 드로어 */}
      <aside
        className={`drawer ${drawerOpen ? "open" : ""}`}
        onClick={(e) => e.stopPropagation()}
        aria-label="사이드 메뉴"
      >
        <div className="drawerHeader">
          <div className="brandRow">
            <span className="car" aria-hidden>🚗</span>
            <strong>오카가카</strong>
          </div>
        </div>

        <nav className="menuList">
          <button className="menuItem" onClick={() => { closeDrawer(); nav("/home"); }}>
            <span className="miIcon">🏠</span><span>홈 화면</span>
          </button>
          <button className="menuItem" onClick={() => { closeDrawer(); nav("/reserve"); }}>
            <span className="miIcon">📅</span><span>차량 예약</span>
          </button>
          <button className="menuItem" onClick={() => { closeDrawer(); nav("/carpool"); }}>
            <span className="miIcon">🧑‍🧒‍🧒</span><span>카풀 내역</span>
          </button>
          <button className="menuItem" onClick={() => { closeDrawer(); nav("/history"); }}>
            <span className="miIcon">🧾</span><span>이용 내역</span>
          </button>
          <button className="menuItem" onClick={() => { closeDrawer(); nav("/me"); }}>
            <span className="miIcon">👤</span><span>내 정보</span>
          </button>
          <button className="menuItem" onClick={() => { closeDrawer(); nav("/vehicle/register"); }}>
            <span className="miIcon">🚘</span><span>차량 등록</span>
          </button>

          <hr className="menuDivider" />
          <button
            className="menuItem danger"
            onClick={() => {
              closeDrawer();
              sessionStorage.removeItem("auth");
              alert("로그아웃 되었습니다.");
              nav("/", { replace: true });
            }}
          >
            <span className="miIcon">↩</span><span>로그아웃</span>
          </button>
        </nav>
      </aside>

      <div className={`pageBody ${hideHeader ? "noHeader" : ""}`} onClick={(e)=>e.stopPropagation()}>
        <Outlet />
      </div>

      {/* 스낵바 */}
      <div className={`snack ${snack ? "show" : ""}`} role="status" aria-live="polite">
        {snack}
      </div>

      <style>{`
        .appShell{ position:relative; min-height:110dvh; background:#f6f7fb; color:#222; overflow:hidden; border-radius:inherit; }

        /* 헤더 */
        .appBar{
          position:sticky; top:0; z-index:60;
          padding:0 12px; margin-bottom:-14px; padding-bottom:14px;
          background:#6a34d6; color:#fff;
          box-shadow:0 2px 10px rgba(0,0,0,.08);
          border-radius:16px 16px 0 0;
        }
        .appBarGrid{
          height:65px;
          display:grid; grid-template-columns: 40px 1fr 40px;
          align-items:center;
          column-gap:24px;
          width:100%;
          max-width:560px;
          margin:0 auto;
        }
        .brandRow{
          justify-self:center;
          display:flex; align-items:center; gap:8px;
          font-size:16px; font-weight:700;
        }
        .car{ font-size:20px; }
        .iconBtn{
          width:40px; height:40px;
          display:flex; align-items:center; justify-content:center;
          border:none; outline:none; background:transparent; color:#fff;
          font-size:22px; line-height:1; border-radius:50%;
          -webkit-tap-highlight-color: transparent;
          cursor:pointer;
        }
        .iconBtn.busy{ opacity:.65; cursor:default; }
        .micBtn.rec{ animation: pulse 1s infinite; }
        @keyframes pulse { 0%{transform:scale(1)} 50%{transform:scale(1.08)} 100%{transform:scale(1)} }

        .recordStrip{
          display:flex; align-items:center; justify-content:center; gap:10px;
          height:32px; margin:-4px auto 6px;
          background:rgba(0,0,0,.12); color:#fff; width:fit-content;
          border-radius:999px; padding:4px 10px; font-size:13px;
        }
        .recordStrip .dot{ width:8px; height:8px; background:#ff5a5a; border-radius:50%; display:inline-block; box-shadow:0 0 0 2px rgba(255,90,90,.35); }
        .recordStrip .stopNow{ margin-left:8px; background:#ffffff22; border:1px solid #ffffff55; color:#fff; border-radius:10px; padding:2px 8px; font-size:12px; }

        .pageBody{ padding:0; }
        .pageBody.noHeader{ padding-top:0; }

        .backdrop{
          position:absolute; inset:0; background:rgba(0,0,0,0);
          opacity:0; pointer-events:none; transition:opacity .2s; z-index:49; border-radius:inherit;
        }
        .backdrop.show{ opacity:.35; background:rgba(0,0,0,.45); pointer-events:auto; }

        .drawer{
          position:absolute; top:0; bottom:0; left:0;
          width:min(80vw,320px);
          background:#fff;
          transform:translateX(-110%);
          transition:transform .22s ease-out;
          z-index:50; display:flex; flex-direction:column;
          box-shadow:6px 0 22px rgba(0,0,0,.18);
          border-top-right-radius:14px; border-bottom-right-radius:14px;
        }
        .drawer.open{ transform:translateX(0); }
        .drawerHeader{
          display:flex; align-items:center; justify-content:space-between;
          padding:14px 16px; border-bottom:1px solid #f0f0f3; background:#faf9ff;
        }
        .menuList{ margin-top:10px; padding:8px 8px 16px; display:flex; flex-direction:column; gap:6px; overflow:auto; }
        .menuItem{
          display:flex; align-items:center; gap:12px; padding:12px;
          background:#fff; border:1px solid #f0eefc; border-radius:12px;
          cursor:pointer; font-size:15px; transition:background .12s, transform .02s;
        }
        .menuItem:hover{ background:#f7f4ff; }
        .menuItem:active{ transform:scale(.995); }
        .menuItem .miIcon{ width:24px; text-align:center; font-size:18px; }
        .menuDivider{ border:none; border-top:1px solid #eee; margin:6px 6px; }
        .menuItem.danger{ color:#7b2bd5; font-weight:700; border-color:#f1e9ff; background:#fbf8ff; }

        /* 스낵바 */
        .snack{
          position:fixed; left:50%; bottom:18px; transform:translateX(-50%) translateY(14px);
          max-width:86vw; padding:10px 14px; border-radius:12px;
          background:#151515; color:#fff; font-weight:600; font-size:14px;
          box-shadow:0 10px 28px rgba(0,0,0,.28);
          opacity:0; pointer-events:none; transition:all .2s ease-out; z-index:80;
          white-space:pre-wrap; text-align:center;
        }
        .snack.show{ opacity:1; transform:translateX(-50%) translateY(0); }

        @media (prefers-color-scheme: dark){
          .appShell{ background:#0f1115; color:#e7e7ea; }
          .pageBody{ color:#e7e7ea; }
          .drawer{ background:#151821; box-shadow:6px 0 22px rgba(0,0,0,.55); }
          .drawerHeader{ background:#141728; border-bottom-color:#202437; }
          .menuItem{ background:#171b26; border-color:#23283a; }
          .menuItem:hover{ background:#1b2030; }
          .backdrop.show{ background:rgba(0,0,0,.6); }
          .snack{ background:#0f0f12; }
        }
      `}</style>
    </div>
  );
}
