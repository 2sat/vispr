'use client';
import { useState } from 'react';
import { Workspace } from './workspace-live';
export function Login() {
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');
  const [token,setToken]=useState('');const [apps,setApps]=useState<{id:string;name:string}[]>([]);
  const [key,setKey]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('Sign in with an operator-created account.');
  async function login(event:React.FormEvent){
    event.preventDefault();setBusy(true);setMessage('Signing in…');
    try {
      const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error?.message??'Login failed');
      setToken(body.accessToken);setApps(body.applications);setPassword('');setMessage('Signed in. Choose an application to create a key and open the workspace.');
    }catch(error){setMessage(error instanceof Error?error.message:'Login failed');}
    finally{setBusy(false);}
  }
  async function connect(app:string){
    setBusy(true);
    try {
      const response=await fetch(`/api/applications/${encodeURIComponent(app)}/keys`,{method:'POST',headers:{Authorization:`Bearer ${token}`}});
      const body=await response.json();if(!response.ok)throw new Error(body.error?.message??'Key creation failed');
      setKey(body.key);setMessage('Application key created. It stays in page memory and can be revoked by its owner.');
    }catch(error){setMessage(error instanceof Error?error.message:'Connection failed');}
    finally{setBusy(false);}
  }
  if(key)return <Workspace initialApiKey={key}/>;
  return <main className="app-shell live-workspace"><header className="topbar"><a className="brand" href="/">vispr</a></header><section className="workspace-heading"><div><p className="eyebrow">INVITED ACCESS</p><h1>Sign in to your application.</h1></div></section><section className="panel login-panel">{!token?<form onSubmit={login}><label htmlFor="login-email">Email</label><input id="login-email" type="email" autoComplete="username" required value={email} disabled={busy} onChange={event=>setEmail(event.target.value)}/><label htmlFor="login-password">Password</label><input id="login-password" type="password" autoComplete="current-password" required value={password} disabled={busy} onChange={event=>setPassword(event.target.value)}/><button className="primary" disabled={busy} type="submit">Sign in</button></form>:apps.map(app=><button key={app.id} className="primary" disabled={busy} onClick={()=>connect(app.id)}>Create key for {app.name}</button>)}<p role="status">{message}</p>{token&&!apps.length&&<p>No owned applications are configured for this account.</p>}</section></main>;
}
