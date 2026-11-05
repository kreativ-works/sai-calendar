"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { logout } from "@/lib/client/firebase-auth";

export default function Logout() {
  const [error, setError] = useState(false);
  async function signOut() {
    setError(false);
    try { await logout(); window.location.replace("/"); }
    catch { setError(true); }
  }
  useEffect(() => { void logout().then(() => window.location.replace("/")).catch(() => setError(true)); }, []);
  return <main className="sai-auth"><header className="auth-header"><Link className="auth-brand" href="/"><span>sai<span>.</span></span></Link></header><div className="auth-layout"><section className="auth-card"><div className="auth-heading"><h1>{error ? "로그아웃을 마무리하지 못했어요" : "로그아웃하고 있어요"}</h1><p role="status">{error ? "연결을 확인하고 다시 시도해 주세요." : "잠시만 기다려 주세요."}</p></div>{error ? <button className="auth-primary" onClick={() => void signOut()}>다시 시도</button> : null}</section></div></main>;
}
