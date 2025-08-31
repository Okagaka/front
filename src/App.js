import "./App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import FamilyCreate from "./pages/FamilyCreate";
import MainMap from "./pages/MainMap";

export default function App() {
  return (
    <div className="phone">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/family/create" element={<FamilyCreate />} />
          <Route path="/home" element={<MainMap />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}
