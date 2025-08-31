// src/pages/Reserve.jsx
import React, { useEffect, useRef, useState } from "react";

const BASE = "http://13.209.57.96:8080";
const RESERVE_ENDPOINT = `${BASE}/api/reservations`;

function extractBunjiFromData(data) {
  const pick = (s) => {
    if (!s) return "";
    const cleaned = s.replace(/\s*\(.*?\)\s*/g, "").trim();
    const m = cleaned.match(/(\d+(?:-\d+)?)$/);
    return m ? m[1] : "";
  };
  return pick(data?.jibunAddress) || pick(data?.autoJibunAddress) || "";
}
const CITY_MAP = {
  "서울": "서울특별시","부산":"부산광역시","대구":"대구광역시","인천":"인천광역시",
  "광주":"광주광역시","대전":"대전광역시","울산":"울산광역시","세종":"세종특별자치시",
  "경기":"경기도","강원":"강원특별자치도","충북":"충청북도","충남":"충청남도",
  "전북":"전북특별자치도","전남":"전라남도","경북":"경상북도","경남":"경상남도",
  "제주":"제주특별자치도",
};
function normalizeCityDo(v=""){const t=v.trim(); if(!t) return t; if(/(특별시|광역시|도|특별자치도|특별자치시)$/.test(t)) return t; return CITY_MAP[t]||t;}
function toShortCityDo(v=""){return v.replace("특별자치시","시").replace("특별자치도","도").replace("특별시","시").replace("광역시","시");}

