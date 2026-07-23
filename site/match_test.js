// Port of app.js answer matching, exercised against the real data.
const fs=require('fs');
const SITE='/Users/akbopebakytkeldy/Desktop/agylshyn/site';
function norm(s){if(s==null)return '';return String(s).toLowerCase().replace(/[‘’‚‛′´`]/g,"'").replace(/[“”„″]/g,'"').replace(/[^\p{L}\p{N}]+/gu,'');}
function dedupe(a){const s=Object.create(null),o=[];for(const x of a){if(!s[x]){s[x]=1;o.push(x);}}return o;}
function expandParens(s){let out=[s];for(let g=0;g<8;g++){let next=[],grew=false;for(const cur of out){const m=/\(([^()]*)\)/.exec(cur);next.push(cur);if(m){grew=true;next.push(cur.slice(0,m.index)+' '+cur.slice(m.index+m[0].length));next.push(cur.slice(0,m.index)+' '+m[1]+' '+cur.slice(m.index+m[0].length));}if(next.length>64)break;}out=dedupe(next);if(!grew||out.length>64)break;}return out;}
function splitAlternatives(s){return String(s).split(/\s*\/\s*|\s+or\s+/i).filter(p=>p&&p.trim());}
function expandSlashTokens(s){const t=String(s).trim().split(/\s+/);let out=[''];for(const tk of t){const ch=tk.indexOf('/')>-1?tk.split('/').filter(c=>c):[tk];if(!ch.length)continue;const nx=[];for(const a of out)for(const b of ch)nx.push(a?a+' '+b:b);out=nx.slice(0,64);}return out;}
function buildVariants(ans){const set=Object.create(null);const add=v=>{const k=norm(v);if(k)set[k]=1;};const raw=String(ans==null?'':ans);const bases=dedupe([raw].concat(expandSlashTokens(raw)));for(const b of bases){for(const w of expandParens(b)){add(w);for(const a of splitAlternatives(w))add(a);}}return set;}
function listParts(s){return String(s==null?'':s).split(/\s*[,;]\s*|\s+and\s+|\s*&\s*/i).map(norm).filter(p=>p);}
function matchesAsSet(input,answer){const want=listParts(answer);if(want.length<2)return false;const got=listParts(input);if(got.length!==want.length)return false;const a=want.slice().sort(),b=got.slice().sort();for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
function isMatch(input,it){const t=norm(input);if(!t)return false;if(buildVariants(it.answer)[t])return true;if(it.blank&&buildVariants(it.blank)[t])return true;return matchesAsSet(input,it.answer);}

const BOOKS=['essential-grammar','grammar','advanced-grammar','vocab-preint','vocab-upint','vocab-adv'];
// learner-input transforms that SHOULD still count as correct
const T=[
 ['exact',           a=>a],
 ['lowercased',      a=>a.toLowerCase()],
 ['trailing period', a=>a+'.'],
 ['straight quote',  a=>a.replace(/[’‘]/g,"'")],
 ['no quote at all', a=>a.replace(/[’‘']/g,'')],
 ['first alt only',  a=>a.split('/')[0].trim()],
 ['last alt only',   a=>a.split('/').pop().trim()],
 ['drop parens',     a=>a.replace(/\([^)]*\)/g,' ').replace(/\s+/g,' ').trim()],
 ['keep parens text',a=>a.replace(/[()]/g,'')],
 ['extra spaces',    a=>'  '+a.split('').join(' ')==='x'?a:'  '+a+'  '],
];
const res={};
for(const b of BOOKS){
  const d=JSON.parse(fs.readFileSync(`${SITE}/data/${b}.json`,'utf8'));
  const c={}; T.forEach(([n])=>c[n]=[0,0]);
  for(const u of d.units) for(const s of (u.subExercises||[])) for(const it of (s.items||[])){
    if(it.isExample) continue;
    const a=(it.answer||'').trim(); if(!a) continue;
    for(const [n,f] of T){ let v; try{v=f(a);}catch(e){continue;} if(!v||!norm(v))continue; c[n][1]++; if(isMatch(v,it)) c[n][0]++; }
  }
  res[b]=c;
}
console.log('acceptance rate of learner inputs that should be accepted:');
const names=T.map(t=>t[0]);
process.stdout.write('transform'.padEnd(18)); BOOKS.forEach(b=>process.stdout.write(b.slice(0,11).padEnd(13))); console.log();
for(const n of names){
  process.stdout.write(n.padEnd(18));
  for(const b of BOOKS){const [ok,tot]=res[b][n];process.stdout.write(((100*ok/(tot||1)).toFixed(1)+'%').padEnd(13));}
  console.log();
}

/* ---- realistic HARD cases: what a learner would plausibly type ---- */
console.log('\nfalse-negative risk (learner types a reasonable form, app says WRONG):');
const HARD=[
 ['multi-part "a..b.." — types only part a', a=>/(^|\s)a\s/.test(a)&&/\sb\s/.test(a), a=>a.replace(/^a\s+/,'').split(/\s+b\s+/)[0]],
 ['ellipsis answer — types both words, no dots', a=>/\.{2,}|…/.test(a), a=>a.replace(/\.{2,}|…/g,' ').replace(/\s+/g,' ').trim()],
 ['comma list — reversed order', a=>a.includes(',')&&a.split(',').length===2, a=>a.split(',').map(s=>s.trim()).reverse().join(', ')],
 ['long prose answer — types the first clause', a=>a.length>90, a=>a.split(/[.;(]/)[0].trim()],
];
for(const b of BOOKS){
  const d=JSON.parse(fs.readFileSync(`${SITE}/data/${b}.json`,'utf8'));
  const c={};HARD.forEach(([n])=>c[n]=[0,0]);
  for(const u of d.units) for(const s of (u.subExercises||[])) for(const it of (s.items||[])){
    if(it.isExample) continue; const a=(it.answer||'').trim(); if(!a) continue;
    for(const [n,pred,f] of HARD){ if(!pred(a))continue; const v=f(a); if(!v||!norm(v)||norm(v)===norm(a))continue; c[n][1]++; if(isMatch(v,it))c[n][0]++; }
  }
  console.log(' '+b);
  for(const [n] of HARD){const[ok,tot]=c[n]; if(tot) console.log('    '+n.padEnd(46)+ok+'/'+tot+' accepted ('+(100*ok/tot).toFixed(0)+'%)');}
}

console.log('\nfalse-positive check (nonsense input must be rejected):');
let fp=0,fpt=0;
for(const b of BOOKS){
  const d=JSON.parse(fs.readFileSync(`${SITE}/data/${b}.json`,'utf8'));
  for(const u of d.units) for(const s of (u.subExercises||[])) for(const it of (s.items||[])){
    if(it.isExample||!it.answer) continue;
    for(const junk of ['qwerty','zzz','a','the','1',' ']){ fpt++; if(isMatch(junk,it)) fp++; }
  }
}
console.log('  nonsense accepted: '+fp+' / '+fpt);
