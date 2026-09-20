(function (global) {
  const MS_PER_MINUTE = 60 * 1000;

  class SimulationEngine {
    constructor(data) {
      this.data = data;
      this.scenario = "normal";
      this.speed = 10;
      this.index = 0;
      this.playing = false;
      this.timer = null;
      this.listeners = new Set();
      this.thresholds = { l1: 1.6, l2: 2.2, l3: 2.8, mismatch: 0.35, tilt: 0.35 };
      this.start = new Date("2026-09-18T06:00:00+08:00");
      this.steps = 721;
      this.timeline = this.buildTimeline();
      this.rainSeries = {};
      for (const [scenario, peak] of [["rain", 2.2], ["rapid_rise", 5.2]]) {
        let total = 0;
        this.rainSeries[scenario] = this.timeline.map((_, minute) => {
          const rainfall = Math.max(0, Math.sin(Math.max(0, minute - 180) / 180)) * peak;
          total += rainfall;
          return { rainfall, total };
        });
      }
    }

    buildTimeline() {
      return Array.from({ length: this.steps }, (_, i) => new Date(this.start.getTime() + i * MS_PER_MINUTE));
    }

    onChange(listener) {
      this.listeners.add(listener);
      listener(this.getState());
      return () => this.listeners.delete(listener);
    }

    emit() {
      const state = this.getState();
      this.listeners.forEach((listener) => listener(state));
    }

    setScenario(scenario) {
      this.scenario = scenario;
      this.index = 0;
      this.emit();
    }

    setSpeed(speed) {
      this.speed = Number(speed) || 10;
      if (this.playing) {
        this.pause();
        this.play();
      }
      this.emit();
    }

    setThresholds(thresholds) {
      const next = { ...this.thresholds, ...thresholds };
      if (![next.l1, next.l2, next.l3].every(Number.isFinite) || next.l1 < 0 || next.l1 >= next.l2 || next.l2 >= next.l3) {
        throw new Error("門檻必須為有效非負數，且 L1 < L2 < L3。");
      }
      this.thresholds = next;
      this.emit();
    }

    play() {
      if (this.playing) return;
      this.playing = true;
      this.timer = setInterval(() => this.step(this.speed), 1000);
      this.emit();
    }

    pause() {
      this.playing = false;
      clearInterval(this.timer);
      this.timer = null;
      this.emit();
    }

    reset() {
      this.index = 0;
      this.pause();
      this.emit();
    }

    step(delta = 1) {
      this.index = Math.max(0, Math.min(this.steps - 1, this.index + delta));
      if (this.index >= this.steps - 1) this.pause();
      this.emit();
    }

    pointRecord(point, minute) {
      const order = Number(point.code.slice(-2));
      const wave = Math.sin((minute + order * 9) / 52);
      let rainfall = 0;
      let accumulated = 0;
      let baseLevel = 0.82 + wave * 0.08 + order * 0.006;
      let tiltX = 0.03 * Math.sin((minute + order) / 80);
      let tiltY = 0.02 * Math.cos((minute + order) / 90);
      let quality = "GOOD";
      let online = true;

      if (this.scenario === "rain" || this.scenario === "rapid_rise") {
        const rainStart = 180;
        const rainFactor = Math.max(0, Math.sin(Math.max(0, minute - rainStart) / 180));
        rainfall = this.rainSeries[this.scenario][minute].rainfall;
        accumulated = this.rainSeries[this.scenario][minute].total;
        baseLevel += rainFactor * (this.scenario === "rapid_rise" ? 1.15 : 0.48);
      }

      if (this.scenario === "rapid_rise" && order >= 7 && order <= 12 && minute > 330) {
        baseLevel += Math.min(1.45, (minute - 330) * 0.018);
      }

      let levelNonContact = baseLevel + 0.03 * Math.sin(minute / 17 + order);
      let levelContact = baseLevel - 0.02 * Math.cos(minute / 19 + order);

      if (this.scenario === "sensor_mismatch" && order === 5 && minute > 260) {
        levelContact -= 0.62;
        quality = "SUSPECT";
      }

      if (this.scenario === "tilt_change" && order === 16 && minute > 240) {
        tiltX += Math.min(0.58, (minute - 240) * 0.003);
        quality = "SUSPECT";
      }

      if (this.scenario === "offline" && order === 14 && minute > 300) {
        online = false;
        quality = "OFFLINE";
      }

      const levelDifference = Math.abs(levelNonContact - levelContact);
      const tiltResultant = Math.sqrt(tiltX * tiltX + tiltY * tiltY);
      const alertLevel = this.getAlertLevel({ levelNonContact, levelContact, levelDifference, tiltResultant, quality, online });

      return {
        timestamp: this.timeline[minute].toISOString(),
        pointId: point.code,
        name: point.name,
        lon: point.lon,
        lat: point.lat,
        levelNonContact: round(levelNonContact, 2),
        levelContact: round(levelContact, 2),
        levelDifference: round(levelDifference, 2),
        tiltX: round(tiltX, 3),
        tiltY: round(tiltY, 3),
        tiltResultant: round(tiltResultant, 3),
        temperature: round(26.5 + Math.sin(minute / 120) * 2.1, 1),
        rainfall1m: round(rainfall, 1),
        rainfallAccumulated: round(accumulated, 1),
        quality,
        online,
        alertLevel,
        location_source: point.location_source
      };
    }

    getAlertLevel(record) {
      if (!record.online) return "OFFLINE";
      if (record.levelNonContact >= this.thresholds.l3 || record.levelContact >= this.thresholds.l3) return "L3";
      if (record.levelNonContact >= this.thresholds.l2 || record.levelContact >= this.thresholds.l2) return "L2";
      if (record.levelNonContact >= this.thresholds.l1 || record.levelContact >= this.thresholds.l1) return "L1";
      if (record.levelDifference >= this.thresholds.mismatch || record.tiltResultant >= this.thresholds.tilt || record.quality !== "GOOD") return "L1";
      return "L0";
    }

    getRainGauges(records) {
      const maxRain = Math.max(...records.map((record) => record.rainfall1m));
      const total = Math.max(...records.map((record) => record.rainfallAccumulated));
      return this.data.rainGauges.map((gauge, idx) => ({
        ...gauge,
        rainfall1m: round(maxRain * (idx === 0 ? 1 : 0.86), 1),
        accumulated: round(total * (idx === 0 ? 1 : 0.9), 1),
        online: true
      }));
    }

    getCameras(records) {
      const urgent = records.some((record) => record.alertLevel === "L3");
      return this.data.cameras.map((camera, idx) => ({
        ...camera,
        online: !(this.scenario === "offline" && idx === 2 && this.index > 300),
        event: urgent && idx < 2 ? "事件快照待確認" : "定時快照",
        lastSnapshot: this.timeline[this.index].toISOString()
      }));
    }

    getAlerts(records) {
      return records
        .filter((record) => record.alertLevel !== "L0")
        .map((record) => ({
          id: `AL-${record.pointId}-${String(this.index).padStart(3, "0")}`,
          pointId: record.pointId,
          level: record.alertLevel,
          quality: record.quality,
          value: record.levelNonContact,
          message: alertMessage(record),
          status: record.alertLevel === "OFFLINE" ? "待維護確認" : "待值班確認",
          timestamp: record.timestamp
        }));
    }

    getState() {
      const minute = this.index;
      const records = this.data.monitoringPoints.map((point) => this.pointRecord(point, minute));
      const counts = countLevels(records);
      return {
        index: this.index,
        steps: this.steps,
        playing: this.playing,
        scenario: this.scenario,
        speed: this.speed,
        time: this.timeline[this.index],
        records,
        counts,
        rainGauges: this.getRainGauges(records),
        cameras: this.getCameras(records),
        alerts: this.getAlerts(records),
        receivedCount: records.filter((record) => record.online).length * 3 + this.getRainGauges(records).filter((gauge) => gauge.online).length + this.getCameras(records).filter((camera) => camera.online).length,
        expectedCount: records.length * 3 + this.data.rainGauges.length + this.data.cameras.length
      };
    }

    getHistory(pointId, span = 60) {
      const point = this.data.monitoringPoints.find((item) => item.code === pointId) || this.data.monitoringPoints[0];
      const start = Math.max(0, this.index - span);
      const history = [];
      for (let i = start; i <= this.index; i += 1) {
        history.push(this.pointRecord(point, i));
      }
      return history;
    }

    exportCsv(pointId, quality = "", start = 0, end = this.index) {
      const point = this.data.monitoringPoints.find((item) => item.code === pointId) || this.data.monitoringPoints[0];
      const rows = [["timestamp", "pointId", "levelNonContact", "levelContact", "levelDifference", "tiltX", "tiltY", "rainfall1m", "quality", "alertLevel"]];
      for (let i = Math.max(0, start); i <= Math.min(this.index, end); i += 1) {
        const record = this.pointRecord(point, i);
        if (quality && record.quality !== quality) continue;
        rows.push([record.timestamp, record.pointId, record.levelNonContact, record.levelContact, record.levelDifference, record.tiltX, record.tiltY, record.rainfall1m, record.quality, record.alertLevel]);
      }
      return rows.map((row) => row.join(",")).join("\n");
    }
  }

  function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function countLevels(records) {
    return records.reduce((acc, record) => {
      acc[record.alertLevel] = (acc[record.alertLevel] || 0) + 1;
      return acc;
    }, { L0: 0, L1: 0, L2: 0, L3: 0, OFFLINE: 0 });
  }

  function alertMessage(record) {
    if (record.alertLevel === "OFFLINE") return "設備心跳逾時，需確認通訊與電源";
    if (record.levelDifference >= 0.35) return "非接觸式與接觸式液位差異偏高";
    if (record.tiltResultant >= 0.35) return "傾斜變化達注意門檻";
    if (record.alertLevel === "L3") return "液位快速上升，達緊急示意門檻";
    if (record.alertLevel === "L2") return "液位達警戒示意門檻";
    return "趨勢接近注意門檻";
  }

  global.SimulationEngine = SimulationEngine;
  if (typeof module !== "undefined") module.exports = { SimulationEngine };
})(typeof window !== "undefined" ? window : globalThis);
