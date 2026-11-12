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
 assert.equal(await p.locator('.header').getAttribute('data-tauri-drag-region'),'deep','header drags from any non-interactive point');
 assert.equal(await p.locator('.rz').count(),0,'resize strips only exist in the native window');
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
 // Telemetry collapses while nothing is transferring and returns on resume.
 await p.locator('#btn-pause-all').click();await p.evaluate(()=>window.__video.step());
 await p.waitForFunction(()=>document.querySelector('.telemetry').hidden);
 await p.locator('#btn-resume-all').click();await p.evaluate(()=>window.__video.step());
 await p.waitForFunction(()=>!document.querySelector('.telemetry').hidden);
 await p.waitForTimeout(550);assert.ok(await p.locator('.thread-row').count()>0,'matrix returns with the telemetry');
 // Min height: sidebar fits without a scrollbar and the size column stays visible.
 await p.setViewportSize({width:820,height:520});await p.waitForTimeout(200);
 assert.ok(await p.evaluate(()=>{const n=document.getElementById('nav');return n.scrollHeight<=n.clientHeight+1;}),'sidebar fits at minimum height');
 assert.equal(await p.locator('.row .m-size').first().evaluate(e=>getComputedStyle(e).display),'grid','size column stays visible on narrow windows');
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));
 // Maximized: rows and the speed plot scale up instead of leaving dead space.
 await p.setViewportSize({width:1920,height:1080});await p.waitForTimeout(200);
 assert.ok(await p.locator('.row').first().evaluate(e=>e.getBoundingClientRect().height)>=56,'rows breathe on tall windows');
 assert.ok(await p.locator('#net-graph').evaluate(e=>e.getBoundingClientRect().height)>=100,'speed plot scales on tall windows');
 await p.setViewportSize({width:1120,height:820});
 // Empty views hide multi-select and show type-specific empty copy.
 await p.locator('[data-view="Images"]').click();
 await p.waitForFunction(()=>document.getElementById('btn-select').hidden);
 assert.equal(await p.locator('#empty-title').textContent(),'还没有图片');
 assert.ok(await p.locator('#empty').isVisible());
 await p.locator('[data-view="completed"]').click();
 await p.waitForFunction(()=>!document.getElementById('btn-select').hidden);
 // Completed view: a per-task folder action, never a batch open.
 assert.ok(await p.locator('#btn-open-folder').isVisible());
 assert.ok(await p.locator('#btn-open-folder').isDisabled());
 assert.ok(await p.locator('#btn-pause-all').isHidden());
 assert.ok(await p.locator('#btn-resume-all').isHidden());
 assert.ok(await p.locator('#btn-history').isVisible());
 await p.locator('#btn-select').click();await p.locator('#bulk-all').check();
 assert.ok(await p.locator('#btn-open-folder').isDisabled(),'selecting many never enables a batch folder open');
 await p.locator('#bulk-exit').click();
 await p.locator('.row').first().click();
 await p.waitForFunction(()=>!document.getElementById('btn-open-folder').disabled);
 // Failed view relabels resume as retry and drops pause-all.
 await p.locator('[data-view="failed"]').click();
 assert.ok((await p.locator('#btn-resume-all').textContent()).includes('全部重试'));
 assert.ok(await p.locator('#btn-pause-all').isHidden());
 await p.locator('[data-view="all"]').click();
 // The settings-leave confirm keeps the same inset as form-based confirms.
 await p.locator('#btn-settings').click();await p.locator('[data-tab="appearance"]').click();
 await p.locator('#set-scale').fill('110');await p.locator('#settings-close').click();
 await p.waitForSelector('#dlg-settings-leave[open]');
 assert.equal(await p.locator('#dlg-settings-leave .confirm-head').evaluate(e=>getComputedStyle(e).paddingTop),'20px');
 assert.equal(await p.locator('#dlg-settings-leave .confirm-foot').evaluate(e=>getComputedStyle(e).paddingBottom),'20px');
 assert.equal(await p.locator('#dlg-settings-leave h2').evaluate(e=>getComputedStyle(e).marginTop),'0px');
 await p.locator('#settings-discard').click();
 // Magnet confirm shows elapsed time while probing, then the file picker.
 const m=await browser.newPage({viewport:{width:552,height:650}});m.on('pageerror',e=>errors.push(e.message));
 await m.goto(origin+'/app/dist/download.html?confirm=1&torrent');
 await m.waitForSelector('#t-wait-msg');
 assert.ok((await m.locator('#t-wait-msg').textContent()).includes('已等待'));
 await m.waitForSelector('.t-file input[data-i]');
 assert.ok(await m.locator('#c-start').isEnabled());
 await m.close();
 const q=await browser.newPage({viewport:{width:552,height:650}});q.on('pageerror',e=>errors.push(e.message));await q.goto(origin+'/app/dist/download.html?confirm=1&video');await q.waitForSelector('#c-start');assert.equal(await q.locator('#root').evaluate(e=>getComputedStyle(e).boxShadow),'none');assert.equal(await q.locator('#root').evaluate(e=>getComputedStyle(e).margin),'0px');
 assert.equal(await q.locator('#view').evaluate(e=>getComputedStyle(e).maxHeight),'none','confirm content is not height-capped; the window grows instead');
 assert.deepEqual(errors,[]);console.log('PASS: v0.4 graphite workspace, categories, real segment matrix, professional table, sun/moon, filters, row actions, settings save/discard/stay, responsive layout, native-frame content, empty-view multi-select hiding, per-view toolbars, single-task folder open and magnet elapsed probe.');
}finally{await browser.close();server.close();}
