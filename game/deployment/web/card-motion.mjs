import {CARD_MOTION_PROFILES} from './card-motion-profiles.mjs';

// A local, lightweight mesh animation. This is not a Cubism / Live2D project.
const VS = `
precision highp float;
attribute vec2 aUV;
uniform float uTime, uSeed, uPeriod, uStrength;
uniform vec4 uFace, uBreath;
uniform vec4 uRigid[4];
uniform vec2 uDirection, uScale, uOffset;
uniform vec4 uRegion[6], uForce[6];
varying vec2 vUV;
float ellipse(vec2 p, vec4 e) {
  vec2 d=(p-e.xy)/max(e.zw,vec2(.001));
  return exp(-2.8*dot(d,d));
}
float rigid(vec2 p,vec4 e){
  vec2 d=(p-e.xy)/max(e.zw,vec2(.001));
  return 1.0-smoothstep(.8,1.3,dot(d,d));
}
void main(){
  vec2 p=aUV;
  float breath=sin(uTime*6.2831853/uPeriod+uSeed);
  float b=ellipse(p,uBreath);
  // Chest/shoulder expansion; head and facial features remain almost fixed.
  vec2 delta=vec2((p.x-uBreath.x)*.006,-.00085)*b*breath;
  for(int i=0;i<6;i++) {
    vec4 r=uRegion[i];vec4 f=uForce[i];
    float m=ellipse(p,r);
    float tip=mix(1.0,pow(clamp((p.y-r.y+r.w)/(r.w*2.0),0.0,1.0),.65),f.w);
    float delay=f.z+(p.y-r.y)*3.2;
    // A steady breeze, two slower gusts, and delayed secondary flutter.
    float gust=.43+.30*sin(uTime*.63+uSeed-delay)+.14*sin(uTime*1.07+.6-delay);
    float flutter=.10*sin(uTime*2.13-delay*1.8)+.035*sin(uTime*3.7-delay);
    delta+=vec2(f.x*uDirection.x*(gust+flutter),f.y*(sin(uTime*.79-delay)+uDirection.y*gust))*m*tip;
  }
  float faceGuard=ellipse(p,uFace);
  float rigidGuard=0.0;
  for(int i=0;i<4;i++)rigidGuard=max(rigidGuard,rigid(p,uRigid[i]));
  float edge=smoothstep(.0,.045,p.x)*smoothstep(.0,.045,1.0-p.x)
    *smoothstep(.0,.04,p.y)*smoothstep(.0,.04,1.0-p.y);
  p+=delta*(1.0-.985*faceGuard)*(1.0-rigidGuard)*edge*uStrength;
  vec2 screen=p*uScale+uOffset;
  gl_Position=vec4(screen.x*2.0-1.0,1.0-screen.y*2.0,0,1);
  vUV=aUV;
}`;
const FS = `
precision highp float;
uniform sampler2D uImage;
uniform float uTime,uSeed;
uniform vec4 uFace;
uniform vec3 uLight;
varying vec2 vUV;
void main(){
  vec4 c=texture2D(uImage,vUV);
  vec2 d=(vUV-uFace.xy)/max(uFace.zw,vec2(.001));
  float away=1.0-exp(-2.8*dot(d,d));
  // Very restrained light drift at the outer scene, not a full-frame filter.
  float edge=pow(clamp(abs(vUV.x-.5)*1.7,0.0,1.0),2.0);
  float light=.009*(.5+.5*sin(vUV.y*6.0-uTime*.18+uSeed))*edge*away;
  gl_FragColor=vec4(c.rgb+uLight*light,c.a);
}`;

const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const lowMemory=(navigator.deviceMemory||8)<=2;
const saveData=Boolean(navigator.connection?.saveData);
const maxActive=lowMemory||saveData?0:(navigator.hardwareConcurrency||4)<=4?3:6;
const maxHighTextures=(navigator.deviceMemory||8)<=4||(navigator.hardwareConcurrency||4)<=4?1:2;
const highTextures=new Set();
const rigs=new Map();
const inView=new Set();
let observer, resizeObserver, mutations, raf=0, lastFrame=0, slowFrames=0;
let disposed=false;
let userEnabled=true;
try{userEnabled=localStorage.getItem('talos-card-motion-v1')!=='0';}catch{}
const frameMs=1000/24;
const policyEnabled=()=>!disposed&&userEnabled&&!reduced.matches&&maxActive>0&&!document.hidden;

