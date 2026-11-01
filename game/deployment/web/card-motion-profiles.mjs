/**
 * Normalized coordinates refer to the un-cropped 9:16 illustration.
 * face / breath / wind ellipse: [centerX, centerY, radiusX, radiusY].
 * Wind area: {region, amount:[x,y], phase, tip}. Hair/cloth roots are pinned.
 * Profiles 16/17 must be visually calibrated when their final illustrations land.
 */
const hair = (region, amount, phase=0, tip=1) => ({region,amount,phase,tip});
export const CARD_MOTION_PROFILES = {
  'c26-s15': {
    name:'庄方宜 · 超精美 01',seed:2.6,period:5.1,direction:[-1,.17],strength:1,
    face:[.573,.249,.10,.063],breath:[.574,.381,.18,.18],
    wind:[
      hair([.272,.392,.26,.16],[.0065,.0017],.0),
      hair([.803,.466,.19,.16],[.0054,.0016],.55),
      hair([.469,.633,.22,.25],[.0037,.0010],1.15),
      hair([.139,.574,.17,.17],[.0061,.0014],.75),
      hair([.82,.702,.15,.17],[.0040,.0010],1.8),
      hair([.47,.86,.39,.12],[.0008,.0004],2.1,0)
    ],light:[.43,.82,1],calibration:'existing-s15-visual'
  },
  'c30-s15': {
    name:'诀 · 超精美 01',seed:5.4,period:4.7,direction:[-1,-.12],strength:1,
    face:[.558,.245,.105,.071],breath:[.564,.357,.17,.15],
    wind:[
      hair([.205,.146,.25,.18],[.0064,.0021],.3),
      hair([.208,.317,.23,.15],[.0058,.0018],.75),
      hair([.2,.463,.23,.17],[.0057,.0013],1.2),
      hair([.752,.568,.20,.23],[.0047,.0018],1.75),
      hair([.858,.783,.15,.15],[.0054,.0014],2.2),
      hair([.54,.848,.39,.10],[.0008,.0003],2.5,0)
    ],light:[.85,.27,.23],calibration:'existing-s15-visual'
  }
};

// Conservative starting rigs. Do not label them final until checked against art.
for (const [id, face, breath, direction, tint] of [
  [26,[.5,.23,.105,.075],[.50,.39,.20,.17],[-1,.12],[.39,.83,.92]],
  [30,[.5,.24,.105,.075],[.50,.39,.20,.17],[1,-.1],[.68,.76,.98]]
]) for (const skin of [16,17]) CARD_MOTION_PROFILES[`c${id}-s${skin}`] = {
  name:`${id===26?'庄方宜':'诀'} · 超精美 ${skin-14}`,
  seed:id*.19+skin*.41,period:skin===16?5.6:4.8,direction,strength:.8,
  face,breath,
  wind:[
    hair([.24,.34,.16,.20],[.005,.0013],.3),
    hair([.77,.35,.16,.21],[.005,.0013],.8),
    hair([.25,.63,.18,.23],[.004,.0010],1.2),
    hair([.74,.64,.18,.23],[.004,.0011],1.8),
    hair([.50,.83,.22,.13],[.003,.0008],2.2),
    hair([.5,.1,.40,.09],[.0006,.0003],2.8,0)
  ],light:tint,calibration:'pending-final-art'
};

// Final s16 illustrations, inspected at native resolution on 2026-10-31.
CARD_MOTION_PROFILES['c26-s16']={
  name:'庄方宜 · 超精美 02',seed:7.6,period:5.6,direction:[1,.10],strength:.86,
  face:[.405,.260,.103,.067],breath:[.399,.385,.175,.142],
  rigid:[[.895,.317,.095,.077],[.025,.534,.078,.071],[.631,.539,.105,.037],[.850,.389,.101,.040]],
  wind:[
    hair([.135,.405,.15,.17],[.0055,.0013],.25),
    hair([.681,.452,.24,.15],[.0057,.0014],.80),
    hair([.839,.545,.19,.14],[.0059,.0015],1.55),
    hair([.730,.808,.18,.18],[.0028,.0008],2.0),
    hair([.944,.146,.062,.16],[.0015,.0009],1.1),
    hair([.670,.310,.18,.08],[.00045,.00025],2.5,0)
  ],light:[.37,.73,.95],calibration:'ancient-v2-s16-seated-pose-revision-visual-20261031'
};
CARD_MOTION_PROFILES['c30-s16']={
  name:'诀 · 超精美 02',seed:8.9,period:5.1,direction:[-1,-.06],strength:.86,
  face:[.558,.282,.095,.063],breath:[.562,.388,.16,.13],
  rigid:[[.199,.145,.23,.12],[.842,.334,.20,.09]],
  wind:[
    hair([.260,.269,.23,.10],[.0060,.0015],.25),
    hair([.215,.366,.20,.10],[.0052,.0012],.80),
    hair([.200,.493,.19,.14],[.0048,.0012],1.30),
    hair([.829,.573,.19,.15],[.0043,.0010],1.90),
    hair([.708,.664,.14,.08],[.0035,.0012],2.50),
    hair([.120,.917,.11,.07],[.0005,.0004],3.0,0)
  ],light:[.89,.81,.64],calibration:'ancient-v2-s16-visual-20261031'
};
CARD_MOTION_PROFILES['c30-s17']={
  name:'诀 · 超精美 03',seed:9.7,period:5.3,direction:[1,.08],strength:.86,
  face:[.497,.293,.105,.066],breath:[.472,.453,.17,.135],
  rigid:[[.284,.134,.222,.107],[.755,.283,.205,.110],[.161,.710,.115,.039],[.856,.603,.117,.041]],
  wind:[
    hair([.259,.312,.18,.096],[.0038,.0010],.20),
    hair([.709,.451,.19,.12],[.0055,.0013],.65),
    hair([.879,.523,.19,.13],[.0061,.0016],1.25),
    hair([.883,.750,.16,.18],[.0046,.0011],1.85),
    hair([.398,.843,.14,.16],[.0034,.0008],2.40),
    hair([.913,.109,.09,.11],[.0013,.0007],2.9,0)
  ],light:[.68,.78,.98],calibration:'ancient-v2-s17-lotus-moon-floating-cannon-visual-20261031'
};
CARD_MOTION_PROFILES['c26-s17']={
  name:'庄方宜 · 超精美 03',seed:10.8,period:5.2,direction:[-1,.09],strength:.88,
  face:[.588,.245,.095,.060],breath:[.585,.344,.15,.127],
  rigid:[[.109,.226,.125,.080],[.885,.446,.120,.075],[.301,.210,.104,.039],[.694,.426,.047,.042]],
  wind:[
    hair([.247,.363,.245,.104],[.0060,.0015],.15),
    hair([.181,.501,.230,.122],[.0062,.0016],.75),
    hair([.259,.588,.255,.122],[.0057,.0014],1.30),
    hair([.350,.715,.210,.175],[.0043,.0011],1.95),
    hair([.198,.769,.190,.143],[.0050,.0012],2.45),
    hair([.373,.049,.310,.055],[.0011,.0006],2.95,0)
  ],light:[1,.72,.35],calibration:'ancient-v2-s17-autumn-ginkgo-mountain-visual-20261031'
};

export const motionAvailable = (id,skin) => {
  const p=CARD_MOTION_PROFILES[`c${String(id).padStart(2,'0')}-s${String(skin).padStart(2,'0')}`];
  return Boolean(p&&!p.calibration.startsWith('pending'));
};
