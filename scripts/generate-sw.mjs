import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root=join(process.cwd(),'dist')
const assetNames=await readdir(join(root,'assets'))
const files=Array.from(new Set(['/','/index.html','/manifest.webmanifest','/icon.svg',...assetNames.map(name=>`/assets/${name}`)]))
const hash=files.sort().join('|').split('').reduce((value,char)=>Math.imul(value^char.charCodeAt(0),16777619)>>>0,2166136261).toString(36)
const source=`const CACHE="mock-tool-${hash}";const PRECACHE=${JSON.stringify(files)};const PATHS=new Set(PRECACHE.map(path=>new URL(path,self.location.origin).pathname));self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRECACHE))));self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('mock-tool-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting()});self.addEventListener('fetch',event=>{const request=event.request;if(request.method!=='GET')return;const url=new URL(request.url);if(url.origin!==self.location.origin)return;if(request.mode==='navigate'){event.respondWith(fetch(request).then(response=>{if(response.ok)caches.open(CACHE).then(cache=>cache.put('/index.html',response.clone()));return response}).catch(()=>caches.match('/index.html').then(response=>response||Response.error())));return}if(!PATHS.has(url.pathname)&&!url.pathname.startsWith('/assets/'))return;event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(response.ok)caches.open(CACHE).then(cache=>cache.put(request,response.clone()));return response})))});`
await writeFile(join(root,'sw.js'),source,'utf8')
console.log(`✓ Service Worker 已生成（${files.length} 个预缓存资源）`)