function shader(gl,type,source){
  const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const log=gl.getShaderInfoLog(s);gl.deleteShader(s);throw Error('card shader: '+log);}
  return s;
}
function createProgram(gl){
  const p=gl.createProgram(),v=shader(gl,gl.VERTEX_SHADER,VS),f=shader(gl,gl.FRAGMENT_SHADER,FS);
  gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const log=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw Error('card program: '+log);}
  return p;
}
function geometry(cols=48,rows=80){
  const uv=new Float32Array((cols+1)*(rows+1)*2),idx=new Uint16Array(cols*rows*6);
  let n=0,k=0;
  for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++){uv[n++]=x/cols;uv[n++]=y/rows;}
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
    const a=y*(cols+1)+x,b=a+1,c=a+cols+1,d=c+1;
    idx.set([a,c,b,b,c,d],k);k+=6;
  }
  return {uv,idx};
}
const mesh=geometry();
const uniformLocations=new WeakMap();
function put(gl,p,name,method,...args){
  let cache=uniformLocations.get(p);if(!cache){cache=new Map();uniformLocations.set(p,cache);}
  if(!cache.has(name))cache.set(name,gl.getUniformLocation(p,name));
  const l=cache.get(name);if(l!==null)gl[method](l,...args);
}

class CardRig {
  constructor(el){
    this.el=el;this.img=el.querySelector('img');this.profile=CARD_MOTION_PROFILES[el.dataset.cardMotion];
    this.canvas=null;this.gl=null;this.failed=false;this.rect=null;this.ready=false;
    this.textureQuality='display';this.highResAttempted=false;this.highResImage=null;this.generation=0;
    this.onLoad=()=>{this.rect=null;ensureLoop();};
    this.onImageError=()=>{this.error='Artwork image could not load';this.failed=true;this.release();};
    this.img?.addEventListener('load',this.onLoad);
    this.img?.addEventListener('error',this.onImageError);
  }
  create(){
    if(this.failed||!this.img?.complete||!this.img.naturalWidth)return false;
    try{
      const canvas=document.createElement('canvas');canvas.className='card-motion-canvas';canvas.setAttribute('aria-hidden','true');
      const gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false,powerPreference:'low-power'});
      if(!gl)throw Error('No WebGL');
      this.canvas=canvas;this.gl=gl;
      const program=createProgram(gl);this.program=program;gl.useProgram(program);
      const vb=gl.createBuffer(),ib=gl.createBuffer();this.buffers=[vb,ib];
      gl.bindBuffer(gl.ARRAY_BUFFER,vb);gl.bufferData(gl.ARRAY_BUFFER,mesh.uv,gl.STATIC_DRAW);
      const loc=gl.getAttribLocation(program,'aUV');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.idx,gl.STATIC_DRAW);
      const texture=gl.createTexture();this.texture=texture;gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.img);
      const p=this.profile;
      put(gl,program,'uImage','uniform1i',0);put(gl,program,'uSeed','uniform1f',p.seed);
      put(gl,program,'uPeriod','uniform1f',p.period);put(gl,program,'uStrength','uniform1f',p.strength);
      put(gl,program,'uFace','uniform4fv',p.face);put(gl,program,'uBreath','uniform4fv',p.breath);
      const rigidAreas=Array.from({length:4},(_,i)=>p.rigid?.[i]||[0,0,0,0]);
      put(gl,program,'uRigid[0]','uniform4fv',rigidAreas.flat());
      put(gl,program,'uDirection','uniform2fv',p.direction);put(gl,program,'uLight','uniform3fv',p.light);
      const r=p.wind.flatMap(w=>w.region),f=p.wind.flatMap(w=>[...w.amount,w.phase,w.tip]);
      put(gl,program,'uRegion[0]','uniform4fv',r);put(gl,program,'uForce[0]','uniform4fv',f);
      canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();this.failed=true;this.release();});
      this.el.append(canvas);return true;
    }catch(error){this.error=String(error.message||error);this.failed=true;this.release();return false;}
  }
  resize(){
    const rect=this.el.getBoundingClientRect();if(rect.width<2||rect.height<2)return false;
    const dpr=Math.min(devicePixelRatio||1,1.5),scale=Math.min(dpr,900/Math.max(rect.width,rect.height));
    const width=Math.max(1,Math.round(rect.width*scale)),height=Math.max(1,Math.round(rect.height*scale));
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;this.gl.viewport(0,0,width,height);}
    // Mirror CSS object-fit: cover, including the original card crop.
    const iw=this.img.naturalWidth,ih=this.img.naturalHeight,cover=Math.max(rect.width/iw,rect.height/ih);
    const sx=iw*cover/rect.width,sy=ih*cover/rect.height;
    const cssPos=getComputedStyle(this.img).objectPosition.split(/\s+/).map(v=>v.endsWith('%')?parseFloat(v)/100:.5);
    const pos=this.el.dataset.cardCrop?.split(',').map(Number)||cssPos;
    put(this.gl,this.program,'uScale','uniform2f',sx,sy);
    put(this.gl,this.program,'uOffset','uniform2f',(1-sx)*pos[0],(1-sy)*pos[1]);
    if(rect.height<=360&&highTextures.has(this))this.releaseHighTexture(true);
    this.rect=rect;return true;
  }
  releaseHighTexture(restore=false){
    this.generation++;highTextures.delete(this);this.highResAttempted=false;this.textureQuality='display';
    if(this.highResImage){this.highResImage.onload=null;this.highResImage.onerror=null;this.highResImage.src='';this.highResImage=null;}
    if(restore&&this.gl&&this.texture){this.gl.bindTexture(this.gl.TEXTURE_2D,this.texture);this.gl.texImage2D(this.gl.TEXTURE_2D,0,this.gl.RGBA,this.gl.RGBA,this.gl.UNSIGNED_BYTE,this.img);}
  }
  requestHighTexture(){
    if(this.highResAttempted||!this.rect||this.rect.height<=360||saveData||lowMemory||!policyEnabled())return;
    if(highTextures.size>=maxHighTextures||this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)<1920)return;
    this.highResAttempted=true;highTextures.add(this);
    const image=new Image(),generation=this.generation;
    image.decoding='async';this.highResImage=image;
    image.onload=()=>{
      if(this.generation!==generation||!this.gl||!this.el.isConnected||!policyEnabled())return;
      try{
        const gl=this.gl;gl.bindTexture(gl.TEXTURE_2D,this.texture);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
        this.textureQuality='motion1080';
      }catch{highTextures.delete(this);}
      this.highResImage=null;
    };
    image.onerror=()=>{
      if(this.generation===generation){highTextures.delete(this);this.highResImage=null;}
      // A missing optional high-resolution derivative must not hide the static art.
    };
    image.src=this.el.dataset.cardMotionSrc||`/assets/cards/motion/${this.el.dataset.cardMotion}.webp`;
  }
  draw(time){
    if(!this.gl&&!this.create())return;
    if(!this.rect&&!this.resize())return;
    this.requestHighTexture();
    const gl=this.gl;
    gl.useProgram(this.program);put(gl,this.program,'uTime','uniform1f',time);
    gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawElements(gl.TRIANGLES,mesh.idx.length,gl.UNSIGNED_SHORT,0);
    this.ready=true;this.el.classList.add('motion-running');
  }
  release(){
    this.el.classList.remove('motion-running');this.ready=false;
    this.releaseHighTexture();
    const gl=this.gl;if(gl){for(const b of this.buffers||[])gl.deleteBuffer(b);if(this.texture)gl.deleteTexture(this.texture);if(this.program)gl.deleteProgram(this.program);}
    this.canvas?.remove();this.canvas=null;this.gl=null;this.rect=null;
  }
  destroy(){this.img?.removeEventListener('load',this.onLoad);this.img?.removeEventListener('error',this.onImageError);this.release();}
}

