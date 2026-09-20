const {chromium} = require(process.env.GFT_PLAYWRIGHT || 'playwright');
const sharp = require(process.env.GFT_SHARP || 'sharp');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve('outputs/qa/v1.2.0');
fs.mkdirSync(output,{recursive:true});
const results = {version:'1.2.0',checks:[],errors:[],terrainSamples:[],screenshots:[]};
const check = (name, condition) => {assert(condition,name);results.checks.push(name);console.log('PASS',name)};

(async()=>{
  const browser = await chromium.launch({headless:true,executablePath:process.env.GFT_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist']});
  try {
    const context = await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true});
    const page = await context.newPage();
    page.on('pageerror',e=>results.errors.push(e.message));
    const tileResponses = [];
    page.on('response',r=>{if(/wmts|Terrain3D/.test(r.url()))tileResponses.push({url:r.url(),status:r.status()})});
    // Expose the actual viewer only in this test response, without changing shipped code.
    await page.route('**/js/app.js*',async route=>{
      const response=await route.fetch();
      await route.fulfill({response,body:(await response.text()).replace('viewer = new window.Cesium.Viewer','viewer = window.__qaViewer = new window.Cesium.Viewer')});
    });
    await page.goto(process.env.GFT_URL || 'http://127.0.0.1:8000/index.html',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.documentElement.dataset.terrainStatus==='ready' && document.documentElement.dataset.railOverlayStatus==='loaded',null,{timeout:60000});
    await page.waitForFunction(()=>window.__qaViewer.scene.globe.tilesLoaded && window.__qaViewer.dataSourceDisplay.ready,null,{timeout:60000});
    await page.waitForTimeout(5000);
    const state = await page.evaluate(async()=>{
      const v=window.__qaViewer,C=Cesium;
      const pts=[[121.40,23.70],[121.41,23.70],[121.42,23.70],[121.40,23.71]];
      const sample=await C.sampleTerrain(v.terrainProvider,12,pts.map(p=>C.Cartographic.fromDegrees(...p)));
      return {version:document.documentElement.dataset.version,mode:v.scene.mode,layers:v.imageryLayers.length,url:v.imageryLayers.get(0).imageryProvider.url,heights:sample.map((p,i)=>({lon:pts[i][0],lat:pts[i][1],height:p.height})),entityCount:v.dataSources.get(0).entities.values.length};
    });
    check('default v1.2.0, 3D and a single EMAP01 base layer',state.version==='1.2.0' && state.mode===3 && state.layers===1 && state.url.includes('/EMAP01/'));
    results.terrainSamples=state.heights;
    const heights=state.heights.map(p=>p.height);
    check('global DEM samples contain real terrain relief',heights.every(Number.isFinite) && Math.max(...heights)-Math.min(...heights)>100);
    check('141 local railway features render from the intact 8087-feature source',state.entityCount===141 && await page.evaluate(()=>window.GFTHualienRailwayLayers.features.length===8087));
    check('EMAP01 and elevation tiles return HTTP 200',tileResponses.some(r=>r.url.includes('/EMAP01/') && r.status===200) && tileResponses.some(r=>r.url.includes('/Terrain3D/ImageServer/tile/') && r.status===200));
    await page.locator('#closeFeature').click();
    check('initial close button hides feature panel',await page.locator('#featureCard').isHidden());
    await page.locator('#stepForward').click();
    check('closed panel remains hidden after a simulation update',await page.locator('#featureCard').isHidden());

    async function shot(name) {
      const file=path.join(output,name+'.png');
      await page.screenshot({path:file,fullPage:true});results.screenshots.push(file);
    }
    await shot('desktop-3d');
    const pixels=await sharp(await page.locator('#cesiumContainer').screenshot()).removeAlpha().raw().toBuffer();
    const colors=new Set();let green=0;
    for(let i=0;i<pixels.length;i+=3){colors.add(`${pixels[i]>>4},${pixels[i+1]>>4},${pixels[i+2]>>4}`);if(pixels[i+1]>pixels[i]+25&&pixels[i+1]>pixels[i+2]+25)green++;}
    check('map canvas is nonblank and monitoring markers are rendered',colors.size>35 && green>15);
    results.canvas={colorBuckets:colors.size,greenPixels:green};

    for(const value of ['esri','osm','emap01']) {
      await page.selectOption('#basemapSelect',value);
      check('basemap switch '+value,await page.evaluate(key=>document.documentElement.dataset.basemap===key && window.__qaViewer.imageryLayers.length===1,value));
    }
    for(const value of ['2d','3d','2d','3d']) {
      await page.selectOption('#sceneModeSelect',value);await page.waitForTimeout(600);
      check('scene switch '+value,await page.evaluate(mode=>window.__qaViewer.scene.mode===(mode==='2d'?2:3),value));
    }
    await page.locator('[data-layer="railFacilities"]').uncheck();
    check('railway layer visibility off',await page.evaluate(()=>!window.__qaViewer.dataSources.get(0).show));
    await page.locator('[data-layer="railFacilities"]').check();
    await page.locator('#layerPanel [data-layer="points"]').uncheck();
    check('monitoring point visibility off',await page.evaluate(()=>!window.__qaViewer.entities.getById('OF-01').show));
    await page.locator('#layerPanel [data-layer="points"]').check();

    const home = await page.evaluate(()=>{const p=window.__qaViewer.camera.position;return {x:p.x,y:p.y,z:p.z}});
    await page.evaluate(()=>window.__qaViewer.camera.moveRight(400));
    await page.locator('#homeExtent').click();await page.waitForTimeout(1200);
    check('home button restores initial north-facing camera',await page.evaluate(p=>Cesium.Cartesian3.distance(window.__qaViewer.camera.position,p)<2,home));
    await page.evaluate(()=>window.__qaViewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(121.5,25,5000),duration:0.1}));
    await page.waitForTimeout(1600);
    check('navigation lock returns an out-of-region camera',await page.evaluate(p=>Cesium.Cartesian3.distance(window.__qaViewer.camera.position,p)<2,home));

    for(let i=0;i<3;i++) {
      await page.locator('[data-target="dashboard"]').click();
      await page.locator('#pointMatrix [data-point="OF-01"]').click();
      check('feature opens from dashboard '+i,await page.locator('#featureCard').isVisible());
      const before=await page.locator('#featureContent').innerText();
      await page.locator('#stepForward').click();
      check('open feature reflects the latest simulation timestamp '+i,(await page.locator('#featureContent').innerText())!==before);
      await page.locator('#closeFeature').click();
      check('replacement content preserves close action '+i,await page.locator('#featureCard').isHidden());
    }
    for(const scenario of ['normal','rain','rapid_rise','sensor_mismatch','tilt_change','offline']) {
      await page.selectOption('#scenarioSelect',scenario);
      await page.locator('#riskTimeline button').nth(45).click();
      await page.locator('[data-target="dashboard"]').click();
      check('scenario '+scenario+' keeps 20 synchronized points',await page.locator('#pointMatrix .point-cell').count()===20);
      if(scenario==='rapid_rise')check('rapid rise has L3 markers',await page.locator('#pointMatrix .l3').count()>0);
      if(scenario==='offline')check('offline scenario has one offline point',await page.locator('#pointMatrix .off').count()===1);
      await page.locator('[data-target="map"]').click();
    }
    await page.selectOption('#scenarioSelect','rapid_rise');await page.locator('#riskTimeline button').nth(45).click();
    await page.locator('[data-target="query"]').click();
    await page.selectOption('#queryPoint','OF-08');await page.fill('#queryStart','330');await page.fill('#queryEnd','360');await page.locator('#queryEnd').blur();
    check('query applies exact 31-minute inclusive window',await page.locator('#queryTable tbody tr').count()===31);
    const downloadPromise=page.waitForEvent('download');await page.locator('#exportCsv').click();
    const download=await downloadPromise;const csvPath=path.join(output,download.suggestedFilename());await download.saveAs(csvPath);
    const csv=fs.readFileSync(csvPath,'utf8').trim().split('\n');
    check('downloaded CSV matches time and point filters',csv.length===32&&csv.slice(1).every(row=>row.includes(',OF-08,')));
    await page.fill('#queryStart','500');await page.locator('#queryStart').blur();
    check('invalid query disables CSV export',await page.locator('#exportCsv').isDisabled());
    await page.fill('#queryStart','0');await page.fill('#queryEnd','');await page.locator('#queryEnd').blur();
    await page.locator('[data-target="settings"]').click();await page.fill('#thresholdL1','4');await page.locator('#applyThresholds').click();
    check('invalid thresholds display a validation error',(await page.locator('#thresholdMessage').innerText()).includes('L1 < L2 < L3'));
    await page.fill('#thresholdL1','1.6');await page.locator('#applyThresholds').click();
    check('valid thresholds apply',(await page.locator('#thresholdMessage').innerText()).includes('已套用'));

    const views=['map','dashboard','cctv','query','statistics','integration','settings'];
    for(const viewport of [{width:1600,height:1000},{width:1024,height:768},{width:390,height:844}]) {
      await page.setViewportSize(viewport);
      for(const view of views) {
        if(viewport.width<861)await page.locator('#menuToggle').click();
        await page.locator(`[data-target="${view}"]`).click();
        check(`${viewport.width}px ${view} fits viewport`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        check(`${viewport.width}px ${view} is the only active view`,await page.locator('.view.active').count()===1);
      }
      if(viewport.width<861)await page.locator('#menuToggle').click();
      await page.locator('[data-target="map"]').click();await page.locator('#homeExtent').click();await page.waitForTimeout(1800);
      check(`${viewport.width}px timeline is not clipped`,await page.locator('#riskTimeline').evaluate(node=>node.scrollWidth<=node.clientWidth));
      if(viewport.width<861)check('closed mobile drawer is entirely off screen',await page.locator('#layerPanel').evaluate(node=>node.getBoundingClientRect().right<=0));
      await shot(viewport.width<861?'mobile-3d':viewport.width<1200?'tablet-3d':'desktop-alerts');
    }
    await page.selectOption('#sceneModeSelect','2d');await page.waitForTimeout(1800);await shot('mobile-2d');
    await page.selectOption('#sceneModeSelect','3d');
    const fallback=await context.newPage();
    await fallback.route('**/Cesium.js',route=>route.abort());
    await fallback.goto('http://127.0.0.1:8000/index.html',{waitUntil:'domcontentloaded'});
    check('CDN outage shows an explicit fallback and 20 markers',await fallback.locator('#fallbackMap').isVisible() && await fallback.locator('#fallbackMap [data-layer="points"]').count()===20);
    await fallback.locator('#closeFeature').click();await fallback.locator('#fallbackMap [data-point="OF-01"] circle').click();await fallback.locator('#closeFeature').click();
    check('fallback feature close action works',await fallback.locator('#featureCard').isHidden());
    await fallback.close();
    const failure=await context.newPage();
    const terrainRoute = /\/Terrain3D\/ImageServer(?:\/|\?|$)/;
    await failure.route(terrainRoute,route=>route.abort());
    await failure.goto('http://127.0.0.1:8000/index.html',{waitUntil:'domcontentloaded'});
    await failure.waitForFunction(()=>document.documentElement.dataset.terrainStatus==='error',null,{timeout:30000});
    check('DEM outage is explicit and retryable',await failure.locator('#retryTerrain').isVisible());
    await failure.unroute(terrainRoute);await failure.locator('#retryTerrain').click();
    await failure.waitForFunction(()=>document.documentElement.dataset.terrainStatus==='ready',null,{timeout:30000});
    check('DEM retry restores the global provider',await failure.locator('#retryTerrain').isHidden());
    await failure.close();
    check('no uncaught browser runtime errors',results.errors.length===0);
  } finally {
    fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify(results,null,2));
    await browser.close();
  }
})().catch(e=>{console.error(e);process.exitCode=1});