function nowDateStr(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function nowTimeStr(){const d=new Date();return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;}

export default function Reserve(){
  const [title,setTitle]=useState("");
  const [date,setDate]=useState(nowDateStr());
  const [time,setTime]=useState(nowTimeStr());
  const [from,setFrom]=useState({cityDo:"",guGun:"",dong:"",bunji:""});
  const [to,setTo]=useState({cityDo:"",guGun:"",dong:"",bunji:""});

  const [showPostcode,setShowPostcode]=useState(false);
  const [pcTarget,setPcTarget]=useState(null);
  const postcodeRef=useRef(null);

  const [kakaoReady,setKakaoReady]=useState(false);
  useEffect(()=>{
    const t=setInterval(()=>{ if(window.kakao?.maps?.services && window.daum?.Postcode){ setKakaoReady(true); clearInterval(t); } },100);
    return ()=>clearInterval(t);
  },[]);

  const geolocateToFrom=async()=>{
    if(!kakaoReady || !navigator.geolocation) return false;
    const geocoder=new window.kakao.maps.services.Geocoder();
    return new Promise((resolve)=>{
      navigator.geolocation.getCurrentPosition(
        ({coords})=>{
          const coord=new window.kakao.maps.LatLng(coords.latitude,coords.longitude);
          geocoder.coord2Address(coord.getLng(),coord.getLat(),(result,status)=>{
            if(status!==window.kakao.maps.services.Status.OK || !result?.length) return resolve(false);
            const a=result[0].address||{};
            const cityDo=normalizeCityDo(a.region_1depth_name||"");
            const guGun=a.region_2depth_name||"";
            const dong=a.region_3depth_name||"";
            const s=(a.address_name||"").replace(/\s*\(.*?\)\s*/g,"").trim();
            const m=s.match(/(\d+(?:-\d+)?)$/);
            const bunji=m?m[1]:"";
            setFrom({cityDo,guGun,dong,bunji});
            resolve(true);
          });
        },
        ()=>resolve(false),
        {enableHighAccuracy:true,timeout:8000}
      );
    });
  };

  useEffect(()=>{
    if(!kakaoReady) return;
    (async()=>{
      let ok=await geolocateToFrom();
      if(!ok) setTimeout(()=>geolocateToFrom(), 900);
    })();
    // eslint-disable-next-line
  },[kakaoReady]);

  const openAddressSearch=(target)=>{
    if(!window.daum?.Postcode){ alert("주소 검색 스크립트를 로드하지 못했습니다."); return; }
    setPcTarget(target); setShowPostcode(true);
  };
  useEffect(()=>{
    if(!showPostcode || !postcodeRef.current || !window.daum?.Postcode) return;
    const pc=new window.daum.Postcode({
      oncomplete:(data)=>{
        const cityDo=normalizeCityDo((data.sido||"").trim());
        const guGun=(data.sigungu||"").trim();
        const dong=(data.bname||data.bname1||"").trim();
        const bunji=extractBunjiFromData(data);
        if(pcTarget==="from") setFrom({cityDo,guGun,dong,bunji});
        else setTo({cityDo,guGun,dong,bunji});
        setShowPostcode(false); setPcTarget(null);
      },
      width:"100%", height:"100%",
    });
    pc.embed(postcodeRef.current);
  },[showPostcode,pcTarget]);

  const handleSubmit=async(e)=>{
    e.preventDefault();
    const payload={
      title:title?.trim()||"개인 출근",
      date,
      arrivalTime:`${time}:00`,
      departureCityDo:toShortCityDo(from.cityDo||""),
      departureGuGun:from.guGun||"",
      departureDong:from.dong||"",
      departureBunji:from.bunji||"",
      destinationCityDo:toShortCityDo(to.cityDo||""),
      destinationGuGun:to.guGun||"",
      destinationDong:to.dong||"",
      destinationBunji:to.bunji||"",
    };
    try{
      const res=await fetch(RESERVE_ENDPOINT,{
        method:"POST",
        headers:{ "Content-Type":"application/json", Accept:"application/json" },
        body:JSON.stringify(payload),
      });
      const text=await res.text().catch(()=> "");
      if(!res.ok) throw new Error(text||`HTTP ${res.status}`);
      alert("예약이 완료되었습니다.");
    }catch(err){
      alert(err.message||"예약 중 오류가 발생했습니다.");
    }
  };

  const Input=({label,value,onChange,placeholder,type="text"})=>(
    <div className="field">
      <label className="label">{label}</label>
      <input className="input" value={value} onChange={(e)=>onChange(e.target.value)} placeholder={placeholder} type={type}/>
    </div>
  );

  return (
    <div className="phoneViewport">
      <main className="contentScroll" aria-label="차량 예약">
        <h1 className="title">차량 예약</h1>

        <form onSubmit={handleSubmit} id="reserveForm" className="formCard">
          {/* 일정 이름 */}
          <div className="field">
            <label className="label">일정 이름</label>
            <input
              className="input"
              value={title}
              placeholder="예) 출근, 마트, 병원 방문 등"
              name="title"
              autoComplete="off"
              onChange={(e)=> setTitle(e.target.value)}
            />
          </div>

          {/* 출발지 */}
          <section className="addr-section">
            <div className="row">
              <span className="section-title">출발지 설정</span>
              <div className="rowBtns">
                <button type="button" className="btn btn-secondary" onClick={()=>openAddressSearch("from")}>주소검색</button>
                <button type="button" className="btn btn-ghost" onClick={geolocateToFrom}>현 위치로 불러오기</button>
              </div>
            </div>
            <div className="addr-grid">
              <Input label="시/도" value={from.cityDo} onChange={(v)=>setFrom({...from,cityDo:v})}/>
              <Input label="구/군" value={from.guGun} onChange={(v)=>setFrom({...from,guGun:v})}/>
              <Input label="동" value={from.dong} onChange={(v)=>setFrom({...from,dong:v})}/>
              <Input label="번지" value={from.bunji} onChange={(v)=>setFrom({...from,bunji:v})}/>
            </div>
          </section>

          {/* 도착지 */}
          <section className="addr-section">
            <div className="row">
              <span className="section-title">어디로 갈까요? (도착지 설정)</span>
              <button type="button" className="btn btn-secondary" onClick={()=>openAddressSearch("to")}>주소검색</button>
            </div>
            <div className="addr-grid">
              <Input label="시/도" value={to.cityDo} onChange={(v)=>setTo({...to,cityDo:v})}/>
              <Input label="구/군" value={to.guGun} onChange={(v)=>setTo({...to,guGun:v})}/>
              <Input label="동" value={to.dong} onChange={(v)=>setTo({...to,dong:v})}/>
              <Input label="번지" value={to.bunji} onChange={(v)=>setTo({...to,bunji:v})}/>
            </div>
          </section>

          {/* 날짜/시간 */}
          <section className="datetime-section">
            <Input label="날짜" type="date" value={date} onChange={setDate}/>
            <Input label="시간" type="time" value={time} onChange={setTime}/>
          </section>

          {/* ✅ 시간 바로 아래 붙는 액션 영역 */}
          <div className="actions">
            <button type="submit" className="btn btn-primary big">예약하기</button>
          </div>

          {/* 스크롤 끝 안전 여백 */}
          <div style={{height:"max(env(safe-area-inset-bottom,0),16px)"}} />
        </form>
      </main>

      {/* 주소검색 모달 */}
      {showPostcode && (
        <div className="pcOverlay" onClick={()=>setShowPostcode(false)}>
          <div className="pcInner" onClick={(e)=>e.stopPropagation()}>
            <div ref={postcodeRef} style={{width:"100%",height:"100%"}}/>
          </div>
        </div>
      )}

      <style>{`
        .phoneViewport{
          position:relative;
          height:100dvh;
          max-width:420px;
          margin:0 auto;
          background:transparent;
        }
        .contentScroll{
          position:absolute;
          left:0; right:0; top:0; bottom:0;
          overflow:auto;
          padding:16px 16px 12px;
          -webkit-overflow-scrolling: touch;
        }

        .formCard{ max-width:720px; margin:0 auto; }
        .title{ font-weight:800; font-size:22px; text-align:center; margin:10px 0 14px; }
        .field{ margin-bottom:14px; }
        .label{ display:block; font-size:13px; margin-bottom:6px; color:#555; }
        .input{ width:100%; border:1.5px solid #6a5af9; border-radius:22px; padding:12px 16px; outline:none; font-size:16px; background:#fff; }
        .row{ display:flex; align-items:center; gap:8px; margin: 12px 0 6px; justify-content:space-between; }
        .rowBtns{ display:flex; gap:8px; }
        .section-title{ font-weight:700; }
        .addr-grid{ display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; }
        @media (max-width:560px){ .addr-grid{ grid-template-columns: repeat(2, 1fr); } }

        .btn{ border-radius:16px; padding:10px 14px; border:none; cursor:pointer; }
        .btn-secondary{ background:#e7dbff; color:#6a5af9; }
        .btn-ghost{ background:#f5f5f7; color:#333; }
        .btn-primary.big{
          width:100%; height:48px;
          background:#6a5af9; color:#fff; font-weight:700; border-radius:16px;
          display:flex; align-items:center; justify-content:center;
        }

        /* 시간 아래 고정(스크롤 컨테이너 내 sticky) + 배경 그라데이션으로 겹침 방지 */
        .actions{
          position: sticky;
          bottom: 0;
          z-index: 5;
          padding: 8px 0 calc(env(safe-area-inset-bottom,0) + 4px);
          background:
            linear-gradient(to bottom, rgba(246,247,251,0), rgba(246,247,251,1) 40%);
        }

        .pcOverlay{ position: fixed; inset: 0; background: rgba(0,0,0,.35); display:flex; align-items:center; justify-content:center; z-index:99999; }
        .pcInner{ width:min(720px, 92vw); height:min(620px, 82vh); background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,.25); }
      `}</style>
    </div>
  );
}