function activeRigs(){
  return [...inView].filter(e=>e.isConnected&&!e.closest('.dead')).sort((a,b)=>{
    const score=e=>e.closest('.mint-preview')?3:e.closest('.unit')?2:e.closest('dialog')?4:1;
    return score(b)-score(a);
  }).map(e=>rigs.get(e)).filter(r=>r&&!r.failed).slice(0,maxActive);
}
function ensureLoop(){if(!raf&&policyEnabled()&&inView.size&&activeRigs().length)raf=requestAnimationFrame(tick);}
function tick(now){
  raf=0;if(!policyEnabled()){for(const rig of rigs.values())rig.release();return;}
  if(now-lastFrame>=frameMs){
    const active=activeRigs(),keep=new Set(active);
    for(const rig of rigs.values())if(rig.gl&&!keep.has(rig))rig.release();
    const start=performance.now();for(const rig of active)rig.draw(now/1000);
    const cost=performance.now()-start;
    slowFrames=cost>28?slowFrames+1:Math.max(0,slowFrames-1);
    // Long-lived slow GPU: retain the static artwork, without repeated retries.
    if(slowFrames>30){for(const rig of rigs.values()){rig.failed=true;rig.release();}inView.clear();return;}
    lastFrame=now;
  }
  if(inView.size&&activeRigs().length)raf=requestAnimationFrame(tick);
}
function refresh(){
  for(const [el,rig] of rigs)if(!el.isConnected){observer.unobserve(el);resizeObserver?.unobserve(el);inView.delete(el);rig.destroy();rigs.delete(el);}
  for(const el of document.querySelectorAll('[data-card-motion]')){
    const profile=CARD_MOTION_PROFILES[el.dataset.cardMotion];
    if(rigs.has(el)||!profile||profile.calibration?.startsWith('pending')||!el.querySelector('img'))continue;
    rigs.set(el,new CardRig(el));observer.observe(el);resizeObserver?.observe(el);
  }
  ensureLoop();
}
function policyChanged(){
  if(!policyEnabled()){
    if(raf)cancelAnimationFrame(raf);raf=0;
    for(const rig of rigs.values())rig.release();
  }else{for(const rig of rigs.values())rig.rect=null;refresh();}
}

