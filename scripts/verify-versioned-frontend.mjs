import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';

const html=readFileSync('public/index.html','utf8');
const js=html.match(/src="\/_app\/([a-f0-9]{16})\/app\.js"/);
const css=html.match(/href="\/_app\/([a-f0-9]{16})\/styles\.css"/);
assert(js&&css,'The deployed HTML must use content-revisioned JS and CSS paths.');
assert.equal(js[1],css[1],'JS/CSS release hashes must match');
const directory=join('public','_app',js[1]);
assert(existsSync(directory),'The versioned frontend directory does not exist');
const assets=readdirSync('public').filter(name=>/\.(js|css)$/.test(name)).sort();
for(const name of assets){
 assert(existsSync(join(directory,name)),'Missing release asset '+name);
 assert.deepEqual(readFileSync(join(directory,name)),readFileSync(join('public',name)),
  'Release module does not match original '+name);
}
const app=readFileSync(join(directory,'app.js'),'utf8');
assert(app.includes('translationProviders')&&app.includes('languageReview'),
  'The bundled entry module does not include both owner-only tools');
console.log('Verified hashed frontend '+js[1]+' with '+assets.length+' synchronized static resources');
