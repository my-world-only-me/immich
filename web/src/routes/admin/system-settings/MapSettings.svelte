<script lang="ts">
  import { getProviderCoordinateSystem } from '$lib/components/shared-components/map/map-provider-styles';
  import SettingAccordion from '$lib/components/shared-components/settings/SettingAccordion.svelte';
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import SettingButtonsRow from '$lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import FormatMessage from '$lib/elements/FormatMessage.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import { MapCoordinateSystem, MapProvider } from '@immich/sdk';
  import { Link } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';
  import SettingSelect from './SettingSelect.svelte';

  const disabled = $derived(featureFlagsManager.value.configFile);
  const config = $derived(systemConfigManager.value);
  let configToEdit = $state(systemConfigManager.cloneValue());

  // 只有「Immich 默认」和「自定义」会用到下面的 style URL，内置地图源自己带 style
  const styleUrlEditable = $derived(
    configToEdit.map.provider === MapProvider.Immich || configToEdit.map.provider === MapProvider.Custom,
  );

  // 内置地图源自带坐标系（高德 / 腾讯 = GCJ-02），切换时自动带出，仍可手动覆盖
  const handleProviderChange = (provider: string | number) => {
    configToEdit.map.coordinateSystem = getProviderCoordinateSystem(provider as MapProvider);
  };
</script>

<div class="mt-2">
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" onsubmit={(event) => event.preventDefault()}>
      <div class="flex flex-col gap-4">
        <SettingAccordion key="map" title={$t('admin.map_settings')} subtitle={$t('admin.map_settings_description')}>
          <div class="ms-4 mt-4 flex flex-col gap-4">
            <SettingSwitch
              title={$t('admin.map_enable_description')}
              subtitle={$t('admin.map_implications')}
              {disabled}
              bind:checked={configToEdit.map.enabled}
            />

            <hr />

            <SettingSelect
              name="map-provider"
              label={$t('admin.map_provider')}
              desc={$t('admin.map_provider_description')}
              bind:value={configToEdit.map.provider}
              onSelect={handleProviderChange}
              disabled={disabled || !configToEdit.map.enabled}
              isEdited={configToEdit.map.provider !== config.map.provider}
              options={[
                { value: MapProvider.Immich, text: $t('admin.map_provider_immich') },
                { value: MapProvider.Amap, text: $t('admin.map_provider_amap') },
                { value: MapProvider.AmapSatellite, text: $t('admin.map_provider_amap_satellite') },
                { value: MapProvider.Tencent, text: $t('admin.map_provider_tencent') },
                { value: MapProvider.Osm, text: $t('admin.map_provider_osm') },
                { value: MapProvider.Carto, text: $t('admin.map_provider_carto') },
                { value: MapProvider.Custom, text: $t('admin.map_provider_custom') },
              ]}
            />

            <SettingSelect
              name="map-coordinate-system"
              label={$t('admin.map_coordinate_system')}
              desc={$t('admin.map_coordinate_system_description')}
              bind:value={configToEdit.map.coordinateSystem}
              disabled={disabled || !configToEdit.map.enabled}
              isEdited={configToEdit.map.coordinateSystem !== config.map.coordinateSystem}
              options={[
                { value: MapCoordinateSystem.Wgs84, text: $t('admin.map_coordinate_system_wgs84') },
                { value: MapCoordinateSystem.Gcj02, text: $t('admin.map_coordinate_system_gcj02') },
                { value: MapCoordinateSystem.Bd09, text: $t('admin.map_coordinate_system_bd09') },
              ]}
            />

            <hr />

            <SettingInputField
              inputType={SettingInputFieldType.TEXT}
              label={$t('admin.map_light_style')}
              description={$t('admin.map_style_description')}
              bind:value={configToEdit.map.lightStyle}
              disabled={disabled || !configToEdit.map.enabled || !styleUrlEditable}
              isEdited={configToEdit.map.lightStyle !== config.map.lightStyle}
            />
            <SettingInputField
              inputType={SettingInputFieldType.TEXT}
              label={$t('admin.map_dark_style')}
              description={$t('admin.map_style_description')}
              bind:value={configToEdit.map.darkStyle}
              disabled={disabled || !configToEdit.map.enabled || !styleUrlEditable}
              isEdited={configToEdit.map.darkStyle !== config.map.darkStyle}
            />
          </div></SettingAccordion
        >

        <SettingAccordion key="reverse-geocoding" title={$t('admin.map_reverse_geocoding_settings')}>
          {#snippet subtitleSnippet()}
            <p class="text-sm dark:text-immich-dark-fg">
              <FormatMessage key="admin.map_manage_reverse_geocoding_settings">
                {#snippet children({ message })}
                  <Link href="https://docs.immich.app/features/reverse-geocoding">{message}</Link>
                {/snippet}
              </FormatMessage>
            </p>
          {/snippet}
          <div class="ms-4 mt-4 flex flex-col gap-4">
            <SettingSwitch
              title={$t('admin.map_reverse_geocoding_enable_description')}
              {disabled}
              bind:checked={configToEdit.reverseGeocoding.enabled}
            />
          </div></SettingAccordion
        >

        <SettingButtonsRow bind:configToEdit keys={['map', 'reverseGeocoding']} {disabled} />
      </div>
    </form>
  </div>
</div>
