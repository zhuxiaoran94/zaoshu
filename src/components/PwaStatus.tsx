import { useEffect, useState } from 'react'
import { Download, RefreshCcw, WifiOff, X } from './Icons'

export default function PwaStatus() {
  const [online,setOnline]=useState(()=>navigator.onLine)
  const [waiting,setWaiting]=useState<ServiceWorker|null>(null)
  const [dismissed,setDismissed]=useState(false)
  useEffect(()=>{
    const handleOnline=()=>setOnline(true),handleOffline=()=>setOnline(false)
    window.addEventListener('online',handleOnline);window.addEventListener('offline',handleOffline)
    if(!('serviceWorker' in navigator)||!import.meta.env.PROD)return()=>{window.removeEventListener('online',handleOnline);window.removeEventListener('offline',handleOffline)}
    let registration:ServiceWorkerRegistration|undefined,timer:number|undefined,reloading=false
    const controllerChanged=()=>{if(!reloading){reloading=true;window.location.reload()}}
    navigator.serviceWorker.addEventListener('controllerchange',controllerChanged)
    navigator.serviceWorker.register('/sw.js',{scope:'/'}).then(value=>{
      registration=value;if(value.waiting)setWaiting(value.waiting)
      const inspect=()=>{const worker=value.installing;if(!worker)return;worker.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller){setWaiting(worker);setDismissed(false)}})}
      value.addEventListener('updatefound',inspect);timer=window.setInterval(()=>value.update(),60*60*1000)
    }).catch(()=>undefined)
    return()=>{window.removeEventListener('online',handleOnline);window.removeEventListener('offline',handleOffline);navigator.serviceWorker.removeEventListener('controllerchange',controllerChanged);if(registration)registration.onupdatefound=null;if(timer)window.clearInterval(timer)}
  },[])
  const applyUpdate=()=>waiting?.postMessage('SKIP_WAITING')
  if(!online)return <aside className="pwa-status offline"><WifiOff/><div><strong>当前处于离线模式</strong><span>造数、预览和本地配置仍可使用</span></div></aside>
  if(waiting&&!dismissed)return <aside className="pwa-status update"><Download/><div><strong>新版本已准备好</strong><span>项目已自动保存，可以安全更新</span></div><button onClick={applyUpdate}><RefreshCcw/>立即更新</button><button className="icon-button" onClick={()=>setDismissed(true)} aria-label="稍后更新"><X/></button></aside>
  return null
}
