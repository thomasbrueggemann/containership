import fs from 'fs';
const src = `const DEG=Math.PI/180, KN=0.514444; const clamp=(v,a,b)=>v<a?a:v>b?b:v;\n` + fs.readFileSync('src/07_physics.js','utf8') + `\nexport {ShipPhysics, TELEGRAPH, SHIPSPEC};`;
fs.writeFileSync('/tmp/_phys.mjs', src);
const { ShipPhysics, TELEGRAPH } = await import('/tmp/_phys.mjs?'+Date.now());
const KN=0.514444, DEG=Math.PI/180;
const env = { depthAt: () => 60, contact: () => null };
function mk(){ const s=new ShipPhysics(); s.windSpeed=0; s.curSpeed=0; s.engineMode='STANDBY'; return s; }
// steady speeds
for (let t=5;t<10;t++){ const s=mk(); s.tele=[t,t]; for(let i=0;i<20*3600;i++) s.step(0.05,env); console.log(TELEGRAPH[t].id, 'rpm',s.rpm[0].toFixed(1),'speed kn', (s.u/KN).toFixed(2)); }
// accel time to 5kn at FA
{ const s=mk(); s.tele=[8,8]; let t=0; while(s.u/KN<5 && t<3600){ s.step(0.05,env); t+=0.05;} console.log('FA 0->5kn s', t.toFixed(0)); }
// stopping: from 12kn crash stop
{ const s=mk(); s.u=12*KN; s.rpm=[38,38]; s.tele=[0,0]; let t=0, d=0; while(s.u>0.05 && t<3600){ s.step(0.05,env); t+=0.05; d+=s.u*0.05;} console.log('crash stop 12kn: time', t.toFixed(0),'dist m', d.toFixed(0)); }
// coast from 10kn with stop
{ const s=mk(); s.u=10*KN; s.tele=[4,4]; let t=0; while(t<600){ s.step(0.05,env); t+=0.05;} console.log('coast 10kn 10min ->', (s.u/KN).toFixed(2)); }
// turning: FA, hard over
for (const [tel,rud] of [[8,35],[8,10],[6,35],[5,35]]) { const s=mk(); s.tele=[tel,tel]; for(let i=0;i<20*1800;i++) s.step(0.05,env); const x0=s.x,z0=s.z; s.rudderCmd=rud; let maxx=0; let psi0=s.psi; let t=0; let adv=0, tact=0, got90=false;
  const f0=[Math.sin(psi0),-Math.cos(psi0)], s0=[Math.cos(psi0),Math.sin(psi0)];
  while(t<1500){ s.step(0.05,env); t+=0.05; const dx=s.x-x0, dz=s.z-z0; const a=dx*f0[0]+dz*f0[1], b=dx*s0[0]+dz*s0[1]; let dpsi=((s.psi-psi0+Math.PI*4)%(Math.PI*2)); if(!got90 && dpsi>Math.PI/2 && dpsi<Math.PI){got90=true; adv=a;} if(dpsi>Math.PI*0.98 && dpsi<Math.PI*1.02){tact=b;} }
  console.log(TELEGRAPH[tel].id,'rud',rud,'ROT deg/min',s.rotDegMin.toFixed(1),'speed',(s.u/KN).toFixed(1),'advance/L',(adv/397).toFixed(2),'tactD/L',(tact/397).toFixed(2), 'drift deg', (Math.atan2(-s.v,s.u)/DEG).toFixed(1));
}
// zigzag stability: 10/10 at HA
// kick ahead from rest: SA with 35 rudder for 60 s
{ const s=mk(); s.tele=[6,6]; s.rudderCmd=35; for(let i=0;i<20*90;i++) s.step(0.05,env); console.log('kick ahead 90s SA+35: ROT', s.rotDegMin.toFixed(1),'speed kn',(s.u/KN).toFixed(2)); }
// bow thruster at rest full: rot after 120s, lateral
{ const s=mk(); s.bowThrCmd=[1,1]; for(let i=0;i<20*180;i++) s.step(0.05,env); console.log('BT 180s: ROT', s.rotDegMin.toFixed(2),'v',s.v.toFixed(3),'hdg change', ((s.psi-Math.PI/2)/DEG).toFixed(1)); }
// tugs both pulling to port 50%: lateral speed after 180s
{ const s=mk(); s.tugs.forEach(t=>{t.attached=true;t.powerCmd=0.5;t.dir=270;t.dirCmd=270;}); for(let i=0;i<20*300;i++) s.step(0.05,env); console.log('tugs 50% port 300s: v', s.v.toFixed(3),'ROT',s.rotDegMin.toFixed(2)); }
// wind 16kn beam effect at rest
{ const s=mk(); s.windSpeed=16*KN; s.windFrom=0; s.psi=Math.PI/2; for(let i=0;i<20*600;i++) s.step(0.05,env); console.log('wind 16kn beam 600s: v', s.v.toFixed(3),'ROT',s.rotDegMin.toFixed(2)); }
// course stability: small perturbation at FA rudder 0
{ const s=mk(); s.tele=[8,8]; s.u=14*KN; s.rpm=[48,48]; s.r=0.001; for(let i=0;i<20*300;i++) s.step(0.05,env); console.log('stability r after 300s', (s.r/DEG*60).toFixed(3),'deg/min'); }
