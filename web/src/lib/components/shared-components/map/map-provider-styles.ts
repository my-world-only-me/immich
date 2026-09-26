/**
 * 内置地图源（栅格瓦片）预设。
 *
 * 这些源都直接返回栅格图片，因此只要拼一个最小的 MapLibre style 即可，
 * 不需要服务端代理（实测高德 / 腾讯 / OSM / Carto 的瓦片接口都带
 * `Access-Control-Allow-Origin: *`）。
 *
 * `immich` 与 `custom` 返回 undefined，调用方应回退到管理端配置的 style URL。
 *
 * 坐标偏移见 ./coordinate-transform.ts：高德与腾讯是 GCJ-02，百度是 BD-09。
 */

import { MapCoordinateSystem, MapProvider } from '@immich/sdk';
import { Theme } from '@immich/ui';
import type { StyleSpecification } from 'maplibre-gl';

const AMAP_ATTRIBUTION = '© 高德地图';
const TENCENT_ATTRIBUTION = '© 腾讯地图';
const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
const CARTO_ATTRIBUTION = '© OpenStreetMap contributors © CARTO';

// 高德 / 腾讯 的瓦片服务器有多个编号子域，MapLibre 不支持 {s} 占位符，
// 这里固定用 01 / rt0，个人自用量级足够。
const AMAP_ROAD_TILES = [
  'https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
];
const AMAP_SATELLITE_TILES = ['https://webst01.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}'];
// 腾讯瓦片是 TMS 方案（y 轴翻转），MapLibre 用 scheme: 'tms' 处理
const TENCENT_TILES = ['https://rt0.map.gtimg.com/tile?z={z}&x={x}&y={y}&styleid=3&version=297'];
const OSM_TILES = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'];
const CARTO_LIGHT_TILES = ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'];
const CARTO_DARK_TILES = ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'];

interface RasterStyleOptions {
  scheme?: 'xyz' | 'tms';
  background: string;
}

function rasterStyle(tiles: string[], attribution: string, options: RasterStyleOptions): StyleSpecification {
  return {
    version: 8,
    sources: {
      base: {
        type: 'raster',
        tiles,
        tileSize: 256,
        scheme: options.scheme ?? 'xyz',
        attribution,
        maxzoom: 18,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': options.background } },
      { id: 'base', type: 'raster', source: 'base' },
    ],
  };
}

/** 返回内置 style；`immich` / `custom` 返回 undefined，由调用方使用配置的 style URL。 */
export function getProviderStyle(provider: MapProvider, theme: Theme): StyleSpecification | undefined {
  const background = theme === Theme.Dark ? '#1a1a1a' : '#f2f2f2';

  switch (provider) {
    case MapProvider.Amap: {
      return rasterStyle(AMAP_ROAD_TILES, AMAP_ATTRIBUTION, { background });
    }
    case MapProvider.AmapSatellite: {
      return rasterStyle(AMAP_SATELLITE_TILES, AMAP_ATTRIBUTION, { background: '#000000' });
    }
    case MapProvider.Tencent: {
      return rasterStyle(TENCENT_TILES, TENCENT_ATTRIBUTION, { scheme: 'tms', background });
    }
    case MapProvider.Osm: {
      return rasterStyle(OSM_TILES, OSM_ATTRIBUTION, { background });
    }
    case MapProvider.Carto: {
      return rasterStyle(theme === Theme.Dark ? CARTO_DARK_TILES : CARTO_LIGHT_TILES, CARTO_ATTRIBUTION, {
        background,
      });
    }
    default: {
      return undefined;
    }
  }
}

/** 各内置地图源对应的坐标系，切换地图源时用它自动带出坐标系。 */
export function getProviderCoordinateSystem(provider: MapProvider): MapCoordinateSystem {
  switch (provider) {
    case MapProvider.Amap:
    case MapProvider.AmapSatellite:
    case MapProvider.Tencent: {
      return MapCoordinateSystem.Gcj02;
    }
    default: {
      return MapCoordinateSystem.Wgs84;
    }
  }
}
