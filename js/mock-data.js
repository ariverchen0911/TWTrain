(function () {
  const tunnelLine = [
    [121.410328, 23.699768],
    [121.41024, 23.699235],
    [121.410203, 23.698413],
    [121.410228, 23.697759],
    [121.410313, 23.697115],
    [121.410473, 23.696396],
    [121.410674, 23.695698],
    [121.410874, 23.695127],
    [121.41562, 23.685329],
    [121.417201, 23.682017],
    [121.41786, 23.680354]
  ];

  const oldTunnelLine = [
    [121.417471, 23.680707],
    [121.409848, 23.698224],
    [121.409601, 23.699172],
    [121.409526, 23.69959],
    [121.40959, 23.700253],
    [121.409628, 23.700331]
  ];

  function interpolate(line, t) {
    const scaled = t * (line.length - 1);
    const idx = Math.min(line.length - 2, Math.floor(scaled));
    const local = scaled - idx;
    const a = line[idx];
    const b = line[idx + 1];
    return [
      a[0] + (b[0] - a[0]) * local,
      a[1] + (b[1] - a[1]) * local
    ];
  }

  function offsetPoint(point, idx) {
    const side = idx % 2 === 0 ? 1 : -1;
    return [point[0] + side * 0.00018, point[1] + side * 0.00008];
  }

  const monitoringPoints = Array.from({ length: 20 }, (_, i) => {
    const t = 0.04 + i * (0.82 / 19);
    const point = offsetPoint(interpolate(tunnelLine, t), i);
    return {
      code: `OF-${String(i + 1).padStart(2, "0")}`,
      name: `溢淹監測點 ${String(i + 1).padStart(2, "0")}`,
      lon: Number(point[0].toFixed(6)),
      lat: Number(point[1].toFixed(6)),
      location_source: "PLAN",
      status: "ACTIVE_SIMULATED",
      devices: [`NC-OF-${String(i + 1).padStart(2, "0")}`, `CT-OF-${String(i + 1).padStart(2, "0")}`, `IN-OF-${String(i + 1).padStart(2, "0")}`]
    };
  });

  const rainGauges = [
    { code: "RG-01", name: "北口雨量筒", lon: 121.40989, lat: 23.69932, location_source: "PLAN" },
    { code: "RG-02", name: "中段雨量筒", lon: 121.4112, lat: 23.69605, location_source: "PLAN" }
  ];

  const cameras = [
    { code: "CAM-01", name: "北口上行 CCTV", lon: 121.41008, lat: 23.69855, location_source: "PLAN" },
    { code: "CAM-02", name: "北口下行 CCTV", lon: 121.41055, lat: 23.69695, location_source: "PLAN" },
    { code: "CAM-03", name: "中段擋牆 CCTV", lon: 121.4111, lat: 23.6952, location_source: "PLAN" },
    { code: "CAM-04", name: "南側示意 CCTV", lon: 121.4146, lat: 23.6879, location_source: "PLAN" }
  ];

  window.GFTData = {
    project: {
      code: "GFT",
      title: "花蓮縣光復隧道科技監測資訊整合系統",
      disclaimer: "POC 示意資料，非正式監測成果"
    },
    tunnelLine,
    oldTunnelLine,
    retainingWall: tunnelLine.slice(0, 8).map(([lon, lat], idx) => [lon + 0.00028, lat - 0.00012 + idx * 0.00001]),
    monitoringPoints,
    rainGauges,
    cameras,
    basemaps: [
      ["emap01", "臺灣通用電子地圖(灰階)/EMAP01"],
      ["esri", "ESRI 全球影像圖"],
      ["osm", "OSM 電子地圖"]
    ],
    scenarios: [
      ["normal", "正常監測"],
      ["rain", "降雨增加"],
      ["rapid_rise", "液位快速上升"],
      ["sensor_mismatch", "液位量測差異"],
      ["tilt_change", "傾斜變化"],
      ["offline", "設備離線"]
    ],
    speedOptions: [
      [1, "1 倍"],
      [5, "5 倍"],
      [10, "10 倍"],
      [30, "30 倍"],
      [60, "60 倍"]
    ],
    nav: [
      ["map", "圖台", "地圖模式"],
      ["dashboard", "儀錶", "儀表板"],
      ["cctv", "影像", "CCTV"],
      ["query", "查詢", "資料查詢"],
      ["statistics", "統計", "統計查詢"],
      ["integration", "介接", "介接監測"],
      ["settings", "設定", "系統設定"]
    ]
  };
})();
