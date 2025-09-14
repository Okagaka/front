import { useEffect, useRef } from "react";
import { Client } from "@stomp/stompjs";

/** ===== WS URL 계산 (하드코딩 제거) ===== */
function computeWsUrl() {
  // 1순위: REACT_APP_WS_URL (ex: wss://13.209.57.96:8080/ws-location)
  if (process.env.REACT_APP_WS_URL) return process.env.REACT_APP_WS_URL;

  // 2순위: REACT_APP_API_BASE에서 프로토콜/호스트를 따와서 ws(s)로 변환
  const httpBase = process.env.REACT_APP_API_BASE || window.location.origin;
  const u = new URL(httpBase.startsWith("http") ? httpBase : `https://${httpBase}`);
  const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
  const wsPath = process.env.REACT_APP_WS_PATH || "/ws-location"; // 경로도 env로

  // u.host는 포트 포함(host:port). 8080 하드코딩 제거!
  return `${wsProto}//${u.host}${wsPath}`;
}

function getAuthToken() {
  return (
    localStorage.getItem("accessToken") ||
    sessionStorage.getItem("jwt") ||
    ""
  );
}

export function useLiveLocationShare({ groupId, userId, userName } = {}) {
  const clientRef = useRef(null);

  useEffect(() => {
    const WS_URL = computeWsUrl();
    const token = getAuthToken();

    console.log("[LiveWS] will connect to:", WS_URL);
    console.log("[LiveWS] has token:", Boolean(token));

    const client = new Client({
      brokerURL: WS_URL,
      connectHeaders: token ? { Authorization: `Bearer ${token}` } : {},
      reconnectDelay: 5000,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
    });

    client.onConnect = () => {
      console.log("✅ STOMP CONNECTED");

      // publish 목적지도 env로 분리 (기본값 유지)
      const DEST = process.env.REACT_APP_STOMP_DEST || "/app/location/update";

      // 서버 명세: RealTimeUpdate wrapper { type, payload }
      const send = (lat, lng) => {
        const wire = {
          type: "USER_UPDATE",
          payload: {
            latitude: lat,
            longitude: lng,
            ...(groupId ? { groupId } : {}),
            ...(userId ? { userId } : {}),
            ...(userName ? { name: userName } : {}),
          },
        };
        client.publish({ destination: DEST, body: JSON.stringify(wire) });
      };

      // 현재 위치 1회 전송
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          ({ coords }) => send(coords.latitude, coords.longitude),
          (err) => console.warn("geolocation getCurrentPosition error:", err),
          { enableHighAccuracy: true, timeout: 8000 }
        );
      }

      // 이후 watch
      const watchId = navigator.geolocation?.watchPosition(
        ({ coords }) => send(coords.latitude, coords.longitude),
        (err) => console.warn("geolocation watchPosition error:", err),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );

      clientRef.current = { client, watchId };
    };

    client.onWebSocketError = (e) => {
      console.error("🛑 WebSocket error:", e);
    };
    client.onStompError = (frame) => {
      console.error("🛑 STOMP error:", frame.headers["message"], frame.body);
    };

    client.activate();

    return () => {
      if (clientRef.current?.watchId != null) {
        navigator.geolocation.clearWatch(clientRef.current.watchId);
      }
      client.deactivate();
    };
  }, [groupId, userId, userName]);

  return null;
}
