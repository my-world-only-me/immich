<script lang="ts" module>
  import mapboxRtlUrl from '@mapbox/mapbox-gl-rtl-text?url';
  import { addProtocol, setRTLTextPlugin, setWorkerUrl } from 'maplibre-gl';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
  import { Protocol } from 'pmtiles';

  let protocol = new Protocol();
  setWorkerUrl(workerUrl);
  void addProtocol('pmtiles', protocol.tile);
  void setRTLTextPlugin(mapboxRtlUrl, true);
</script>

<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
  import MapSettingsModal from '$lib/modals/MapSettingsModal.svelte';
  import { mapSettings } from '$lib/stores/preferences.store';
  import { getAssetMediaUrl, handlePromiseError } from '$lib/utils';
  import { getMapMarkers, MapCoordinateSystem, type MapMarkerResponseDto } from '@immich/sdk';
  import { Alert, Container, Icon, modalManager, Text, Theme, themeManager } from '@immich/ui';
  import { mdiCog, mdiImageMultiple, mdiMap, mdiMapMarker } from '@mdi/js';
  import type { Feature, GeoJsonProperties, Geometry, Point } from 'geojson';
  import { isEqual, omit } from 'lodash-es';
  import { DateTime, Duration } from 'luxon';
  import {
    GlobeControl,
    LngLat,
    LngLatBounds,
    Marker,
    type GeoJSONSource,
    type LngLatLike,
    type Map,
    type MapMouseEvent,
  } from 'maplibre-gl';
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { t } from 'svelte-i18n';
  import {
    AttributionControl,
    Control,
    ControlButton,
    ControlGroup,
    GeoJSON,
    GeolocateControl,
    MapLibre,
    MarkerLayer,
    NavigationControl,
    Popup,
    ScaleControl,
  } from 'svelte-maplibre';
  import { fromMapCoordinate, toMapCoordinate } from './coordinate-transform';
  import { getProviderStyle } from './map-provider-styles';
  import type { SelectionBBox } from './types';

  interface Props {
    mapMarkers?: MapMarkerResponseDto[];
    showSettings?: boolean;
    zoom?: number | undefined;
    center?: LngLatLike | undefined;
    hash?: boolean;
    simplified?: boolean;
    clickable?: boolean;
    useLocationPin?: boolean;
    onOpenInMapView?: (() => Promise<void> | void) | undefined;
    onSelect?: (assetIds: string[]) => void;
    onClusterSelect?: (assetIds: string[], bbox: SelectionBBox) => void;
    onViewportClose?: () => void;
    viewportGridActive?: boolean;
    autoOpenPanel?: boolean;
    onClickPoint?: ({ lat, lng }: { lat: number; lng: number }) => void;
    popup?: import('svelte').Snippet<[{ marker: MapMarkerResponseDto }]>;
    rounded?: boolean;
    showSimpleControls?: boolean;
    autoFitBounds?: boolean;
  }

  let {
    mapMarkers = $bindable(),
    showSettings = true,
    zoom = undefined,
    center = $bindable(undefined),
    hash = false,
    simplified = false,
    clickable = false,
    useLocationPin = false,
    onOpenInMapView = undefined,
    onSelect = () => {},
    onClusterSelect,
    onViewportClose,
    viewportGridActive = false,
    autoOpenPanel = false,
    onClickPoint = () => {},
    popup,
    rounded = false,
    showSimpleControls = true,
    autoFitBounds = true,
  }: Props = $props();

  // 底图坐标系：高德 / 腾讯 是 GCJ-02，与库里存的 WGS-84 相差 300~600 米，
  // 渲染标记前要正转换，用地图坐标反查数据前要逆转换。
  function currentCoordinateSystem(): MapCoordinateSystem {
    try {
      return serverConfigManager.value.mapCoordinateSystem ?? MapCoordinateSystem.Wgs84;
    } catch {
      // server config 尚未就绪时先按 WGS-84 处理，渲染后会自行修正
      return MapCoordinateSystem.Wgs84;
    }
  }

  const coordinateSystem = $derived(currentCoordinateSystem());

  // Calculate initial bounds from markers once during initialization
  const initialBounds = (() => {
    if (!autoFitBounds || center || zoom !== undefined || !mapMarkers || mapMarkers.length === 0) {
      return undefined;
    }

    const system = currentCoordinateSystem();
    const bounds = new LngLatBounds();
    for (const marker of mapMarkers) {
      const [latitude, longitude] = toMapCoordinate(marker.lat, marker.lon, system);
      bounds.extend([longitude, latitude]);
    }
    return bounds;
  })();

  let map: Map | undefined = $state();
  let marker: Marker | null = null;
  let abortController: AbortController;

  const mapTheme = $derived($mapSettings.allowDarkMode ? themeManager.value : Theme.Light);
  // 内置地图源直接返回 style 对象；immich / custom 回退到管理端配置的 style URL
  const styleUrl = $derived(
    getProviderStyle(serverConfigManager.value.mapProvider, mapTheme) ??
      (mapTheme === Theme.Dark
        ? serverConfigManager.value.mapDarkStyleUrl
        : serverConfigManager.value.mapLightStyleUrl),
  );

  export function addClipMapMarker(lng: number, lat: number) {
    if (!map) {
      return;
    }

    if (marker) {
      marker.remove();
    }

    const [mapLatitude, mapLongitude] = toMapCoordinate(lat, lng, coordinateSystem);
    center = { lng: mapLongitude, lat: mapLatitude };
    marker = new Marker().setLngLat([mapLongitude, mapLatitude]).addTo(map);
  }

  function handleAssetClick(assetId: string, map: Map | null) {
    if (!map) {
      return;
    }
    onSelect([assetId]);
  }

  async function handleClusterClick(clusterId: number, map: Map | null) {
    if (!map) {
      return;
    }

    const mapSource = map.getSource('geojson') as GeoJSONSource;
    const leaves = await mapSource.getClusterLeaves(clusterId, 10_000, 0);
    const ids = leaves.map((leaf) => leaf.properties?.id as string);

    if (onClusterSelect && ids.length > 1) {
      const [firstLongitude, firstLatitude] = (leaves[0].geometry as Point).coordinates;
      let west = firstLongitude;
      let south = firstLatitude;
      let east = firstLongitude;
      let north = firstLatitude;

      for (const leaf of leaves.slice(1)) {
        const [longitude, latitude] = (leaf.geometry as Point).coordinates;
        west = Math.min(west, longitude);
        south = Math.min(south, latitude);
        east = Math.max(east, longitude);
        north = Math.max(north, latitude);
      }

      // 地图坐标 -> WGS-84，bbox 会用于服务端查询
      const [southWestLatitude, southWestLongitude] = fromMapCoordinate(south, west, coordinateSystem);
      const [northEastLatitude, northEastLongitude] = fromMapCoordinate(north, east, coordinateSystem);

      const bbox = {
        west: southWestLongitude,
        south: southWestLatitude,
        east: northEastLongitude,
        north: northEastLatitude,
      };
      onClusterSelect(ids, bbox);
      return;
    }

    onSelect(ids);
  }

  function handleMapClick(event: MapMouseEvent) {
    if (!clickable) {
      return;
    }

    const { lng, lat } = event.lngLat;
    // 回调方需要 WGS-84（会写回数据库），标记本身用地图坐标
    const [wgsLatitude, wgsLongitude] = fromMapCoordinate(lat, lng, coordinateSystem);
    onClickPoint({ lng: wgsLongitude, lat: wgsLatitude });

    if (marker) {
      marker.remove();
    }

    if (map) {
      marker = new Marker().setLngLat([lng, lat]).addTo(map);
    }
  }

  type FeaturePoint = Feature<Point, { id: string; city: string | null; state: string | null; country: string | null }>;

  const asFeature = (marker: MapMarkerResponseDto): FeaturePoint => {
    const [latitude, longitude] = toMapCoordinate(marker.lat, marker.lon, coordinateSystem);
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [longitude, latitude] },
      properties: {
        id: marker.id,
        city: marker.city,
        state: marker.state,
        country: marker.country,
      },
    };
  };

  const asMarker = (feature: Feature<Geometry, GeoJsonProperties>): MapMarkerResponseDto => {
    const featurePoint = feature as FeaturePoint;
    const coords = LngLat.convert(featurePoint.geometry.coordinates as [number, number]);
    const [latitude, longitude] = fromMapCoordinate(coords.lat, coords.lng, coordinateSystem);
    return {
      lat: latitude,
      lon: longitude,
      id: featurePoint.properties.id,
      city: featurePoint.properties.city,
      state: featurePoint.properties.state,
      country: featurePoint.properties.country,
    };
  };

  function getFileCreatedDates() {
    const { relativeDate, dateAfter, dateBefore } = $mapSettings;

    if (relativeDate) {
      const duration = Duration.fromISO(relativeDate);
      return {
        fileCreatedAfter: duration.isValid ? DateTime.now().minus(duration).toUTC().toISO() : undefined,
      };
    }

    return {
      // $mapSettings stores no value as an empty string
      fileCreatedAfter: dateAfter || undefined,
      fileCreatedBefore: dateBefore || undefined,
    };
  }

  async function loadMapMarkers() {
    if (abortController) {
      abortController.abort();
    }
    abortController = new AbortController();

    const { includeArchived, onlyFavorites, withPartners, withSharedAlbums } = $mapSettings;
    const { fileCreatedAfter, fileCreatedBefore } = getFileCreatedDates();

    return await getMapMarkers(
      {
        isArchived: includeArchived || undefined,
        isFavorite: onlyFavorites || undefined,
        fileCreatedAfter,
        fileCreatedBefore,
        withPartners: withPartners || undefined,
        withSharedAlbums: withSharedAlbums || undefined,
      },
      {
        signal: abortController.signal,
      },
    );
  }

  const handleSettingsClick = async () => {
    const settings = await modalManager.show(MapSettingsModal);
    if (settings) {
      const shouldUpdate = !isEqual(omit(settings, 'allowDarkMode'), omit($mapSettings, 'allowDarkMode'));
      $mapSettings = settings;

      if (shouldUpdate) {
        mapMarkers = await loadMapMarkers();
      }
    }
  };

  afterNavigate(() => {
    if (!map) {
      return;
    }

    map.resize();

    if (location.hash) {
      const hashChangeEvent = new HashChangeEvent('hashchange');
      // eslint-disable-next-line unicorn/no-unnecessary-global-this
      globalThis.dispatchEvent(hashChangeEvent);
    }
  });

  onMount(async () => {
    if (!mapMarkers) {
      mapMarkers = await loadMapMarkers();
    }
    if (autoOpenPanel) {
      // Wait for the map to finish rendering before opening the panel
      await tick();
      if (map) {
        map.resize();
        await map.once('idle');
        handleViewportSelect();
      }
    }
  });

  onDestroy(() => {
    abortController?.abort();
  });

  $effect(() => {
    map?.setStyle(styleUrl, {
      transformStyle: (previousStyle, nextStyle) => {
        if (previousStyle) {
          // Preserves the custom map markers from the previous style when the theme is switched
          // Required until https://github.com/dimfeld/svelte-maplibre/issues/146 is fixed
          const customLayers = previousStyle.layers.filter((l) => l.type === 'fill' && l.source === 'geojson');
          const layers = nextStyle.layers.concat(customLayers);
          const sources = nextStyle.sources;

          for (const [key, value] of Object.entries(previousStyle.sources || {})) {
            if (key.startsWith('geojson')) {
              sources[key] = value;
            }
          }

          return {
            ...nextStyle,
            sources,
            layers,
          };
        }
        return nextStyle;
      },
    });
  });

  $effect(() => {
    if (!center || !zoom) {
      return;
    }

    untrack(() => map?.jumpTo({ center, zoom }));
  });

  const handleViewportSelect = () => {
    if (!map || !onClusterSelect || !mapMarkers) {
      return;
    }
    const bounds = map.getBounds();
    const west = bounds.getWest();
    const east = bounds.getEast();

    // When zoomed out enough to see the whole world, show all markers
    const showAll = east - west >= 360;
    const visibleIds = showAll
      ? mapMarkers.map(({ id }) => id)
      : mapMarkers
          .filter(({ lon, lat }) => {
            const [mapLatitude, mapLongitude] = toMapCoordinate(lat, lon, coordinateSystem);
            return bounds.contains([mapLongitude, mapLatitude]);
          })
          .map(({ id }) => id);

    // 地图坐标 -> WGS-84，bbox 会用于服务端查询
    const [southWestLatitude, southWestLongitude] = fromMapCoordinate(bounds.getSouth(), west, coordinateSystem);
    const [northEastLatitude, northEastLongitude] = fromMapCoordinate(bounds.getNorth(), east, coordinateSystem);

    const bbox: SelectionBBox = {
      west: showAll ? -180 : southWestLongitude,
      south: showAll ? -90 : southWestLatitude,
      east: showAll ? 180 : northEastLongitude,
      north: showAll ? 90 : northEastLatitude,
    };
    onClusterSelect(visibleIds, bbox);
  };

  const handleMoveEnd = () => {
    if (viewportGridActive && !assetViewerManager.isViewing) {
      handleViewportSelect();
    }
  };

  const onAssetsChanged = async () => {
    mapMarkers = await loadMapMarkers();
  };
