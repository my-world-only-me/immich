/**
 * 中国大陆地图底图的坐标系转换。
 *
 * 高德 / 腾讯 的瓦片使用 GCJ-02（俗称“火星坐标系”），百度使用 BD-09，
 * 而 Immich 数据库里存的是 GPS 原始值 WGS-84。两者在中国境内相差
 * 300~600 米，所以渲染标记前要正转换，用地图坐标反查数据前要逆转换。
 *
 * 中国大陆范围之外（含港澳台以外的境外）不做偏移。
 */

import { MapCoordinateSystem } from '@immich/sdk';

const PI = Math.PI;
const SEMI_MAJOR_AXIS = 6_378_245;
const ECCENTRICITY_SQUARED = 0.006_693_421_622_965_943;
const BD_FACTOR = (PI * 3000) / 180;

function outOfChina(latitude: number, longitude: number): boolean {
  return longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271;
}

function transformLatitude(x: number, y: number): number {
  let result = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  result += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  result += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3;
  result += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3;
  return result;
}

function transformLongitude(x: number, y: number): number {
  let result = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  result += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  result += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3;
  result += ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3;
  return result;
}

export function wgs84ToGcj02(latitude: number, longitude: number): [number, number] {
  if (outOfChina(latitude, longitude)) {
    return [latitude, longitude];
  }

  let deltaLatitude = transformLatitude(longitude - 105, latitude - 35);
  let deltaLongitude = transformLongitude(longitude - 105, latitude - 35);

  const radianLatitude = (latitude / 180) * PI;
  let magic = Math.sin(radianLatitude);
  magic = 1 - ECCENTRICITY_SQUARED * magic * magic;
  const sqrtMagic = Math.sqrt(magic);

  deltaLatitude = (deltaLatitude * 180) / (((SEMI_MAJOR_AXIS * (1 - ECCENTRICITY_SQUARED)) / (magic * sqrtMagic)) * PI);
  deltaLongitude = (deltaLongitude * 180) / ((SEMI_MAJOR_AXIS / sqrtMagic) * Math.cos(radianLatitude) * PI);

  return [latitude + deltaLatitude, longitude + deltaLongitude];
}

/** GCJ-02 -> WGS-84 没有解析解，用三次迭代逼近，精度优于 1e-6 度。 */
export function gcj02ToWgs84(latitude: number, longitude: number): [number, number] {
  if (outOfChina(latitude, longitude)) {
    return [latitude, longitude];
  }

  let wgsLatitude = latitude;
  let wgsLongitude = longitude;
  for (let index = 0; index < 3; index++) {
    const [gcjLatitude, gcjLongitude] = wgs84ToGcj02(wgsLatitude, wgsLongitude);
    wgsLatitude += latitude - gcjLatitude;
    wgsLongitude += longitude - gcjLongitude;
  }

  return [wgsLatitude, wgsLongitude];
}

export function gcj02ToBd09(latitude: number, longitude: number): [number, number] {
  const radius = Math.sqrt(longitude * longitude + latitude * latitude) + 0.00002 * Math.sin(latitude * BD_FACTOR);
  const theta = Math.atan2(latitude, longitude) + 0.000003 * Math.cos(longitude * BD_FACTOR);
  return [radius * Math.sin(theta) + 0.006, radius * Math.cos(theta) + 0.0065];
}

export function bd09ToGcj02(latitude: number, longitude: number): [number, number] {
  const x = longitude - 0.0065;
  const y = latitude - 0.006;
  const radius = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * BD_FACTOR);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * BD_FACTOR);
  return [radius * Math.sin(theta), radius * Math.cos(theta)];
}

/** WGS-84（数据库里的值） -> 底图坐标系 */
export function toMapCoordinate(
  latitude: number,
  longitude: number,
  system: MapCoordinateSystem,
): [number, number] {
  switch (system) {
    case MapCoordinateSystem.Gcj02: {
      return wgs84ToGcj02(latitude, longitude);
    }
    case MapCoordinateSystem.Bd09: {
      const [gcjLatitude, gcjLongitude] = wgs84ToGcj02(latitude, longitude);
      return gcj02ToBd09(gcjLatitude, gcjLongitude);
    }
    default: {
      return [latitude, longitude];
    }
  }
}

/** 底图坐标系 -> WGS-84（数据库里的值） */
export function fromMapCoordinate(
  latitude: number,
  longitude: number,
  system: MapCoordinateSystem,
): [number, number] {
  switch (system) {
    case MapCoordinateSystem.Gcj02: {
      return gcj02ToWgs84(latitude, longitude);
    }
    case MapCoordinateSystem.Bd09: {
      const [gcjLatitude, gcjLongitude] = bd09ToGcj02(latitude, longitude);
      return gcj02ToWgs84(gcjLatitude, gcjLongitude);
    }
    default: {
      return [latitude, longitude];
    }
  }
}
