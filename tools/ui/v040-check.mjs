import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {start,root} from './runtime.mjs';
const {browser,server,origin}=await start();
const shots=process.env.BAADASH_UI_SHOTS;
if(shots)fs.mkdirSync(shots,{recursive:true});
const errors=[];
try{
 const p=await browser.newPage({viewport:{width:1120,height:820}});p.on('pageerror',e=>errors.push(e.message));
 await p.goto(origin+'/app/dist/index.html?video');await p.waitForSelector('.row');await p.evaluate(async()=>{const s=await window.__TAURI__.core.invoke('get_state');await window.__TAURI__.core.invoke('set_settings',{settings:{...s.settings,theme:'dark'}});window.__video.step();});
 const capture=async name=>{if(!shots)return;await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(200);await p.screenshot({path:path.join(shots,name+'.png')});};
 assert.equal(await p.locator('#theme-toggle svg').getAttribute('data-icon'),'sun');
 assert.equal(await p.locator('.workspace').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(27, 27, 27)');
 assert.equal(await p.locator('#nav [data-view]').count(),11,'four states and seven categories');
 assert.equal(await p.locator('.table-heading span').count(),7);
 await p.waitForTimeout(550);assert.ok(await p.locator('.thread-row').count()>0,'real mock connection ranges render');
 assert.ok(await p.locator('.thread-row i').count()>=32);
 await capture('main-dark');
 await p.locator('#status-filters [data-status="paused"]').click();assert.ok((await p.locator('.row').count())>0);assert.equal(await p.locator('.row .st-downloading').count(),0);
 await p.locator('[data-view="all"]').click();await p.locator('.r-actions [data-row-action="pause"]').first().click();await p.evaluate(()=>window.__video.step());
 await p.locator('#btn-settings').click();await p.locator('[data-tab="appearance"]').click();assert.equal(await p.locator('#dlg-settings').evaluate(e=>e.matches(':modal')),false,'settings uses an in-app page');
 await p.locator('#set-scale').fill('120');await p.locator('#settings-close').click();assert.ok(await p.locator('#dlg-settings-leave').isVisible());await p.locator('#settings-stay').click();assert.ok(await p.locator('#dlg-settings').isVisible());
 await p.locator('#settings-close').click();await p.locator('#settings-discard').click();await p.waitForFunction(()=>document.documentElement.style.zoom==='1');
 await p.locator('#btn-settings').click();await p.locator('[data-tab="appearance"]').click();await capture('settings-dark');
 await p.locator('[data-tab="general"]').click();await p.locator('#set-clipboard').check();await p.locator('#settings-close').click();await p.locator('#settings-save-leave').click();await p.waitForFunction(()=>!document.querySelector('#dlg-settings').open);assert.equal(await p.evaluate(async()=>(await window.__TAURI__.core.invoke('get_state')).settings.clipboardWatch),true);
 await p.locator('#theme-toggle').click();assert.equal(await p.locator('#theme-toggle svg').getAttribute('data-icon'),'moon');await capture('main-light');
 for(const width of [820,1120,1440]){await p.setViewportSize({width,height:700});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.locator('#btn-settings').click();await p.locator('[data-tab="appearance"]').click();assert.ok(await p.locator('#settings-close').isVisible());assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.locator('#set-cancel').click();}
 const q=await browser.newPage({viewport:{width:552,height:650}});q.on('pageerror',e=>errors.push(e.message));await q.goto(origin+'/app/dist/download.html?confirm=1&video');await q.waitForSelector('#c-start');assert.equal(await q.locator('#root').evaluate(e=>getComputedStyle(e).boxShadow),'none');assert.equal(await q.locator('#root').evaluate(e=>getComputedStyle(e).margin),'0px');
 assert.deepEqual(errors,[]);console.log('PASS: v0.4 graphite workspace, categories, real segment matrix, professional table, sun/moon, filters, row actions, settings save/discard/stay, responsive layout and native-frame content.');
}finally{await browser.close();server.close();}
