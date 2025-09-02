import React, { useState, useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";

export default function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();

  const hideHeader = ["/", "/signup", "/family/create"].includes(loc.pathname);
  const showMic = loc.pathname === "/home";

  // 드로어 열고/닫을 때 전역 이벤트 발행
  const openDrawer = () => {
    setDrawerOpen(true);
    window.dispatchEvent(new CustomEvent("app/drawer-open"));
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    window.dispatchEvent(new CustomEvent("app/drawer-close"));
  };
  const toggleDrawer = () => (drawerOpen ? closeDrawer() : openDrawer());

  // ESC 로 닫기
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && closeDrawer();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 라우트 변경 시 닫기
  useEffect(() => { closeDrawer(); }, [loc.pathname]);

  return (
    <div className="appShell" onClick={closeDrawer}>
      {!hideHeader && (
        <header className="appBar" onClick={(e) => e.stopPropagation()}>
          <button
            className="iconBtn"
            aria-label={drawerOpen ? "메뉴 닫기" : "메뉴 열기"}
            aria-expanded={drawerOpen}
            onClick={(e) => { e.stopPropagation(); toggleDrawer(); }}
          >
            ☰
          </button>
          <div className="brandRow">
            <span className="car" aria-hidden>🚗</span>
            <strong>오카가카</strong>
          </div>

          {showMic ? (
            <button
              className="iconBtn"
              aria-label="말하기"
              title="말하기"
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent("app/mic-toggle"));
              }}
            >
              🎤
            </button>
          ) : (
            <div className="rightGap" aria-hidden />
          )}
        </header>
      )}

      <div
        className={`backdrop ${drawerOpen ? "show" : ""}`}
        onClick={closeDrawer}
        aria-hidden={!drawerOpen}
      />

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
          <button className="closeBtn" onClick={closeDrawer} aria-label="메뉴 닫기">×</button>
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

      <style>{`
        .appShell{ position:relative; min-height:110dvh; background:#f6f7fb; color:#222; overflow:hidden; border-radius:inherit; }
        .appBar{ position:sticky; top:0; z-index:60; height:56px; display:flex; align-items:center; justify-content:space-between; padding:0 12px; background:#6a34d6; color:#fff; box-shadow:0 2px 10px rgba(0,0,0,.08); }
        .iconBtn{ width:40px; height:40px; border:none; border-radius:12px; background:rgba(255,255,255,.12); color:#fff; font-size:20px; display:flex; align-items:center; justify-content:center; cursor:pointer; }
        .iconBtn:hover{ background:rgba(255,255,255,.18); }
        .brandRow{ display:flex; align-items:center; gap:8px; font-size:16px; }
        .car{ font-size:20px; }
        .rightGap{ width:40px; }
        .pageBody{ padding:0; }
        .pageBody.noHeader{ padding-top:0; }
        .backdrop{ position:absolute; inset:0; background:rgba(0,0,0,0); opacity:0; pointer-events:none; transition:opacity .2s; z-index:49; border-radius:inherit; }
        .backdrop.show{ opacity:.35; background:rgba(0,0,0,.45); pointer-events:auto; }
        .drawer{ position:absolute; top:0; bottom:0; left:0; width:min(80vw,320px); background:#fff; transform:translateX(-110%); transition:transform .22s ease-out; z-index:50; display:flex; flex-direction:column; box-shadow:6px 0 22px rgba(0,0,0,.18); border-top-right-radius:14px; border-bottom-right-radius:14px; }
        .drawer.open{ transform:translateX(0); }
        .drawerHeader{ display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid #f0f0f3; background:#faf9ff; }
        .closeBtn{ width:36px; height:36px; border:none; border-radius:10px; background:#f5f5f7; font-size:20px; cursor:pointer; }
        .menuList{ padding:8px 8px 16px; display:flex; flex-direction:column; gap:6px; overflow:auto; }
        .menuItem{ display:flex; align-items:center; gap:12px; padding:12px; background:#fff; border:1px solid #f0eefc; border-radius:12px; cursor:pointer; font-size:15px; transition:background .12s, transform .02s; }
        .menuItem:hover{ background:#f7f4ff; }
        .menuItem:active{ transform:scale(.995); }
        .menuItem .miIcon{ width:24px; text-align:center; font-size:18px; }
        .menuDivider{ border:none; border-top:1px solid #eee; margin:6px 6px; }
        .menuItem.danger{ color:#7b2bd5; font-weight:700; border-color:#f1e9ff; background:#fbf8ff; }
        @media (prefers-color-scheme: dark){
          .appShell{ background:#0f1115; color:#e7e7ea; }
          .pageBody{ color:#e7e7ea; }
          .drawer{ background:#151821; box-shadow:6px 0 22px rgba(0,0,0,.55); }
          .drawerHeader{ background:#141728; border-bottom-color:#202437; }
          .menuItem{ background:#171b26; border-color:#23283a; }
          .menuItem:hover{ background:#1b2030; }
          .backdrop.show{ background:rgba(0,0,0,.6); }
        }
      `}</style>
    </div>
  );
}
