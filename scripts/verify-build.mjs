import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root=join(process.cwd(),'dist')
for(const file of ['index.html','manifest.webmanifest','icon.svg','sw.js','_headers','_redirects'])await access(join(root,file))
const worker=await readFile(join(root,'sw.js'),'utf8')
for(const pattern of [/generator\.worker-[\w-]+\.js/,/index-[\w-]+\.css/,/index-[\w-]+\.js/,/url\.origin!==self\.location\.origin/,/request\.method!=='GET'/])if(!pattern.test(worker))throw new Error(`Service Worker 产物检查失败：${pattern}`)
console.log('✓ Cloudflare/PWA 产物检查通过')
