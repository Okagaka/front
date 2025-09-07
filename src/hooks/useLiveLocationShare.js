// src/hooks/useLiveLocationShare.js
import { useEffect, useRef } from "react";
import { Client } from "@stomp/stompjs";

// ✅ WS URL을 환경변수 우선 사용, 없으면 로컬로 폴백
const WS_URL =
  process.env.REACT_APP_WS_URL ||
  (window.location.protocol === "https:"
    ? `wss://${window.location.hostname}/ws-location`
    : `ws://${window.location.hostname}:8080/ws-location`);

function getAuthToken() {
  // 로그인 시 저장해둔 토큰 키에 맞추세요 (예: accessToken)
  return (
    localStorage.getItem("accessToken") ||
    sessionStorage.getItem("jwt") ||
    ""
  );
}

export function useLiveLocationShare() {
  const clientRef = useRef(null);

  useEffect(() => {
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

      // 위치 전송: 최초 한번 + 이후 변경 watch
      const send = (lat, lng) => {
        const body = JSON.stringify({ latitude: lat, longitude: lng });
        console.log("📤 sending location", { lat, lng });
        client.publish({ destination: "/app/location/update", body });
      };

      // 현재 위치 한 번 보내기
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          ({ coords }) => send(coords.latitude, coords.longitude),
          (err) => console.warn("geolocation getCurrentPosition error:", err),
          { enableHighAccuracy: true, timeout: 8000 }
        );
      }

      // 이후 변경 감지해서 주기 전송
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
  }, []);

  return null;
}
