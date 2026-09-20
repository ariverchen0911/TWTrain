const {test} = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('../js/mock-data.js');
const {SimulationEngine} = require('../js/simulation-engine.js');
const make = () => new SimulationEngine(window.GFTData);

test('six scenarios retain 20 finite records through all 721 timestamps', () => {
  const engine = make();
  for (const [scenario] of window.GFTData.scenarios) {
    engine.setScenario(scenario);
    for (let minute = 0; minute <= 720; minute++) {
      engine.index = minute;
      const state = engine.getState();
      assert.equal(state.records.length, 20);
      assert.equal(Object.values(state.counts).reduce((a,b)=>a+b,0),20);
      assert(state.records.every(r=>Number.isFinite(r.levelNonContact) && Number.isFinite(r.tiltResultant)));
    }
  }
});

test('hazard, quality and offline scenarios produce distinct outcomes', () => {
  const engine = make();
  engine.setScenario('rapid_rise'); engine.index = 450;
  assert(engine.getState().counts.L3 > 0);
  engine.setScenario('sensor_mismatch'); engine.index = 400;
  assert.equal(engine.getState().records[4].quality,'SUSPECT');
  assert.equal(engine.getState().records[4].alertLevel,'L1');
  engine.setScenario('tilt_change'); engine.index = 500;
  assert.equal(engine.getState().records[15].alertLevel,'L1');
  engine.setScenario('offline'); engine.index = 400;
  const offline = engine.getState();
  assert.equal(offline.counts.OFFLINE,1);
  assert.equal(offline.receivedCount,62);
  assert.equal(offline.expectedCount,66);
});

test('cumulative rain never decreases and equals minute totals', () => {
  const engine = make();
  engine.setScenario('rain');
  let previous=0,total=0;
  for(let minute=0;minute<=720;minute++) {
    const r=engine.pointRecord(window.GFTData.monitoringPoints[0],minute);
    assert(r.rainfallAccumulated>=previous);
    previous=r.rainfallAccumulated;
    total+=engine.rainSeries.rain[minute].rainfall;
  }
  assert(Math.abs(previous-total)<0.1);
});

test('invalid thresholds are rejected without corrupting state', () => {
  const engine=make(), before={...engine.thresholds};
  for(const input of [{l1:NaN},{l1:-1},{l1:3,l2:2},{l2:2.8},{l3:Infinity}]) assert.throws(()=>engine.setThresholds(input));
  assert.deepEqual(engine.thresholds,before);
  engine.setThresholds({l1:0.1,l2:0.2,l3:0.3});
  assert.equal(engine.getState().alerts.length,20);
});

test('CSV respects point, quality and exact time window', () => {
  const engine=make(); engine.setScenario('sensor_mismatch'); engine.index=400;
  const csv=engine.exportCsv('OF-05','SUSPECT',250,270).split('\n');
  assert.equal(csv.length,11);
  assert(csv.slice(1).every(row=>row.includes(',OF-05,') && row.includes(',SUSPECT,')));
  assert(csv[1].startsWith(engine.timeline[261].toISOString()));
  assert(csv.at(-1).startsWith(engine.timeline[270].toISOString()));
});

test('playback boundaries and reset remain consistent', () => {
  const engine=make(); engine.step(-1); assert.equal(engine.index,0);
  engine.step(1000); assert.equal(engine.index,720); assert.equal(engine.playing,false);
  engine.reset(); assert.equal(engine.index,0); assert.equal(engine.timer,null);
});
