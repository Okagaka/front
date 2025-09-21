// src/layouts/AppShell.jsx
import React, { useState, useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";

export default function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
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

            {/* ✅ 모든 페이지에서 마이크 표시(헤더가 보일 때) */}
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
          </div>
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

      <style>{`
        .appShell{ position:relative; min-height:110dvh; background:#f6f7fb; color:#222; overflow:hidden; border-radius:inherit; }

        /* 헤더 */
        .appBar{
          position:sticky; top:0; z-index:60;
          height:65px;
          display:flex; align-items:center; justify-content:center;
          padding:0 12px; margin-bottom:-14px; padding-bottom:14px;
          background:#6a34d6; color:#fff;
          box-shadow:0 2px 10px rgba(0,0,0,.08);
          border-radius:16px 16px 0 0;
        }
        /* 3열 Grid: 좌 40px / 중앙 1fr / 우 40px */
        .appBarGrid{
          display:grid; grid-template-columns: 40px 1fr 40px;
          align-items:center;
          column-gap:24px;             /* 햄버거-브랜드-마이크 간격 */
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

        /* 아이콘 버튼 */
        .iconBtn{
          width:40px; height:40px;
          display:flex; align-items:center; justify-content:center;
          border:none; outline:none; background:transparent; color:#fff;
          font-size:22px; line-height:1; border-radius:50%;
          -webkit-tap-highlight-color: transparent;
          cursor:pointer;
        }
        .iconBtn:hover, .iconBtn:active{ background:transparent; transform:none; }

        .pageBody{ padding:0; }
        .pageBody.noHeader{ padding-top:0; }

        .backdrop{
          position:absolute; inset:0; background:rgba(0,0,0,0);
          opacity:0; pointer-events:none; transition:opacity .2s;
          z-index:49; border-radius:inherit;
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
        /* 앱바와 안 겹치게 살짝 내리기 */
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
