import { access, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const root=join(process.cwd(),'dist')
for(const file of ['index.html','manifest.webmanifest','icon.svg','sw.js','_headers','_redirects'])await access(join(root,file))
const worker=await readFile(join(root,'sw.js'),'utf8')
for(const pattern of [/generator\.worker-[\w-]+\.js/,/index-[\w-]+\.css/,/index-[\w-]+\.js/,/url\.origin!==self\.location\.origin/,/request\.method!=='GET'/])if(!pattern.test(worker))throw new Error(`Service Worker 产物检查失败：${pattern}`)
const headers=await readFile(join(root,'_headers'),'utf8')
for(const pattern of [/X-Content-Type-Options:\s*nosniff/i,/X-Frame-Options:\s*DENY/i,/Permissions-Policy:/i,/Content-Security-Policy:[^\n]*default-src 'none'/i,/Content-Security-Policy:[^\n]*frame-ancestors 'none'/i,/Content-Security-Policy:[^\n]*script-src 'self'/i])if(!pattern.test(headers))throw new Error(`Cloudflare 安全响应头缺失：${pattern}`)
if(/unsafe-eval/i.test(headers))throw new Error('Cloudflare CSP 不得允许 unsafe-eval')
const redirects=await readFile(join(root,'_redirects'),'utf8')
if(!/^\/\*\s+\/index\.html\s+200\s*$/m.test(redirects))throw new Error('Cloudflare SPA 回退规则缺失')
const assets=await readdir(join(root,'assets')),html=await readFile(join(root,'index.html'),'utf8'),entry=html.match(/<script[^>]+src="\/assets\/(index-[\w-]+\.js)"/),mainScript=entry?.[1];if(!mainScript||!assets.includes(mainScript))throw new Error('无法从 index.html 定位首屏 JavaScript 产物')
const mainBytes=(await stat(join(root,'assets',mainScript))).size,limit=450*1024;if(mainBytes>limit)throw new Error(`首屏 JavaScript 超出 450 KB 预算：${mainBytes} bytes`)
if(!assets.some(name=>/^engine-[\w-]+\.js$/.test(name)))throw new Error('Faker 生成引擎没有按需拆分')
console.log(`✓ Cloudflare/PWA 产物检查通过；首屏 JS ${(mainBytes/1024).toFixed(1)} KB`)
