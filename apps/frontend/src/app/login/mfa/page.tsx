"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
export default function MfaLoginPage() {
 const router=useRouter(); const {refresh}=useAuth(); const [code,setCode]=useState(""); const [error,setError]=useState<string|null>(null); const [loading,setLoading]=useState(false);
 const submit=async(e:FormEvent)=>{e.preventDefault();setLoading(true);setError(null);try{await api.post("/auth/mfa/verify",{code},{anonymous:true,silent:true});await refresh();router.replace("/calendar");}catch(e){setError(e instanceof ApiError?e.message:"That code could not be verified.");}finally{setLoading(false);}};
 return <main style={{maxWidth:420,margin:"10vh auto",padding:24}}><h1>Two-factor authentication</h1><p>Enter the 6-digit code from your authenticator app, or one recovery code.</p><form onSubmit={submit}><label htmlFor="code">Authenticator or recovery code</label><input id="code" autoFocus autoComplete="one-time-code" value={code} onChange={(e)=>setCode(e.target.value)} style={{width:"100%",margin:"8px 0 12px",padding:12}}/><button type="submit" disabled={loading}>{loading?"Verifying…":"Continue"}</button>{error&&<p role="alert">{error}</p>}</form></main>;
}
