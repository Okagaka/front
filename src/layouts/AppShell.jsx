// src/layouts/AppShell.jsx
import React, { useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";

export default function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const nav = useNavigate();

  return (
    <div className="mainShell" onClick={() => setDrawerOpen(false)}>
      <header className="appBar" onClick={(e)=>e.stopPropagation()}>
        {/* <button className="appIcon" aria-label="메뉴"
          onClick={() => setDrawerOpen(true)}>☰</button>
        <div className="appTitle">오카가카</div>
        <div style={{width:40}} /> */}
      </header>

      <div className={`backdrop ${drawerOpen ? "show" : ""}`} onClick={() => setDrawerOpen(false)} />
      <aside className={`drawer ${drawerOpen ? "open" : ""}`} onClick={(e) => e.stopPropagation()} aria-label="사이드 메뉴">
        <div className="drawerHeader">
          <div className="brandRow"><span className="car">🚗</span><strong>오카가카</strong></div>
          <button className="closeBtn" onClick={() => setDrawerOpen(false)}>×</button>
        </div>
        <nav className="menuList">
          <button className="menuItem" onClick={() => { setDrawerOpen(false); nav("/"); }}>
            <span className="miIcon">🏠</span><span>홈 화면</span>
          </button>
          <button className="menuItem" onClick={() => { setDrawerOpen(false); nav("/reserve"); }}>
            <span className="miIcon">📅</span><span>차량 예약</span>
          </button>
          <button className="menuItem" onClick={() => { setDrawerOpen(false); nav("/carpool"); }}>
            <span className="miIcon">🧑‍🧒‍🧒</span><span>카풀 내역</span>
          </button>
          <button className="menuItem" onClick={() => { setDrawerOpen(false); nav("/history"); }}>
            <span className="miIcon">🧾</span><span>이용 내역</span>
          </button>
          <button className="menuItem" onClick={() => { setDrawerOpen(false); nav("/me"); }}>
            <span className="miIcon">👤</span><span>내 정보</span>
          </button>
          <hr className="menuDivider" />
          <button className="menuItem danger" onClick={() => {
            setDrawerOpen(false); sessionStorage.removeItem("auth"); alert("로그아웃 되었습니다."); nav("/", { replace: true });
          }}>
            <span className="miIcon">↩</span><span>로그아웃</span>
          </button>
        </nav>
      </aside>

      <Outlet />
    </div>
    
  );
}
