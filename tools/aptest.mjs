import fs from 'fs';
const src = `const DEG=Math.PI/180, KN=0.514444; const clamp=(v,a,b)=>v<a?a:v>b?b:v;\n` + fs.readFileSync('src/07_physics.js','utf8') + `\nexport {ShipPhysics, TELEGRAPH, SHIPSPEC};`;
fs.writeFileSync('/tmp/_phys2.mjs', src);
const { ShipPhysics } = await import('/tmp/_phys2.mjs?'+Date.now());
const DEG=Math.PI/180, KN=0.514444; const clamp=(v,a,b)=>v<a?a:v>b?b:v; const wrap180=(d)=>((d+540)%360)-180;
const env = { depthAt: () => 60, contact: () => null };
for (const [kp,kd,spd,tele,rpm] of [[2,3,16,9,56],[2,3,6,5,21],[1.5,2.2,16,9,56],[1.5,2.2,6,5,21]]) {
  const s=new ShipPhysics(); s.windSpeed=7; s.curSpeed=0.2; s.engineMode='STANDBY'; s.u=spd*KN; s.rpm=[rpm,rpm]; s.tele=[tele,tele]; s.psi=90*DEG;
  let ap=100, out=[];
  for(let i=0;i<20*400;i++){ const err=wrap180(ap - s.psi/DEG); s.rudderCmd=clamp(err*kp - s.rotDegMin*kd,-15,15); s.step(0.05,env); if(i%(20*40)==0) out.push((s.psi/DEG).toFixed(1)); }
  console.log(kp,kd,spd,'kn', out.join(' '));
}
