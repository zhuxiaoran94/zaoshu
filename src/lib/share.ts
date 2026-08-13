import type { ProjectSchema } from '../types'
import { parseProjectFile, serializeProject } from './projectConfig'

export const SHARE_HASH_KEY='share'
export const MAX_SHARE_HASH_CHARS=60_000

const bytesToBase64=(bytes:Uint8Array)=>{let binary='';for(let index=0;index<bytes.length;index+=8192)binary+=String.fromCharCode(...bytes.subarray(index,index+8192));return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')}
const base64ToBytes=(value:string)=>{if(!/^[A-Za-z0-9_-]+$/.test(value))throw new Error('分享链接编码无效');const normalized=value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4),binary=atob(normalized),bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);return bytes}

export function encodeSharedProject(project:ProjectSchema){const payload=new TextEncoder().encode(serializeProject(project)),encoded=bytesToBase64(payload);if(encoded.length>MAX_SHARE_HASH_CHARS)throw new Error('当前 Schema 生成的分享链接过长，请改用“下载配置”分享');return encoded}
export function decodeSharedProject(encoded:string){if(!encoded||encoded.length>MAX_SHARE_HASH_CHARS)throw new Error('分享链接为空或超过安全长度');let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(base64ToBytes(encoded))}catch{throw new Error('分享链接内容损坏或字符编码无效')}return parseProjectFile(text)}
export function sharedProjectFromHash(hash:string){const value=hash.startsWith('#')?hash.slice(1):hash,params=new URLSearchParams(value),encoded=params.get(SHARE_HASH_KEY);return encoded?decodeSharedProject(encoded):null}
export function createShareUrl(project:ProjectSchema,location:{origin:string;pathname:string}){return`${location.origin}${location.pathname}#${SHARE_HASH_KEY}=${encodeSharedProject(project)}`}
export function clearShareHash(){if(typeof history!=='undefined'&&typeof location!=='undefined'&&location.hash.includes(`${SHARE_HASH_KEY}=`))history.replaceState(null,'',`${location.pathname}${location.search}`)}
