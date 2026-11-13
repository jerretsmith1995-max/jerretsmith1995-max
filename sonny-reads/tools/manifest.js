// Lists every line the story friends need to say, read straight from app.html.
const fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'..','app.html'),'utf8');
const cut=(a,b,close)=>{const i=src.indexOf(a),j=src.indexOf(b,i);return src.slice(i+a.length-1,j)+close;};
const NIGHTS=new Function('return '+cut('const NIGHTS=[','\n];',']'))();
const SAYS=new Function('return '+cut('const SAYS={','};\n','}'))();
const BUDDIES=new Function('return '+cut('const BUDDIES={','\n};','}'))();
const plain=t=>t.replace(/[*\[\]]/g,'');
const pages=[],words=new Set();
NIGHTS.forEach((N,i)=>{
  (N.keys||[]).forEach(k=>words.add(k.w.toLowerCase()));
  (N.sort||[]).forEach(r=>{words.add(r.yes[1]);words.add(r.no[1]);});
  (N.blend||[]).forEach(b=>words.add(b.w));
  N.story.forEach((p,j)=>{pages.push({id:`n${i+1}p${j+1}`,text:plain(p.t)});(p.t.match(/\[([^\]]+)\]/g)||[]).forEach(w=>words.add(w.slice(1,-1).toLowerCase()));});
});
const says=[...new Set(Object.values(SAYS).concat(['Sonny!','Meadow!','Dada!','Momma!']))];
const lines={};Object.keys(BUDDIES).forEach(k=>{lines[k]={hi:BUDDIES[k].hi};BUDDIES[k].yay.forEach((y,n)=>lines[k]['yay'+n]=y);});
process.stdout.write(JSON.stringify({pages,words:[...words].sort(),says,lines},null,1));
