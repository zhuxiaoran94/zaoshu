import { access, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const root=join(process.cwd(),'dist')
for(const file of ['index.html','manifest.webmanifest','icon.svg','sw.js','_headers','_redirects'])await access(join(root,file))
const worker=await readFile(join(root,'sw.js'),'utf8')
for(const pattern of [/generator\.worker-[\w-]+\.js/,/index-[\w-]+\.css/,/index-[\w-]+\.js/,/url\.origin!==self\.location\.origin/,/request\.method!=='GET'/])if(!pattern.test(worker))throw new Error(`Service Worker 产物检查失败：${pattern}`)
const assets=await readdir(join(root,'assets')),mainScript=assets.find(name=>/^index-[\w-]+\.js$/.test(name));if(!mainScript)throw new Error('找不到首屏 JavaScript 产物')
const mainBytes=(await stat(join(root,'assets',mainScript))).size,limit=450*1024;if(mainBytes>limit)throw new Error(`首屏 JavaScript 超出 450 KB 预算：${mainBytes} bytes`)
if(!assets.some(name=>/^engine-[\w-]+\.js$/.test(name)))throw new Error('Faker 生成引擎没有按需拆分')
console.log(`✓ Cloudflare/PWA 产物检查通过；首屏 JS ${(mainBytes/1024).toFixed(1)} KB`)
