(function () {
  const data = window.GFTData;
  const engine = new window.SimulationEngine(data);
  const levelClass = { L0: "l0", L1: "l1", L2: "l2", L3: "l3", OFFLINE: "off" };
  const levelLabel = { L0: "正常", L1: "注意", L2: "警戒", L3: "緊急", OFFLINE: "離線" };
  const cesiumEntities = new Map();
  const layerGroups = { rail: [], tunnel: [], wall: [], points: [], rain: [], camera: [] };
  const overlayStyles = {
    railway_tracks: { color: "#111827", width: 3, pointSize: 7 },
    railway_stations: { color: "#0284c7", width: 2, pointSize: 10 },
    railway_milestones: { color: "#8a6f32", width: 1, pointSize: 5 },
    railway_tunnels: { color: "#7c3aed", width: 4, pointSize: 7 },
    railway_bridges: { color: "#2563eb", width: 3, pointSize: 7 },
    railway_facilities: { color: "#0f766e", width: 2, pointSize: 6 },
    guardrails: { color: "#a16207", width: 2, pointSize: 5 },
    slopes_retaining_walls: { color: "#dc2626", width: 3, pointSize: 6 }
  };
  let viewer = null;
  let baseLayer = null;
  let railFacilitiesDataSource = null;
  let activeBasemap = "emap01";
  let activeSceneMode = "3d";
  let activePointId = "OF-01";
  let selectedFeatureId = null;
  let returningHome = false;
  let terrainLoading = false;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  document.addEventListener("DOMContentLoaded", () => {
    buildNavigation();
    $$('[data-version]').forEach((node) => node.textContent = `v${data.project.version}`);
    document.documentElement.dataset.version = data.project.version;
    fillControls();
    bindEvents();
    initCesium();
    engine.onChange(render);
  });

  function buildNavigation() {
    const nav = $("#mainNav");
    nav.innerHTML = data.nav.map(([code, short, label], idx) => `
      <button class="${idx === 0 ? "active" : ""}" data-target="${code}" type="button" title="${label}">
        <span>${short}</span><small>${label}</small>
      </button>
    `).join("");
  }

  function fillControls() {
    $("#basemapSelect").innerHTML = data.basemaps.map(([value, label]) => `<option value="${value}" ${value === activeBasemap ? "selected" : ""}>${label}</option>`).join("");
    $("#scenarioSelect").innerHTML = data.scenarios.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
    $("#speedSelect").innerHTML = data.speedOptions.map(([value, label]) => `<option value="${value}" ${value === 10 ? "selected" : ""}>${label}</option>`).join("");
    $("#queryPoint").innerHTML = data.monitoringPoints.map((point) => `<option value="${point.code}">${point.code}</option>`).join("");
  }

  function bindEvents() {
    $("#mainNav").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-target]");
      if (!button) return;
      switchView(button.dataset.target);
    });
    $("#menuToggle").addEventListener("click", () => document.body.classList.toggle("menu-open"));
    $("#basemapSelect").addEventListener("change", (event) => setBasemap(event.target.value));
    $("#sceneModeSelect").addEventListener("change", (event) => setSceneMode(event.target.value));
    $("#homeExtent").addEventListener("click", () => flyToGuangfu(true));
    $("#retryTerrain").addEventListener("click", loadTerrain);
    $("#layerPanel").addEventListener("change", (event) => {
      const input = event.target.closest("input[data-layer]");
      if (input) setLayerVisibility(input.dataset.layer, input.checked);
    });
    $("#scenarioSelect").addEventListener("change", (event) => engine.setScenario(event.target.value));
    $("#speedSelect").addEventListener("change", (event) => engine.setSpeed(event.target.value));
    $("#playPause").addEventListener("click", () => engine.playing ? engine.pause() : engine.play());
    $("#resetSim").addEventListener("click", () => engine.reset());
    $("#stepBack").addEventListener("click", () => engine.step(-1));
    $("#stepForward").addEventListener("click", () => engine.step(1));
    $("#queryPoint").addEventListener("change", (event) => {
      activePointId = event.target.value;
      render(engine.getState());
    });
    $("#queryQuality").addEventListener("change", () => render(engine.getState()));
    ["#queryStart", "#queryEnd"].forEach((id) => $(id).addEventListener("change", () => renderQuery(engine.getState())));
    $("#exportCsv").addEventListener("click", downloadCsv);
    $("#closeFeature").addEventListener("click", closeFeature);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeFeature(); });
    $("#applyThresholds").addEventListener("click", () => {
      const inputs = ["#thresholdL1", "#thresholdL2", "#thresholdL3"].map($);
      const [l1, l2, l3] = inputs.map((input) => input.value === "" ? NaN : Number(input.value));
      try {
        engine.setThresholds({ l1, l2, l3 });
        $("#thresholdMessage").textContent = "已套用本次模擬門檻";
      } catch (error) {
        $("#thresholdMessage").textContent = error.message;
      }
    });
  }

  function switchView(view) {
    $$("#mainNav button").forEach((button) => button.classList.toggle("active", button.dataset.target === view));
    $$(".view").forEach((section) => section.classList.toggle("active", section.dataset.view === view));
    document.body.classList.remove("menu-open");
    if (view === "map" && viewer) setTimeout(() => viewer.resize(), 80);
  }

  function initCesium() {
    if (!window.Cesium) {
      document.body.classList.add("no-cesium");
      $("#terrainStatus").textContent = "地圖服務無法載入，顯示點位示意圖";
      ["#basemapSelect", "#sceneModeSelect", "#homeExtent"].forEach((id) => $(id).disabled = true);
      return;
    }
    try {
      window.Cesium.Ion.defaultAccessToken = "";
      viewer = new window.Cesium.Viewer("cesiumContainer", {
        baseLayer: new window.Cesium.ImageryLayer(createImageryProvider(activeBasemap)),
        terrainProvider: new window.Cesium.EllipsoidTerrainProvider(),
        animation: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
        navigationHelpButton: false,
        sceneMode: window.Cesium.SceneMode.SCENE3D,
        skyBox: false,
        skyAtmosphere: false,
        targetFrameRate: 30
      });
      viewer.scene.backgroundColor = window.Cesium.Color.fromCssColorString("#eef2ee");
      viewer.scene.globe.baseColor = window.Cesium.Color.fromCssColorString("#eef2ee");
      viewer.scene.globe.depthTestAgainstTerrain = false;
      viewer.scene.globe.showGroundAtmosphere = false;
      viewer.scene.globe.showWaterEffect = false;
      viewer.scene.globe.enableLighting = true;
      viewer.scene.light = new window.Cesium.DirectionalLight({
        direction: window.Cesium.Cartesian3.normalize(new window.Cesium.Cartesian3(1, -1, -2), new window.Cesium.Cartesian3()),
        intensity: 1.5
      });
      viewer.scene.fog.enabled = false;
      viewer.scene.screenSpaceCameraController.minimumZoomDistance = 150;
      viewer.scene.screenSpaceCameraController.maximumZoomDistance = 6000;
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
      baseLayer = viewer.imageryLayers.get(0);
      document.documentElement.dataset.basemap = activeBasemap;
      document.documentElement.dataset.sceneMode = activeSceneMode;
      viewer.camera.moveEnd.addEventListener(enforceNorthExtent);
      viewer.scene.morphComplete.addEventListener(() => flyToGuangfu(false));
      addPolyline("rail", data.tunnelLine, "#1f2937", 5, "rail");
      addPolyline("oldTunnel", data.oldTunnelLine, "#7c6f57", 2, "tunnel");
      addPolyline("wall", data.retainingWall, "#2563eb", 4, "wall");
      data.monitoringPoints.forEach((point) => addPointEntity(point, "point"));
      data.rainGauges.forEach((point) => addPointEntity(point, "rain"));
      data.cameras.forEach((point) => addPointEntity(point, "camera"));
      loadHualienRailwayLayers();
      flyToGuangfu(false);
      loadTerrain();
      viewer.screenSpaceEventHandler.setInputAction((movement) => {
        const picked = viewer.scene.pick(movement.position);
        if (picked && picked.id && picked.id.properties && picked.id.properties.pointCode) {
          showFeature(String(picked.id.properties.pointCode.getValue()), engine.getState());
        }
      }, window.Cesium.ScreenSpaceEventType.LEFT_CLICK);
    } catch (error) {
      console.warn("Cesium fallback enabled", error);
      document.body.classList.add("no-cesium");
      $("#terrainStatus").textContent = "3D 圖台無法載入，顯示點位示意圖";
    }
  }

  async function loadTerrain() {
    if (!viewer || terrainLoading) return;
    terrainLoading = true;
    $("#retryTerrain").hidden = true;
    $("#terrainStatus").textContent = "全球 DEM 載入中";
    document.documentElement.dataset.terrainStatus = "loading";
    let timeout;
    try {
      const provider = await Promise.race([
        window.Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(data.map.terrainUrl),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("DEM timeout")), 20000); })
      ]);
      clearTimeout(timeout);
      viewer.terrainProvider = provider;
      provider.errorEvent.addEventListener(() => {
        document.documentElement.dataset.terrainStatus = "degraded";
        $("#terrainStatus").textContent = "部分 DEM 圖磚無法載入";
        $("#retryTerrain").hidden = false;
      });
      document.documentElement.dataset.terrainStatus = "ready";
      $("#terrainStatus").textContent = "全球 DEM · Esri Terrain3D";
      viewer.scene.requestRender();
    } catch (error) {
      document.documentElement.dataset.terrainStatus = "error";
      $("#terrainStatus").textContent = "DEM 無法載入，目前為平面地形";
      $("#retryTerrain").hidden = false;
      console.warn("Global DEM unavailable", error);
    } finally {
      clearTimeout(timeout);
      terrainLoading = false;
    }
  }


  function createImageryProvider(key) {
    if (key === "esri") {
      return new window.Cesium.UrlTemplateImageryProvider({
        url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        maximumLevel: 19,
        credit: ""
      });
    }
    if (key === "osm") {
      return new window.Cesium.UrlTemplateImageryProvider({
        url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        maximumLevel: 19,
        credit: ""
      });
    }
    return new window.Cesium.UrlTemplateImageryProvider({
      url: "https://wmts.nlsc.gov.tw/wmts/EMAP01/default/GoogleMapsCompatible/{z}/{y}/{x}",
      tilingScheme: new window.Cesium.WebMercatorTilingScheme(),
      maximumLevel: 19,
      credit: ""
    });
  }

  function setBasemap(key) {
    activeBasemap = key;
    if (!viewer) return;
    const provider = createImageryProvider(key);
    if (baseLayer) viewer.imageryLayers.remove(baseLayer, true);
    baseLayer = viewer.imageryLayers.addImageryProvider(provider, 0);
    document.documentElement.dataset.basemap = key;
    viewer.scene.requestRender();
  }

  function setSceneMode(mode) {
    activeSceneMode = mode;
    if (!viewer) return;
    viewer.camera.cancelFlight();
    viewer.scene.completeMorph();
    if (mode === "2d") viewer.scene.morphTo2D(0);
    else viewer.scene.morphTo3D(0);
    flyToGuangfu(false);
    document.documentElement.dataset.sceneMode = mode;
  }

  function flyToGuangfu(animated) {
    if (!viewer) return;
    viewer.scene.completeMorph();
    viewer.camera.cancelFlight();
    returningHome = true;
    const duration = animated ? 0.65 : 0;
    const finish = () => { returningHome = false; };
    if (activeSceneMode === "2d") {
      viewer.camera.flyTo({
        destination: window.Cesium.Rectangle.fromDegrees(...data.map.homeBounds),
        duration, complete: finish, cancel: finish
      });
      return;
    }
    const home = data.map.home;
    const target = new window.Cesium.BoundingSphere(window.Cesium.Cartesian3.fromDegrees(home.lon, home.lat, home.height), 1);
    viewer.camera.flyToBoundingSphere(target, {
      offset: new window.Cesium.HeadingPitchRange(0, window.Cesium.Math.toRadians(-50), home.range),
      duration, complete: finish, cancel: finish
    });
  }

  function enforceNorthExtent() {
    if (!viewer || returningHome || viewer.scene.mode === window.Cesium.SceneMode.MORPHING) return;
    const canvas = viewer.canvas;
    const center = new window.Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const ray = viewer.camera.getPickRay(center);
    const position = (ray && viewer.scene.globe.pick(ray, viewer.scene)) || viewer.camera.pickEllipsoid(center);
    const bounds = window.Cesium.Rectangle.fromDegrees(...data.map.navigationBounds);
    if (!position || !window.Cesium.Rectangle.contains(bounds, window.Cesium.Cartographic.fromCartesian(position))) {
      flyToGuangfu(false);
    }
  }

  function registerLayerEntity(layerKey, entity) {
    if (!layerKey || !layerGroups[layerKey]) return;
    layerGroups[layerKey].push(entity);
  }

  function setLayerVisibility(layerKey, visible) {
    if (layerKey === "railFacilities") {
      if (railFacilitiesDataSource) railFacilitiesDataSource.show = visible;
      if (viewer) viewer.scene.requestRender();
      return;
    }
    (layerGroups[layerKey] || []).forEach((entity) => {
      entity.show = visible;
    });
    if (viewer) viewer.scene.requestRender();
    document.querySelectorAll(`#fallbackMap [data-layer="${layerKey}"]`).forEach((node) => { node.style.display = visible ? "" : "none"; });
  }

  async function loadHualienRailwayLayers() {
    if (!window.GFTHualienRailwayLayers || !viewer) return;
    document.documentElement.dataset.railOverlayStatus = "loading";
    document.documentElement.dataset.railOverlayFeatures = String(window.GFTHualienRailwayLayers.features?.length || 0);
    try {
      // Limit terrain-clamped geometry to the locked navigation area.
      const features = window.GFTHualienRailwayLayers.features.filter(intersectsNorthExtent);
      const source = await window.Cesium.GeoJsonDataSource.load({ type: "FeatureCollection", features }, { clampToGround: true });
      source.name = "花蓮台鐵鐵道設施 GeoJSON";
      viewer.dataSources.add(source);
      railFacilitiesDataSource = source;
      styleRailwayOverlay(source);
      const checked = document.querySelector('[data-layer="railFacilities"]')?.checked ?? true;
      setLayerVisibility("railFacilities", checked);
      document.documentElement.dataset.railOverlayStatus = "loaded";
      document.documentElement.dataset.railOverlayEntities = String(source.entities.values.length);
    } catch (error) {
      document.documentElement.dataset.railOverlayStatus = "error";
      console.warn("Hualien railway GeoJSON overlay failed", error);
    }
  }

  function styleRailwayOverlay(source) {
    source.entities.values.forEach((entity) => {
      const layer = entity.properties?.layer?.getValue?.() || "railway_facilities";
      const style = overlayStyles[layer] || overlayStyles.railway_facilities;
      const color = window.Cesium.Color.fromCssColorString(style.color);
      if (entity.polyline) {
        entity.polyline.material = color.withAlpha(0.88);
        entity.polyline.width = style.width;
        entity.polyline.clampToGround = true;
      }
      if (entity.polygon) {
        entity.polygon.material = color.withAlpha(0.16);
        entity.polygon.outline = true;
        entity.polygon.outlineColor = color.withAlpha(0.9);
      }
      if (entity.point || entity.billboard || !entity.polyline && !entity.polygon) {
        entity.billboard = undefined;
        entity.point = new window.Cesium.PointGraphics({
          pixelSize: style.pointSize,
          color: color.withAlpha(0.85),
          outlineColor: window.Cesium.Color.WHITE,
          outlineWidth: 1,
          heightReference: window.Cesium.HeightReference.CLAMP_TO_GROUND
        });
      }
      if (entity.label) entity.label.show = false;
    });
  }

  function addPolyline(id, coords, color, width, layerKey) {
    const entity = viewer.entities.add({
      id,
      polyline: {
        positions: coords.map(([lon, lat]) => window.Cesium.Cartesian3.fromDegrees(lon, lat, 0)),
        width,
        clampToGround: true,
        material: window.Cesium.Color.fromCssColorString(color)
      }
    });
    registerLayerEntity(layerKey, entity);
  }

  function addPointEntity(point, kind) {
    const labelDistance = point.code === "OF-01" ? Number.MAX_VALUE : 700;
    const entity = viewer.entities.add({
      id: point.code,
      position: window.Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 0),
      point: {
        pixelSize: kind === "point" ? 12 : 14,
        color: kind === "camera" ? window.Cesium.Color.SKYBLUE : kind === "rain" ? window.Cesium.Color.ROYALBLUE : window.Cesium.Color.LIME,
        outlineColor: window.Cesium.Color.BLACK,
        outlineWidth: 1,
        heightReference: window.Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      label: {
        text: point.code,
        heightReference: window.Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        font: "12px sans-serif",
        pixelOffset: new window.Cesium.Cartesian2(0, -22),
        fillColor: window.Cesium.Color.BLACK,
        show: true,
        distanceDisplayCondition: new window.Cesium.DistanceDisplayCondition(0, labelDistance),
        showBackground: true,
        backgroundColor: window.Cesium.Color.fromCssColorString("#f5f0e6")
      },
      properties: { pointCode: point.code, kind }
    });
    cesiumEntities.set(point.code, entity);
    registerLayerEntity(kind === "point" ? "points" : kind, entity);
  }

  function render(state) {
    $("#playPause").textContent = state.playing ? "暫停" : "▶";
    $("#currentTime").textContent = formatTime(state.time);
    $("#rightPanelTime").textContent = formatTime(state.time);
    $("#updateStatus").textContent = `${state.index} / ${state.steps - 1} 分鐘`;
    $("#basemapSelect").value = activeBasemap;
    $("#sceneModeSelect").value = activeSceneMode;
    $("#scenarioSelect").value = state.scenario;
    $("#speedSelect").value = String(state.speed);
    renderRiskCards(state);
    renderTimeline(state);
    renderFallbackMap(state);
    updateCesiumEntities(state);
    renderPointMatrix(state);
    renderAlerts(state);
    renderChart(state);
    renderCameras(state);
    renderQuery(state);
    renderStats(state);
    renderIntegration(state);
    if (selectedFeatureId && !$("#featureCard").hidden) renderFeature(selectedFeatureId, state);
    if (viewer) viewer.scene.requestRender();
  }

  function renderRiskCards(state) {
    const cards = [
      ["L3", "緊急", state.counts.L3],
      ["L2", "警戒", state.counts.L2],
      ["L1", "注意", state.counts.L1],
      ["L0", "正常", state.counts.L0],
      ["OFFLINE", "離線", state.counts.OFFLINE]
    ];
    $("#riskCards").innerHTML = cards.map(([level, label, count]) => `
      <div class="risk-card ${levelClass[level]}">
        <span>${label}</span>
        <strong>${count}</strong>
      </div>
    `).join("");
    $("#northStatus").textContent = state.counts.L3 > 0 ? "緊急" : state.counts.L2 > 0 ? "警戒" : state.counts.L1 > 0 ? "注意" : "正常";
  }

  function renderTimeline(state) {
    const bars = Array.from({ length: 72 }, (_, i) => {
      const idx = Math.floor(i * (state.steps - 1) / 71);
      const sample = data.monitoringPoints.map((point) => engine.pointRecord(point, idx));
      const maxLevel = pickWorst(sample);
      const active = idx <= state.index ? "active" : "";
      return `<button class="${levelClass[maxLevel]} ${active}" style="height:${14 + severity(maxLevel) * 9}px" data-index="${idx}" title="${idx} 分鐘"></button>`;
    }).join("");
    $("#riskTimeline").innerHTML = bars;
    $("#riskTimeline").onclick = (event) => {
      const button = event.target.closest("button[data-index]");
      if (!button) return;
      engine.index = Number(button.dataset.index);
      engine.emit();
    };
  }

  function renderFallbackMap(state) {
    const svg = $("#fallbackMap");
    const records = new Map(state.records.map((record) => [record.pointId, record]));
    const bbox = getBounds([...data.tunnelLine, ...data.oldTunnelLine]);
    const line = pointsToSvg(data.tunnelLine, bbox).map((p) => p.join(",")).join(" ");
    const oldLine = pointsToSvg(data.oldTunnelLine, bbox).map((p) => p.join(",")).join(" ");
    const wall = pointsToSvg(data.retainingWall, bbox).map((p) => p.join(",")).join(" ");
    const pointNodes = data.monitoringPoints.map((point) => {
      const [x, y] = project(point, bbox);
      const record = records.get(point.code);
      return `<g class="map-point ${levelClass[record.alertLevel]}" data-point="${point.code}" data-layer="points">
        <circle cx="${x}" cy="${y}" r="${record.alertLevel === "L3" ? 9 : 7}"></circle>
        <text x="${x + 9}" y="${y - 8}">${point.code}</text>
      </g>`;
    }).join("");
    const rainNodes = data.rainGauges.map((point) => {
      const [x, y] = project(point, bbox);
      return `<g data-point="${point.code}" data-layer="rain"><rect class="rain-node" x="${x - 8}" y="${y - 8}" width="16" height="16"></rect><text x="${x + 11}" y="${y - 9}">${point.code}</text></g>`;
    }).join("");
    const cameraNodes = data.cameras.map((point) => {
      const [x, y] = project(point, bbox);
      return `<g data-point="${point.code}" data-layer="camera"><path class="camera-node" d="M${x - 9},${y - 6} h18 v12 h-18z M${x + 9},${y - 3} l12,-7 v20 l-12,-7z"></path><text x="${x + 23}" y="${y - 8}">${point.code}</text></g>`;
    }).join("");
    svg.innerHTML = `
      <rect class="map-bg" x="0" y="0" width="1000" height="520"></rect>
      <polyline class="old-rail" data-layer="tunnel" points="${oldLine}"></polyline>
      <polyline class="rail" data-layer="rail" points="${line}"></polyline>
      <polyline class="wall" data-layer="wall" points="${wall}"></polyline>
      ${pointNodes}${rainNodes}${cameraNodes}
    `;
    svg.querySelectorAll("[data-point]").forEach((node) => node.addEventListener("click", () => showFeature(node.dataset.point, state)));
    $$('#layerPanel input[data-layer]').forEach((input) => {
      svg.querySelectorAll(`[data-layer="${input.dataset.layer}"]`).forEach((node) => { node.style.display = input.checked ? "" : "none"; });
    });
  }

  function updateCesiumEntities(state) {
    if (!viewer) return;
    state.records.forEach((record) => {
      const entity = cesiumEntities.get(record.pointId);
      if (!entity) return;
      entity.point.color = window.Cesium.Color.fromCssColorString(cssLevelColor(record.alertLevel));
      entity.point.pixelSize = record.alertLevel === "L3" ? 18 : record.alertLevel === "L2" ? 15 : 12;
    });
  }

  function renderPointMatrix(state) {
    $("#pointMatrix").innerHTML = state.records.map((record) => `
      <button class="point-cell ${levelClass[record.alertLevel]}" data-point="${record.pointId}">
        <b>${record.pointId}</b>
        <span>${record.levelNonContact.toFixed(2)} m</span>
        <small>差 ${record.levelDifference.toFixed(2)} · ${levelLabel[record.alertLevel]}</small>
      </button>
    `).join("");
    $("#pointMatrix").onclick = (event) => {
      const button = event.target.closest("[data-point]");
      if (!button) return;
      showFeature(button.dataset.point, state);
      switchView("map");
    };
  }

  function renderAlerts(state) {
    $("#alertTimeline").innerHTML = state.alerts.length ? state.alerts.map((alert) => `
      <div class="event ${levelClass[alert.level]}">
        <b>${alert.pointId}</b><span>${levelLabel[alert.level] || "離線"}</span>
        <p>${alert.message}</p><small>${formatTime(new Date(alert.timestamp))} · ${alert.status}</small>
      </div>
    `).join("") : `<p class="empty">目前無注意以上事件。</p>`;
  }

  function renderChart(state) {
    const canvas = $("#trendChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const history = engine.getHistory(activePointId, 60);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f5f0e6";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#1f2937";
    ctx.strokeRect(36, 20, canvas.width - 60, canvas.height - 55);
    drawSeries(ctx, history.map((r) => r.levelNonContact), "#d90429", 0, 3.4, canvas);
    drawSeries(ctx, history.map((r) => r.levelContact), "#2563eb", 0, 3.4, canvas);
    drawSeries(ctx, history.map((r) => r.rainfall1m), "#eab308", 0, 6, canvas);
    ctx.fillStyle = "#111";
    ctx.font = "14px sans-serif";
    ctx.fillText(`${activePointId} 近 60 分鐘：紅=非接觸液位，藍=接觸液位，黃=1分鐘雨量`, 42, canvas.height - 18);
  }

  function drawSeries(ctx, values, color, min, max, canvas) {
    const left = 36;
    const top = 20;
    const width = canvas.width - 60;
    const height = canvas.height - 55;
    ctx.beginPath();
    values.forEach((value, idx) => {
      const x = left + (idx / Math.max(1, values.length - 1)) * width;
      const y = top + height - ((value - min) / (max - min)) * height;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function renderCameras(state) {
    $("#cameraGrid").innerHTML = state.cameras.map((camera, idx) => `
      <article class="module camera-card">
        <div class="camera-preview"><span>CAM ${idx + 1}</span></div>
        <h2>${camera.name}</h2>
        <p>${camera.event}</p>
        <small>${camera.online ? "在線" : "離線"} · ${formatTime(new Date(camera.lastSnapshot))}</small>
      </article>
    `).join("");
  }

  function renderQuery(state) {
    const pointId = $("#queryPoint").value || activePointId;
    const quality = $("#queryQuality").value;
    const range = getQueryRange(state);
    $("#exportCsv").disabled = !range;
    const rows = range ? engine.getHistory(pointId, 720).filter((record, minute) => {
      return minute >= range.start && minute <= range.end && (!quality || record.quality === quality);
    }).reverse() : [];
    $("#queryMessage").textContent = range ? `${rows.length} 筆 · ${range.start} 至 ${range.end} 分鐘` : "請輸入 0 至 720 的整數分鐘，且起始不得晚於目前時間或結束分鐘。";
    $("#queryTable").innerHTML = `
      <thead><tr><th>時間</th><th>點位</th><th>非接觸</th><th>接觸式</th><th>差異</th><th>傾斜</th><th>品質</th><th>告警</th></tr></thead>
      <tbody>${rows.map((record) => `
        <tr><td>${formatTime(new Date(record.timestamp))}</td><td>${record.pointId}</td><td>${record.levelNonContact}</td><td>${record.levelContact}</td><td>${record.levelDifference}</td><td>${record.tiltResultant}</td><td>${record.quality}</td><td>${levelLabel[record.alertLevel]}</td></tr>
      `).join("")}</tbody>
    `;
  }

  function renderStats(state) {
    const byDiff = [...state.records].sort((a, b) => b.levelDifference - a.levelDifference).slice(0, 5);
    const byTilt = [...state.records].sort((a, b) => b.tiltResultant - a.tiltResultant).slice(0, 5);
    $("#differenceRank").innerHTML = byDiff.map((record) => rankItem(record.pointId, `${record.levelDifference.toFixed(2)} m`, record.alertLevel)).join("");
    $("#tiltRank").innerHTML = byTilt.map((record) => rankItem(record.pointId, `${record.tiltResultant.toFixed(3)} deg`, record.alertLevel)).join("");
    const rate = Math.round((state.receivedCount / state.expectedCount) * 100);
    $("#statisticsSummary").innerHTML = `
      <div><b>${state.receivedCount}</b><span>目前接收筆數</span></div>
      <div><b>${rate}%</b><span>資料接收率</span></div>
      <div><b>${state.alerts.length}</b><span>注意以上事件</span></div>
      <div><b>${state.rainGauges[0].accumulated.toFixed(1)} mm</b><span>示意累積雨量</span></div>
    `;
  }

  function renderIntegration(state) {
    const services = [
      ["GW-01", "現場資料傳輸閘道", state.counts.OFFLINE ? "待確認" : "正常"],
      ["API-MOCK", "資料接收 API", "模擬"],
      ["RULE-01", "告警規則引擎", "運作中"],
      ["REPORT", "月報摘要", "待正式格式"],
      ["NVR-LINK", "CCTV/NVR 入口", "不連真實設備"]
    ];
    $("#integrationList").innerHTML = services.map(([code, name, status]) => `
      <div><b>${code}</b><span>${name}</span><em>${status}</em></div>
    `).join("");
  }

  function showFeature(pointId, state) {
    selectedFeatureId = pointId;
    if (state.records.some((record) => record.pointId === pointId)) {
      activePointId = pointId;
      $("#queryPoint").value = pointId;
    }
    $("#featureCard").hidden = false;
    $("#featureCard").classList.add("open");
    renderFeature(pointId, state);
  }

  function intersectsNorthExtent(feature) {
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    function visit(coordinates) {
      if (!Array.isArray(coordinates)) return;
      if (typeof coordinates[0] === "number") {
        bounds[0] = Math.min(bounds[0], coordinates[0]);
        bounds[1] = Math.min(bounds[1], coordinates[1]);
        bounds[2] = Math.max(bounds[2], coordinates[0]);
        bounds[3] = Math.max(bounds[3], coordinates[1]);
      } else coordinates.forEach(visit);
    }
    function visitGeometry(geometry) {
      if (!geometry) return;
      if (geometry.type === "GeometryCollection") geometry.geometries.forEach(visitGeometry);
      else visit(geometry.coordinates);
    }
    visitGeometry(feature.geometry);
    const [west, south, east, north] = data.map.navigationBounds;
    return bounds[0] <= east && bounds[2] >= west && bounds[1] <= north && bounds[3] >= south;
  }

  function closeFeature() {
    $("#featureCard").hidden = true;
    $("#featureCard").classList.remove("open");
    selectedFeatureId = null;
  }

  function renderFeature(pointId, state) {
    const record = state.records.find((item) => item.pointId === pointId);
    if (!record) {
      const device = [...state.rainGauges, ...state.cameras].find((item) => item.code === pointId);
      if (!device) return;
      $("#featureContent").innerHTML = `<h3>${device.code} ${device.name}</h3><p>${device.online ? "在線" : "離線"} · ${formatTime(state.time)}</p>` +
        (pointId.startsWith("RG") ? `<p>1 分鐘雨量 ${device.rainfall1m} mm<br>累積雨量 ${device.accumulated} mm</p>` : `<p>${device.event} · 模擬影像狀態</p>`) +
        `<small>座標來源 ${device.location_source} · ${device.lon}, ${device.lat}</small>`;
      return;
    }
    $("#featureContent").innerHTML = `
      <h3>${record.pointId} ${levelLabel[record.alertLevel]}</h3>
      <dl>
        <div><dt>非接觸式液位</dt><dd>${record.levelNonContact.toFixed(2)} m</dd></div>
        <div><dt>接觸式液位</dt><dd>${record.levelContact.toFixed(2)} m</dd></div>
        <div><dt>液位差異</dt><dd>${record.levelDifference.toFixed(2)} m</dd></div>
        <div><dt>合成傾角</dt><dd>${record.tiltResultant.toFixed(3)} deg</dd></div>
        <div><dt>1 分鐘雨量</dt><dd>${record.rainfall1m.toFixed(1)} mm</dd></div>
        <div><dt>更新時間</dt><dd>${formatTime(state.time)}</dd></div>
        <div><dt>座標來源</dt><dd>${record.location_source}</dd></div>
      </dl>
      <p>${data.project.disclaimer}</p>
    `;
    renderChart(state);
  }

  function getQueryRange(state) {
    const start = $("#queryStart").value === "" ? NaN : Number($("#queryStart").value);
    const end = $("#queryEnd").value === "" ? state.index : Number($("#queryEnd").value);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 720 || start > end || start > state.index) return null;
    return { start, end: Math.min(end, state.index) };
  }

  function downloadCsv() {
    const range = getQueryRange(engine.getState());
    if (!range) return;
    const csv = engine.exportCsv($("#queryPoint").value, $("#queryQuality").value, range.start, range.end);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gft-${$("#queryPoint").value}-telemetry.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function rankItem(label, value, level) {
    return `<div class="${levelClass[level]}"><b>${label}</b><span>${value}</span><small>${levelLabel[level]}</small></div>`;
  }

  function pickWorst(records) {
    return records.reduce((worst, record) => severity(record.alertLevel) > severity(worst) ? record.alertLevel : worst, "L0");
  }

  function severity(level) {
    return { L0: 0, L1: 1, L2: 2, L3: 3, OFFLINE: 1 }[level] || 0;
  }

  function cssLevelColor(level) {
    return { L0: "#238b45", L1: "#f0c929", L2: "#df6b21", L3: "#d90429", OFFLINE: "#6b7280" }[level] || "#238b45";
  }

  function formatTime(date) {
    return new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  }

  function getBounds(coords) {
    const lons = coords.map((item) => item[0]);
    const lats = coords.map((item) => item[1]);
    return { minLon: Math.min(...lons), maxLon: Math.max(...lons), minLat: Math.min(...lats), maxLat: Math.max(...lats) };
  }

  function project(point, bbox) {
    const lon = Array.isArray(point) ? point[0] : point.lon;
    const lat = Array.isArray(point) ? point[1] : point.lat;
    const x = 70 + ((lon - bbox.minLon) / (bbox.maxLon - bbox.minLon)) * 860;
    const y = 460 - ((lat - bbox.minLat) / (bbox.maxLat - bbox.minLat)) * 395;
    return [x, y];
  }

  function pointsToSvg(coords, bbox) {
    return coords.map((point) => project(point, bbox));
  }
})();
