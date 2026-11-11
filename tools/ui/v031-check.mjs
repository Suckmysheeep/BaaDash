import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from '../../app/node_modules/typescript/lib/typescript.js';
import {start, root} from './runtime.mjs';
const source=fs.readFileSync(path.join(root,'app/ui/src/accent.ts'),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {accentTokens}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const lum=rgb=>rgb.map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((s,c,i)=>s+c*[.2126,.7152,.0722][i],0);
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
for(const dark of [false,true]) for(const color of ['#ffffff','#000000','#ffff00','#007aff','#7c3aed','#00ff00','#ff00ff','#ff0000','#808080']) {
 const t=accentTokens(color,dark),a=rgb(t.color),base=dark?[16,17,20]:[255,255,255],alpha=dark?.16:.1;
 const b=a.map((c,i)=>Math.round(c*alpha+base[i]*(1-alpha)));
 assert.ok((Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05)>=4.5,`${color} readable on selection ${dark}`);
}
const {browser,server,origin}=await start();
try {
 const context=await browser.newContext({viewport:{width:1120,height:760}});
 const p=await context.newPage();
 await p.goto(origin+'/app/dist/index.html?video');await p.waitForSelector('.row');
 const open=async()=>{await p.locator('#btn-settings').click();await p.locator('[data-tab="appearance"]').click();};
 const color=()=>p.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent'));
 await open();const initial=await color();
 await p.locator('[data-color="#7c3aed"]').click();assert.notEqual(await color(),initial);
 assert.equal(await p.evaluate(()=>localStorage.getItem('accentColor')),'#007aff','preview does not persist');
 await p.locator('#set-cancel').click();assert.equal(await color(),initial);
 await open();await p.locator('#set-accent-hex').fill('#123');
 await p.locator('#form-settings').evaluate(e=>e.requestSubmit());
 assert.ok(await p.locator('#accent-error').isVisible());assert.equal(await p.locator('#dlg-settings').evaluate(e=>e.open),true);
 await p.locator('#set-accent-hex').fill('#059669');
 await p.locator('#form-settings').evaluate(e=>e.requestSubmit());await p.waitForFunction(()=>!document.querySelector('#dlg-settings').open);
 assert.equal(await p.evaluate(()=>localStorage.getItem('accentColor')),'#059669');
 await open();assert.equal(await p.locator('#set-accent-hex').inputValue(),'#059669');
 await p.locator('#accent-reset').click();await p.keyboard.press('Escape');
 assert.equal(await p.evaluate(()=>localStorage.getItem('accentColor')),'#059669');
 for(const theme of ['light','dark']) {
  await p.evaluate(t=>window.setTheme(t),theme);await open();
  await p.locator('[data-color="#7c3aed"]').click();
  if(process.env.BAADASH_UI_SHOTS){await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(200);await p.screenshot({path:path.join(process.env.BAADASH_UI_SHOTS,`accent-${theme}.png`)});}
  await p.locator('#set-cancel').click();
 }
 await open();await p.locator('#set-accent-hex').fill('#db2777');
 await p.evaluate(()=>{const invoke=window.__TAURI__.core.invoke;window.__restoreInvoke=invoke;window.__TAURI__.core.invoke=(cmd,...args)=>cmd==='set_settings'?Promise.reject('无法保存设置'):invoke(cmd,...args);});
 await p.locator('#form-settings').evaluate(e=>e.requestSubmit());
 await p.waitForFunction(()=>document.querySelector('#dlg-settings').open && document.body.textContent.includes('无法保存设置'));
 assert.equal(await p.evaluate(()=>localStorage.getItem('accentColor')),'#059669','failed save preserves stored settings');
 await p.evaluate(()=>{window.__TAURI__.core.invoke=window.__restoreInvoke;});
 await p.keyboard.press('Escape');
 const q=await p.context().newPage();
 await q.goto(origin+'/app/dist/download.html?confirm=1&video');await q.waitForSelector('#c-start');
 await q.evaluate(async()=>{const state=await window.__TAURI__.core.invoke('get_state');await window.__TAURI__.core.invoke('set_settings',{settings:{...state.settings,theme:'dark',accentColor:'#db2777'}});});
 assert.equal(await q.evaluate(()=>document.documentElement.dataset.theme),'dark');
 assert.equal(await q.evaluate(()=>localStorage.getItem('accentColor')),'#db2777','download window handles settings event');
 const fresh=await p.context().newPage();
 // Hold app modules back: the cached color must already be correct before boot.
 await fresh.route('**/*.js',route=>route.abort());
 await fresh.goto(origin+'/app/dist/index.html?video');
 assert.equal(await fresh.evaluate(()=>document.documentElement.dataset.theme),'dark');
 assert.equal(await fresh.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent')),accentTokens('#db2777',true).color);
 await fresh.close();await q.close();
 await open();await p.evaluate(()=>window.setTheme('dark',false));await p.locator('#set-accent-hex').fill('#ffffff');
 await p.locator('[data-tab="general"]').click();
 const knob=await p.locator('#set-notify + i').evaluate(e=>getComputedStyle(e,'::after').backgroundColor);
 assert.equal(knob,'rgb(0, 0, 0)','light accent keeps a visible switch thumb');
 await p.keyboard.press('Escape');
 await p.locator('#btn-add').click();await p.locator('#add-url').fill('https://example.test/file.zip');
 await p.waitForFunction(()=>!document.querySelector('#add-start').disabled);
 await p.locator('#add-advanced summary').click();await p.locator('#add-verify').check();
 await p.evaluate(()=>{window.setTheme('dark',false);window.setAccent('#ffffff');});
 assert.equal(await p.locator('#add-verify').evaluate(e=>getComputedStyle(e,'::after').borderTopColor),'rgb(0, 0, 0)','checkmark contrasts against a light custom accent');
 await p.locator('#add-x').click();
 await p.locator('#btn-settings').hover();
 assert.ok(await p.locator('#btn-settings .lucide-icon').evaluate(e=>e.getAnimations().length)>0,'primary entry animates');
 await p.emulateMedia({reducedMotion:'reduce'});await p.mouse.move(0,0);await p.locator('#btn-settings').hover();
 assert.equal(await p.locator('#btn-settings .lucide-icon').evaluate(e=>e.getAnimations().length),0,'reduced motion cancels animations');
 console.log('PASS: accent contrast, preview/cancel/Escape, invalid input, save/reopen, reset, and reduced motion.');
} finally {await browser.close();server.close();}
