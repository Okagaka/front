import React from "react";
import { useLiveLocationShare } from "../hooks/useLiveLocationShare";

export default function LocationSharing() {
  useLiveLocationShare();
  return <div>📍 위치 공유 활성화됨</div>;
}
