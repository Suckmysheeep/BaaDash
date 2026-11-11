// Build only pinned Lucide glyphs; no runtime dependency or CDN.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const names=JSON.parse(fs.readFileSync(path.join(root,'tools/ui/icon-map.json'),'utf8'));
const glyphs={};
for(const name of new Set(Object.values(names))) {
 if(!/^[a-z0-9-]+$/.test(name))throw Error('Invalid icon name: '+name);
 const source=fs.readFileSync(path.join(root,'app/node_modules/lucide-static/icons',name+'.svg'),'utf8');
 glyphs[name]=source.slice(source.indexOf('>',source.indexOf('<svg'))+1,source.lastIndexOf('</svg>')).trim().replace(/\s+/g,' ');
}
const output=`// Generated from lucide-static by tools/ui/build-icons.mjs. ISC license in public/licenses/.\nconst names: Record<string,string> = ${JSON.stringify(names,null,2)};\nconst glyphs: Record<string,string> = ${JSON.stringify(glyphs,null,2)};\nexport type IconName = keyof typeof names | string;\nexport function icon(name: IconName): string {\n return '<svg class="ic lucide-icon" data-icon="'+(names[name] || names.file)+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+(glyphs[names[name]] || glyphs[names.file])+'</svg>';\n}\n`;
const target=path.join(root,'app/ui/src/icons.ts');
if(process.argv.includes('--check')) {
 if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==output)throw Error('Run node tools/ui/build-icons.mjs and commit generated icons.');
 console.log('PASS: pinned Lucide glyphs match the generated map.');
} else {fs.writeFileSync(target,output);console.log('Generated '+Object.keys(glyphs).length+' Lucide glyphs.');}
