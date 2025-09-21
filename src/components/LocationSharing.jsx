import React from "react";
import { useLiveLocationShare } from "../hooks/useLiveLocationShare";

export default function LocationSharing() {
  // 필요하면 로그인 정보에서 groupId/userId/name을 내려주세요.
  useLiveLocationShare({
    groupId: Number(sessionStorage.getItem("groupId")) || undefined,
    userId: Number(sessionStorage.getItem("userId")) || undefined,
    userName: (JSON.parse(sessionStorage.getItem("auth") || "{}")?.name) || undefined,
  });
  return <div>📍 위치 공유 활성화됨</div>;
}
