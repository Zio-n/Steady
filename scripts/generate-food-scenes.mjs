import { writeFileSync } from 'node:fs';

// A deterministic SVG scene study. It uses food categories, an archetype, and drawing primitives.
const output = new URL('../docs/food-scenes.svg', import.meta.url);
const C={paper:'#f8f6ed',white:'#fcfbf6',ink:'#153f35',olive:'#516b2c',muted:'#586b60',sage:'#e9eddf',line:'#d6ddcf',oat:'#cdbb91',berry:'#536478',wood:'#e9e1cf',woodLine:'#d8ccb5'};
const ingredients=[
  {name:'Greek yoghurt',category:'dairy'},
  {name:'Rolled oats',category:'grain'},
  {name:'Blueberries',category:'fruit'},
  {name:'Honey',category:'pantry'},
  {name:'Chia seeds',category:'seed'},
];
const e=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const R=(x,y,w,h,f,r=0,s='none',sw=1)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
const E=(x,y,rx,ry,f,s='none',sw=1)=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
const L=(x,y,X,Y,s,sw=1)=>`<line x1="${x}" y1="${y}" x2="${X}" y2="${Y}" stroke="${s}" stroke-width="${sw}" stroke-linecap="round"/>`;
const P=(d,f,s='none',sw=1)=>`<path d="${d}" fill="${f}" stroke="${s}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
const T=(x,y,v,z=14,w=600,f=C.ink,a='start',sp=0)=>`<text x="${x}" y="${y}" fill="${f}" font-family="Manrope,Arial,sans-serif" font-size="${z}" font-weight="${w}" text-anchor="${a}" letter-spacing="${sp}">${e(v)}</text>`;
const G=(x,y,b)=>`<g transform="translate(${x} ${y})">${b}</g>`;
function hash(s){let h=2166136261;for(const ch of s)h=Math.imul(h^ch.charCodeAt(0),16777619);return h>>>0;}
function rnd(seed,i){let n=Math.imul(seed^Math.imul(i+1,374761393),668265263);return ((n^(n>>>13))>>>0)/4294967295;}
function grains(name,cx,cy,count,rx,ry,scale=1){
  const a=[],seed=hash(name);
  for(let i=0;i<count;i++){
    const ang=rnd(seed,i)*Math.PI*2,rad=Math.sqrt(rnd(seed,i+count));
    const x=(cx+Math.cos(ang)*rad*rx).toFixed(1),y=(cy+Math.sin(ang)*rad*ry).toFixed(1);
    a.push(`<ellipse cx="${x}" cy="${y}" rx="${3.4*scale}" ry="${1.7*scale}" transform="rotate(${Math.round(rnd(seed,i+2*count)*140-70)} ${x} ${y})" fill="${i%5?C.oat:'#ad986d'}"/>`);
  }
  return a.join('');
}
function berries(name,cx,cy,count,rx,ry,r=8){
  const a=[],seed=hash(name);
  for(let i=0;i<count;i++){
    const ang=rnd(seed,i)*Math.PI*2,rad=Math.sqrt(rnd(seed,i+count));
    const x=cx+Math.cos(ang)*rad*rx,y=cy+Math.sin(ang)*rad*ry;
    a.push(E(x.toFixed(1),y.toFixed(1),r,r*.94,i%4?C.berry:'#73849a'));
    a.push(E((x-r*.3).toFixed(1),(y-r*.3).toFixed(1),r*.15,r*.11,'#b9c4ca'));
  }
  return a.join('');
}
const bowl=(x,y,r,fill)=>E(x,y+9,r+6,r+6,'#153f3522')+E(x,y,r,r,C.white,'#d2dcca',3)+E(x,y,r-13,r-13,fill,'#dce3d6',2);
const yoghurt=(x,y,s=1)=>`<g transform="translate(${x} ${y}) scale(${s})">${E(0,0,57,39,'#fffef8')}${E(-14,-7,33,19,'#f0f1e9')}${P('M-43 5 C-25-20 13-17 25-1 C35 14 10 23-8 13 C-19 7-8-5 6-2','none','#fffefc',9)}${P('M-30 16 C-6 27 24 21 40 4','none','#e5e9df',3)}</g>`;

function mealScene(){
  const a=[R(0,0,630,440,C.sage,22),E(314,387,246,25,'#153f351b')];
  a.push(R(66,36,498,352,'#91a785',36,C.ink,3),R(78,48,474,328,'#d7e3d0',28));
  a.push(R(48,161,38,92,C.olive,16),R(544,161,38,92,C.olive,16));
  a.push(`<g transform="rotate(9 481 114)">${R(420,68,103,94,'#f7f5e9',11)}${L(431,85,510,85,'#d9decf',2)}${L(431,96,510,96,'#e4e6da')}</g>`);
  a.push(bowl(291,209,146,'#e9dfc8'),E(291,209,117,117,'#e9dfc8'));
  a.push(yoghurt(278,198,1.6),grains('Rolled oats',286,217,76,106,95,1.15));
  a.push(berries('Blueberries',242,247,17,45,28,7.8),berries('Blueberries-extra',342,162,7,24,19,7));
  a.push(`<ellipse cx="300" cy="270" rx="15" ry="6" transform="rotate(-32 300 270)" fill="${C.olive}"/>`);
  a.push(`<ellipse cx="317" cy="268" rx="14" ry="6" transform="rotate(32 317 268)" fill="${C.olive}"/>`);
  a.push(`<g transform="rotate(27 486 261)">${R(481,192,10,145,'#d4d9d0',5,C.ink)}${E(486,189,22,33,'#e9ede6',C.ink,2)}${E(486,184,14,24,'#f9faf6')}</g>`);
  return a.join('');
}
function recipeScene(items){
  const a=[R(0,0,630,440,'#e9e5d9',22)];
  // A single board groups the ingredients into a kitchen prep scene.
  a.push(`<g transform="rotate(-7 68 316)">${R(11,259,132,150,'#f8f6eb',10)}${L(24,280,131,280,'#d5dbce',3)}${L(24,293,131,293,'#d5dbce',2)}</g>`);
  a.push(R(52,39,526,364,'#153f3515',24));
  a.push(R(48,32,526,364,'#d9cba9',24,'#b6a47f',2));
  for(const y of [73,169,328])a.push(L(69,y,552,y,'#cabb99',1));
  a.push(E(543,65,8,8,'#b5a37f'));
  // The large oats bowl anchors the composition. Smaller ingredients follow its edge.
  const spots={dairy:[148,140],grain:[316,210],fruit:[485,135],pantry:[130,316],seed:[487,311]};
  for(const food of items){
    const [x,y]=spots[food.category]??[310,215];
    if(food.category==='dairy')a.push(bowl(x,y,65,'#e8ede3'),yoghurt(x,y,.92));
    if(food.category==='grain')a.push(bowl(x,y,86,'#ddc9a1'),grains(food.name,x,y,118,68,67,1.4));
    if(food.category==='fruit')a.push(bowl(x,y,61,'#e7e8e3'),berries(food.name,x,y,31,44,41,7.1));
    if(food.category==='pantry')a.push(E(x,y+56,43,9,'#153f3518'),R(x-34,y-43,68,98,'#dcb568',15,C.ink,2),R(x-39,y-52,78,20,C.olive,7),R(x-29,y-6,58,37,'#f7f2df',7),T(x,y+18,'HONEY',10,800,C.olive,'middle',1));
    if(food.category==='seed'){
      a.push(bowl(x,y,43,'#d8d2c2'));
      const seed=hash(food.name);
      for(let i=0;i<80;i++){const ang=rnd(seed,i)*Math.PI*2,r=Math.sqrt(rnd(seed,i+80))*30;a.push(E((x+Math.cos(ang)*r).toFixed(1),(y+Math.sin(ang)*r).toFixed(1),1.55,1.55,i%3?'#5f605a':'#8e8d80'));}
    }
  }
  a.push(`<g transform="rotate(28 327 350)">${R(321,318,10,105,'#b5b9ac',5,C.ink)}${E(326,316,17,23,'#e6e8df',C.ink,2)}${E(326,311,11,16,'#f9faf6')}</g>`);
  a.push(berries('loose-blueberries',540,231,4,14,14,5.5));
  return a.join('');
}

const b=[R(0,0,1440,900,C.paper)];
b.push(T(64,65,'STEADY  /  FOOD VISUAL LANGUAGE',13,800,C.olive,'start',2));
b.push(T(64,119,'Food, in context.',46,750));
b.push(T(64,156,'One recipe, two useful views: the finished meal and the ingredients ready to prepare.',16,500,C.muted));
const left=64,right=738,top=213;
b.push(R(left,top,638,613,C.white,22,C.line),R(right,top,638,613,C.white,22,C.line));
b.push(G(left+4,top+4,mealScene()),G(right+4,top+4,recipeScene(ingredients)));
b.push(T(left+28,top+491,'MEAL',12,800,C.olive,'start',1.7));
b.push(T(left+28,top+526,'Yoghurt, oats & blueberries',24,750));
b.push(T(left+28,top+557,'Served together on a tray. The food fills the bowl.',15,500,C.muted));
b.push(T(right+28,top+491,'RECIPE',12,800,C.olive,'start',1.7));
b.push(T(right+28,top+526,'Overnight oats with blueberries',24,750));
b.push(T(right+28,top+557,'Yoghurt · oats · blueberries · honey · chia seeds',15,500,C.muted));
b.push(T(64,870,'Generated from ingredient categories and a breakfast bowl template by scripts/generate-food-scenes.mjs',12,600,C.muted));
writeFileSync(output,`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900" role="img" aria-label="Steady meal tray and recipe countertop visual study"><title>Steady food scene study</title>${b.join('')}</svg>`);
console.log(output.pathname);
