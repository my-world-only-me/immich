<script lang="ts">
  import type { Action } from '$lib/components/asset-viewer/actions/action';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import NsfwAssetData from '$lib/components/utilities-page/nsfw-assets/nsfw-asset-data.svelte';
  import Portal from '$lib/elements/Portal.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { handlePromiseError } from '$lib/utils';
  import { getNextAsset, getPreviousAsset } from '$lib/utils/asset-utils';
  import { navigate } from '$lib/utils/navigation';
  import type { AssetResponseDto } from '@immich/sdk';
  import { AssetVisibility, updateAssets } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  let assets = $state(data.assets);
  let asset = $derived(data.asset);
  let selectedIds = $state<Set<string>>(new Set());

  $effect(() => {
    if (asset) {
      assetViewerManager.setAsset(asset);
    }
  });

  const onRandom = async () => {
    if (assets.length <= 0) {
      return undefined;
    }
    const index = Math.floor(Math.random() * assets.length);
    const asset = assets[index];
    await onViewAsset(asset);
    return asset;
  };

  const onAction = (payload: Action) => {
    if (payload.type == 'trash') {
      assets = assets.filter((a) => a.id != payload.asset.id);
      assetViewerManager.showAssetViewer(false);
    }
  };

  const onViewAsset = async (asset: AssetResponseDto) => {
    await navigate({ targetRoute: 'current', assetId: asset.id });
  };

  const assetCursor = $derived({
    current: assetViewerManager.asset!,
    nextAsset: getNextAsset(assets, assetViewerManager.asset),
    previousAsset: getPreviousAsset(assets, assetViewerManager.asset),
  });

  async function hideAsset(assetIds: string[]) {
    await updateAssets({
      assetBulkUpdateDto: {
        ids: assetIds,
        visibility: AssetVisibility.Locked,
      },
    });
  }

  function toggleSelect(id: string) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
    } else {
      selectedIds.add(id);
    }
    selectedIds = new Set(selectedIds);
  }

  async function hideSelectedAssets() {
    if (selectedIds.size === 0) return;

    const ids = Array.from(selectedIds);

    await updateAssets({
      assetBulkUpdateDto: {
        ids,
        visibility: AssetVisibility.Locked,
      },
    });

    assets = assets.filter((a) => !selectedIds.has(a.id));

    selectedIds = new Set();
  }
</script>

<UserPageLayout title={data.meta.title} scrollbar={true}>
  {#if selectedIds.size > 0}
    <div class="mb-4">
      <button
        class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        onclick={hideSelectedAssets}
      >
        {$t('move_to_locked_folder')} ({selectedIds.size})
      </button>
    </div>
  {/if}
  <div class="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
    {#if assets && assets.length > 0}
      {#each assets as asset (asset.id)}
        <div
          class="border rounded-lg p-2 cursor-pointer transition-colors"
          class:bg-green-200={selectedIds.has(asset.id)}
          class:dark:bg-green-900={selectedIds.has(asset.id)}
          onclick={() => toggleSelect(asset.id)}
        >
          <div class="flex justify-between items-center mb-2">
            <input
              type="checkbox"
              checked={selectedIds.has(asset.id)}
              onclick={(event) => event.stopPropagation()}
              onchange={() => toggleSelect(asset.id)}
              class="w-4 h-4 cursor-pointer"
            />
          </div>

          <NsfwAssetData {asset} {onViewAsset} {toggleSelect} />
        </div>
      {/each}
    {:else}
      <p class="text-center text-lg dark:text-white flex place-items-center place-content-center">
        {$t('no_assets_to_show')}
      </p>
    {/if}
  </div>
</UserPageLayout>

{#if assetViewerManager.isViewing}
  {#await import('$lib/components/asset-viewer/AssetViewer.svelte') then { default: AssetViewer }}
    <Portal target="body">
      <AssetViewer
        cursor={assetCursor}
        showNavigation={assets.length > 1}
        {onRandom}
        {onAction}
        onClose={() => {
          assetViewerManager.showAssetViewer(false);
          handlePromiseError(navigate({ targetRoute: 'current', assetId: null }));
        }}
      />
    </Portal>
  {/await}
{/if}
