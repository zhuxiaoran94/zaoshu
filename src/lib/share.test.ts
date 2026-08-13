import { describe,expect,it } from 'vitest'
import { cloneTemplate } from '../data/templates'
import { createShareUrl,decodeSharedProject,encodeSharedProject,MAX_SHARE_HASH_CHARS,sharedProjectFromHash } from './share'

describe('隐私分享链接',()=>{
  it('支持中文 Schema 无损往返且生成 fragment URL',()=>{const project=cloneTemplate('commerce'),encoded=encodeSharedProject(project),decoded=decodeSharedProject(encoded),url=createShareUrl(project,{origin:'https://mock.example',pathname:'/tool'});expect(decoded).toEqual(project);expect(url).toMatch(/^https:\/\/mock\.example\/tool#share=/);expect(sharedProjectFromHash(url.split('#')[1])).toEqual(project)})
  it('不包含结果或数据池，只编码项目 Schema',()=>{const project=cloneTemplate('users'),encoded=encodeSharedProject(project),normalized=encoded.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-encoded.length%4)%4),text=new TextDecoder().decode(Uint8Array.from(atob(normalized),char=>char.charCodeAt(0)));expect(text).not.toContain('result');expect(text).not.toContain('pools');expect(text).toContain('用户中心')})
  it('拒绝损坏、超长和未通过项目校验的内容',()=>{expect(()=>decodeSharedProject('%bad')).toThrow(/编码无效/);expect(()=>decodeSharedProject('A'.repeat(MAX_SHARE_HASH_CHARS+1))).toThrow(/安全长度/);const invalid=btoa(JSON.stringify({version:1,project:{id:'x'}})).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');expect(()=>decodeSharedProject(invalid)).toThrow(/项目文件/)} )
})