export function startCardMotion(){
  if(observer||disposed||maxActive===0||!window.IntersectionObserver)return;
  observer=new IntersectionObserver(entries=>{
    for(const e of entries){if(e.isIntersecting&&e.intersectionRatio>.06)inView.add(e.target);else{inView.delete(e.target);rigs.get(e.target)?.release();}}
    ensureLoop();
  },{threshold:[0,.07]});
  if(window.ResizeObserver)resizeObserver=new ResizeObserver(entries=>{for(const e of entries){const rig=rigs.get(e.target);if(rig)rig.rect=null;}ensureLoop();});
  let pending=false;
  mutations=new MutationObserver(()=>{if(pending)return;pending=true;queueMicrotask(()=>{pending=false;refresh();});});
  mutations.observe(document.body,{childList:true,subtree:true});
  document.addEventListener('visibilitychange',policyChanged);reduced.addEventListener('change',policyChanged);
  window.addEventListener('resize',policyChanged);window.addEventListener('pagehide',stopCardMotion,{once:true});
  refresh();
}
export function stopCardMotion(){
  disposed=true;if(raf)cancelAnimationFrame(raf);raf=0;observer?.disconnect();resizeObserver?.disconnect();mutations?.disconnect();
  for(const rig of rigs.values())rig.destroy();rigs.clear();inView.clear();
  document.removeEventListener('visibilitychange',policyChanged);reduced.removeEventListener('change',policyChanged);window.removeEventListener('resize',policyChanged);
}
export function setCardMotionEnabled(enabled,{persist=true}={}){
  userEnabled=Boolean(enabled);if(persist)try{localStorage.setItem('talos-card-motion-v1',userEnabled?'1':'0');}catch{}
  policyChanged();return userEnabled;
}
export function cardMotionStats(){return {registered:rigs.size,visible:inView.size,active:[...rigs.values()].filter(r=>r.ready).length,limit:maxActive,highTextures:[...highTextures].filter(r=>r.textureQuality==='motion1080').length,highTextureLimit:maxHighTextures,reduced:reduced.matches,userEnabled,failures:[...rigs.values()].filter(r=>r.error).map(r=>({card:r.el.dataset.cardMotion,error:r.error}))};}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startCardMotion,{once:true});else startCardMotion();