</script>

<OnEvents onAssetsDelete={onAssetsChanged} onAssetsArchive={onAssetsChanged} onAssetsUnarchive={onAssetsChanged} />
<svelte:boundary>
  <!--  We handle style loading ourselves so we set style blank here -->
  <MapLibre
    {hash}
    style=""
    class="h-full {rounded ? 'rounded-2xl' : 'rounded-none'}"
    {zoom}
    {center}
    bounds={initialBounds}
    fitBoundsOptions={{ padding: 50, maxZoom: 15 }}
    attributionControl={false}
    diffStyleUpdates={true}
    onload={(event: Map) => {
      event.setMaxZoom(18);
      event.on('click', handleMapClick);
      event.on('moveend', handleMoveEnd);
      if (!simplified) {
        event.addControl(new GlobeControl(), 'top-left');
      }
    }}
    bind:map
  >
    {#snippet children({ map }: { map: Map })}
      {#if showSimpleControls}
        <NavigationControl position="top-left" showCompass={!simplified} />

        {#if !simplified}
          <GeolocateControl position="top-left" />
          {#if onClusterSelect}
            <Control position="top-left">
              <ControlGroup>
                <ControlButton onclick={() => (viewportGridActive ? onViewportClose?.() : handleViewportSelect())}>
                  <Icon title={$t('show_photos_in_area')} icon={mdiImageMultiple} size="70%" class="text-black/80" />
                </ControlButton>
              </ControlGroup>
            </Control>
          {/if}
          <ScaleControl />
          <AttributionControl compact={false} />
        {/if}
      {/if}

      {#if showSettings}
        <Control>
          <ControlGroup>
            <ControlButton onclick={handleSettingsClick}>
              <Icon icon={mdiCog} size="70%" class="text-black/80" />
            </ControlButton>
          </ControlGroup>
        </Control>
      {/if}

      {#if onOpenInMapView && showSimpleControls}
        <Control position="top-right">
          <ControlGroup>
            <ControlButton onclick={() => onOpenInMapView()}>
              <Icon title={$t('open_in_map_view')} icon={mdiMap} size="100%" class="text-black/80" />
            </ControlButton>
          </ControlGroup>
        </Control>
      {/if}

      <GeoJSON
        data={{
          type: 'FeatureCollection',
          features: mapMarkers?.map((marker) => asFeature(marker)) ?? [],
        }}
        id="geojson"
        cluster={{ radius: 35, maxZoom: 18 }}
      >
        <MarkerLayer
          applyToClusters
          asButton
          onclick={(event) => handlePromiseError(handleClusterClick(event.feature.properties?.cluster_id, map))}
        >
          {#snippet children({ feature })}
            <div
              class="flex size-10 items-center justify-center rounded-full bg-immich-primary font-mono font-bold text-white opacity-90 shadow-lg transition-all duration-200 hover:bg-immich-dark-primary hover:text-immich-dark-bg"
            >
              {feature.properties?.point_count?.toLocaleString()}
            </div>
          {/snippet}
        </MarkerLayer>
        <MarkerLayer
          applyToClusters={false}
          asButton
          onclick={(event) => {
            if (!popup) {
              handleAssetClick(event.feature.properties?.id, map);
            }
          }}
        >
          {#snippet children({ feature }: { feature: Feature })}
            {#if useLocationPin}
              <Icon icon={mdiMapMarker} size="50px" class="translate-y-[calc(5px-50%)] text-primary" />
            {:else}
              <img
                src={getAssetMediaUrl({ id: feature.properties?.id })}
                class="size-15 rounded-full border-2 border-immich-primary bg-immich-primary object-cover shadow-lg transition-all duration-200 hover:scale-150 hover:border-immich-dark-primary"
                alt={feature.properties?.city && feature.properties.country
                  ? $t('map_marker_for_image', {
                      values: { city: feature.properties.city, country: feature.properties.country },
                    })
                  : $t('map_marker_with_image')}
              />
            {/if}
            {#if popup}
              <Popup offset={[0, -30]} openOn="click" closeOnClickOutside>
                {@render popup({ marker: asMarker(feature) })}
              </Popup>
            {/if}
          {/snippet}
        </MarkerLayer>
      </GeoJSON>
    {/snippet}
  </MapLibre>

  {#snippet failed()}
    <Container size="small" class="p-2">
      <Alert color="warning" title={$t('errors.unable_to_load_map')} size={simplified ? 'medium' : 'large'}>
        <Text size={simplified ? 'small' : 'medium'}>{$t('errors.unable_to_load_map_description')}</Text>
      </Alert>
    </Container>
  {/snippet}
</svelte:boundary>
