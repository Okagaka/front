// src/App.js
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import FamilyCreate from "./pages/FamilyCreate";
import MainMap from "./pages/MainMap";
import Reserve from "./pages/Reserve";
import AppShell from "./layouts/AppShell"; // ✅ 공통 레이아웃

export default function App() {
  return (
    <div className="phone">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/family/create" element={<FamilyCreate />} />

          {/* 공통 레이아웃 안에 자식 페이지 배치 */}
          <Route element={<AppShell />}>
            <Route path="/home" element={<MainMap />} />
            <Route path="/reserve" element={<Reserve />} />
            {/* 필요하면 추가: /carpool, /history, /me 등 */}
          </Route>

          {/* 루트 접근 시 홈으로 */}
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}
